import { DEFAULT_HTTP_TIMEOUT_MS } from "./constants.js";

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly origin: string;

  constructor(message: string, status: number, body: string, origin = "") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body.slice(0, 2000);
    this.origin = origin;
  }
}

export class TransportError extends Error {
  readonly origin: string;
  readonly kind: "timeout" | "network";
  readonly timeoutMs: number;
  readonly code?: string;

  constructor(kind: "timeout" | "network", origin: string, timeoutMs: number, cause?: unknown) {
    const code = errorCode(cause);
    super(
      kind === "timeout"
        ? `Zaman aşımı (${timeoutMs} ms): ${origin}`
        : `Ağ hatası${code ? ` (${code})` : ""}: ${origin}`
    );
    this.name = "TransportError";
    this.origin = origin;
    this.kind = kind;
    this.timeoutMs = timeoutMs;
    if (code) {
      this.code = code;
    }
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string" && candidate.code) {
    return candidate.code;
  }
  return errorCode(candidate.cause);
}

const RETRY_AFTER_MAX_MS = 30_000;

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const {
    timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
    retries = 2,
    retryDelayMs = 750,
    ...requestOptions
  } = options;
  const origin = new URL(url).origin;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let waitMs = retryDelayMs * (attempt + 1);

    try {
      const response = await fetch(url, {
        ...requestOptions,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok || !isTransientStatus(response.status) || attempt === retries) {
        return response;
      }

      lastError = new HttpError(`HTTP ${response.status} from ${origin}`, response.status, await response.text(), origin);
      waitMs = Math.max(waitMs, retryAfterMs(response));
    } catch (error) {
      clearTimeout(timeout);
      lastError = isAbortError(error)
        ? new TransportError("timeout", origin, timeoutMs)
        : new TransportError("network", origin, timeoutMs, error);
      if (attempt === retries) {
        break;
      }
    }

    await delay(waitMs);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  if (!header) {
    return 0;
  }
  const seconds = Number.parseFloat(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, RETRY_AFTER_MAX_MS) : 0;
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await fetchWithRetry(url, options);
  const text = await response.text();

  if (!response.ok) {
    const origin = new URL(url).origin;
    throw new HttpError(`HTTP ${response.status} from ${origin}`, response.status, text, origin);
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await fetchWithRetry(url, options);
  const text = await response.text();

  if (!response.ok) {
    const origin = new URL(url).origin;
    throw new HttpError(`HTTP ${response.status} from ${origin}`, response.status, text, origin);
  }

  return text;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function joinUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}
