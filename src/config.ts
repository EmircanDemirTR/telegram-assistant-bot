import {
  DEFAULT_BRIEFING_LATITUDE,
  DEFAULT_BRIEFING_LOCATION_NAME,
  DEFAULT_BRIEFING_LONGITUDE,
  DEFAULT_ENSEMBLE_MODELS,
  DEFAULT_OPENROUTER_API_URL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_STATE_FILE,
  DEFAULT_TIMEZONE,
  DEFAULT_WEATHER_FALLBACK_MODEL,
  DEFAULT_WEATHER_MODEL
} from "./constants.js";
import type { Logger } from "./logger.js";
import type { AppConfig, LogLevel } from "./types.js";

/**
 * Ortam değişkenlerini (process.env) okur ve yapılandırır.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, _logger?: Logger): AppConfig {
  return {
    enabled: parseBoolean(env.BOT_ENABLED, true),
    timezone: trimToUndefined(env.TIMEZONE) ?? DEFAULT_TIMEZONE,
    stateFile: trimToUndefined(env.STATE_FILE) ?? DEFAULT_STATE_FILE,
    logLevel: parseLogLevel(env.LOG_LEVEL),
    telegram: {
      botToken: trimToUndefined(env.TELEGRAM_BOT_TOKEN),
      chatId: trimToUndefined(env.TELEGRAM_CHAT_ID)
    },
    openRouter: {
      apiKey: trimToUndefined(env.OPENROUTER_API_KEY),
      model: trimToUndefined(env.OPENROUTER_MODEL) ?? DEFAULT_OPENROUTER_MODEL,
      apiUrl: trimToUndefined(env.OPENROUTER_API_URL) ?? DEFAULT_OPENROUTER_API_URL,
      httpReferer: trimToUndefined(env.OPENROUTER_HTTP_REFERER),
      appTitle: trimToUndefined(env.OPENROUTER_APP_TITLE) ?? "Telegram Asistan Botu"
    },
    briefing: {
      latitude: parseCoordinate(env.LATITUDE, DEFAULT_BRIEFING_LATITUDE, 90),
      longitude: parseCoordinate(env.LONGITUDE, DEFAULT_BRIEFING_LONGITUDE, 180),
      locationName: trimToUndefined(env.LOCATION_NAME) ?? DEFAULT_BRIEFING_LOCATION_NAME,
      includeNews: parseBoolean(env.BRIEFING_INCLUDE_NEWS, true),
      weatherModel: trimToUndefined(env.WEATHER_MODEL) ?? DEFAULT_WEATHER_MODEL,
      weatherFallbackModel: trimToUndefined(env.WEATHER_FALLBACK_MODEL) ?? DEFAULT_WEATHER_FALLBACK_MODEL,
      useEnsemble: parseBoolean(env.USE_ENSEMBLE, true),
      ensembleModels: parseCsvOr(env.ENSEMBLE_MODELS, [...DEFAULT_ENSEMBLE_MODELS])
    }
  };
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "debug" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return "info";
}

function parseCoordinate(value: string | undefined, defaultValue: number, maxAbs: number): number {
  if (!value) return defaultValue;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > maxAbs) {
    return defaultValue;
  }
  return parsed;
}

function parseCsvOr(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const list = value.split(",").map((item) => item.trim()).filter(Boolean);
  return list.length > 0 ? list : fallback;
}
