import "@std/dotenv/load";

/** Prefix used for environment variable config options */
const ENVIRONMENT_VARIABLE_PREFIX = "DISCORD_EVENTS_SYNC_";

const getEnv = (name: string, required: boolean = true) => {
  const envName = ENVIRONMENT_VARIABLE_PREFIX + name;
  const value = Deno.env.get(envName);
  if (value) {
    return value;
  }
  if (required) {
    const message = `Environment {${envName}} not found.`;
    throw new Error(message);
  }
};

export const loadEnvConfig = () => {
  const config = {
    settings: {
      eventPrefix: getEnv("EVENT_PREFIX")!,
      commitChanges: getEnv("COMMIT", false)?.toLowerCase() === "true",
    },
    discord: {
      guildId: getEnv("DISCORD_GUILD_ID")!,
      botToken: getEnv("DISCORD_BOT_TOKEN")!,
    },
    googleCalendar: {
      calendarId: getEnv("GOOGLE_CALENDAR_CALENDAR_ID")!,
      serviceAccountKeyJson: getEnv(
        "GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY_JSON",
      )!,
    },
  };

  return config;
};
