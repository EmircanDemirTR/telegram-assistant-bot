import type { LogLevel } from "./types.js";

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const SECRET_KEY_PATTERN = /(token|secret|password|authorization|cookie|api[_-]?key|credential|refresh)/i;

/**
 * Hassas olabilecek alanları loglardan gizler.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactSecrets(nestedValue);
    }
    return result;
  }

  return value;
}

/**
 * JSON formatında güvenli logger oluşturur.
 */
export function createLogger(level: LogLevel = "info"): Logger {
  const shouldLog = (entryLevel: LogLevel) => LEVEL_WEIGHT[entryLevel] >= LEVEL_WEIGHT[level];

  const write = (entryLevel: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (!shouldLog(entryLevel)) {
      return;
    }

    const payload = {
      ts: new Date().toISOString(),
      level: entryLevel,
      msg: message,
      ...(meta ? { meta: redactSecrets(meta) } : {})
    };

    const line = JSON.stringify(payload);
    if (entryLevel === "error" || entryLevel === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}

export function errorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const meta: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
    const http = error as Error & { status?: unknown; body?: unknown; origin?: unknown; code?: unknown; cause?: unknown };
    if (typeof http.status === "number") {
      meta.status = http.status;
    }
    if (typeof http.body === "string" && http.body.length > 0) {
      meta.body = http.body.slice(0, 300);
    }
    if (typeof http.origin === "string" && http.origin) {
      meta.origin = http.origin;
    }
    if (typeof http.code === "string" && http.code) {
      meta.code = http.code;
    }
    if (http.cause instanceof Error) {
      const cause = http.cause as Error & { code?: unknown };
      meta.cause = {
        name: cause.name,
        message: cause.message,
        ...(typeof cause.code === "string" ? { code: cause.code } : {})
      };
    }
    return meta;
  }

  return { error: String(error) };
}
