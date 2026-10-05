export type LogLevel = "debug" | "info" | "warn" | "error";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface TelegramConfig {
  botToken?: string;
  chatId?: string;
}

export interface OpenRouterConfig {
  apiKey?: string;
  model: string;
  apiUrl: string;
  httpReferer?: string;
  appTitle?: string;
}

export interface BriefingConfig {
  latitude: number;
  longitude: number;
  locationName: string;
  includeNews: boolean;
  weatherModel: string;
  weatherFallbackModel?: string;
  useEnsemble: boolean;
  ensembleModels: string[];
}

export interface AppConfig {
  enabled: boolean;
  timezone: string;
  stateFile: string;
  logLevel: LogLevel;
  telegram: TelegramConfig;
  openRouter: OpenRouterConfig;
  briefing: BriefingConfig;
}

export interface RssSource {
  name: string;
  url: string;
}

export interface RssItem {
  id: string;
  source: string;
  title: string;
  link?: string;
  publishedAt?: string;
  summary?: string;
  alsoReportedBy?: string[];
}

export type DigestBucket = "news" | "tech";

export interface SentHeadline {
  title: string;
  sentAt: string;
}

export type JobId = "morning-briefing" | "evening-briefing";

export interface JobRunInfo {
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  running?: boolean;
  skippedOverlaps?: number;
}

export interface AppState {
  version: 1;
  telegram: {
    offset: number;
  };
  ai: {
    contexts: Record<string, ChatMessage[]>;
    lastActiveAt?: Record<string, string>;
  };
  dedupe: Record<string, string>;
  rss: {
    seen: Record<string, string>;
  };
  digests: {
    techLastDate?: string;
    sentHeadlines?: Partial<Record<DigestBucket, SentHeadline[]>>;
  };
  jobs: Partial<Record<JobId, JobRunInfo>>;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number | string;
  type: string;
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
