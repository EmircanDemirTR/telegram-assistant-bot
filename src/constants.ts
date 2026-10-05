import type { RssSource } from "./types.js";

export const DEFAULT_TIMEZONE = "Europe/Istanbul";
export const DEFAULT_STATE_FILE = "./data/state.json";
export const DEFAULT_OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-001";

/**
 * Hava durumu için varsayılan koordinatlar (İstanbul).
 * BRIEFING_LATITUDE ve BRIEFING_LONGITUDE ile değiştirilebilir.
 */
export const DEFAULT_BRIEFING_LATITUDE = 41.0082;
export const DEFAULT_BRIEFING_LONGITUDE = 28.9784;
export const DEFAULT_BRIEFING_LOCATION_NAME = "İstanbul";

/** Open-Meteo ücretsiz hava durumu API uç noktaları. */
export const DEFAULT_WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast";
export const DEFAULT_ENSEMBLE_API_URL = "https://ensemble-api.open-meteo.com/v1/ensemble";
export const DEFAULT_AIR_QUALITY_API_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const DEFAULT_WEATHER_MODEL = "best_match";
export const DEFAULT_WEATHER_FALLBACK_MODEL = "icon_seamless";
export const DEFAULT_ENSEMBLE_MODELS = ["ecmwf_ifs025", "icon_seamless"] as const;

export const RSS_SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ERROR_DEDUPE_TTL_MS = 12 * 60 * 60 * 1000;

export const AI_CONTEXT_MAX_MESSAGES = 12;
export const AI_CONTEXT_IDLE_RESET_MS = 6 * 60 * 60 * 1000;

export const DEFAULT_HTTP_TIMEOUT_MS = 20_000;
export const TELEGRAM_LONG_POLL_TIMEOUT_SECONDS = 30;
export const TELEGRAM_MAX_MESSAGE_LENGTH = 3900;
export const TELEGRAM_PARAGRAPH_SPLIT_MIN_FILL = 0.5;
export const TELEGRAM_TYPING_REFRESH_MS = 4_000;
export const TELEGRAM_COMMAND_DESCRIPTION_MAX_LENGTH = 256;

export const NEWS_DIGEST_SELECTION_COUNT = 5;
export const NEWS_SELECTION_SPARE = 2;
export const NEWS_WINDOW_MIN_HOURS = 12;
export const NEWS_WINDOW_MAX_HOURS = 36;
export const NEWS_WINDOW_MARGIN_HOURS = 1;

export const BRIEFING_SCHEDULE = {
  morning: { hour: 9, minute: 0, catchUpUntilHour: 13 },
  evening: { hour: 20, minute: 30, catchUpUntilHour: 23 }
} as const;

export const QUIET_HOURS = { startHour: 23, endHour: 7 } as const;

export const DIGEST_MODEL_RETRIES = 1;
export const TECH_DIGEST_WINDOW_HOURS = 48;
export const TECH_DIGEST_SELECTION_COUNT = 5;
export const TECH_DIGEST_INTERVAL_DAYS = 1;

export const NEWS_POOL_LIMIT = 100;
export const TECH_POOL_LIMIT = 80;
export const PROMPT_SUMMARY_CHARS = 220;
export const DIGEST_SUMMARY_TARGET_CHARS = 300;
export const DIGEST_SUMMARY_MAX_CHARS = 400;
export const RSS_PER_SOURCE_LIMIT = 30;

export const SENT_HEADLINE_MEMORY = {
  news: { retentionHours: 36, maxEntries: 24 },
  tech: { retentionHours: 7 * 24, maxEntries: 16 }
} as const;

export const NEWS_RSS_SOURCES: RssSource[] = [
  { name: "BBC Türkçe", url: "https://feeds.bbci.co.uk/turkce/rss.xml" },
  { name: "TRT Haber", url: "https://www.trthaber.com/gundem_articles.rss" },
  { name: "TRT Son Dakika", url: "https://www.trthaber.com/sondakika.rss" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss" },
  { name: "Anadolu Ajansı", url: "https://www.aa.com.tr/tr/rss/default?cat=guncel" },
  { name: "NTV Gündem", url: "https://www.ntv.com.tr/gundem.rss" },
  { name: "Euronews Türkçe", url: "https://tr.euronews.com/rss?format=xml" }
];

export const TECH_SCIENCE_RSS_SOURCES: RssSource[] = [
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "Hacker News", url: "https://news.ycombinator.com/rss" },
  { name: "GitHub Blog", url: "https://github.blog/feed/" },
  { name: "Donanım Haber", url: "https://www.donanimhaber.com/rss/tum/" },
  { name: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/" }
];
