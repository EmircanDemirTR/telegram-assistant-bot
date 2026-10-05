import {
  AI_CONTEXT_IDLE_RESET_MS,
  AI_CONTEXT_MAX_MESSAGES,
  BRIEFING_SCHEDULE,
  DIGEST_SUMMARY_MAX_CHARS,
  DIGEST_SUMMARY_TARGET_CHARS,
  ERROR_DEDUPE_TTL_MS,
  NEWS_DIGEST_SELECTION_COUNT,
  NEWS_POOL_LIMIT,
  NEWS_RSS_SOURCES,
  NEWS_SELECTION_SPARE,
  NEWS_WINDOW_MAX_HOURS,
  NEWS_WINDOW_MIN_HOURS,
  PROMPT_SUMMARY_CHARS,
  QUIET_HOURS,
  RSS_PER_SOURCE_LIMIT,
  RSS_SEEN_TTL_MS,
  TECH_DIGEST_SELECTION_COUNT,
  TECH_DIGEST_WINDOW_HOURS,
  TECH_POOL_LIMIT,
  TECH_SCIENCE_RSS_SOURCES,
  TELEGRAM_COMMAND_DESCRIPTION_MAX_LENGTH
} from "./constants.js";
import {
  dedupeSimilarTitles,
  interleaveBySource,
  orderByCoverage,
  partitionRepeatedStories,
  relativeAge
} from "./digests/candidates.js";
import {
  formatNewsDigest,
  formatTechDigest,
  newsCategoryPromptList,
  normalizeNewsCategory
} from "./digests/render.js";
import type { ProcessedNewsItem, RecentRssResult } from "./digests/types.js";
import {
  DIGEST_DIVIDER,
  bold,
  clipText,
  escapeHtml,
  link,
  markdownToTelegramHtml,
  normalizePriority,
  preformatted
} from "./format.js";
import { OpenRouterClient } from "./integrations/openrouter.js";
import { fetchSourceSet } from "./integrations/rss.js";
import { TelegramClient, type SendOptions } from "./integrations/telegram.js";
import {
  FORECAST_DAY_COUNT,
  WeatherClient,
  formatForecast
} from "./integrations/weather.js";
import type { Logger } from "./logger.js";
import { errorMeta } from "./logger.js";
import type { ScheduledJob } from "./scheduler.js";
import {
  hasSeenRssItem,
  pushAiContextMessage,
  recentSentHeadlines,
  rememberRssItem,
  rememberSentHeadlines,
  shouldNotify,
  type StateStore
} from "./state.js";
import { formatDateOnly, formatDateTime, formatTimeOnly, getZonedParts, toDateKey } from "./time.js";
import type {
  AppConfig,
  ChatMessage,
  DigestBucket,
  JobId,
  RssItem,
  RssSource,
  TelegramMessage
} from "./types.js";
import { describeUserFacingError } from "./user-error.js";

export interface WorkerDependencies {
  config: AppConfig;
  logger: Logger;
  stateStore: StateStore;
  telegram: TelegramClient;
  weather: WeatherClient;
  openRouter: OpenRouterClient;
}

export interface CommandContext {
  deps: WorkerDependencies;
  chatId: string;
  argument?: string;
  command: string;
}

export interface BotCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  inMenu: boolean;
  argumentHint?: string;
  run: (context: CommandContext) => Promise<string>;
}

export const BOT_COMMANDS: BotCommandDefinition[] = [
  {
    name: "hava",
    description: "Bugün ve yarın hava durumu: yağış saatleri, nem, rüzgar, UV",
    inMenu: true,
    run: ({ deps }) => weatherReport(deps)
  },
  {
    name: "haber",
    description: "Güncel haber bülteni",
    inMenu: true,
    run: ({ deps }) => getNewsDigestText(deps, "Güncel Haberler")
  },
  {
    name: "teknoloji",
    description: "Teknoloji ve bilim bülteni",
    inMenu: true,
    run: ({ deps }) => getTechDigestText(deps)
  },
  {
    name: "yardim",
    aliases: ["help"],
    description: "Komut listesi",
    inMenu: true,
    run: async () => helpText()
  },
  {
    // Telegram, kullanıcı bota ilk kez "Başlat" düğmesine bastığında /start gönderir;
    // menüde görünmez ama "Bilinmeyen komut" yerine karşılama mesajı döner.
    name: "start",
    description: "Botu başlat",
    inMenu: false,
    run: async () => ["👋 Merhaba! Ben kişisel asistan botunuzum.", "", helpText()].join("\n")
  }
];

export function findCommand(command: string): BotCommandDefinition | undefined {
  const name = command.replace(/^\//, "");
  return BOT_COMMANDS.find(
    (definition) => definition.name === name || definition.aliases?.includes(name)
  );
}

export function buildCommandMenu(): Array<{ command: string; description: string }> {
  return BOT_COMMANDS.filter((definition) => definition.inMenu).map((definition) => ({
    command: definition.name,
    description: definition.description.slice(0, TELEGRAM_COMMAND_DESCRIPTION_MAX_LENGTH)
  }));
}

export function helpText(): string {
  const lines = [bold("Komut Listesi"), ""];
  for (const def of BOT_COMMANDS) {
    if (!def.inMenu) continue;
    const aliases = def.aliases?.map((a) => `/${a}`).join(", ");
    const aliasSuffix = aliases ? ` (${escapeHtml(aliases)})` : "";
    lines.push(`/${def.name}${aliasSuffix} — ${escapeHtml(def.description)}`);
  }
  lines.push("", "Komut olmayan mesajlar doğrudan Yapay Zeka (AI) asistanına iletilir.");
  return lines.join("\n");
}

export async function handleTelegramMessage(
  deps: WorkerDependencies,
  message: TelegramMessage
): Promise<void> {
  const configuredChatId = deps.telegram.configuredChatId();
  const incomingChatId = String(message.chat.id);

  // Eger yapilandirilmis chat id varsa yalnizca o sohbetten gelenleri dinle
  if (configuredChatId && incomingChatId !== configuredChatId) {
    deps.logger.warn("yetkisiz chat id'den mesaj geldi", { chatId: incomingChatId });
    return;
  }

  const text = message.text?.trim();
  if (!text) {
    return;
  }

  const [rawCommand, ...argumentParts] = text.split(/\s+/);
  const command = (rawCommand ?? "").toLowerCase().replace(/@[^\s]+$/, "");
  const argument = argumentParts.join(" ").trim() || undefined;
  const isCommand = command.startsWith("/");

  try {
    if (!isCommand) {
      const answer = await deps.telegram.withTypingIndicator(incomingChatId, () =>
        freeformAssistant(deps, incomingChatId, text)
      );
      await deps.telegram.sendMessage(incomingChatId, markdownToTelegramHtml(answer));
      return;
    }

    const definition = findCommand(command);
    if (!definition) {
      await deps.telegram.sendMessage(
        incomingChatId,
        `Bilinmeyen komut: ${escapeHtml(command)}\n\n${helpText()}`
      );
      return;
    }

    const reply = await deps.telegram.withTypingIndicator(incomingChatId, () =>
      definition.run({ deps, chatId: incomingChatId, argument, command })
    );
    await deps.telegram.sendMessage(incomingChatId, reply);
  } catch (error) {
    deps.logger.error("telegram komut hatasi", {
      command: isCommand ? command : "(serbest metin)",
      ...errorMeta(error)
    });
    await deps.telegram.sendMessage(incomingChatId, `⚠️ ${escapeHtml(describeUserFacingError(error))}`);
  }
}

async function freeformAssistant(deps: WorkerDependencies, chatId: string, text: string): Promise<string> {
  if (!deps.openRouter.isConfigured()) {
    return "Merhaba! Yapay zeka sohbet özelliğini aktifleştirmek için `.env` dosyasında `OPENROUTER_API_KEY` tanımlayabilirsiniz.\n\nŞu komutları hemen kullanabilirsiniz:\n/hava - Hava durumu\n/haber - Güncel haberler\n/teknoloji - Teknoloji bülteni";
  }

  const now = new Date();
  const state = deps.stateStore.get();
  const lastActive = Date.parse(state.ai.lastActiveAt?.[chatId] ?? "");
  const stale = Number.isNaN(lastActive) || now.getTime() - lastActive > AI_CONTEXT_IDLE_RESET_MS;
  const context = stale ? [] : state.ai.contexts[chatId] ?? [];
  const messages: ChatMessage[] = [
    { role: "system", content: assistantSystemPrompt(deps, now) },
    ...context,
    { role: "user", content: text }
  ];

  const answer = await deps.openRouter.complete(messages, 0.4);
  await deps.stateStore.update((nextState) => {
    if (stale) {
      nextState.ai.contexts[chatId] = [];
    }
    pushAiContextMessage(nextState, chatId, { role: "user", content: text }, AI_CONTEXT_MAX_MESSAGES);
    pushAiContextMessage(nextState, chatId, { role: "assistant", content: answer }, AI_CONTEXT_MAX_MESSAGES);
    nextState.ai.lastActiveAt = { ...(nextState.ai.lastActiveAt ?? {}), [chatId]: now.toISOString() };
  });

  return answer;
}

function assistantSystemPrompt(deps: WorkerDependencies, now: Date): string {
  const timezone = deps.config.timezone;
  return [
    "Türkçe cevap veren samimi ve bilgili bir kişisel asistansın. Kısa, net, anlaşılır ve doğrudan cevap ver.",
    `Şu an ${formatDateOnly(now, timezone)}, saat ${formatTimeOnly(now, timezone)} (${timezone}). Kullanıcı ${deps.config.briefing.locationName} konumunda.`,
    "Canlı veriye doğrudan erişimin yoksa hava durumu veya haber sorulursa ilgili bot komutlarını öner: /hava, /haber, /teknoloji.",
    "Cevapların Telegram sohbetinde rahat okunması için kısa paragraflar kullan."
  ].join("\n");
}

async function weatherReport(deps: WorkerDependencies): Promise<string> {
  const timezone = deps.config.timezone;
  const now = new Date();
  const dateKeys = Array.from({ length: FORECAST_DAY_COUNT }, (_, offset) =>
    toDateKey(new Date(now.getTime() + offset * 24 * 60 * 60 * 1000), timezone)
  );

  const forecasts = await deps.weather.forecast(timezone, dateKeys);
  if (forecasts.length === 0) {
    return "🌡️ Hava tahmini şu an alınamıyor. Lütfen biraz sonra tekrar deneyin.";
  }

  return formatForecast(forecasts, now, timezone);
}

export async function getNewsDigestText(
  deps: WorkerDependencies,
  digestTitle: string = "Haber Özeti",
  now: Date = new Date()
): Promise<string> {
  const state = deps.stateStore.get();
  const rssResult = await recentRssItems(
    deps,
    NEWS_RSS_SOURCES,
    NEWS_WINDOW_MAX_HOURS,
    "news",
    NEWS_POOL_LIMIT,
    now
  );

  if (rssResult.items.length === 0) {
    return "📰 Şu an gösterilecek yeni haber bulunmuyor.";
  }

  // Model yoksa veya calismazsa: RSS ogelerini dogrudan listeleyip gonder
  if (!deps.openRouter.isConfigured()) {
    return formatFallbackDigest(digestTitle, rssResult.items.slice(0, 5), rssResult);
  }

  try {
    const alreadySent = recentSentHeadlines(state, "news", now);
    const rankedCount = NEWS_DIGEST_SELECTION_COUNT + NEWS_SELECTION_SPARE;

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `Sen deneyimli bir Türkçe haber editörüsün. Görevin "candidates" listesinden okuyucu için en önemli ${rankedCount} haberi ÖNEM SIRASIYLA (en önemlisi başta) seçmek.
Kurallar:
1. ÖNEM: Ülkeyi ya da dünyayı etkileyen, çok kişiyi ilgilendiren gelişmeleri seç. Magazin, reklam, sıradan adli olayları ele.
2. TEKRAR: "alreadySent" listesindeki haberleri tekrar seçme.
3. YAZIM: Başlık ve özeti akıcı ve doğal Türkçe ile yaz. Özet en fazla iki cümle ve yaklaşık ${DIGEST_SUMMARY_TARGET_CHARS} karakter olsun.
4. KATEGORİ: Aşağıdakilerden birini seç:
${newsCategoryPromptList()}
5. Yalnızca geçerli JSON döndür:
{
  "selected": [
    {
      "index": 0,
      "turkishTitle": "...",
      "category": "gundem",
      "priority": "normal",
      "turkishSummary": "..."
    }
  ]
}`
      },
      {
        role: "user",
        content: JSON.stringify({
          candidates: rssResult.items.map((item, index) => ({
            index,
            source: item.source,
            title: item.title,
            summary: item.summary ? clipText(item.summary, PROMPT_SUMMARY_CHARS) : undefined,
            age: relativeAge(item.publishedAt, now)
          })),
          alreadySent
        })
      }
    ];

    const rawResponse = await deps.openRouter.complete(messages, 0.2);
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Model çıktısında JSON bulunamadı");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      selected?: Array<{
        index: number;
        turkishTitle?: string;
        category?: string;
        priority?: string;
        turkishSummary?: string;
      }>;
    };

    const selectedItems: ProcessedNewsItem[] = [];
    for (const entry of parsed.selected ?? []) {
      const item = rssResult.items[entry.index];
      if (!item) continue;
      selectedItems.push({
        turkishTitle: entry.turkishTitle?.trim() || item.title,
        category: normalizeNewsCategory(entry.category),
        priority: normalizePriority(entry.priority),
        turkishSummary: clipText(entry.turkishSummary?.trim() || item.summary || item.title, DIGEST_SUMMARY_MAX_CHARS),
        item
      });
    }

    const { fresh } = partitionRepeatedStories(selectedItems, alreadySent);
    const finalItems = fresh.slice(0, NEWS_DIGEST_SELECTION_COUNT);

    if (finalItems.length > 0) {
      await deps.stateStore.update((nextState) => {
        rememberSentHeadlines(
          nextState,
          "news",
          finalItems.map((i) => i.turkishTitle),
          now
        );
        for (const i of finalItems) {
          rememberRssItem(nextState, i.item.id, RSS_SEEN_TTL_MS, now);
        }
      });
      return formatNewsDigest(digestTitle, finalItems, rssResult);
    }
  } catch (error) {
    deps.logger.warn("model ile haber bulteni secimi basarisiz, yedek listeye dusuldu", errorMeta(error));
  }

  return formatFallbackDigest(digestTitle, rssResult.items.slice(0, 5), rssResult);
}

export async function getTechDigestText(deps: WorkerDependencies, now: Date = new Date()): Promise<string> {
  const rssResult = await recentRssItems(
    deps,
    TECH_SCIENCE_RSS_SOURCES,
    TECH_DIGEST_WINDOW_HOURS,
    "tech",
    TECH_POOL_LIMIT,
    now
  );

  if (rssResult.items.length === 0) {
    return "🌐 Şu an gösterilecek yeni teknoloji/bilim haberi bulunmuyor.";
  }

  if (!deps.openRouter.isConfigured()) {
    return formatFallbackDigest("Teknoloji ve Bilim Bülteni", rssResult.items.slice(0, 5), rssResult);
  }

  try {
    const alreadySent = recentSentHeadlines(deps.stateStore.get(), "tech", now);
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `Sen bir teknoloji ve bilim editörüsün. "candidates" listesinden son gelişmelerin en önemli olanlarını seç (en fazla ${TECH_DIGEST_SELECTION_COUNT}).
Yazılım, yapay zeka, açık kaynak, bilişim güvenliği ve bilimsel keşifleri önceliklendir.
Yalnızca geçerli JSON döndür:
{
  "selected": [
    {
      "index": 0,
      "turkishTitle": "...",
      "categoryEmoji": "💻",
      "tags": "Yapay Zeka, Açık Kaynak",
      "priority": "normal",
      "turkishSummary": "..."
    }
  ]
}`
      },
      {
        role: "user",
        content: JSON.stringify({
          candidates: rssResult.items.map((item, index) => ({
            index,
            source: item.source,
            title: item.title,
            summary: item.summary ? clipText(item.summary, PROMPT_SUMMARY_CHARS) : undefined,
            age: relativeAge(item.publishedAt, now)
          })),
          alreadySent
        })
      }
    ];

    const rawResponse = await deps.openRouter.complete(messages, 0.2);
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Model yanıtında JSON bulunamadı");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      selected?: Array<{
        index: number;
        turkishTitle?: string;
        categoryEmoji?: string;
        tags?: string;
        priority?: string;
        turkishSummary?: string;
      }>;
    };

    const selectedItems: ProcessedNewsItem[] = [];
    for (const entry of parsed.selected ?? []) {
      const item = rssResult.items[entry.index];
      if (!item) continue;
      selectedItems.push({
        turkishTitle: entry.turkishTitle?.trim() || item.title,
        categoryEmoji: entry.categoryEmoji || "💡",
        tags: entry.tags,
        priority: normalizePriority(entry.priority),
        turkishSummary: clipText(entry.turkishSummary?.trim() || item.summary || item.title, DIGEST_SUMMARY_MAX_CHARS),
        item
      });
    }

    const finalItems = selectedItems.slice(0, TECH_DIGEST_SELECTION_COUNT);
    if (finalItems.length > 0) {
      await deps.stateStore.update((nextState) => {
        rememberSentHeadlines(
          nextState,
          "tech",
          finalItems.map((i) => i.turkishTitle),
          now
        );
        for (const i of finalItems) {
          rememberRssItem(nextState, i.item.id, RSS_SEEN_TTL_MS, now);
        }
      });
      return formatTechDigest(finalItems, rssResult);
    }
  } catch (error) {
    deps.logger.warn("model ile teknoloji bulteni secimi basarisiz, yedek listeye dusuldu", errorMeta(error));
  }

  return formatFallbackDigest("Teknoloji ve Bilim Bülteni", rssResult.items.slice(0, 5), rssResult);
}

function formatFallbackDigest(title: string, items: RssItem[], rssResult: RecentRssResult): string {
  const header = [`📰 ${bold(title)}`, DIGEST_DIVIDER].join("\n");
  const lines = items.map((item, index) => {
    const itemTitle = item.link ? link(`${index + 1}. ${item.title}`, item.link) : bold(`${index + 1}. ${item.title}`);
    const summary = item.summary ? `\n${escapeHtml(clipText(item.summary, 200))}` : "";
    return `• ${itemTitle} (${escapeHtml(item.source)})${summary}`;
  });

  const footer = rssResult.failedSources.length > 0
    ? `\n\n⚠️ Bazı kaynaklar yanıt vermedi: ${escapeHtml(rssResult.failedSources.join(", "))}`
    : "";

  return `${header}\n\n${lines.join("\n\n")}${footer}`;
}

async function recentRssItems(
  deps: WorkerDependencies,
  sources: RssSource[],
  recentHours: number,
  bucket: DigestBucket,
  poolLimit: number,
  now: Date
): Promise<RecentRssResult> {
  const rssResult = await fetchSourceSet(sources, RSS_PER_SOURCE_LIMIT, deps.logger);
  const state = deps.stateStore.get();
  const cutoff = now.getTime() - recentHours * 60 * 60 * 1000;

  const eligible = rssResult.items
    .filter((item) => {
      const timestamp = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
      return Number.isNaN(timestamp) || timestamp >= cutoff;
    })
    .filter((item) => !hasSeenRssItem(state, item.id, now));

  const interleaved = interleaveBySource(eligible);
  const deduped = dedupeSimilarTitles(interleaved);
  const ordered = orderByCoverage(deduped).slice(0, poolLimit);

  return {
    items: ordered,
    activeSources: rssResult.activeSources,
    totalSources: rssResult.totalSources,
    failedSources: rssResult.failedSources,
    totalScanned: rssResult.items.length
  };
}

export function createScheduledJobs(deps: WorkerDependencies): ScheduledJob[] {
  return [
    {
      id: "morning-briefing",
      schedule: {
        kind: "daily",
        times: [{ hour: BRIEFING_SCHEDULE.morning.hour, minute: BRIEFING_SCHEDULE.morning.minute }]
      },
      run: async () => {
        deps.logger.info("sabah brifingi gonderiliyor");
        const weather = await weatherReport(deps);
        const news = await getNewsDigestText(deps, "Günün Özeti");
        const fullMessage = `${weather}\n\n${DIGEST_DIVIDER}\n\n${news}`;
        await deps.telegram.sendToConfiguredChat(fullMessage, unpromptedSendOptions(deps));
      }
    },
    {
      id: "evening-briefing",
      schedule: {
        kind: "daily",
        times: [{ hour: BRIEFING_SCHEDULE.evening.hour, minute: BRIEFING_SCHEDULE.evening.minute }]
      },
      run: async () => {
        deps.logger.info("aksam brifingi gonderiliyor");
        const weather = await weatherReport(deps);
        const news = await getNewsDigestText(deps, "Akşam Bülteni");
        const fullMessage = `${weather}\n\n${DIGEST_DIVIDER}\n\n${news}`;
        await deps.telegram.sendToConfiguredChat(fullMessage, unpromptedSendOptions(deps));
      }
    }
  ];
}

export function unpromptedSendOptions(deps: WorkerDependencies, now: Date = new Date()): SendOptions {
  return { silent: isQuietHour(deps.config.timezone, now) };
}

export function isQuietHour(timezone: string, now: Date = new Date()): boolean {
  const hour = getZonedParts(now, timezone).hour;
  return hour >= QUIET_HOURS.startHour || hour < QUIET_HOURS.endHour;
}

export async function notifyJobFailure(
  deps: WorkerDependencies,
  jobId: JobId,
  error: unknown
): Promise<void> {
  const should = shouldNotify(deps.stateStore.get(), `job:${jobId}`, ERROR_DEDUPE_TTL_MS);
  if (!should) return;

  const text = [
    `⚠️ ${bold(`Zamanlanmış iş başarısız oldu: ${escapeHtml(jobId)}`)}`,
    escapeHtml(describeUserFacingError(error))
  ].join("\n");

  await deps.telegram.sendToConfiguredChat(text, unpromptedSendOptions(deps));
}
