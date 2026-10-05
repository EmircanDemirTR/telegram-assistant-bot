import type { RssItem } from "../types.js";
import type { ProcessedNewsItem } from "./types.js";

export function interleaveBySource(items: RssItem[]): RssItem[] {
  const bySource = new Map<string, RssItem[]>();
  for (const item of items) {
    const bucket = bySource.get(item.source);
    if (bucket) {
      bucket.push(item);
    } else {
      bySource.set(item.source, [item]);
    }
  }

  for (const bucket of bySource.values()) {
    sortByRecency(bucket);
  }

  const buckets = [...bySource.values()];
  const output: RssItem[] = [];
  const longest = Math.max(0, ...buckets.map((bucket) => bucket.length));

  for (let position = 0; position < longest; position += 1) {
    for (const bucket of buckets) {
      const item = bucket[position];
      if (item) {
        output.push(item);
      }
    }
  }

  return output;
}

export function dedupeSimilarTitles(items: RssItem[], threshold = SIMILARITY_THRESHOLD): RssItem[] {
  const kept: Array<{ item: RssItem; tokens: Set<string>; others: Set<string> }> = [];

  for (const item of items) {
    const tokens = significantTokens(item.title);
    const original = tokens.size === 0
      ? undefined
      : kept.find((existing) => jaccard(tokens, existing.tokens) >= threshold);
    if (!original) {
      kept.push({ item, tokens, others: new Set() });
    } else if (item.source !== original.item.source) {
      original.others.add(item.source);
    }
  }

  return kept.map(({ item, others }) => (others.size > 0 ? { ...item, alsoReportedBy: [...others] } : item));
}

export function isSameStory(left: string, right: string, threshold = SIMILARITY_THRESHOLD): boolean {
  return jaccard(significantTokens(left), significantTokens(right)) >= threshold;
}

export function partitionRepeatedStories(
  selected: ProcessedNewsItem[],
  alreadySent: string[]
): { fresh: ProcessedNewsItem[]; repeated: Array<{ title: string; sent: string }> } {
  const fresh: ProcessedNewsItem[] = [];
  const repeated: Array<{ title: string; sent: string }> = [];
  for (const entry of selected) {
    const sent = alreadySent.find((title) => isSameStory(entry.turkishTitle, title));
    if (sent === undefined) {
      fresh.push(entry);
    } else {
      repeated.push({ title: entry.turkishTitle, sent });
    }
  }
  return { fresh, repeated };
}

export function orderByCoverage(items: RssItem[]): RssItem[] {
  return items
    .map((item, position) => ({ item, position, coverage: item.alsoReportedBy?.length ?? 0 }))
    .sort((left, right) => right.coverage - left.coverage || left.position - right.position)
    .map((entry) => entry.item);
}

export function relativeAge(publishedAt: string | undefined, now = new Date()): string | undefined {
  if (!publishedAt) {
    return undefined;
  }

  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }

  const minutes = Math.round((now.getTime() - timestamp) / 60_000);
  if (minutes < 0) {
    return "az önce";
  }
  if (minutes < 60) {
    return `${minutes} dakika önce`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} saat önce`;
  }

  return `${Math.round(hours / 24)} gün önce`;
}

const SIMILARITY_THRESHOLD = 0.6;

const STOP_WORDS = new Set([
  "ve", "ile", "icin", "için", "bir", "bu", "da", "de", "ki", "mi", "mu",
  "ama", "veya", "ya", "her", "cok", "çok", "daha", "en", "gibi", "sonra",
  "once", "önce", "kadar", "olarak", "oldu", "olan", "son", "dakika", "yeni",
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "is", "are", "with"
]);

const STEM_LENGTH = 4;

function significantTokens(title: string): Set<string> {
  const normalized = title
    .toLocaleLowerCase("tr")
    .replace(/['’ʼ`]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    .map((token) => token.slice(0, STEM_LENGTH));

  return new Set(normalized);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function sortByRecency(items: RssItem[]): void {
  const timestamps = new Map<RssItem, number>();
  for (const item of items) {
    const parsed = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
    timestamps.set(item, Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed);
  }

  items.sort((left, right) => (timestamps.get(right) ?? 0) - (timestamps.get(left) ?? 0));
}
