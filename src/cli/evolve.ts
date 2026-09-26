// Headless evolution (the equivalent of pressing "Start EA" in Unity).
//
//   npm run evolve -- --medium substrate --gens 100 --pop 50 --species 5 --seed 1
//
// Writes to runs/<name>/: config.json (the exact configuration), stats.csv (one row per generation),
// champion.json and champions/gen-XXXX.json (the best of each generation, with everything needed to
// replay it in the viewer) and population.json (a checkpoint every 10 generations, for --resume).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultNeatConfig } from '../neat/config.ts';
import { NeatEvolution, type PopulationJson } from '../neat/evolution.ts';
import { experimentFor, type ExperimentParams } from '../sim/creature.ts';
import { inputCount, type EvalInfo } from '../sim/evaluate.ts';
import type { Genome } from '../neat/genome.ts';
import { EvaluatorPool } from './pool.ts';
import type { Medium } from '../sim/physics.ts';
import { championJson, serializeChampion } from '../champion.ts';

const { values: args } = parseArgs({
  options: {
    gens: { type: 'string', default: '100' },
    pop: { type: 'string', default: '8' },
    species: { type: 'string', default: '2' },
    seed: { type: 'string', default: '1' },
    mode: { type: 'string', default: 'fixed' },
    friction: { type: 'string', default: 'inf' },
    medium: { type: 'string', default: 'ground' },
    // No defaults: every medium has its own (see experimentFor).
    muscles: { type: 'string' },
    fitness: { type: 'string' },
    penalty: { type: 'string' },
    sharing: { type: 'boolean', default: false },
    settle: { type: 'string' },
    development: { type: 'string' },
    seeds: { type: 'string' },
    positional: { type: 'boolean', default: false },
    scope: { type: 'string' },
    regions: { type: 'string' },
    out: { type: 'string' },
    resume: { type: 'string' },
    threads: { type: 'string' },
  },
});

/** Checks that an option has one of the allowed values. */
function choice<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`--${name} must be one of: ${allowed.join(', ')} (got "${value}")`);
  }
  return value as T;
}

const seed = Number(args.seed);
const muscleModel = choice('muscles', args.muscles, ['accumulative', 'oscillator', 'cpg'] as const);
const fitnessWindow = choice('fitness', args.fitness, ['full', 'second-half'] as const);
const musclePenalty = choice('penalty', args.penalty, ['product', 'geometric-mean'] as const);
const development = choice('development', args.development, ['stochastic', 'deterministic'] as const);
const seedMode = choice('seeds', args.seeds, ['per-evaluation', 'inherited'] as const);
const muscleScope = choice('scope', args.scope, ['all', 'hinge'] as const);
const regions = choice('regions', args.regions, ['yes', 'no'] as const);
const settle = choice('settle', args.settle, ['on', 'off'] as const);
const params: ExperimentParams = experimentFor(choice('medium', args.medium, ['ground', 'viscous', 'substrate'] as const) as Medium, {
  mode: choice('mode', args.mode, ['original', 'fixed'] as const),
  ...(muscleModel ? { muscleModel } : {}),
  ...(fitnessWindow ? { fitnessWindow } : {}),
  ...(musclePenalty ? { musclePenalty } : {}),
  muscleSharing: args.sharing,
  ...(development ? { development } : {}),
  ...(seedMode ? { seedMode } : {}),
  positionalInputs: args.positional,
  ...(muscleScope ? { muscleScope } : {}),
  ...(regions ? { divideByRegions: regions === 'yes' } : {}),
  ...(settle === 'off' ? { settle: null } : settle === 'on' ? { settle: { speed: 0.01, hold: 0.5, maxTime: 10 } } : {}),
  physics: { friction: args.friction === 'inf' ? Infinity : Number(args.friction) } as ExperimentParams['physics'],
});
if (params.physics.medium === 'substrate' && params.muscleModel !== 'cpg') {
  throw new Error('The substrate needs --muscles cpg (adhesion follows the oscillators).');
}
const cfg = defaultNeatConfig({ populationSize: Number(args.pop), specieCount: Number(args.species), inputCount: inputCount(params) });
const outDir = args.out ?? join('runs', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
mkdirSync(join(outDir, 'champions'), { recursive: true });
writeFileSync(join(outDir, 'config.json'), JSON.stringify({ args, neat: cfg, params }, (_, v) => (v === Infinity ? null : v), 1));

const ea = new NeatEvolution(cfg, seed);
const pool = new EvaluatorPool(args.threads ? Number(args.threads) : undefined);
const evaluate = (genomes: Genome[], generation: number) => pool.evaluate(genomes, generation, seed, params);

const csv = [
  'generation,max_fitness,mean_fitness,mean_complexity,mode,species,best_cells,best_regions,best_working_muscles,best_distance,mean_distance,max_distance,seconds',
];
const distances = (gs: Genome[]) => gs.map((g) => (g.evalInfo as EvalInfo).distance);
const t0 = Date.now();
const log = (s: Awaited<ReturnType<typeof ea.step>>) => {
  const info = s.best.evalInfo as EvalInfo;
  const d = distances(ea.population);
  const meanDist = d.reduce((a, b) => a + b, 0) / d.length;
  const maxDist = Math.max(...d);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  csv.push(
    [s.generation, s.maxFitness, s.meanFitness, s.meanComplexity.toFixed(2), s.mode, s.specieSizes.join('/'), info.cells, info.regions, info.workingMuscles,
      info.distance.toFixed(3), meanDist.toFixed(3), maxDist.toFixed(3), secs].join(','),
  );
  const fmt = (x: number) => (x !== 0 && Math.abs(x) < 0.01 ? x.toExponential(2) : x.toFixed(4));
  console.log(
    `gen ${String(s.generation).padStart(4)}  best ${fmt(s.maxFitness).padStart(10)}  mean ${fmt(s.meanFitness).padStart(9)}` +
      `  complexity ${s.meanComplexity.toFixed(1).padStart(5)}  ${s.mode === 'simplifying' ? 'simplif.' : 'complex.'}` +
      `  cells ${info.cells}  regions ${info.regions}  muscles ${info.workingMuscles}` +
      `  distance ${info.distance.toFixed(2)} (mean ${meanDist.toFixed(2)}, max ${maxDist.toFixed(2)})  (${secs}s)`,
  );
  const champion = serializeChampion(championJson(s.best, params, seed));
  writeFileSync(join(outDir, 'champion.json'), champion);
  writeFileSync(join(outDir, 'champions', `gen-${String(s.generation).padStart(4, '0')}.json`), champion);
  if (s.generation % 10 === 0) writeFileSync(join(outDir, 'population.json'), JSON.stringify(ea.toJSON()));
};

const loaded = args.resume ? (JSON.parse(readFileSync(args.resume, 'utf8')) as PopulationJson) : undefined;
// When resuming into the same folder, the previous history in stats.csv is kept.
const statsFile = join(outDir, 'stats.csv');
if (loaded && existsSync(statsFile)) {
  const previous = readFileSync(statsFile, 'utf8').trim().split('\n').slice(1);
  csv.push(...previous.filter((line) => Number(line.split(',')[0]) < loaded.generation));
}
log(await ea.initialize(evaluate, loaded));
const lastGen = ea.generation + Number(args.gens);
while (ea.generation < lastGen) {
  log(await ea.step(evaluate));
  writeFileSync(join(outDir, 'stats.csv'), csv.join('\n') + '\n');
}
writeFileSync(join(outDir, 'population.json'), JSON.stringify(ea.toJSON()));
await pool.close();
console.log(`\nResults in ${outDir}`);
