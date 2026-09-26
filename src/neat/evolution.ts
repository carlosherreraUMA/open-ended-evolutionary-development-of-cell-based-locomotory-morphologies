// Derived from SharpNEAT, Copyright (C) 2004-2010 Colin Green. Licensed under the GNU General
// Public License version 3 or later (see LICENSE).
//
// Generational NEAT evolutionary algorithm, ported from SharpNEAT:
// NeatEvolutionAlgorithm + KMeansClusteringStrategy + DefaultComplexityRegulationStrategy.

import { Rng, probabilisticRound, rouletteThrow } from '../rng.ts';
import type { NeatConfig } from './config.ts';
import {
  Genome,
  GenomeFactory,
  manhattanCentroid,
  manhattanDistance,
  type CoordVector,
  type GenomeJson,
} from './genome.ts';

/**
 * Evaluates a list of genomes and sets `genome.fitness` (and optionally `evalInfo`).
 * `generation` is the number of completed generations, like Optimizer.Generation in Unity.
 */
export type Evaluator = (genomes: Genome[], generation: number) => void | Promise<void>;

interface Specie {
  idx: number;
  genomes: Genome[];
  centroid: CoordVector;
}

export interface GenerationStats {
  generation: number;
  maxFitness: number;
  meanFitness: number;
  meanComplexity: number;
  maxComplexity: number;
  specieSizes: number[];
  mode: 'complexifying' | 'simplifying';
  best: Genome;
}

export interface PopulationJson {
  generation: number;
  factory: ReturnType<GenomeFactory['saveState']>;
  genomes: GenomeJson[];
}

const MAX_KMEANS_LOOPS = 5;
const MIN_SIMPLIFICATION_GENERATIONS = 10;
const MOVING_AVERAGE_LENGTH = 100;

export class NeatEvolution {
  readonly rng: Rng;
  readonly factory: GenomeFactory;
  generation = 0;
  population: Genome[] = [];
  species: Specie[] = [];
  best: Genome | null = null;
  private bestSpecieIdx = 0;

  private complexityHistory: number[] = [];
  private lastTransitionGeneration = 0;

  constructor(
    public readonly cfg: NeatConfig,
    seed: number,
  ) {
    if (cfg.populationSize <= cfg.specieCount) {
      throw new Error('The population size must be larger than the number of species.');
    }
    this.rng = new Rng(seed);
    this.factory = new GenomeFactory(cfg, this.rng);
  }

  /** Creates and evaluates the initial (or a loaded) population and splits it into species. */
  async initialize(evaluate: Evaluator, loaded?: PopulationJson): Promise<GenerationStats> {
    if (loaded) {
      this.factory.loadState(loaded.factory);
      this.generation = loaded.generation;
      this.population = loaded.genomes.map((g) => Genome.fromJSON(g));
    } else {
      this.population = this.factory.createGenomeList(this.cfg.populationSize, 0);
    }
    await evaluate(this.population, this.generation);
    this.species = [];
    for (let i = 0; i < this.cfg.specieCount; i++) this.species.push({ idx: i, genomes: [], centroid: { keys: [], vals: [] } });
    this.speciateGenomes(this.population);
    this.sortSpecieGenomes();
    this.updateBestGenome();
    return this.currentStats();
  }

  /** One full generation: reproduction, evaluation and re-speciation. */
  async step(evaluate: Evaluator): Promise<GenerationStats> {
    this.generation++;
    const { stats, offspringCount } = this.calcSpecieStats();
    const offspring = this.createOffspring(stats, offspringCount);
    const emptySpecies = this.trimSpeciesBackToElite(stats);

    this.population = this.species.flatMap((s) => s.genomes).concat(offspring);
    // In Unity every genome (the elite included) was re-evaluated at every generation.
    await evaluate(this.population, this.generation - 1);

    if (emptySpecies) {
      for (const s of this.species) s.genomes = [];
      this.speciateGenomes(this.population);
    } else {
      this.speciateOffspring(offspring);
    }
    this.sortSpecieGenomes();
    this.updateBestGenome();
    const result = this.currentStats();
    this.regulateComplexity(result.meanComplexity);
    return result;
  }

  toJSON(): PopulationJson {
    return {
      generation: this.generation,
      factory: this.factory.saveState(),
      genomes: this.population.map((g) => g.toJSON()),
    };
  }

  // ---------------------------------------------------------------- reproduction

  private calcSpecieStats() {
    const n = this.species.length;
    const popSize = this.cfg.populationSize;
    const stats = this.species.map((s) => ({
      meanFitness: s.genomes.reduce((a, g) => a + g.fitness, 0) / s.genomes.length,
      targetReal: 0,
      targetInt: 0,
      elite: 0,
      offspring: 0,
      asexual: 0,
      sexual: 0,
      selection: 0,
    }));
    const totalMean = stats.reduce((a, s) => a + s.meanFitness, 0);
    let totalTarget = 0;
    for (const s of stats) {
      s.targetReal = totalMean === 0 ? popSize / n : (s.meanFitness / totalMean) * popSize;
      s.targetInt = probabilisticRound(s.targetReal, this.rng);
      totalTarget += s.targetInt;
    }

    // Adjust so that the target sizes add up exactly to the population size.
    let delta = totalTarget - popSize;
    if (delta < 0) {
      if (delta === -1) {
        stats[this.bestSpecieIdx].targetInt++;
      } else {
        const probs = stats.map((s) => Math.max(0, s.targetReal - s.targetInt));
        for (delta = -delta; delta > 0; delta--) stats[rouletteThrow(probs, this.rng)].targetInt++;
      }
    } else if (delta > 0) {
      const probs = stats.map((s) => Math.max(0, s.targetInt - s.targetReal));
      while (delta > 0) {
        const idx = rouletteThrow(probs, this.rng);
        if (stats[idx].targetInt !== 0) {
          stats[idx].targetInt--;
          delta--;
        } else {
          probs[idx] = 0;
          if (!probs.some((p) => p > 0)) stats.forEach((s, i) => (probs[i] = s.targetInt > 0 ? 1 : 0));
        }
      }
    }

    // The species of the best genome can never disappear.
    if (stats[this.bestSpecieIdx].targetInt === 0) {
      stats[this.bestSpecieIdx].targetInt++;
      const donor = stats.findIndex((s, i) => i !== this.bestSpecieIdx && s.targetInt > 0);
      if (donor < 0) throw new Error('Could not adjust the species sizes.');
      stats[donor].targetInt--;
    }

    let offspringCount = 0;
    stats.forEach((s, i) => {
      if (s.targetInt === 0) {
        s.elite = 0;
        return;
      }
      const size = this.species[i].genomes.length;
      s.elite = Math.min(probabilisticRound(size * this.cfg.elitismProportion, this.rng), s.targetInt);
      if (i === this.bestSpecieIdx && s.elite === 0) s.elite = 1;
      s.offspring = s.targetInt - s.elite;
      offspringCount += s.offspring;
      const asexualProportion = this.factory.mode === 'simplifying' ? 1 : this.cfg.offspringAsexualProportion;
      s.asexual = probabilisticRound(s.offspring * asexualProportion, this.rng);
      s.sexual = s.offspring - s.asexual;
      s.selection = Math.max(1, probabilisticRound(size * this.cfg.selectionProportion, this.rng));
    });
    return { stats, offspringCount };
  }

  private createOffspring(stats: ReturnType<NeatEvolution['calcSpecieStats']>['stats'], count: number): Genome[] {
    const gen = this.generation;
    const selectionProbs = this.species.map((sp, i) =>
      sp.genomes.slice(0, stats[i].selection).map((g) => g.fitness),
    );
    const specieWeights = stats.map((s) => s.selection);
    const nonZeroSpecies = specieWeights.filter((w) => w !== 0).length;
    const offspring: Genome[] = [];

    this.species.forEach((sp, i) => {
      const s = stats[i];
      const probs = selectionProbs[i];
      if (probs.length === 0) return;
      for (let k = 0; k < s.asexual; k++) {
        offspring.push(this.factory.createOffspringAsexual(sp.genomes[rouletteThrow(probs, this.rng)], gen));
      }
      const crossSpecie =
        nonZeroSpecies === 1 ? 0 : probabilisticRound(this.cfg.interspeciesMatingProportion * s.sexual, this.rng);
      let matings = 0;
      for (; matings < crossSpecie; matings++) {
        const p1 = sp.genomes[rouletteThrow(probs, this.rng)];
        const others = specieWeights.map((w, j) => (j === i ? 0 : w));
        const j = rouletteThrow(others, this.rng);
        const p2 = this.species[j].genomes[rouletteThrow(selectionProbs[j], this.rng)];
        offspring.push(this.factory.createOffspringSexual(p1, p2, gen));
      }
      for (; matings < s.sexual; matings++) {
        const idx1 = rouletteThrow(probs, this.rng);
        if (s.selection === 1) {
          offspring.push(this.factory.createOffspringAsexual(sp.genomes[idx1], gen));
          continue;
        }
        const rest = probs.map((p, k) => (k === idx1 ? 0 : p));
        if (rest.some((p) => p > 0)) {
          const idx2 = rouletteThrow(rest, this.rng);
          offspring.push(this.factory.createOffspringSexual(sp.genomes[idx1], sp.genomes[idx2], gen));
        } else {
          offspring.push(this.factory.createOffspringAsexual(sp.genomes[idx1], gen));
        }
      }
    });
    if (offspring.length !== count) throw new Error(`Descendencia inesperada: ${offspring.length} != ${count}`);
    return offspring;
  }

  private trimSpeciesBackToElite(stats: { elite: number }[]): boolean {
    let empty = false;
    this.species.forEach((sp, i) => {
      sp.genomes = sp.genomes.slice(0, stats[i].elite);
      if (stats[i].elite === 0) empty = true;
    });
    return empty;
  }

  private sortSpecieGenomes(): void {
    for (const sp of this.species) {
      this.rng.shuffle(sp.genomes);
      // Highest fitness first; on ties, the youngest.
      sp.genomes.sort((a, b) => b.fitness - a.fitness || b.birthGeneration - a.birthGeneration);
    }
  }

  private updateBestGenome(): void {
    let bestFitness = -1;
    this.species.forEach((sp, i) => {
      const g = sp.genomes[0];
      if (g && g.fitness > bestFitness) {
        bestFitness = g.fitness;
        this.best = g;
        this.bestSpecieIdx = i;
      }
    });
  }

  private currentStats(): GenerationStats {
    const pop = this.population;
    return {
      generation: this.generation,
      maxFitness: this.best?.fitness ?? 0,
      meanFitness: pop.reduce((a, g) => a + g.fitness, 0) / pop.length,
      meanComplexity: pop.reduce((a, g) => a + g.complexity, 0) / pop.length,
      maxComplexity: Math.max(...pop.map((g) => g.complexity)),
      specieSizes: this.species.map((s) => s.genomes.length),
      mode: this.factory.mode,
      best: this.best!,
    };
  }

  // ---------------------------------------------------------------- complexity regulation

  private regulateComplexity(meanComplexity: number): void {
    const threshold = this.cfg.complexityThreshold;
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const prevMA = mean(this.complexityHistory);
    this.complexityHistory.push(meanComplexity);
    if (this.complexityHistory.length > MOVING_AVERAGE_LENGTH) this.complexityHistory.shift();
    if (threshold === null) return;

    if (this.factory.mode === 'complexifying') {
      if (meanComplexity > threshold) {
        this.factory.mode = 'simplifying';
        this.lastTransitionGeneration = this.generation;
      }
    } else if (
      this.generation - this.lastTransitionGeneration > MIN_SIMPLIFICATION_GENERATIONS &&
      meanComplexity < threshold &&
      mean(this.complexityHistory) - prevMA >= 0
    ) {
      this.factory.mode = 'complexifying';
      this.lastTransitionGeneration = this.generation;
    }
  }

  // ---------------------------------------------------------------- k-means speciation

  private distance(a: CoordVector, b: CoordVector): number {
    return manhattanDistance(a, b, this.cfg.distance);
  }

  private centroidOf(sp: Specie): CoordVector {
    return manhattanCentroid(sp.genomes.map((g) => g.position()));
  }

  private closestSpecie(g: Genome): Specie {
    const pos = g.position();
    let best = this.species[0];
    let bestD = this.distance(pos, best.centroid);
    for (let i = 1; i < this.species.length; i++) {
      const d = this.distance(pos, this.species[i].centroid);
      if (d < bestD) {
        bestD = d;
        best = this.species[i];
      }
    }
    return best;
  }

  private speciateGenomes(genomes: Genome[]): void {
    const k = this.species.length;
    for (let i = 0; i < k; i++) {
      const sp = this.species[i];
      genomes[i].specieIdx = sp.idx;
      sp.genomes.push(genomes[i]);
      sp.centroid = genomes[i].position();
    }
    for (let i = k; i < genomes.length; i++) {
      const sp = this.closestSpecie(genomes[i]);
      genomes[i].specieIdx = sp.idx;
      sp.genomes.push(genomes[i]);
    }
    for (const sp of this.species) sp.centroid = this.centroidOf(sp);
    this.speciateUntilConvergence(genomes);
  }

  private speciateOffspring(offspring: Genome[]): void {
    for (const sp of this.species) sp.centroid = this.centroidOf(sp);
    for (const g of offspring) {
      const sp = this.closestSpecie(g);
      sp.genomes.push(g);
      g.specieIdx = sp.idx;
    }
    for (const sp of this.species) sp.centroid = this.centroidOf(sp);
    this.speciateUntilConvergence(this.species.flatMap((s) => s.genomes));
  }

  private speciateUntilConvergence(genomes: Genome[]): void {
    const modified = new Array<boolean>(this.species.length).fill(false);
    for (let loop = 0; loop < MAX_KMEANS_LOOPS; loop++) {
      let reallocations = 0;
      for (const g of genomes) {
        const sp = this.closestSpecie(g);
        if (g.specieIdx !== sp.idx) {
          modified[g.specieIdx] = true;
          modified[sp.idx] = true;
          sp.genomes.push(g);
          g.specieIdx = sp.idx;
          reallocations++;
        }
      }
      const empty: Specie[] = [];
      this.species.forEach((sp, i) => {
        if (!modified[i]) return;
        modified[i] = false;
        sp.genomes = sp.genomes.filter((g) => g.specieIdx === sp.idx);
        if (sp.genomes.length === 0) empty.push(sp);
        else sp.centroid = this.centroidOf(sp);
      });

      if (empty.length > 0) {
        // Empty species are repopulated with the genomes furthest from their centroid.
        const byDistance = genomes
          .map((g) => ({ g, d: this.distance(g.position(), this.species[g.specieIdx].centroid) }))
          .sort((a, b) => b.d - a.d)
          .map((x) => x.g);
        let outlier = 0;
        for (const emptySp of empty) {
          let g: Genome;
          let source: Specie;
          do {
            g = byDistance[outlier++];
            source = this.species[g.specieIdx];
          } while (source.genomes.length === 1 && outlier < byDistance.length);
          if (source.genomes.length === 1) throw new Error('No genome found to repopulate an empty species.');
          modified[emptySp.idx] = true;
          modified[source.idx] = true;
          source.genomes.splice(source.genomes.indexOf(g), 1);
          emptySp.genomes.push(g);
          g.specieIdx = emptySp.idx;
          reallocations++;
        }
        this.species.forEach((sp, i) => {
          if (modified[i]) {
            modified[i] = false;
            sp.centroid = this.centroidOf(sp);
          }
        });
      }
      if (reallocations === 0) break;
    }
  }
}
