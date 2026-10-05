import type { AppState, JobId } from "./types.js";
import type { Logger } from "./logger.js";
import { errorMeta } from "./logger.js";
import { nextDailyOccurrence } from "./time.js";
import type { StateStore } from "./state.js";
import {
  markJobFailure,
  markJobOverlapSkipped,
  markJobStarted,
  markJobSuccess
} from "./state.js";

type JobRunner = () => Promise<void>;

export interface JobFailureContext {
  consecutiveFailures: number;
  willRetry: boolean;
}

type JobFailureHandler = (jobId: JobId, error: unknown, context: JobFailureContext) => Promise<void> | void;

export type ScheduleSpec =
  | { kind: "daily"; times: Array<{ hour: number; minute: number }> }
  | { kind: "everyMinutes"; minutes: number; startImmediately?: boolean };

export interface ScheduledJob {
  id: JobId;
  schedule: ScheduleSpec;
  run: JobRunner;
  runOnStartWhen?: (state: AppState) => boolean;
}

export class Scheduler {
  private readonly timers = new Map<JobId, NodeJS.Timeout>();
  private readonly locks = new Set<JobId>();
  private readonly consecutiveFailures = new Map<JobId, number>();
  private readonly anchors = new Map<JobId, Date>();
  private stopped = false;

  constructor(
    private readonly jobs: ScheduledJob[],
    private readonly timezone: string,
    private readonly stateStore: StateStore,
    private readonly logger: Logger,
    private readonly onFailure?: JobFailureHandler
  ) {}

  start(): void {
    this.stopped = false;
    for (const job of this.jobs) {
      this.scheduleNext(job, new Date(), true);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  async runNow(jobId: JobId): Promise<void> {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    await this.runWithLock(job);
  }

  isRunning(jobId: JobId): boolean {
    return this.locks.has(jobId);
  }

  private scheduleNext(job: ScheduledJob, now: Date, isFirstSchedule = false): void {
    if (this.stopped) {
      return;
    }

    const failures = this.consecutiveFailures.get(job.id) ?? 0;
    const nextRun = nextRunAt(job.schedule, now, this.timezone, this.anchors.get(job.id));

    const startsImmediately =
      isFirstSchedule && job.schedule.kind === "everyMinutes" && job.schedule.startImmediately === true;
    const catchesUp = isFirstSchedule && job.runOnStartWhen?.(this.stateStore.get()) === true;

    const scheduledDelayMs =
      startsImmediately || catchesUp ? 0 : Math.max(0, nextRun.getTime() - now.getTime());
    const { delayMs, retrying, backoffMs } = nextDelayMs(scheduledDelayMs, failures);

    const plannedRunAt = new Date(now.getTime() + delayMs);
    this.anchors.set(job.id, plannedRunAt);
    this.logger.info("scheduled job", {
      jobId: job.id,
      nextRunAt: plannedRunAt.toISOString(),
      ...(catchesUp ? { catchUp: true } : {}),
      ...(failures > 0 ? { consecutiveFailures: failures, backoffMs, retrying } : {})
    });

    const timer = setTimeout(() => {
      void this.runWithLock(job).finally(() => {
        this.scheduleNext(job, new Date());
      });
    }, delayMs);

    this.timers.set(job.id, timer);
  }

  private async runWithLock(job: ScheduledJob): Promise<void> {
    if (this.locks.has(job.id)) {
      await this.stateStore.update((state) => markJobOverlapSkipped(state, job.id));
      this.logger.warn("skipped overlapping job run", { jobId: job.id });
      return;
    }

    this.locks.add(job.id);
    await this.stateStore.update((state) => markJobStarted(state, job.id));
    this.logger.info("job started", { jobId: job.id });

    try {
      await job.run();
      this.consecutiveFailures.delete(job.id);
      await this.stateStore.update((state) => markJobSuccess(state, job.id));
      this.logger.info("job finished", { jobId: job.id });
    } catch (error) {
      const failures = (this.consecutiveFailures.get(job.id) ?? 0) + 1;
      this.consecutiveFailures.set(job.id, failures);
      await this.stateStore.update((state) => markJobFailure(state, job.id, error));
      this.logger.error("job failed", { jobId: job.id, consecutiveFailures: failures, ...errorMeta(error) });
      try {
        await this.onFailure?.(job.id, error, { consecutiveFailures: failures, willRetry: willRetryEarly(failures) });
      } catch (notificationError) {
        this.logger.error("job failure notification failed", {
          jobId: job.id,
          ...errorMeta(notificationError)
        });
      }
    } finally {
      this.locks.delete(job.id);
    }
  }
}

export function nextRunAt(schedule: ScheduleSpec, now: Date, timezone: string, anchor?: Date): Date {
  if (schedule.kind === "everyMinutes") {
    const intervalMs = schedule.minutes * 60_000;
    if (!anchor) {
      return new Date(now.getTime() + intervalMs);
    }
    let next = anchor.getTime() + intervalMs;
    while (next <= now.getTime()) {
      next += intervalMs;
    }
    return new Date(next);
  }

  const candidates = schedule.times.map((time) => nextDailyOccurrence(now, timezone, time.hour, time.minute));
  return new Date(Math.min(...candidates.map((candidate) => candidate.getTime())));
}

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 3_600_000;
export const MAX_EARLY_RETRIES = 5;

export function willRetryEarly(consecutiveFailures: number): boolean {
  return consecutiveFailures > 0 && consecutiveFailures <= MAX_EARLY_RETRIES;
}

function backoffDelay(consecutiveFailures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1), BACKOFF_MAX_MS);
}

export function nextDelayMs(
  scheduledDelayMs: number,
  consecutiveFailures: number
): { delayMs: number; retrying: boolean; backoffMs: number } {
  const retrying = willRetryEarly(consecutiveFailures);
  if (!retrying) {
    return { delayMs: scheduledDelayMs, retrying: false, backoffMs: 0 };
  }

  const backoffMs = backoffDelay(consecutiveFailures);
  return { delayMs: Math.min(backoffMs, scheduledDelayMs), retrying: true, backoffMs };
}
