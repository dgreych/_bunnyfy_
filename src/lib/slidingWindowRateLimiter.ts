/**
 * Janela deslizante estrita em memória. Diferente de um balde cheio no boot,
 * nunca admite mais que `maxRequests` dentro de qualquer intervalo completo.
 */
export class SlidingWindowRateLimiter {
  private readonly acceptedAtMs: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isInteger(maxRequests) || maxRequests < 1) {
      throw new Error('maxRequests precisa ser um inteiro positivo');
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error('windowMs precisa ser positivo');
    }
  }

  tryConsume(nowMs = Date.now()): boolean {
    const windowStart = nowMs - this.windowMs;
    while (this.acceptedAtMs.length > 0 && this.acceptedAtMs[0]! <= windowStart) {
      this.acceptedAtMs.shift();
    }

    if (this.acceptedAtMs.length >= this.maxRequests) return false;
    this.acceptedAtMs.push(nowMs);
    return true;
  }
}
