export type LlmBudgetName =
  | 'github_ingest'
  | 'contextualize'
  | 'summarize'
  | 'relations'
  | 'embedding';

interface QueueTask<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

export interface QueueStats {
  active: number;
  pending: number;
  pausedUntil: number | null;
  concurrency: number;
}

export class LlmBudgetQueue {
  private readonly tasks: Array<QueueTask<unknown>> = [];
  private active = 0;
  private pausedUntil: number | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly name: string,
    readonly concurrency: number,
  ) {}

  add<T>(fn: () => Promise<T> | T, options: { signal?: AbortSignal } = {}): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason ?? new DOMException('aborted', 'AbortError'));
    }
    return new Promise<T>((resolve, reject) => {
      const task: QueueTask<T> = {
        fn: () => Promise.resolve(fn()),
        resolve,
        reject,
        signal: options.signal,
      };
      if (options.signal) {
        task.abortHandler = () => {
          const index = this.tasks.indexOf(task as QueueTask<unknown>);
          if (index >= 0) this.tasks.splice(index, 1);
          reject(options.signal?.reason ?? new DOMException('aborted', 'AbortError'));
        };
        options.signal.addEventListener('abort', task.abortHandler, { once: true });
      }
      this.tasks.push(task as QueueTask<unknown>);
      this.drain();
    });
  }

  pauseFor(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const until = Date.now() + Math.ceil(ms);
    this.pausedUntil = Math.max(this.pausedUntil ?? 0, until);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(
      () => {
        this.pauseTimer = null;
        this.pausedUntil = null;
        this.drain();
      },
      Math.max(0, (this.pausedUntil ?? until) - Date.now()),
    );
  }

  stats(): QueueStats {
    return {
      active: this.active,
      pending: this.tasks.length,
      pausedUntil: this.pausedUntil,
      concurrency: this.concurrency,
    };
  }

  clear(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    this.pausedUntil = null;
    while (this.tasks.length > 0) {
      const task = this.tasks.shift()!;
      if (task.signal && task.abortHandler) {
        task.signal.removeEventListener('abort', task.abortHandler);
      }
      task.reject(new DOMException('queue cleared', 'AbortError'));
    }
  }

  private drain(): void {
    if (this.pausedUntil && this.pausedUntil > Date.now()) return;
    this.pausedUntil = null;
    while (this.active < this.concurrency && this.tasks.length > 0) {
      const task = this.tasks.shift()!;
      if (task.signal && task.abortHandler) {
        task.signal.removeEventListener('abort', task.abortHandler);
      }
      if (task.signal?.aborted) {
        task.reject(task.signal.reason ?? new DOMException('aborted', 'AbortError'));
        continue;
      }
      this.active += 1;
      void task
        .fn()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active = Math.max(0, this.active - 1);
          this.drain();
        });
    }
  }
}

function readConcurrency(name: LlmBudgetName, envName: string): number {
  const value = Number(process.env[envName]);
  if (Number.isFinite(value) && value > 0) return Math.floor(value);
  const defaults: Record<LlmBudgetName, number> = {
    github_ingest: 5,
    summarize: 4,
    relations: 2,
    contextualize: 2,
    embedding: 2,
  };
  return defaults[name];
}

function readTotalConcurrency(): number {
  const value = Number(process.env.COMPOUND_BACKGROUND_LLM_TOTAL);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 10;
}

const backgroundLlmBudget = new LlmBudgetQueue('background_total', readTotalConcurrency());

export const llmBudgets: Record<LlmBudgetName, LlmBudgetQueue> = {
  github_ingest: new LlmBudgetQueue(
    'github_ingest',
    readConcurrency('github_ingest', 'COMPOUND_BACKGROUND_LLM_GITHUB_INGEST'),
  ),
  contextualize: new LlmBudgetQueue(
    'contextualize',
    readConcurrency('contextualize', 'COMPOUND_BACKGROUND_LLM_CONTEXTUALIZE'),
  ),
  summarize: new LlmBudgetQueue(
    'summarize',
    readConcurrency('summarize', 'COMPOUND_BACKGROUND_LLM_SUMMARIZE'),
  ),
  relations: new LlmBudgetQueue(
    'relations',
    readConcurrency('relations', 'COMPOUND_BACKGROUND_LLM_RELATIONS'),
  ),
  embedding: new LlmBudgetQueue(
    'embedding',
    readConcurrency('embedding', 'COMPOUND_BACKGROUND_LLM_EMBEDDING'),
  ),
};

export function runWithLlmBudget<T>(
  bucket: LlmBudgetName,
  fn: () => Promise<T> | T,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  // Acquire the stage slot first, then the shared slot. Reversing that order
  // lets tasks waiting on one saturated stage occupy every global slot and
  // starve otherwise-idle stages.
  return llmBudgets[bucket].add(() => backgroundLlmBudget.add(fn, options), options);
}

export function pauseLlmBudget(bucket: LlmBudgetName, ms: number): void {
  llmBudgets[bucket].pauseFor(ms);
}

export function getLlmBudgetStats(bucket: LlmBudgetName): QueueStats {
  return llmBudgets[bucket].stats();
}

export function getBackgroundLlmBudgetStats(): QueueStats {
  return backgroundLlmBudget.stats();
}
