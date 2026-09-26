// Genome evaluation: decodes the network, grows the creature and simulates it.
// Every evaluation uses its own seed, so any creature can be replayed exactly.

import { hashSeed, Rng } from '../rng.ts';
import type { Genome } from '../neat/genome.ts';
import { Network } from '../neat/network.ts';
import { DEFAULT_EXPERIMENT, grow, Trial, type ExperimentParams } from './creature.ts';

export const INPUT_COUNT = 11;

/** Network inputs: the 11 of the C# code, plus 4 positional ones if enabled. */
export function inputCount(params: Pick<ExperimentParams, 'positionalInputs'>): number {
  return params.positionalInputs ? INPUT_COUNT + 4 : INPUT_COUNT;
}
export const OUTPUT_COUNT = 12;

export interface EvalInfo {
  seed: number;
  generation: number;
  cells: number;
  muscles: number;
  workingMuscles: number;
  regions: number;
  /** Distance travelled in the fitness window (before the cut-off, regions and penalty). */
  distance: number;
  penalty: number;
}

export function createTrial(genome: Genome, generation: number, seed: number, params: ExperimentParams): Trial {
  const net = new Network(genome, inputCount(params), OUTPUT_COUNT);
  const body = grow(net, generation, new Rng(seed), params.mode, params.muscleModel, params.maxAmplitude, params, params.physics.medium === 'substrate');
  return new Trial(body, generation, params);
}

export function evaluateGenome(
  genome: Genome,
  generation: number,
  runSeed: number,
  params: ExperimentParams = DEFAULT_EXPERIMENT,
): { fitness: number; info: EvalInfo } {
  const seed = params.seedMode === 'inherited' ? hashSeed(runSeed, genome.devSeed) : hashSeed(runSeed, genome.id, generation);
  const trial = createTrial(genome, generation, seed, params);
  const fitness = trial.run();
  const body = trial.body;
  return {
    fitness,
    info: {
      seed,
      generation,
      cells: body.cells.length,
      muscles: body.muscles.length,
      workingMuscles: body.muscles.filter((m) => m.working).length,
      regions: body.noRegions,
      distance: trial.distance,
      penalty: body.penalty,
    },
  };
}
