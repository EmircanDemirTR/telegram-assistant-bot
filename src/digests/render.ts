import { DIGEST_DIVIDER, bold, escapeHtml, link, priorityDot } from "../format.js";
import type { ProcessedNewsItem, RecentRssResult } from "./types.js";

export const NEWS_CATEGORIES = {
  gundem: { emoji: "📌", label: "Gündem", hint: "iç gündem, olaylar, asayiş" },
  politika: { emoji: "🏛️", label: "Politika", hint: "siyaset, hükümet, meclis, diplomasi" },
  ekonomi: { emoji: "💰", label: "Ekonomi", hint: "piyasalar, faiz, enflasyon, şirketler" },
  dunya: { emoji: "🌍", label: "Dünya", hint: "yurt dışındaki gelişmeler" },
  guvenlik: { emoji: "🛡️", label: "Güvenlik", hint: "savaş, çatışma, terör, savunma" },
  afet: { emoji: "🚨", label: "Afet ve Kaza", hint: "deprem, sel, yangın, büyük kaza" },
  hukuk: { emoji: "⚖️", label: "Hukuk", hint: "yargı, soruşturma, dava, yasa" },
  saglik: { emoji: "🏥", label: "Sağlık", hint: "halk sağlığı, salgın, sağlık politikası" },
  egitim: { emoji: "🎓", label: "Eğitim", hint: "okullar, üniversiteler, sınavlar, MEB ve YÖK kararları" },
  bilim: { emoji: "🔬", label: "Bilim", hint: "araştırma, uzay, keşif" },
  teknoloji: { emoji: "💻", label: "Teknoloji", hint: "yapay zeka, internet, dijital düzenlemeler" },
  cevre: { emoji: "🌱", label: "Çevre", hint: "iklim, kirlilik, enerji dönüşümü" },
  spor: { emoji: "⚽", label: "Spor", hint: "yalnızca ülke gündemine oturan spor haberi" },
  kultur: { emoji: "🎭", label: "Kültür-Sanat", hint: "sanat, edebiyat, sinema, miras" }
} as const;

export type NewsCategoryKey = keyof typeof NEWS_CATEGORIES;

const FALLBACK_NEWS_CATEGORY = { emoji: "📰", label: "Haber" } as const;

export function newsCategoryPromptList(): string {
  return Object.entries(NEWS_CATEGORIES)
    .map(([key, category]) => `- ${key}: ${category.hint}`)
    .join("\n");
}

export function normalizeNewsCategory(value: unknown): NewsCategoryKey | undefined {
  const folded = foldTurkish(String(value ?? ""));
  if (!folded) {
    return undefined;
  }
  for (const [key, category] of Object.entries(NEWS_CATEGORIES) as Array<[NewsCategoryKey, (typeof NEWS_CATEGORIES)[NewsCategoryKey]]>) {
    if (folded === key || folded === foldTurkish(category.label)) {
      return key;
    }
  }
  return undefined;
}

export function formatNewsDigest(
  title: string,
  processedItems: ProcessedNewsItem[],
  rssResult: RecentRssResult,
  note?: string
): string {
  const header = [`📰 ${bold(title)}`, ...(note ? [escapeHtml(note)] : []), DIGEST_DIVIDER].join("\n");
  const items = processedItems.map((processed, index) => {
    const category = newsCategoryOf(processed.category);
    return [
      `${priorityDot(processed.priority)} ${itemTitle(index, processed)}`,
      `${category.emoji} ${escapeHtml(category.label)} · ${escapeHtml(processed.item.source)}`,
      escapeHtml(processed.turkishSummary)
    ].join("\n");
  });
  if (items.length === 0) {
    items.push("Şu an öne çıkan yeni bir haber yok.");
  }
  return joinDigest(header, items, rssResult);
}

export function formatTechDigest(processedItems: ProcessedNewsItem[], rssResult: RecentRssResult): string {
  const header = [`🌐 ${bold("Teknoloji ve Bilim Bülteni")}`, DIGEST_DIVIDER].join("\n");
  const items = processedItems.map((processed, index) => {
    const tags = processed.tags ? ` · ${escapeHtml(processed.tags)}` : "";
    return [
      `${priorityDot(processed.priority)} ${itemTitle(index, processed)}`,
      `${escapeHtml(processed.categoryEmoji ?? "🤖")} ${escapeHtml(processed.item.source)}${tags}`,
      escapeHtml(processed.turkishSummary)
    ].join("\n");
  });
  if (items.length === 0) {
    items.push("Son dönemde bültene girecek kadar önemli bir gelişme yok.");
  }
  return joinDigest(header, items, rssResult);
}

export function digestFooter(rssResult: RecentRssResult): string[] {
  if (rssResult.failedSources.length === 0) {
    return [];
  }
  return [
    `⚠️ ${rssResult.failedSources.length}/${rssResult.totalSources} kaynak yanıt vermedi: ${escapeHtml(rssResult.failedSources.join(", "))}`
  ];
}

function itemTitle(index: number, processed: ProcessedNewsItem): string {
  const text = `${index + 1}. ${processed.turkishTitle}`;
  return processed.item.link ? `<b>${link(text, processed.item.link)}</b>` : bold(text);
}

function newsCategoryOf(key: string | undefined): { emoji: string; label: string } {
  const normalized = normalizeNewsCategory(key);
  return normalized ? NEWS_CATEGORIES[normalized] : FALLBACK_NEWS_CATEGORY;
}

function joinDigest(header: string, items: string[], rssResult: RecentRssResult): string {
  const footer = digestFooter(rssResult);
  return [header, ...items, ...(footer.length > 0 ? [footer.join("\n")] : [])].join("\n\n");
}

function foldTurkish(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z]/g, "");
}
