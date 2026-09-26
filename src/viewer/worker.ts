// Web Worker: runs the evolution without blocking the page and posts a summary per generation.

import { championJson, type ChampionJson } from '../champion.ts';
import { defaultNeatConfig } from '../neat/config.ts';
import { NeatEvolution, type GenerationStats, type PopulationJson } from '../neat/evolution.ts';
import type { Genome } from '../neat/genome.ts';
import type { ExperimentParams } from '../sim/creature.ts';
import { evaluateGenome, inputCount } from '../sim/evaluate.ts';

export type ToWorker =
  | { type: 'start'; populationSize: number; specieCount: number; seed: number; params: ExperimentParams; population?: PopulationJson }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'getPopulation' };

export type FromWorker =
  | { type: 'generation'; stats: Omit<GenerationStats, 'best'>; champion: ChampionJson }
  | { type: 'population'; population: PopulationJson }
  | { type: 'error'; message: string };

let ea: NeatEvolution | null = null;
let running = false;
let runId = 0;

const post = (m: FromWorker) => postMessage(m);

function report(stats: GenerationStats, params: ExperimentParams, seed: number) {
  const { best, ...rest } = stats;
  post({ type: 'generation', stats: rest, champion: championJson(best, params, seed) });
}

async function loop(id: number, params: ExperimentParams, seed: number) {
  const evaluate = (genomes: Genome[], generation: number) => {
    for (const g of genomes) {
      const r = evaluateGenome(g, generation, seed, params);
      g.fitness = r.fitness;
      g.evalInfo = r.info;
    }
  };
  while (id === runId) {
    if (!running || !ea) {
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
    report(await ea.step(evaluate), params, seed);
    // Yields control so that messages can be received (pause, new run...).
    await new Promise((r) => setTimeout(r, 0));
  }
}

onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'start': {
        const id = ++runId;
        running = true;
        ea = new NeatEvolution(
          defaultNeatConfig({ populationSize: msg.populationSize, specieCount: msg.specieCount, inputCount: inputCount(msg.params) }),
          msg.seed,
        );
        const stats = await ea.initialize((gs, gen) => {
          for (const g of gs) {
            const r = evaluateGenome(g, gen, msg.seed, msg.params);
            g.fitness = r.fitness;
            g.evalInfo = r.info;
          }
        }, msg.population);
        report(stats, msg.params, msg.seed);
        void loop(id, msg.params, msg.seed);
        break;
      }
      case 'pause':
        running = false;
        break;
      case 'resume':
        running = true;
        break;
      case 'getPopulation':
        if (ea) post({ type: 'population', population: ea.toJSON() });
        break;
    }
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
