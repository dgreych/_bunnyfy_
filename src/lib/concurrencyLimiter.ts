/**
 * Semáforo simples de contagem — usado pra limitar quantas transcrições
 * (processamento pesado) rodam ao mesmo tempo. Sem fila: quando lotado,
 * `tryAcquire` recusa na hora e o chamador decide devolver 429 estável em
 * vez de enfileirar silenciosamente.
 */
export class ConcurrencyLimiter {
  private readonly max: number;
  private active: number;

  constructor(max: number) {
    this.max = max;
    this.active = 0;
  }

  tryAcquire(): boolean {
    if (this.active >= this.max) return false;
    this.active += 1;
    return true;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }

  get activeCount(): number {
    return this.active;
  }

  get maxConcurrency(): number {
    return this.max;
  }
}
