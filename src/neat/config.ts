// Derived from SharpNEAT, Copyright (C) 2004-2010 Colin Green. Licensed under the GNU General
// Public License version 3 or later (see LICENSE).
//
// NEAT parameters. The defaults are SharpNEAT's, as they were in the Unity project
// (NeatGenomeParameters, NeatEvolutionAlgorithmParameters and Resources/experiment.config.xml).

export interface WeightMutationInfo {
  probability: number;
  type: 'jiggle' | 'reset';
  /** 'fixed' mutates `quantity` connections; 'proportional' mutates each connection with prob. `proportion`. */
  selection: 'fixed' | 'proportional';
  quantity: number;
  proportion: number;
  sigma: number;
}

export interface NeatConfig {
  inputCount: number;
  outputCount: number;
  populationSize: number;
  specieCount: number;

  // Evolutionary algorithm
  elitismProportion: number;
  selectionProportion: number;
  offspringAsexualProportion: number;
  interspeciesMatingProportion: number;

  // Genome
  connectionWeightRange: number;
  initialInterconnectionsProportion: number;
  disjointExcessGenesRecombineProbability: number;
  mutation: {
    connectionWeight: number;
    addNode: number;
    addConnection: number;
    deleteConnection: number;
  };
  weightMutationScheme: WeightMutationInfo[];

  // Manhattan distance for speciation (match, mismatch, mismatch constant).
  distance: { matchCoeff: number; mismatchCoeff: number; mismatchConstant: number };

  /** Probability that a child gets a new development seed instead of its parent's. */
  devSeedMutation: number;

  /** "Absolute" complexity regulation. null disables it. */
  complexityThreshold: number | null;
}

const jiggle = (selection: 'fixed' | 'proportional', q: number, sigma: number, p: number): WeightMutationInfo => ({
  probability: p,
  type: 'jiggle',
  selection,
  quantity: selection === 'fixed' ? q : 0,
  proportion: selection === 'proportional' ? q : 0,
  sigma,
});
const reset = (selection: 'fixed' | 'proportional', q: number, p: number): WeightMutationInfo => ({
  probability: p,
  type: 'reset',
  selection,
  quantity: selection === 'fixed' ? q : 0,
  proportion: selection === 'proportional' ? q : 0,
  sigma: 0,
});

export const DEFAULT_WEIGHT_MUTATION_SCHEME: WeightMutationInfo[] = [
  jiggle('fixed', 1, 0.02, 0.11375),
  jiggle('fixed', 2, 0.02, 0.11375),
  jiggle('fixed', 3, 0.02, 0.11375),
  jiggle('proportional', 0.02, 0.02, 0.11375),
  jiggle('fixed', 1, 1, 0.11375),
  jiggle('fixed', 2, 1, 0.11375),
  jiggle('fixed', 3, 1, 0.11375),
  jiggle('proportional', 0.02, 1, 0.11275),
  reset('fixed', 1, 0.03),
  reset('fixed', 2, 0.03),
  reset('fixed', 3, 0.03),
  reset('proportional', 0.02, 0.001),
];

export function defaultNeatConfig(overrides: Partial<NeatConfig> = {}): NeatConfig {
  return {
    inputCount: 11,
    outputCount: 12,
    populationSize: 8,
    specieCount: 2,
    elitismProportion: 0.2,
    selectionProportion: 0.2,
    offspringAsexualProportion: 0.5,
    interspeciesMatingProportion: 0.01,
    connectionWeightRange: 5,
    initialInterconnectionsProportion: 0.05,
    disjointExcessGenesRecombineProbability: 0.1,
    mutation: { connectionWeight: 0.988, addNode: 0.005, addConnection: 0.05, deleteConnection: 0.004 },
    weightMutationScheme: DEFAULT_WEIGHT_MUTATION_SCHEME,
    distance: { matchCoeff: 1, mismatchCoeff: 0, mismatchConstant: 10 },
    complexityThreshold: 20,
    devSeedMutation: 0.05,
    ...overrides,
  };
}

/** Mutation probabilities in "simplifying" mode (NeatGenomeParameters.CreateSimplifyingParameters). */
export const SIMPLIFYING_MUTATION = { connectionWeight: 0.6, addNode: 0, addConnection: 0, deleteConnection: 0.4 };
