// Champion file format: the genome plus everything needed to replay its evaluation exactly
// (seed, generation and parameters).

import type { Genome, GenomeJson } from './neat/genome.ts';
import type { ExperimentParams } from './sim/creature.ts';
import type { EvalInfo } from './sim/evaluate.ts';

export interface ChampionJson {
  genome: GenomeJson;
  fitness: number;
  eval: EvalInfo;
  params: ExperimentParams;
  runSeed: number;
}

export function championJson(g: Genome, params: ExperimentParams, runSeed: number): ChampionJson {
  return { genome: g.toJSON(), fitness: g.fitness, eval: g.evalInfo as EvalInfo, params, runSeed };
}

/** JSON has no Infinity: infinite friction is stored as null. */
export function serializeChampion(c: ChampionJson): string {
  return JSON.stringify(c, (_, v) => (v === Infinity ? null : v), 1);
}

/**
 * Parameter values used by files written before the code was translated to English, mapped to the
 * current ones, so that old champion and configuration files can still be replayed.
 */
const LEGACY_VALUES: Record<string, Record<string, string>> = {
  mode: { corregido: 'fixed' },
  muscleModel: { acumulativo: 'accumulative', oscilador: 'oscillator' },
  fitnessWindow: { completo: 'full', 'segunda-mitad': 'second-half' },
  musclePenalty: { producto: 'product', 'media-geometrica': 'geometric-mean' },
  development: { estocastico: 'stochastic', determinista: 'deterministic' },
  seedMode: { 'por-evaluacion': 'per-evaluation', heredada: 'inherited' },
  muscleScope: { todos: 'all', bisagra: 'hinge' },
  medium: { suelo: 'ground', viscoso: 'viscous', sustrato: 'substrate' },
};

/** Restores Infinity and translates legacy parameter values (mutates and returns `params`). */
export function normalizeParams(params: ExperimentParams): ExperimentParams {
  if (params.physics.friction === null) params.physics.friction = Infinity;
  const fix = (obj: Record<string, unknown>) => {
    for (const [key, map] of Object.entries(LEGACY_VALUES)) {
      const v = obj[key];
      if (typeof v === 'string' && map[v]) obj[key] = map[v];
    }
  };
  fix(params as unknown as Record<string, unknown>);
  fix(params.physics as unknown as Record<string, unknown>);
  return params;
}

export function parseChampion(text: string): ChampionJson {
  const c = JSON.parse(text) as ChampionJson;
  normalizeParams(c.params);
  return c;
}
