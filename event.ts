import { calendar_v3 } from "googleapis";
import {
  GuildScheduledEvent,
  GuildScheduledEventCreateOptions,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventRecurrenceRule,
  GuildScheduledEventRecurrenceRuleFrequency,
  GuildScheduledEventRecurrenceRuleNWeekday,
  GuildScheduledEventRecurrenceRuleOptions,
  GuildScheduledEventRecurrenceRuleWeekday,
  GuildScheduledEventStatus,
  StageChannel,
  VoiceChannel,
} from "discord.js";

const RRULE = "RRULE";
const FREQ = "FREQ";
const INTERVAL = "INTERVAL";
const COUNT = "COUNT";
const UNTIL = "UNTIL";
const BYDAY = "BYDAY";

export class Event {
  id: string | null | undefined;
  title: string;
  description: string;
  startDate: Date;
  endDate: Date | null | undefined;
  source: Source;
  location?: string | null | undefined;
  recurrence?: RecurrenceRule;

  constructor(gEvent?: calendar_v3.Schema$Event, dEvent?: GuildScheduledEvent<GuildScheduledEventStatus>) {
    if (dEvent) {
      this.id = dEvent.id;
      this.title = dEvent.name ?? "";
      this.description = dEvent.description ?? "";
      this.endDate = dEvent.scheduledEndAt;
      this.startDate = dEvent.scheduledStartAt ?? new Date();
      this.source = Source.Discord;
      if (dEvent.channel) {
        this.location = `Discord ${"stageInstance" in dEvent.channel ? "Stage" : "Voice"}: ${dEvent.channel.name}`;
      } else {
        this.location = dEvent.entityMetadata?.location;
      }
      this.recurrence = dEvent.recurrenceRule ? this.#parseDiscordRecurrence(dEvent.recurrenceRule) : undefined;
    } else if (gEvent) {
      this.id = gEvent.id;
      this.title = gEvent.summary ?? "";
      this.description = gEvent.description ?? "";
      this.endDate = new Date(gEvent.end?.dateTime ?? "");
      this.startDate = new Date(gEvent.start?.dateTime ?? "");
      this.source = Source.Google;
      this.location = gEvent.location;
      this.recurrence = gEvent.recurrence && gEvent.recurrence.length > 0
        ? this.#parseRecurrenceRule(gEvent.recurrence)
        : undefined;
    } else {
      throw new Error("gEvent or dEvent must be passed");
    }
  }

  #parseDiscordRecurrence(rule: GuildScheduledEventRecurrenceRule): RecurrenceRule {
    return {
      frequency: this.#discordToPlain(rule.frequency),
      interval: rule.interval,
      count: rule.count,
      //startDate: rule.startAt,
      //endDate: rule.endAt,
      weekdays: this.#discordToWeekday(rule.byWeekday),
      weekdayOfMonth: this.#discordToWeekdayOfMonth(rule.byNWeekday),
    } as RecurrenceRule;
  }

  #parseRecurrenceRule(rule: string[]): RecurrenceRule {
    const parts = rule[0].split(":")[1].split(";");
    const recRule: RecurrenceRule = {} as RecurrenceRule;
    for (const part of parts) {
      const [key, value] = part.split("=");
      switch (key) {
        case FREQ:
          recRule.frequency = value as Frequency;
          break;
        case INTERVAL:
          recRule.interval = parseInt(value);
          break;
        case COUNT:
          recRule.count = parseInt(value);
          break;
        case BYDAY:
          recRule.weekdays = recRule.weekdays || [];
          recRule.weekdayOfMonth = recRule.weekdayOfMonth || [];
          for (const dayStr of value.split(",")) {
            // Match optional +/-number (1 or more digits) followed by two uppercase letters
            const match = dayStr.match(/^([+-]?\d+)?([A-Z]{2})$/);
            if (match) {
              const [, num, wd] = match;
              if (num) {
                // It's a "nTH" style (e.g., "1MO", "-1FR")
                recRule.weekdayOfMonth.push({
                  weekday: wd as Weekday,
                  n: parseInt(num),
                });
              } else {
                // Just a weekday string (e.g. "TU")
                recRule.weekdays.push(wd as Weekday);
              }
            }
          }
          break;
      }
    }
    return recRule;
  }

  #discordToPlain(frequency: GuildScheduledEventRecurrenceRuleFrequency): Frequency {
    switch (frequency) {
      case GuildScheduledEventRecurrenceRuleFrequency.Daily:
        return Frequency.DAILY;
      case GuildScheduledEventRecurrenceRuleFrequency.Monthly:
        return Frequency.MONTHLY;
      case GuildScheduledEventRecurrenceRuleFrequency.Weekly:
        return Frequency.WEEKLY;
      case GuildScheduledEventRecurrenceRuleFrequency.Yearly:
        return Frequency.YEARLY;
    }
  }

  #discordToWeekday(weekdays: readonly GuildScheduledEventRecurrenceRuleWeekday[] | null): Weekday[] | null {
    if (weekdays && weekdays.length > 0) {
      const result = [];
      for (const wd of weekdays) {
        result.push(this.#discordEnumToWeedayEnum(wd));
      }
      return result;
    }
    return null;
  }

  #discordToWeekdayOfMonth(
    weekdays: readonly GuildScheduledEventRecurrenceRuleNWeekday[] | null,
  ): WeekdayOfMonth[] | null {
    if (weekdays && weekdays.length > 0) {
      const result = [];
      for (const wd of weekdays) {
        result.push({ weekday: this.#discordEnumToWeedayEnum(wd.day), n: wd.n });
      }
      return result;
    }
    return null;
  }

  #discordEnumToWeedayEnum(weekday: GuildScheduledEventRecurrenceRuleWeekday): Weekday {
    switch (weekday) {
      case GuildScheduledEventRecurrenceRuleWeekday.Monday:
        return Weekday.MO;
      case GuildScheduledEventRecurrenceRuleWeekday.Tuesday:
        return Weekday.TU;
      case GuildScheduledEventRecurrenceRuleWeekday.Wednesday:
        return Weekday.WE;
      case GuildScheduledEventRecurrenceRuleWeekday.Thursday:
        return Weekday.TH;
      case GuildScheduledEventRecurrenceRuleWeekday.Friday:
        return Weekday.FR;
      case GuildScheduledEventRecurrenceRuleWeekday.Saturday:
        return Weekday.SA;
      case GuildScheduledEventRecurrenceRuleWeekday.Sunday:
        return Weekday.SU;
    }
  }

  #plainToDiscord(frequency: Frequency): GuildScheduledEventRecurrenceRuleFrequency {
    switch (frequency) {
      case Frequency.DAILY:
        return GuildScheduledEventRecurrenceRuleFrequency.Daily;
      case Frequency.MONTHLY:
        return GuildScheduledEventRecurrenceRuleFrequency.Monthly;
      case Frequency.WEEKLY:
        return GuildScheduledEventRecurrenceRuleFrequency.Weekly;
      case Frequency.YEARLY:
        return GuildScheduledEventRecurrenceRuleFrequency.Yearly;
      default:
        return GuildScheduledEventRecurrenceRuleFrequency.Yearly;
    }
  }

  #weekdayEnumToDiscordEnum(weekday: Weekday): GuildScheduledEventRecurrenceRuleWeekday {
    switch (weekday) {
      case Weekday.MO:
        return GuildScheduledEventRecurrenceRuleWeekday.Monday;
      case Weekday.TU:
        return GuildScheduledEventRecurrenceRuleWeekday.Tuesday;
      case Weekday.WE:
        return GuildScheduledEventRecurrenceRuleWeekday.Wednesday;
      case Weekday.TH:
        return GuildScheduledEventRecurrenceRuleWeekday.Thursday;
      case Weekday.FR:
        return GuildScheduledEventRecurrenceRuleWeekday.Friday;
      case Weekday.SA:
        return GuildScheduledEventRecurrenceRuleWeekday.Saturday;
      case Weekday.SU:
        return GuildScheduledEventRecurrenceRuleWeekday.Sunday;
    }
  }

  #recurrenceRuleToDiscordRecurrence(rule: RecurrenceRule, startAt: Date): GuildScheduledEventRecurrenceRuleOptions {
    return {
      frequency: this.#plainToDiscord(rule.frequency),
      interval: rule.interval,
      count: rule.count,
      startAt: startAt,
      byWeekday: rule.weekdays && rule.weekdays.length > 0
        ? rule.weekdays.map(this.#weekdayEnumToDiscordEnum)
        : undefined,
      byNWeekday: rule.weekdayOfMonth && rule.weekdayOfMonth.length > 0
        ? rule.weekdayOfMonth.map((wd) => ({
          day: this.#weekdayEnumToDiscordEnum(wd.weekday),
          n: wd.n,
        }))
        : undefined,
    } as GuildScheduledEventRecurrenceRuleOptions;
  }

  #generateRecurrenceRule(rule: RecurrenceRule): string {
    const parts: string[] = [];
    if (rule.frequency) parts.push(`${FREQ}=${rule.frequency}`);
    if (rule.interval !== undefined && rule.interval !== null) parts.push(`${INTERVAL}=${rule.interval}`);
    if (rule.count !== undefined && rule.count !== null) parts.push(`${COUNT}=${rule.count}`);
    if (rule.endDate) parts.push(`${UNTIL}=${rule.endDate.toISOString()}`);
    if (rule.weekdays && rule.weekdays.length > 0) parts.push(`${BYDAY}=${rule.weekdays.join(",")}`);
    if (rule.weekdayOfMonth && rule.weekdayOfMonth.length > 0) {
      // Map to number+weekday format like 1MO, -1FR
      const byDayVal = rule.weekdayOfMonth.map((w) => `${w.n}${w.weekday}`).join(",");
      parts.push(`${BYDAY}=${byDayVal}`);
    }

    return `${RRULE}:${parts.join(";")}`;
  }

  #parseEventLocation = (): [GuildScheduledEventEntityType | undefined, string | undefined] => {
    let deventType = GuildScheduledEventEntityType.External;
    let location = this.location?.trim();
    if (this.location?.startsWith("Discord Voice:")) {
      deventType = GuildScheduledEventEntityType.Voice;
      location = this.location?.split("Discord Voice:")[1]?.trim();
    }
    if (this.location?.startsWith("Discord Stage:")) {
      deventType = GuildScheduledEventEntityType.StageInstance;
      location = this.location?.split("Discord Stage:")[1]?.trim();
    }
    return [deventType, location];
  };

  getDiscordCreateOption(
    discordChannels: (StageChannel | VoiceChannel)[],
    prefix: string,
  ): GuildScheduledEventCreateOptions {
    const [entityType, eventLocation] = this.#parseEventLocation();
    const channelFromLocation = eventLocation
      ? discordChannels?.find((c) => c.name.toLowerCase().includes(eventLocation.toLowerCase()))
      : null;

    if (this.title.indexOf(prefix) < 0) {
      this.title = prefix + " - " + this.title;
    }
    const newDEvent = {
      name: this.title,
      entityMetadata: this.location ? { location: this.location } : undefined,
      description: this.description,
      scheduledStartTime: this.startDate,
      scheduledEndTime: this.endDate,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: entityType,
      channel: channelFromLocation,
      //Not copying over recurrence to discord
      // recurrenceRule: this.recurrence
      //   ? this.#recurrenceRuleToDiscordRecurrence(this.recurrence, this.startDate)
      //   : undefined,
    } as GuildScheduledEventCreateOptions;

    return newDEvent;
  }

  getGoogleInsertEvent(withRecurrence: boolean): calendar_v3.Params$Resource$Events$Insert {
    const newGEvent = {
      requestBody: {
        summary: this.title,
        location: this.location,
        description: this.description,
        start: {
          dateTime: this.startDate.toISOString().split(".")[0] + "-00:00",
          timeZone: "UTC",
        },
        end: {
          dateTime: this.endDate?.toISOString().split(".")[0] + "-00:00",
          timeZone: "UTC",
        },
      },
    } as calendar_v3.Params$Resource$Events$Insert;

    if (withRecurrence && this.recurrence) {
      newGEvent.requestBody!.recurrence = [this.#generateRecurrenceRule(this.recurrence)];
    }

    return newGEvent;
  }

  equals(event: Event): boolean {
    return this.title == event.title &&
      this.location == event.location &&
      this.description == event.description &&
      this.startDate.getTime() == event.startDate.getTime() &&
      this.endDate?.getTime() == event.endDate?.getTime();
  }
}

type RecurrenceRule = {
  frequency: Frequency;
  interval: number;
  count: number;
  startDate: Date;
  endDate: Date | null | undefined;
  weekdays: Weekday[];
  weekdayOfMonth: WeekdayOfMonth[];
};

type WeekdayOfMonth = {
  weekday: Weekday;
  n: number;
};

enum Source {
  Discord,
  Facebook,
  Google,
}

enum Frequency {
  SECONDLY = "SECONDLY",
  MINUTELY = "MINUTELY",
  HOURLY = "HOURLY",
  DAILY = "DAILY",
  WEEKLY = "WEEKLY",
  MONTHLY = "MONTHLY",
  YEARLY = "YEARLY",
}

enum Weekday {
  SU = "SU",
  MO = "MO",
  TU = "TU",
  WE = "WE",
  TH = "TH",
  FR = "FR",
  SA = "SA",
}
