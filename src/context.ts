import type { FastifyRequest } from 'fastify';

import type { EnvelopeMeta } from './envelope.ts';

declare module 'fastify' {
  interface FastifyRequest {
    startTimeNs: bigint;
  }
}

export function durationMs(request: FastifyRequest): number {
  return Number(process.hrtime.bigint() - request.startTimeNs) / 1_000_000;
}

export function envelopeMeta(request: FastifyRequest): EnvelopeMeta {
  return { requestId: String(request.id), durationMs: durationMs(request) };
}
