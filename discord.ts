import {
  ChannelType,
  Client,
  Guild,
  GuildScheduledEvent,
  GuildScheduledEventCreateOptions,
  GuildScheduledEventResolvable,
  GuildScheduledEventStatus,
  StageChannel,
  VoiceChannel,
} from "discord.js";

/**
 * Discord Events API Client.
 * Required Bot Permissions: MANAGE_EVENTS
 */
export class DiscordClient {
  #discordClient: Client;
  #guildId: string;
  #guild: Guild | undefined;
  #commit: boolean;

  constructor(guildId: string, botToken: string, commit: boolean) {
    this.#discordClient = new Client({ intents: [] });
    this.#guildId = guildId;
    this.#guild = undefined;
    this.#commit = commit;

    this.#discordClient.login(botToken).catch((err) => {
      console.error("Login failed:", err);
      Deno.exit();
    });
  }

  private async getGuild(): Promise<void> {
    if (this.#guild) {
      return;
    }
    this.#discordClient.once("clientReady", () => {
      this.#guild = this.#discordClient.guilds.cache.get(this.#guildId);
      if (!this.#guild) {
        console.error("Guild id not found in server");
        Deno.exit();
      }
    });

    while (!this.#guild) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /**
   * Get events on a Discord server.
   *
   * @throws Will throw error if HTTP request was not successful.
   * @param params Used to generate query params for Discord API request.
   * @returns Array of events if successful
   */
  public async getScheduledEvents(): Promise<
    GuildScheduledEvent<GuildScheduledEventStatus>[]
  > {
    await this.getGuild();
    return (await this.#guild?.scheduledEvents.fetch())?.values()
      .toArray() ?? [];
  }

  /**
   * Create event in the discord server.
   * @throws Will throw error if HTTP request was not successful.
   * @param params Event information
   * @returns Event data if successful
   */
  public async createScheduledEvent(
    params: GuildScheduledEventCreateOptions,
  ): Promise<string> {
    if (!this.#commit) {
      return "notcommitid";
    }
    await this.getGuild();
    const response = await this.#guild!.scheduledEvents.create(
      params,
    );
    return response?.id;
  }

  /**
   * Delete event in the discord server.
   * @throws Will throw error if HTTP request was not successful.
   * @param params Event ID to delete
   * @returns Blank response if successful. Status 204.
   */
  public async deleteScheduledEvent(
    params: GuildScheduledEventResolvable,
  ): Promise<void> {
    if (!this.#commit) {
      return;
    }

    await this.getGuild();
    await this.#guild!.scheduledEvents.delete(params);
  }

  /**
   * Patch event in the discord server.
   * @throws Will throw error if HTTP request was not successful.
   * @param params Event ID to patch and updated event information
   * @returns Event data if successful
   */
  public async patchScheduledEvent(
    id: string,
    params: GuildScheduledEventCreateOptions,
  ): Promise<void> {
    if (!this.#commit) {
      return;
    }

    await this.getGuild();
    await this.#guild?.scheduledEvents.edit(
      id,
      params,
    );
  }

  /**
   * Get channels on a Discord server.
   * @throws Will throw error if HTTP request was not successful.
   * @returns Array of pruned channels (id, type) if successful
   */
  public async getChannels(): Promise<(StageChannel | VoiceChannel)[]> {
    await this.getGuild();
    const discordChannels = await this.#guild?.channels.fetch();
    const voiceStageChannels = discordChannels?.filter(
      (c) =>
        c?.type === ChannelType.GuildStageVoice ||
        c?.type === ChannelType.GuildVoice,
    );
    return voiceStageChannels?.values().toArray() ?? [];
  }
}
