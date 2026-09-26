// Parallel evaluation with worker_threads: every thread evaluates part of the population.
// Since every evaluation has its own seed, the result is identical to the sequential one.

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { Genome } from '../neat/genome.ts';
import type { ExperimentParams } from '../sim/creature.ts';
import type { EvalInfo } from '../sim/evaluate.ts';

export interface EvalRequest {
  genomes: ReturnType<Genome['toJSON']>[];
  generation: number;
  runSeed: number;
  params: ExperimentParams;
}

export type EvalResponse = { fitness: number; info: EvalInfo }[];

export class EvaluatorPool {
  private workers: Worker[];

  constructor(size = availableParallelism()) {
    this.workers = Array.from(
      { length: size },
      () => new Worker(new URL('./eval-worker.mjs', import.meta.url)),
    );
  }

  async evaluate(genomes: Genome[], generation: number, runSeed: number, params: ExperimentParams): Promise<void> {
    // Interleaved split: the cost grows with the size of the creature, so this balances the load better.
    const parts = this.workers.map((_, w) => genomes.filter((_, i) => i % this.workers.length === w));
    await Promise.all(
      this.workers.map(async (worker, w) => {
        if (parts[w].length === 0) return;
        const req: EvalRequest = { genomes: parts[w].map((g) => g.toJSON()), generation, runSeed, params };
        const res = await new Promise<EvalResponse>((resolve, reject) => {
          const onError = (err: Error) => {
            worker.off('message', onMessage);
            reject(err);
          };
          const onMessage = (msg: EvalResponse) => {
            worker.off('error', onError);
            resolve(msg);
          };
          worker.once('message', onMessage);
          worker.once('error', onError);
          worker.postMessage(req);
        });
        res.forEach((r, k) => {
          parts[w][k].fitness = r.fitness;
          parts[w][k].evalInfo = r.info;
        });
      }),
    );
  }

  close(): Promise<number[]> {
    return Promise.all(this.workers.map((w) => w.terminate()));
  }
}
