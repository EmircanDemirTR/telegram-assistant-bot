import {
  TELEGRAM_LONG_POLL_TIMEOUT_SECONDS,
  TELEGRAM_MAX_MESSAGE_LENGTH,
  TELEGRAM_PARAGRAPH_SPLIT_MIN_FILL,
  TELEGRAM_TYPING_REFRESH_MS
} from "../constants.js";
import { toPlainText } from "../format.js";
import { HttpError, delay, fetchJson } from "../http.js";
import type { Logger } from "../logger.js";
import { errorMeta } from "../logger.js";
import type { StateStore } from "../state.js";
import type { TelegramMessage, TelegramUpdate } from "../types.js";

export type TelegramMessageHandler = (message: TelegramMessage) => Promise<void>;

export interface SendOptions {
  silent?: boolean;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

export class TelegramClient {
  private stopped = true;
  private readonly apiBaseUrl: string;

  constructor(
    private readonly botToken: string | undefined,
    private readonly chatId: string | undefined,
    private readonly stateStore: StateStore,
    private readonly logger: Logger,
    apiBaseUrl?: string
  ) {
    this.apiBaseUrl = apiBaseUrl ?? (botToken ? `https://api.telegram.org/bot${botToken}` : "");
  }

  isConfigured(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  configuredChatId(): string | undefined {
    return this.chatId;
  }

  startLongPolling(handler: TelegramMessageHandler): void {
    if (!this.isConfigured()) {
      this.logger.warn("telegram polling skipped; missing bot token or chat id");
      return;
    }

    this.stopped = false;
    void this.pollLoop(handler);
  }

  stop(): void {
    this.stopped = true;
  }

  async sendToConfiguredChat(text: string, options: SendOptions = {}): Promise<void> {
    if (!this.chatId) {
      this.logger.warn("telegram send skipped; missing chat id");
      return;
    }
    await this.sendMessage(this.chatId, text, options);
  }

  async sendMessage(chatId: string | number, text: string, options: SendOptions = {}): Promise<void> {
    if (!this.botToken) {
      this.logger.warn("telegram send skipped; missing bot token");
      return;
    }

    for (const part of splitTelegramMessage(text)) {
      try {
        await this.postMessage(chatId, part, options, "HTML");
      } catch (error) {
        if (!isHtmlRejection(error)) {
          throw error;
        }
        this.logger.warn("telegram rejected html; resending as plain text", errorMeta(error));
        await this.postMessage(chatId, toPlainText(part), options);
      }
    }
  }

  private async postMessage(
    chatId: string | number,
    text: string,
    options: SendOptions,
    parseMode?: "HTML"
  ): Promise<void> {
    const response = await fetchJson<TelegramApiResponse<unknown>>(`${this.apiBaseUrl}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        ...(options.silent ? { disable_notification: true } : {}),
        disable_web_page_preview: true
      }),
      retries: 2,
      timeoutMs: 15_000
    });

    if (!response.ok) {
      throw new Error(response.description ?? "Telegram sendMessage failed");
    }
  }

  async sendChatAction(chatId: string | number, action = "typing"): Promise<void> {
    if (!this.botToken) {
      return;
    }
    try {
      await fetchJson<TelegramApiResponse<boolean>>(`${this.apiBaseUrl}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action }),
        retries: 0,
        timeoutMs: 5_000
      });
    } catch (error) {
      this.logger.debug("telegram chat action failed", errorMeta(error));
    }
  }

  async withTypingIndicator<T>(chatId: string | number, task: () => Promise<T>): Promise<T> {
    void this.sendChatAction(chatId);
    const timer = setInterval(() => void this.sendChatAction(chatId), TELEGRAM_TYPING_REFRESH_MS);
    try {
      return await task();
    } finally {
      clearInterval(timer);
    }
  }

  async deleteMessage(chatId: string | number, messageId: number): Promise<boolean> {
    if (!this.botToken) {
      return false;
    }

    try {
      const response = await fetchJson<TelegramApiResponse<boolean>>(`${this.apiBaseUrl}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
        retries: 0,
        timeoutMs: 10_000
      });
      return response.ok;
    } catch (error) {
      this.logger.warn("telegram message delete failed", errorMeta(error));
      return false;
    }
  }

  async setCommandMenu(commands: Array<{ command: string; description: string }>): Promise<boolean> {
    if (!this.botToken) {
      this.logger.warn("telegram command menu skipped; missing bot token");
      return false;
    }

    try {
      const response = await fetchJson<TelegramApiResponse<boolean>>(`${this.apiBaseUrl}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands, scope: { type: "default" } }),
        retries: 1,
        timeoutMs: 15_000
      });

      if (!response.ok) {
        this.logger.warn("telegram command menu rejected", { description: response.description });
        return false;
      }

      this.logger.info("telegram command menu updated", { count: commands.length });
      return true;
    } catch (error) {
      this.logger.warn("telegram command menu update failed", errorMeta(error));
      return false;
    }
  }

  async deleteWebhook(): Promise<void> {
    if (!this.botToken) {
      throw new Error("Telegram bot token is missing");
    }

    const response = await fetchJson<TelegramApiResponse<boolean>>(`${this.apiBaseUrl}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drop_pending_updates: false }),
      retries: 1,
      timeoutMs: 15_000
    });

    if (!response.ok) {
      throw new Error(response.description ?? "Telegram deleteWebhook failed");
    }
  }

  private async pollLoop(handler: TelegramMessageHandler): Promise<void> {
    while (!this.stopped) {
      try {
        const offset = this.stateStore.get().telegram.offset + 1;
        const updates = await this.getUpdates(offset);

        for (const update of updates) {
          if (update.message) {
            try {
              await handler(update.message);
            } catch (error) {
              this.logger.error("telegram message handler failed", {
                updateId: update.update_id,
                ...errorMeta(error)
              });
            }
          }

          await this.stateStore.update((state) => {
            state.telegram.offset = Math.max(state.telegram.offset, update.update_id);
          });
        }
      } catch (error) {
        this.logger.error("telegram polling error", errorMeta(error));
        await delay(5_000);
      }
    }
  }

  private async getUpdates(offset: number): Promise<TelegramUpdate[]> {
    const url = new URL(`${this.apiBaseUrl}/getUpdates`);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("timeout", String(TELEGRAM_LONG_POLL_TIMEOUT_SECONDS));
    url.searchParams.set("allowed_updates", JSON.stringify(["message"]));

    const response = await fetchJson<TelegramApiResponse<TelegramUpdate[]>>(url.toString(), {
      timeoutMs: (TELEGRAM_LONG_POLL_TIMEOUT_SECONDS + 10) * 1000,
      retries: 1
    });

    if (!response.ok) {
      throw new Error(response.description ?? "Telegram getUpdates failed");
    }

    return response.result;
  }
}

function isHtmlRejection(error: unknown): boolean {
  return error instanceof HttpError && error.status === 400 && /can't parse entities/i.test(error.body);
}

const PARAGRAPH_BREAK = "\n\n";

export function splitTelegramMessage(text: string): string[] {
  if (visibleLength(text) <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let current = "";
  let currentVisible = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
      currentVisible = 0;
    }
  };

  for (const line of text.split(/(?<=\n)/)) {
    const lineVisible = visibleLength(line);
    if (currentVisible + lineVisible <= TELEGRAM_MAX_MESSAGE_LENGTH) {
      current += line;
      currentVisible += lineVisible;
      continue;
    }

    const breakAt = current.lastIndexOf(PARAGRAPH_BREAK);
    const headLength = breakAt + PARAGRAPH_BREAK.length;
    const head = current.slice(0, headLength);
    if (breakAt > 0 && visibleLength(head) >= TELEGRAM_MAX_MESSAGE_LENGTH * TELEGRAM_PARAGRAPH_SPLIT_MIN_FILL) {
      chunks.push(head);
      current = current.slice(headLength);
      currentVisible = visibleLength(current);
      if (currentVisible + lineVisible <= TELEGRAM_MAX_MESSAGE_LENGTH) {
        current += line;
        currentVisible += lineVisible;
        continue;
      }
    }

    flush();

    if (lineVisible <= TELEGRAM_MAX_MESSAGE_LENGTH) {
      current = line;
      currentVisible = lineVisible;
      continue;
    }

    let remaining = line;
    while (remaining.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
      chunks.push(remaining.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH));
      remaining = remaining.slice(TELEGRAM_MAX_MESSAGE_LENGTH);
    }
    current = remaining;
    currentVisible = visibleLength(remaining);
  }

  flush();
  return chunks;
}

function visibleLength(html: string): number {
  return toPlainText(html).length;
}
