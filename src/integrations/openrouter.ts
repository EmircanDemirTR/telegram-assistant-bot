import { fetchJson } from "../http.js";
import type { ChatMessage, OpenRouterConfig } from "../types.js";

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class OpenRouterClient {
  constructor(private readonly config: OpenRouterConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async complete(messages: ChatMessage[], temperature = 0.4): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error("OpenRouter API key is missing");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "X-Title": this.config.appTitle ?? "telegram-assistant-bot"
    };
    if (this.config.httpReferer) {
      headers["HTTP-Referer"] = this.config.httpReferer;
    }

    const response = await fetchJson<OpenRouterResponse>(this.config.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature
      }),
      timeoutMs: 60_000,
      retries: 1
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("OpenRouter response did not include message content");
    }
    return content;
  }
}
