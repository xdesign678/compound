export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  halfOpenSuccesses: number;
  openedAt?: number;
  nextAttemptAt?: number;
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenSuccessThreshold?: number;
  now?: () => number;
  isFailure?: (error: unknown) => boolean;
  onStateChange?: (snapshot: CircuitBreakerSnapshot) => void;
}

export class CircuitBreakerOpenError extends Error {
  readonly service: string;
  readonly retryAfterMs: number;

  constructor(service: string, retryAfterMs: number) {
    super(`Circuit breaker is open for ${service}; retry after ${retryAfterMs}ms`);
    this.name = 'CircuitBreakerOpenError';
    this.service = service;
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private consecutiveFailures = 0;
  private halfOpenSuccesses = 0;
  private openedAt?: number;
  private nextAttemptAt?: number;
  private halfOpenInFlight = false;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;
  private readonly now: () => number;
  private readonly isFailure: (error: unknown) => boolean;
  private readonly onStateChange?: (snapshot: CircuitBreakerSnapshot) => void;

  constructor(
    private readonly name: string,
    options: CircuitBreakerOptions,
  ) {
    this.failureThreshold = Math.max(1, Math.floor(options.failureThreshold ?? 3));
    this.resetTimeoutMs = Math.max(1, Math.floor(options.resetTimeoutMs ?? 30_000));
    this.halfOpenSuccessThreshold = Math.max(1, Math.floor(options.halfOpenSuccessThreshold ?? 1));
    this.now = options.now ?? Date.now;
    this.isFailure = options.isFailure ?? (() => true);
    this.onStateChange = options.onStateChange;
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      halfOpenSuccesses: this.halfOpenSuccesses,
      openedAt: this.openedAt,
      nextAttemptAt: this.nextAttemptAt,
    };
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.now();
    if (this.state === 'open') {
      if (this.nextAttemptAt && current < this.nextAttemptAt) {
        throw new CircuitBreakerOpenError(this.name, this.nextAttemptAt - current);
      }
      this.transition('half_open');
    }

    if (this.state === 'half_open') {
      if (this.halfOpenInFlight) {
        throw new CircuitBreakerOpenError(this.name, 0);
      }
      this.halfOpenInFlight = true;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordError(error);
      throw error;
    } finally {
      this.halfOpenInFlight = false;
    }
  }

  private recordSuccess(): void {
    if (this.state === 'half_open') {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenSuccessThreshold) {
        this.close();
      }
      return;
    }
    this.consecutiveFailures = 0;
  }

  private recordError(error: unknown): void {
    if (!this.isFailure(error)) {
      if (this.state === 'half_open') this.close();
      return;
    }

    if (this.state === 'half_open') {
      this.open();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.open();
    }
  }

  private close(): void {
    this.consecutiveFailures = 0;
    this.halfOpenSuccesses = 0;
    this.openedAt = undefined;
    this.nextAttemptAt = undefined;
    this.transition('closed');
  }

  private open(): void {
    const current = this.now();
    this.openedAt = current;
    this.nextAttemptAt = current + this.resetTimeoutMs;
    this.halfOpenSuccesses = 0;
    this.transition('open');
  }

  private transition(nextState: CircuitBreakerState): void {
    if (this.state === nextState) return;
    this.state = nextState;
    this.onStateChange?.(this.snapshot());
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  return new CircuitBreaker(options.name, options);
}

export function getCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const existing = breakers.get(options.name);
  if (existing) return existing;
  const breaker = createCircuitBreaker(options);
  breakers.set(options.name, breaker);
  return breaker;
}

export function resetCircuitBreakersForTests(): void {
  breakers.clear();
}
