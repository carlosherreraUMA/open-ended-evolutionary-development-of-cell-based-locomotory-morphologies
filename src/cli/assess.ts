// Fair assessment of the saved population of a run: every genome is evaluated again in its own seed
// mode, and also with K new growths (seeds it has never seen), in parallel.
//
//   npm run assess -- runs/my-run --samples 3

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeParams } from '../champion.ts';
import { Genome } from '../neat/genome.ts';
import type { ExperimentParams } from '../sim/creature.ts';
import type { EvalInfo } from '../sim/evaluate.ts';
import { EvaluatorPool } from './pool.ts';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { samples: { type: 'string', default: '3' }, threads: { type: 'string' } },
});
const dir = positionals[0];
const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'), (_, v) => v) as { params: ExperimentParams; args: { seed: string } };
const params = normalizeParams(config.params);
const population = JSON.parse(readFileSync(join(dir, 'population.json'), 'utf8'));
const generation: number = population.generation;
const pool = new EvaluatorPool(args.threads ? Number(args.threads) : undefined);

const distances = async (genomes: Genome[], p: ExperimentParams, runSeed: number) => {
  await pool.evaluate(genomes, generation, runSeed, p);
  return genomes.map((g) => (g.evalInfo as EvalInfo).distance);
};
const load = () => population.genomes.map((g: unknown) => Genome.fromJSON(g as never)) as Genome[];

const own = await distances(load(), params, Number(config.args.seed));
const fresh: number[][] = [];
for (let k = 0; k < Number(args.samples); k++) {
  fresh.push(await distances(load(), { ...params, seedMode: 'per-evaluation' }, 9000 + k));
}
await pool.close();

const freshMean = own.map((_, i) => fresh.reduce((a, f) => a + f[i], 0) / fresh.length);
const summary = (xs: number[]) => {
  const s = [...xs].sort((a, b) => b - a);
  return `best ${s[0].toFixed(2)} | top 5 ${(s.slice(0, 5).reduce((a, b) => a + b, 0) / 5).toFixed(2)} | median ${s[Math.floor(s.length / 2)].toFixed(2)} | >1: ${s.filter((x) => x > 1).length}/${s.length}`;
};
console.log(`${dir} (generation ${generation}, distance in the fitness window)`);
console.log(`  in its own seed mode (${params.seedMode}): ${summary(own)}`);
console.log(`  mean of ${fresh.length} new growths:      ${summary(freshMean)}`);
const bestIdx = freshMean.indexOf(Math.max(...freshMean));
console.log(`  most robust genome: index ${bestIdx}, per growth ${fresh.map((f) => f[bestIdx].toFixed(2)).join(' ')}`);
