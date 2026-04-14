import { loadEnvConfig } from "./envConfig.ts";
import { GuildScheduledEvent, GuildScheduledEventStatus, StageChannel, VoiceChannel } from "discord.js";

import { DiscordClient } from "./discord.ts";

import { calendar_v3 } from "googleapis";
import { Event } from "./event.ts";
import { GoogleCalendarClient } from "./gcal.ts";

const FOUR_WEEKS = 1000 * 3600 * 24 * 7 * 4;
const DISCORD_LINK_PROPERTY = "discordid";
const envConfig = loadEnvConfig();

const discordClient = new DiscordClient(
  envConfig.discord.guildId,
  envConfig.discord.botToken,
  envConfig.settings.commitChanges,
);

const gCalClient = new GoogleCalendarClient(
  envConfig.googleCalendar.serviceAccountKeyJson,
  envConfig.googleCalendar.calendarId,
  new Date(Date.now() + FOUR_WEEKS),
  envConfig.settings.commitChanges,
);

const processedUnlinkedEvent = async (
  gCalEvent: calendar_v3.Schema$Event,
  discordEvents: GuildScheduledEvent<GuildScheduledEventStatus>[],
  discordChannels: (StageChannel | VoiceChannel)[],
  processedEvents: Set<string>,
) => {
  const dEvents = discordEvents.filter((dEvent) =>
    dEvent.name.toLowerCase().trim() == gCalEvent.summary?.toLowerCase().trim() &&
    new Date(gCalEvent.start?.dateTime ?? 0).getTime() == dEvent.scheduledStartAt?.getTime() &&
    new Date(gCalEvent.end?.dateTime ?? 0).getTime() == dEvent.scheduledEndAt?.getTime()
  );

  if (dEvents.length == 1) {
    console.info(`Linking ${gCalEvent.summary} to ${dEvents[0].id}.`);
    processedEvents.add(dEvents[0].id);
    await gCalClient.addDiscordId(gCalEvent.id ?? "", dEvents[0].id);
  } else if (dEvents.length == 0) {
    //Event doesn't exist in discord, create.
    console.info(`Creating ${gCalEvent.summary} in discord.`);
    const newDEvent = (new Event(gCalEvent)).getDiscordCreateOption(discordChannels, envConfig.settings.eventPrefix);
    const response = await discordClient.createScheduledEvent(
      newDEvent,
    );
    if (response) {
      console.info(`Linking ${gCalEvent.summary} to ${response}.`);
      processedEvents.add(response);
      await gCalClient.addDiscordId(gCalEvent.id ?? "", response);
    }
  }
};

const syncEvents = async () => {
  console.info(`syncing events. Commit: ${envConfig.settings.commitChanges}`);
  let resync = false;

  const discordChannels = await discordClient.getChannels();
  const gCalEvents = await gCalClient.getEvents();

  // filter events created by the bot
  const dScheduledEvents = (await discordClient.getScheduledEvents()).filter((e) =>
    e.name.trim().toUpperCase().startsWith(envConfig.settings.eventPrefix)
  );

  const processedEvents = new Set<string>();
  console.info(`Processing ${gCalEvents.length} Google Calendar Events`);
  //Loop through events where the gcal event hasn't been linked to discord
  for (const gCalEvent of gCalEvents) {
    let updated = false;
    if (gCalEvent.extendedProperties?.private && DISCORD_LINK_PROPERTY in gCalEvent.extendedProperties.private) {
      //Event is linked to discord
      const dScheduledEvent = dScheduledEvents.find((dEvent) =>
        dEvent.id == gCalEvent.extendedProperties!.private![DISCORD_LINK_PROPERTY]
      );

      if (dScheduledEvent) {
        if (gCalEvent.status == "cancelled") {
          //delete from discord
          console.info(`Event ${gCalEvent.summary} deleted from discord`);
          await discordClient.deleteScheduledEvent(dScheduledEvent);
        } else {
          const dEventCompare = new Event(undefined, dScheduledEvent);
          const gEvent = new Event(gCalEvent);

          if (!dEventCompare.equals(gEvent)) {
            //Events are not equal, need to compare.
            if (
              gCalEvent.updated &&
              new Date(gCalEvent.updated).getTime() - parseInt(gCalEvent.extendedProperties?.private?.lastrun) > 10000
            ) {
              //Event updated recently in google calendar
              console.info(`Event ${gCalEvent.summary} updated in gcal`);
              await discordClient.patchScheduledEvent(
                dScheduledEvent.id,
                gEvent.getDiscordCreateOption(discordChannels, envConfig.settings.eventPrefix),
              );
            } else {
              //updated in discord
              console.info(`Event ${gCalEvent.summary} updated in discord`);
              dEventCompare.getGoogleInsertEvent(false);
              await gCalClient.patchEvent(gCalEvent.id ?? "", dEventCompare.getGoogleInsertEvent(false).requestBody!);

              updated = true;
            }
          } else {
            console.info(`Event ${gCalEvent.summary} no action`);
          }
        }

        processedEvents.add(dScheduledEvent.id);
      } else {
        if (gCalEvent.status != "cancelled") {
          console.info(`Event ${gCalEvent.summary} deleted in discord`);
          await gCalClient.deleteEvent(gCalEvent.id!);
        }
      }
    } else if (gCalEvent.status !== "cancelled") {
      //Event isn't linked
      await processedUnlinkedEvent(gCalEvent, dScheduledEvents, discordChannels, processedEvents);
      updated = true;
    }

    if (!updated && gCalEvent.status !== "cancelled") {
      console.info(`Updating gcal last run for ${gCalEvent.summary} Start: ${gCalEvent.start?.dateTime}`);
      await gCalClient.updateEvent(gCalEvent);
    }
  }

  for (const dEvent of dScheduledEvents) {
    if (processedEvents.has(dEvent.id)) {
      continue;
    }

    const event = new Event(undefined, dEvent);
    if (event.recurrence) {
      console.info(`Creating ${event.title} as new event recurring event in google calendar`);
      await gCalClient.insertEvent(event.getGoogleInsertEvent(true));
      await discordClient.deleteScheduledEvent(dEvent);
      await discordClient.createScheduledEvent(
        event.getDiscordCreateOption(discordChannels, envConfig.settings.eventPrefix),
      );
      resync = true;
    } else {
      console.info(`Creating ${event.title} as new event in google calendar`);
      await gCalClient.insertEvent(event.getGoogleInsertEvent(false), dEvent.id);
    }
  }
  return resync;
};

let resync = true;
while (resync) {
  resync = await syncEvents();
  if (!envConfig.settings.commitChanges) {
    resync = false;
  }
}
Deno.exit();
