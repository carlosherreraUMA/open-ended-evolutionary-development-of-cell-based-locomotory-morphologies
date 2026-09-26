// Evaluation thread for EvaluatorPool.

import { parentPort } from 'node:worker_threads';
import { Genome } from '../neat/genome.ts';
import { evaluateGenome } from '../sim/evaluate.ts';
import type { EvalRequest, EvalResponse } from './pool.ts';

parentPort!.on('message', (req: EvalRequest) => {
  const res: EvalResponse = req.genomes.map((g) =>
    evaluateGenome(Genome.fromJSON(g), req.generation, req.runSeed, req.params),
  );
  parentPort!.postMessage(res);
});
