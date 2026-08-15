import { SlidingWindowRateLimiter } from './slidingWindowRateLimiter.ts';

/**
 * Limite de concorrencia independente por identidade autenticada. Entradas
 * ociosas sao removidas assim que a ultima operacao do consumidor termina.
 */
export class KeyedConcurrencyLimiter {
  private readonly activeByKey = new Map<string, number>();

  constructor(private readonly maxConcurrencyPerKey: number) {
    if (!Number.isInteger(maxConcurrencyPerKey) || maxConcurrencyPerKey < 1) {
      throw new Error('maxConcurrencyPerKey precisa ser um inteiro positivo');
    }
  }

  tryAcquire(key: string): boolean {
    const active = this.activeByKey.get(key) ?? 0;
    if (active >= this.maxConcurrencyPerKey) return false;

    this.activeByKey.set(key, active + 1);
    return true;
  }

  release(key: string): void {
    const active = this.activeByKey.get(key) ?? 0;
    if (active <= 1) {
      this.activeByKey.delete(key);
      return;
    }

    this.activeByKey.set(key, active - 1);
  }

  activeCount(key: string): number {
    return this.activeByKey.get(key) ?? 0;
  }
}

/**
 * Janela deslizante estrita separada por identidade autenticada. A quantidade
 * de chaves e limitada pelo registro de credenciais carregado no boot.
 */
export class KeyedSlidingWindowRateLimiter {
  private readonly limitersByKey = new Map<string, SlidingWindowRateLimiter>();

  constructor(
    private readonly maxRequestsPerKey: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isInteger(maxRequestsPerKey) || maxRequestsPerKey < 1) {
      throw new Error('maxRequestsPerKey precisa ser um inteiro positivo');
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error('windowMs precisa ser positivo');
    }
  }

  tryConsume(key: string, nowMs = Date.now()): boolean {
    let limiter = this.limitersByKey.get(key);
    if (limiter === undefined) {
      limiter = new SlidingWindowRateLimiter(this.maxRequestsPerKey, this.windowMs);
      this.limitersByKey.set(key, limiter);
    }

    return limiter.tryConsume(nowMs);
  }
}
