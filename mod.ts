import { loadEnvConfig } from "./envConfig.ts";
import {
  ChannelType,
  Client,
  Guild,
  GuildScheduledEvent,
  GuildScheduledEventCreateOptions,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  GuildVoiceChannelResolvable,
  StageChannel,
  VoiceChannel,
} from "discord.js";

import { JWT } from "npm:google-auth-library";
import { calendar_v3, google } from "googleapis";

const FOUR_WEEKS = 1000 * 3600 * 24 * 7 * 4;

const envConfig = loadEnvConfig();
const discordClient = new Client({ intents: [] });

const discordApplicationId = envConfig.discord.applicationId;
const syncDateRange = {
  from: new Date(),
  to: new Date(Date.now() + FOUR_WEEKS),
};

const jsonKeys = JSON.parse(envConfig.googleCalendar.serviceAccountKeyJson!);

const client = new JWT({
  client_id: jsonKeys.client_id,
  key: jsonKeys.private_key,
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
  email: jsonKeys.client_email,
});

const gCalClient = google.calendar({ version: "v3", auth: client });

discordClient.login(envConfig.discord.botToken).catch((err) => {
  console.error("Login failed:", err);
  Deno.exit();
});

const calendarToDiscordEvent = (
  discordChannels: (StageChannel | VoiceChannel)[],
  calEvent: calendar_v3.Schema$Event,
): GuildScheduledEventCreateOptions | undefined => {
  const parseDates = (
    start: calendar_v3.Schema$EventDateTime,
    end: calendar_v3.Schema$EventDateTime,
  ) => {
    let startParsed: Date | undefined = undefined;
    let endParsed: Date | undefined = undefined;
    if (start.date && end.date) {
      startParsed = new Date(start.date);
      endParsed = new Date(end.date);
    }
    if (start.dateTime && end.dateTime) {
      startParsed = new Date(start.dateTime);
      endParsed = new Date(end.dateTime);
    }
    return [startParsed, endParsed];
  };
  const parseEventLocation = (
    location: string,
  ): [GuildScheduledEventEntityType | undefined, string | undefined] => {
    if (!location.startsWith("Discord")) {
      return [GuildScheduledEventEntityType.External, location.trim()];
    }
    if (location.startsWith("Discord Voice:")) {
      return [
        GuildScheduledEventEntityType.Voice,
        location.split("Discord Voice:")[1]?.trim(),
      ];
    }
    if (location.startsWith("Discord Stage:")) {
      return [
        GuildScheduledEventEntityType.StageInstance,
        location.split("Discord Stage:")[1]?.trim(),
      ];
    }
    return [undefined, undefined];
  };

  if (
    !calEvent.id || !calEvent.summary || !calEvent.start || !calEvent.end ||
    !calEvent.htmlLink
  ) {
    return undefined;
  }
  const [startDate, endDate] = parseDates(calEvent.start, calEvent.end);
  if (!startDate || !endDate) {
    return undefined;
  }
  const [entityType, eventLocation] = calEvent.location
    ? parseEventLocation(calEvent.location)
    : [GuildScheduledEventEntityType.External, "🤷"];

  if (!entityType || !eventLocation) {
    return undefined;
  }

  let channel: GuildVoiceChannelResolvable | undefined = undefined;
  let entityMetadata: { location: string | undefined } | undefined = undefined;

  const channelFromLocation = discordChannels?.find((c) => c.name.toLowerCase().includes(eventLocation.toLowerCase()));
  switch (entityType) {
    case GuildScheduledEventEntityType.External:
      channel = undefined;
      entityMetadata = { location: eventLocation };
      break;
    case GuildScheduledEventEntityType.Voice:
      entityMetadata = undefined;
      if (channelFromLocation) {
        channel = channelFromLocation;
      } else {
        return undefined;
      }
      break;
    case GuildScheduledEventEntityType.StageInstance:
      if (channelFromLocation) {
        channel = channelFromLocation;
      } else {
        return undefined;
      }
      break;
  }
  const description: string = `${calEvent.description ?? ""}\nCalendar event link: ${calEvent.htmlLink}`.trim();

  const discordEventData: GuildScheduledEventCreateOptions = {
    name: calEvent.summary,
    description,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    channel,
    entityMetadata,
    scheduledStartTime: startDate,
    scheduledEndTime: endDate,
    entityType,
  };

  return discordEventData;
};

const getDiscordEvents = async (guild: Guild): Promise<GuildScheduledEvent<GuildScheduledEventStatus>[]> => {
  return (await guild?.scheduledEvents.fetch())?.values()
    .toArray() ?? [];
};
const getDiscordChannels = async (guild: Guild): Promise<(StageChannel | VoiceChannel)[]> => {
  const discordChannels = await guild?.channels.fetch();
  const voiceStageChannels = discordChannels?.filter(
    (c) =>
      c?.type === ChannelType.GuildStageVoice ||
      c?.type === ChannelType.GuildVoice,
  );
  return voiceStageChannels?.values().toArray() ?? [];
};

const getCalendarEvents = async () => {
  const gCalResponse: calendar_v3.Schema$Event[] = (await gCalClient.events.list({
    calendarId: envConfig.googleCalendar.calendarId,
    singleEvents: true,
    maxResults: 100,
    timeMin: syncDateRange.from.toISOString(),
    timeMax: syncDateRange.to.toISOString(),
    orderBy: "startTime",
  })).data.items ?? [];
  return gCalResponse;
};

const discordApiTimeout = async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
};

const compareEvents = (
  event1: GuildScheduledEventCreateOptions,
  event2: GuildScheduledEvent<GuildScheduledEventStatus>,
): boolean => {
  return !(
    event1.name !== event2.name ||
    (event1.description ?? "") !== (event2.description ?? "") ||
    (event1.channel ?? null) !== (event2.channel ?? null) ||
    event1.privacyLevel !== event2.privacyLevel ||
    event1.entityType !== event2.entityType ||
    (event1.entityMetadata?.location || null) !== (event2.entityMetadata?.location || null) ||
    event1.scheduledStartTime.valueOf() !== event2.scheduledStartAt?.getTime() ||
    event1.scheduledEndTime?.valueOf() !== event2.scheduledEndAt?.getTime()
  );
};

const syncEvents = async () => {
  console.info("syncing events");
  const guild = discordClient.guilds.cache.get(envConfig.discord.guildId);
  if (!guild) {
    return;
  }
  const discordChannels = await getDiscordChannels(guild);
  const gCalEvents = await getCalendarEvents();

  // filter events created by the bot
  const discordEvents = (await getDiscordEvents(guild)).filter((e) => e.creatorId === discordApplicationId);

  if (gCalEvents) {
    console.info(`Received ${gCalEvents.length} calendar events.`);
    if (gCalEvents.length === 0) {
      return;
    }
    const convertedEvents = gCalEvents.map((calEvent) => ({
      calEvent,
      discordEvent: calendarToDiscordEvent(discordChannels, calEvent),
    }));
    try {
      const discordEventsProcessed: Record<string, boolean> = {};
      for (const { calEvent, discordEvent } of convertedEvents) {
        if (calEvent === undefined || discordEvent === undefined) {
          continue;
        }

        const existingDiscordEvent = discordEvents.find(
          (discordEvent) =>
            calEvent.htmlLink !== undefined &&
            discordEvent.description?.endsWith(calEvent.htmlLink!),
        );
        if (existingDiscordEvent) {
          if (compareEvents(discordEvent, existingDiscordEvent)) {
            discordEventsProcessed[existingDiscordEvent.id] = true;
            console.info(
              `${existingDiscordEvent.id}: Event skipped; No update needed.`,
            );
            continue;
          } else {
            const response = await guild?.scheduledEvents.edit(
              existingDiscordEvent.id,
              discordEvent,
            );
            if (response) {
              console.info(`${response.id}: Event updated.`);
              discordEventsProcessed[response.id] = true;
            }
          }
        } else {
          const response = await guild?.scheduledEvents.create(
            discordEvent,
          );
          if (response) {
            console.info(`${response.id}: Event created.`);
            discordEventsProcessed[response.id] = true;
          }
        }
        await discordApiTimeout();
      }

      for (const event of discordEvents) {
        if (discordEventsProcessed[event.id]) {
          continue;
        } else {
          // delete all other events
          await guild.scheduledEvents.delete(
            event.id,
          );
          console.info(`${event.id}: Event deleted.`);
          await discordApiTimeout();
        }
      }
      console.info("Done processing events.");
    } catch (e) {
      console.error(
        `Error while processing events. Error message: ${(e as Error).message}, Error: ${JSON.stringify(e)}.`,
      );
    }
  }
};

discordClient.once("clientReady", async () => {
  await syncEvents();
  Deno.exit();
});
