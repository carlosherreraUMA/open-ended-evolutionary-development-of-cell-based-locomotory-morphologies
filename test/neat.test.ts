import { describe, expect, it } from 'vitest';
import { defaultNeatConfig } from '../src/neat/config.ts';
import { NeatEvolution } from '../src/neat/evolution.ts';
import { Genome } from '../src/neat/genome.ts';
import { Network } from '../src/neat/network.ts';

// The description in experiment.config.xml was precisely XOR: it validates the NEAT port.
const CASES = [
  [0, 0, 0],
  [0, 1, 1],
  [1, 0, 1],
  [1, 1, 0],
];

function xorFitness(g: Genome): number {
  const net = new Network(g, 2, 1);
  let fitness = 0;
  let correct = 0;
  for (const [a, b, expected] of CASES) {
    net.inputs[0] = a;
    net.inputs[1] = b;
    net.activate();
    const out = net.outputs[0];
    fitness += 1 - Math.abs(out - expected);
    if (out >= 0.5 === (expected === 1)) correct++;
  }
  return correct === 4 ? fitness + 10 : fitness;
}

describe('NEAT', () => {
  it('solves XOR', async () => {
    const cfg = defaultNeatConfig({ inputCount: 2, outputCount: 1, populationSize: 150, specieCount: 10, complexityThreshold: null });
    const ea = new NeatEvolution(cfg, 42);
    const evaluate = (gs: Genome[]) => gs.forEach((g) => (g.fitness = xorFitness(g)));
    let stats = await ea.initialize(evaluate);
    while (stats.maxFitness < 10 && ea.generation < 500) stats = await ea.step(evaluate);
    expect(stats.maxFitness).toBeGreaterThanOrEqual(10);
    expect(ea.population).toHaveLength(150);
  });

  it('keeps the population size and acyclic genomes with the original configuration', async () => {
    const ea = new NeatEvolution(defaultNeatConfig(), 7);
    let n = 0;
    const evaluate = (gs: Genome[]) => gs.forEach((g) => (g.fitness = ++n % 5));
    await ea.initialize(evaluate);
    for (let i = 0; i < 200; i++) {
      await ea.step(evaluate);
      expect(ea.population).toHaveLength(8);
    }
    for (const g of ea.population) {
      const ids = new Set(g.neurons.map((x) => x.id));
      for (const c of g.conns) {
        expect(ids.has(c.src) && ids.has(c.tgt)).toBe(true);
      }
      expect(new Set(g.conns.map((c) => `${c.src},${c.tgt}`)).size).toBe(g.conns.length);
    }
  });

  it('serialises and restores genomes', () => {
    const ea = new NeatEvolution(defaultNeatConfig(), 1);
    const g = ea.factory.createGenome(0);
    expect(Genome.fromJSON(JSON.parse(JSON.stringify(g))).toJSON()).toEqual(g.toJSON());
  });
});
