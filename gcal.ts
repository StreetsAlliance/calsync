import { calendar_v3, google } from "googleapis";

export interface IGetCalendarEventsParams {
  /** Breakup recurring events into instances */
  singleEvents: boolean;
  /** ISO Date string */
  timeMin: Date;
  /** ISO Date string */
  timeMax: Date;
  /** Number of events to return */
  maxResults: number;
  /** Sort events by startTime or updated (last modification time) */
  orderBy: "startTime" | "updated";
}
const LAST_RUN = "lastrun";
const DISCORD_ID = "discordid";

export class GoogleCalendarClient {
  #calendarId: string;
  #calendarClient: calendar_v3.Calendar;
  #syncDateRange: { from: Date; to: Date };
  #commit: boolean;

  constructor(serviceAccountKeyJson: string, calendarId: string, dateMax: Date, commit: boolean) {
    this.#calendarId = calendarId;
    this.#commit = commit;
    const jsonKeys = JSON.parse(serviceAccountKeyJson);
    const client = new google.auth.JWT({
      client_id: jsonKeys.client_id,
      key: jsonKeys.private_key,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      email: jsonKeys.client_email,
    });

    this.#syncDateRange = {
      from: new Date(),
      to: dateMax,
    };
    this.#calendarClient = google.calendar({ version: "v3", auth: client });
  }

  public async getEvents() {
    const gCalResponse: calendar_v3.Schema$Event[] = (await this.#calendarClient.events.list({
      calendarId: this.#calendarId,
      singleEvents: true,
      showDeleted: true,
      timeMin: this.#syncDateRange.from.toISOString(),
      timeMax: this.#syncDateRange.to.toISOString(),
      orderBy: "startTime",
    })).data.items ?? [];
    return gCalResponse;
  }

  public async getEvent(eventId: string) {
    return await this.#calendarClient.events.get({ calendarId: this.#calendarId, eventId });
  }

  public async updateEvent(requestBody: calendar_v3.Schema$Event, dEventId?: string) {
    if (!this.#commit) {
      return;
    }

    if (!requestBody.extendedProperties) {
      requestBody.extendedProperties = { private: {} };
    }

    requestBody.extendedProperties!.private![LAST_RUN] = new Date().getTime().toString();
    if (dEventId) {
      requestBody.extendedProperties!.private![DISCORD_ID] = dEventId;
    }

    await this.#calendarClient.events.update({
      calendarId: this.#calendarId,
      eventId: requestBody.id!,
      requestBody,
    });
  }

  public async addDiscordId(eventId: string, dEventId: string) {
    if (!this.#commit) {
      return;
    }

    await this.#calendarClient.events.patch({
      calendarId: this.#calendarId,
      eventId: eventId,
      requestBody: {
        extendedProperties: {
          private: {
            DISCORD_ID: dEventId,
            LAST_RUN: new Date().getTime().toString(),
          },
        },
      },
    });
  }

  public async patchEvent(eventId: string, requestBody: calendar_v3.Schema$Event) {
    if (!this.#commit) {
      return;
    }

    if (!requestBody.extendedProperties) {
      requestBody.extendedProperties = { private: undefined };
    }
    if (!requestBody.extendedProperties.private) {
      requestBody.extendedProperties.private = {};
    }

    requestBody.extendedProperties.private[LAST_RUN] = new Date().getTime().toString();

    await this.#calendarClient.events.patch({
      calendarId: this.#calendarId,
      eventId: eventId,
      requestBody: requestBody,
    });
  }

  public async deleteEvent(eventId: string) {
    if (!this.#commit) {
      return;
    }

    await this.#calendarClient.events.delete({
      calendarId: this.#calendarId,
      eventId: eventId,
    });
  }

  public async insertEvent(event: calendar_v3.Params$Resource$Events$Insert, discordId?: string) {
    if (!this.#commit) {
      return;
    }

    event.calendarId = this.#calendarId;
    event.requestBody!.extendedProperties = { private: { LAST_RUN: new Date().getTime().toString() } };
    if (discordId) {
      event.requestBody!.extendedProperties!.private![DISCORD_ID] = discordId;
    }

    await this.#calendarClient.events.insert(event);
  }
}
