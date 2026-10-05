import { mkdir, open, readFile, rename, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppState, ChatMessage, DigestBucket, JobId } from "./types.js";
import { AI_CONTEXT_MAX_MESSAGES, SENT_HEADLINE_MEMORY } from "./constants.js";
import type { Logger } from "./logger.js";

export const KNOWN_JOB_IDS: ReadonlySet<JobId> = new Set<JobId>([
  "morning-briefing",
  "evening-briefing"
]);

export function createDefaultState(): AppState {
  return {
    version: 1,
    telegram: { offset: 0 },
    ai: { contexts: {} },
    dedupe: {},
    rss: { seen: {} },
    digests: {},
    jobs: {}
  };
}

export async function loadState(filePath: string, logger: Logger): Promise<AppState> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return normalizeState(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.info("state file missing; starting with empty state", { filePath });
      return createDefaultState();
    }
    throw error;
  }
}

export async function saveStateAtomic(filePath: string, state: AppState): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${nextTempSequence()}.tmp`;
  const handle = await open(tempPath, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await chmod(tempPath, 0o600);
  } catch {
    // Windows chmod hatasi verebilir, yutulur
  }
  await rename(tempPath, filePath);
  await fsyncDirectoryBestEffort(directory);
}

export class StateStore {
  private state: AppState;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    initialState: AppState
  ) {
    this.state = initialState;
  }

  get(): AppState {
    return this.state;
  }

  async update(mutator: (state: AppState) => void): Promise<AppState> {
    mutator(this.state);
    const write = this.writeChain.then(() => saveStateAtomic(this.filePath, this.state));
    this.writeChain = write.then(
      () => undefined,
      () => undefined
    );
    await write;
    return this.state;
  }
}

export function pruneExpiredEntries(entries: Record<string, string>, now = new Date()): number {
  let removed = 0;
  const nowMs = now.getTime();
  for (const [key, expiresAt] of Object.entries(entries)) {
    if (new Date(expiresAt).getTime() <= nowMs) {
      delete entries[key];
      removed += 1;
    }
  }
  return removed;
}

export function rememberRssItem(state: AppState, itemId: string, ttlMs: number, now = new Date()): void {
  pruneExpiredEntries(state.rss.seen, now);
  state.rss.seen[itemId] = new Date(now.getTime() + ttlMs).toISOString();
}

export function hasSeenRssItem(state: AppState, itemId: string, now = new Date()): boolean {
  pruneExpiredEntries(state.rss.seen, now);
  const expiresAt = state.rss.seen[itemId];
  return Boolean(expiresAt && new Date(expiresAt).getTime() > now.getTime());
}

export function recentSentHeadlines(state: AppState, bucket: DigestBucket, now = new Date()): string[] {
  const cutoff = headlineCutoff(bucket, now);
  return (state.digests.sentHeadlines?.[bucket] ?? [])
    .filter((entry) => Date.parse(entry.sentAt) >= cutoff)
    .map((entry) => entry.title);
}

export function rememberSentHeadlines(
  state: AppState,
  bucket: DigestBucket,
  titles: string[],
  now = new Date()
): void {
  const cutoff = headlineCutoff(bucket, now);
  const sentAt = now.toISOString();
  const kept = (state.digests.sentHeadlines?.[bucket] ?? []).filter((entry) => Date.parse(entry.sentAt) >= cutoff);
  state.digests.sentHeadlines = {
    ...(state.digests.sentHeadlines ?? {}),
    [bucket]: [...kept, ...titles.map((title) => ({ title, sentAt }))].slice(-SENT_HEADLINE_MEMORY[bucket].maxEntries)
  };
}

function headlineCutoff(bucket: DigestBucket, now: Date): number {
  return now.getTime() - SENT_HEADLINE_MEMORY[bucket].retentionHours * 3_600_000;
}

export function pushAiContextMessage(
  state: AppState,
  chatId: string,
  message: ChatMessage,
  maxMessages = AI_CONTEXT_MAX_MESSAGES
): ChatMessage[] {
  const current = state.ai.contexts[chatId] ?? [];
  current.push(message);
  state.ai.contexts[chatId] = current.slice(-maxMessages);
  return state.ai.contexts[chatId] ?? [];
}

export function shouldNotify(state: AppState, key: string, ttlMs: number, now = new Date()): boolean {
  pruneExpiredEntries(state.dedupe, now);
  const expiresAt = state.dedupe[key];
  if (expiresAt && new Date(expiresAt).getTime() > now.getTime()) {
    return false;
  }

  state.dedupe[key] = new Date(now.getTime() + ttlMs).toISOString();
  return true;
}

export function markJobStarted(state: AppState, jobId: JobId, now = new Date()): void {
  state.jobs[jobId] = {
    ...(state.jobs[jobId] ?? {}),
    running: true,
    lastStartedAt: now.toISOString()
  };
}

export function markJobSuccess(state: AppState, jobId: JobId, now = new Date()): void {
  state.jobs[jobId] = {
    ...(state.jobs[jobId] ?? {}),
    running: false,
    lastFinishedAt: now.toISOString(),
    lastSuccessAt: now.toISOString(),
    lastError: undefined,
    lastErrorAt: undefined
  };
}

export function markJobFailure(state: AppState, jobId: JobId, error: unknown, now = new Date()): void {
  const message = error instanceof Error ? error.message : String(error);
  state.jobs[jobId] = {
    ...(state.jobs[jobId] ?? {}),
    running: false,
    lastFinishedAt: now.toISOString(),
    lastErrorAt: now.toISOString(),
    lastError: message.slice(0, 500)
  };
}

export function markJobOverlapSkipped(state: AppState, jobId: JobId): void {
  const current = state.jobs[jobId] ?? {};
  state.jobs[jobId] = {
    ...current,
    skippedOverlaps: (current.skippedOverlaps ?? 0) + 1
  };
}

function normalizeState(input: Partial<AppState>): AppState {
  const state = createDefaultState();
  return {
    ...state,
    ...input,
    telegram: { ...state.telegram, ...(input.telegram ?? {}) },
    ai: { ...state.ai, ...(input.ai ?? {}) },
    dedupe: { ...(input.dedupe ?? {}) },
    rss: { ...state.rss, ...(input.rss ?? {}) },
    digests: { ...state.digests, ...(input.digests ?? {}) },
    jobs: pruneUnknownJobs(input.jobs)
  };
}

function pruneUnknownJobs(jobs: AppState["jobs"] | undefined): AppState["jobs"] {
  const output: AppState["jobs"] = {};
  for (const [jobId, info] of Object.entries(jobs ?? {})) {
    if (KNOWN_JOB_IDS.has(jobId as JobId) && info) {
      output[jobId as JobId] = info.running ? { ...info, running: false } : info;
    }
  }
  return output;
}

let tempSequence = 0;

function nextTempSequence(): number {
  tempSequence = (tempSequence + 1) % Number.MAX_SAFE_INTEGER;
  return tempSequence;
}

async function fsyncDirectoryBestEffort(directory: string): Promise<void> {
  try {
    const dirHandle = await open(directory, "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    // Windows veya bazi dosya sistemleri dizinde fsync desteklemeyebilir
  }
}
