// Derived from SharpNEAT, Copyright (C) 2004-2010 Colin Green. Licensed under the GNU General
// Public License version 3 or later (see LICENSE).
//
// NEAT genome ported from SharpNEAT (NeatGenome / NeatGenomeFactory).
// Acyclic networks only (FeedforwardOnly = true, as in experiment.config.xml).

import { hashSeed, Rng, rouletteThrow, probabilisticRound } from '../rng.ts';
import { SIMPLIFYING_MUTATION, type NeatConfig, type WeightMutationInfo } from './config.ts';

export type NeuronType = 'bias' | 'input' | 'output' | 'hidden';

export interface NeuronGene {
  id: number;
  type: NeuronType;
}

export interface ConnectionGene {
  id: number;
  src: number;
  tgt: number;
  w: number;
}

/** Sparse vector (innovation id -> weight), sorted by id. Equivalent to CoordinateVector. */
export interface CoordVector {
  keys: number[];
  vals: number[];
}

export interface GenomeJson {
  id: number;
  birthGeneration: number;
  neurons: [number, NeuronType][];
  connections: [number, number, number, number][];
  devSeed?: number;
}

export class Genome {
  fitness = 0;
  specieIdx = -1;
  /** Data from the last evaluation (e.g. the seed used), so that it can be replayed. */
  evalInfo: unknown = null;
  /**
   * Heritable development seed: with `seedMode: 'inherited'` the body is a fixed function of the
   * genome and this seed, which is passed on to the offspring and mutates now and then.
   */
  devSeed = 0;

  constructor(
    public id: number,
    public birthGeneration: number,
    /** Sorted by id: bias, inputs, outputs, then hidden. */
    public neurons: NeuronGene[],
    /** Sorted by innovation id. */
    public conns: ConnectionGene[],
  ) {}

  get complexity(): number {
    return this.conns.length;
  }

  position(): CoordVector {
    return { keys: this.conns.map((c) => c.id), vals: this.conns.map((c) => c.w) };
  }

  toJSON(): GenomeJson {
    return {
      id: this.id,
      birthGeneration: this.birthGeneration,
      neurons: this.neurons.map((n) => [n.id, n.type]),
      connections: this.conns.map((c) => [c.id, c.src, c.tgt, c.w]),
      devSeed: this.devSeed,
    };
  }

  static fromJSON(j: GenomeJson): Genome {
    const g = new Genome(
      j.id,
      j.birthGeneration,
      j.neurons.map(([id, type]) => ({ id, type })),
      j.connections.map(([id, src, tgt, w]) => ({ id, src, tgt, w })),
    );
    g.devSeed = j.devSeed ?? 0;
    return g;
  }
}

type AddedNeuron = { neuronId: number; inConnId: number; outConnId: number };

/**
 * Creates genomes and keeps the innovation record shared by the whole population
 * (equivalent to NeatGenomeFactory with its AddedConnectionBuffer and AddedNeuronBuffer).
 */
export class GenomeFactory {
  private nextInnovation: number;
  private nextGenomeId = 0;
  private addedConnections = new Map<string, number>();
  private addedNeurons = new Map<number, AddedNeuron>();
  mode: 'complexifying' | 'simplifying' = 'complexifying';

  constructor(
    public cfg: NeatConfig,
    public rng: Rng,
  ) {
    const neuronCount = 1 + cfg.inputCount + cfg.outputCount;
    const initialConnCount = (1 + cfg.inputCount) * cfg.outputCount;
    this.nextInnovation = neuronCount + initialConnCount;
  }

  get inputAndBiasCount(): number {
    return this.cfg.inputCount + 1;
  }

  /** Serialisable state of the innovation record (to save/load populations). */
  saveState() {
    return {
      nextInnovation: this.nextInnovation,
      nextGenomeId: this.nextGenomeId,
      addedConnections: [...this.addedConnections],
      addedNeurons: [...this.addedNeurons],
    };
  }

  loadState(s: ReturnType<GenomeFactory['saveState']>): void {
    this.nextInnovation = s.nextInnovation;
    this.nextGenomeId = s.nextGenomeId;
    this.addedConnections = new Map(s.addedConnections);
    this.addedNeurons = new Map(s.addedNeurons);
  }

  private newInnovationId(): number {
    return this.nextInnovation++;
  }

  newGenomeId(): number {
    return this.nextGenomeId++;
  }

  randomWeight(): number {
    return (this.rng.next() * 2 - 1) * this.cfg.connectionWeightRange;
  }

  private capWeight(w: number): number {
    const r = this.cfg.connectionWeightRange;
    return w > r ? r : w < -r ? -r : w;
  }

  /** Initial genome: bias + inputs + outputs, with a random fraction of input->output connections. */
  createGenome(birthGeneration: number): Genome {
    const { inputCount, outputCount } = this.cfg;
    const neurons: NeuronGene[] = [{ id: 0, type: 'bias' }];
    for (let i = 0; i < inputCount; i++) neurons.push({ id: 1 + i, type: 'input' });
    for (let i = 0; i < outputCount; i++) neurons.push({ id: 1 + inputCount + i, type: 'output' });

    // The ids of the initial connections are the same in every genome.
    const defs: { id: number; src: number; tgt: number }[] = [];
    let nextId = neurons.length;
    for (let s = 0; s <= inputCount; s++) {
      for (let t = 0; t < outputCount; t++) {
        defs.push({ id: nextId++, src: s, tgt: 1 + inputCount + t });
      }
    }
    this.rng.shuffle(defs);
    const count = Math.max(
      1,
      probabilisticRound(defs.length * this.cfg.initialInterconnectionsProportion, this.rng),
    );
    const conns = defs.slice(0, count).map((d) => ({ ...d, w: this.randomWeight() }));
    conns.sort((a, b) => a.id - b.id);
    const g = new Genome(this.newGenomeId(), birthGeneration, neurons, conns);
    g.devSeed = hashSeed(0x5eed, g.id);
    return g;
  }

  /**
   * The development seed is inherited and mutates with probability devSeedMutation. This is decided
   * by hashing the child's id so as not to consume the NEAT generator (the rest of evolution is unchanged).
   */
  private inheritDevSeed(child: Genome, parent: Genome): void {
    const mutates = hashSeed(child.id, 1) / 4294967296 < this.cfg.devSeedMutation;
    child.devSeed = mutates ? hashSeed(0x5eed, child.id) : parent.devSeed;
  }

  createGenomeList(n: number, birthGeneration: number): Genome[] {
    const list: Genome[] = [];
    for (let i = 0; i < n; i++) list.push(this.createGenome(birthGeneration));
    return list;
  }

  copy(g: Genome, birthGeneration: number): Genome {
    return new Genome(
      this.newGenomeId(),
      birthGeneration,
      g.neurons.map((n) => ({ ...n })),
      g.conns.map((c) => ({ ...c })),
    );
  }

  // ---------------------------------------------------------------- asexual reproduction

  createOffspringAsexual(parent: Genome, birthGeneration: number): Genome {
    const child = this.copy(parent, birthGeneration);
    this.inheritDevSeed(child, parent);
    this.mutate(child);
    return child;
  }

  private mutate(g: Genome): void {
    const p = this.mode === 'complexifying' ? this.cfg.mutation : SIMPLIFYING_MUTATION;
    // SharpNEAT order: weights, add node, add connection, aux (unused), delete connection.
    const probs = [p.connectionWeight, p.addNode, p.addConnection, 0, g.conns.length < 2 ? 0 : p.deleteConnection];
    for (;;) {
      const outcome = rouletteThrow(probs, this.rng);
      let success = false;
      switch (outcome) {
        case 0:
          this.mutateWeights(g);
          success = true;
          break;
        case 1:
          success = this.mutateAddNode(g);
          break;
        case 2:
          success = this.mutateAddConnection(g);
          break;
        case 4:
          success = this.mutateDeleteConnection(g);
          break;
      }
      if (success) return;
      probs[outcome] = 0;
      if (probs.every((x) => x === 0)) return;
    }
  }

  private mutateWeights(g: Genome): void {
    const scheme = this.cfg.weightMutationScheme;
    const info: WeightMutationInfo = scheme[rouletteThrow(scheme.map((s) => s.probability), this.rng)];
    const mutateOne = (c: ConnectionGene) => {
      c.w = info.type === 'reset' ? this.randomWeight() : this.capWeight(c.w + this.rng.gaussian(0, info.sigma));
    };
    const n = g.conns.length;
    if (n === 0) return;
    if (info.selection === 'proportional') {
      let any = false;
      for (const c of g.conns) {
        if (this.rng.next() < info.proportion) {
          mutateOne(c);
          any = true;
        }
      }
      if (!any) mutateOne(g.conns[this.rng.int(n)]);
    } else {
      const mutations = Math.min(n, info.quantity);
      const mutated = new Set<number>();
      const maxRetries = mutations * 5;
      for (let i = 0, retries = 0; i < mutations && retries < maxRetries; i++) {
        const idx = this.rng.int(n);
        if (mutated.has(idx)) {
          retries++;
          continue;
        }
        mutateOne(g.conns[idx]);
        mutated.add(idx);
      }
    }
  }

  private mutateAddNode(g: Genome): boolean {
    if (g.conns.length === 0) return false;
    const idx = this.rng.int(g.conns.length);
    const old = g.conns[idx];
    g.conns.splice(idx, 1);

    let ids = this.addedNeurons.get(old.id);
    const reusable =
      ids !== undefined &&
      !g.neurons.some((n) => n.id === ids!.neuronId) &&
      !g.conns.some((c) => c.id === ids!.inConnId || c.id === ids!.outConnId);
    if (!reusable) {
      const fresh = {
        neuronId: this.newInnovationId(),
        inConnId: this.newInnovationId(),
        outConnId: this.newInnovationId(),
      };
      if (ids === undefined) this.addedNeurons.set(old.id, fresh);
      ids = fresh;
    }
    g.neurons.push({ id: ids!.neuronId, type: 'hidden' });
    g.neurons.sort((a, b) => a.id - b.id);
    g.conns.push({ id: ids!.inConnId, src: old.src, tgt: ids!.neuronId, w: old.w });
    // SharpNEAT uses ConnectionWeightRange as the weight of the second connection.
    g.conns.push({ id: ids!.outConnId, src: ids!.neuronId, tgt: old.tgt, w: this.cfg.connectionWeightRange });
    g.conns.sort((a, b) => a.id - b.id);
    return true;
  }

  private mutateAddConnection(g: Genome): boolean {
    const neuronCount = g.neurons.length;
    if (neuronCount < 3) return false;
    const inBias = this.inputAndBiasCount;
    const outCount = this.cfg.outputCount;
    const hiddenOutputCount = neuronCount - inBias;
    const inputBiasHiddenCount = neuronCount - outCount;
    const sources = sourceMap(g);

    for (let attempt = 0; attempt < 5; attempt++) {
      let srcIdx = this.rng.int(inputBiasHiddenCount);
      if (srcIdx >= inBias) srcIdx += outCount;
      let tgtIdx = inBias + this.rng.int(hiddenOutputCount - 1);
      if (srcIdx === tgtIdx) tgtIdx = neuronCount - 1;
      const src = g.neurons[srcIdx].id;
      const tgt = g.neurons[tgtIdx].id;
      if (g.conns.some((c) => c.src === src && c.tgt === tgt)) continue;
      if (isCyclic(sources, src, tgt)) continue;

      const key = `${src},${tgt}`;
      let id = this.addedConnections.get(key);
      if (id === undefined) {
        id = this.newInnovationId();
        this.addedConnections.set(key, id);
      }
      g.conns.push({ id, src, tgt, w: this.randomWeight() });
      g.conns.sort((a, b) => a.id - b.id);
      return true;
    }
    return false;
  }

  private mutateDeleteConnection(g: Genome): boolean {
    if (g.conns.length < 2) return false;
    const idx = this.rng.int(g.conns.length);
    const [removed] = g.conns.splice(idx, 1);
    removeIfRedundant(g, removed.src);
    if (removed.tgt !== removed.src) removeIfRedundant(g, removed.tgt);
    return true;
  }

  // ---------------------------------------------------------------- sexual reproduction

  createOffspringSexual(p1: Genome, p2: Genome, birthGeneration: number): Genome {
    const builder = new ConnectionListBuilder();
    for (const n of p1.neurons) if (n.type !== 'hidden') builder.neurons.set(n.id, { ...n });

    let fitSwitch: 1 | 2;
    if (p1.fitness > p2.fitness) fitSwitch = 1;
    else if (p1.fitness < p2.fitness) fitSwitch = 2;
    else fitSwitch = this.rng.next() < 0.5 ? 1 : 2;

    const combineDisjointExcess = this.rng.next() < this.cfg.disjointExcessGenesRecombineProbability;
    const leftovers: { gene: ConnectionGene; parent: Genome }[] = [];

    // Correlation by innovation id (sorted lists).
    let i = 0;
    let j = 0;
    while (i < p1.conns.length || j < p2.conns.length) {
      const c1 = i < p1.conns.length ? p1.conns[i] : undefined;
      const c2 = j < p2.conns.length ? p2.conns[j] : undefined;
      if (c1 && c2 && c1.id === c2.id) {
        const pick1 = this.rng.next() < 0.5;
        builder.tryAdd(pick1 ? c1 : c2, pick1 ? p1 : p2);
        i++;
        j++;
      } else if (c1 && (!c2 || c1.id < c2.id)) {
        if (fitSwitch === 1) builder.tryAdd(c1, p1);
        else if (combineDisjointExcess) leftovers.push({ gene: c1, parent: p1 });
        i++;
      } else {
        if (fitSwitch === 2) builder.tryAdd(c2!, p2);
        else if (combineDisjointExcess) leftovers.push({ gene: c2!, parent: p2 });
        j++;
      }
    }
    for (const { gene, parent } of leftovers) {
      if (!builder.isCyclic(gene.src, gene.tgt)) builder.tryAdd(gene, parent);
    }

    const neurons = [...builder.neurons.values()].sort((a, b) => a.id - b.id);
    const conns = builder.conns.sort((a, b) => a.id - b.id);
    const child = new Genome(this.newGenomeId(), birthGeneration, neurons, conns);
    this.inheritDevSeed(child, fitSwitch === 1 ? p1 : p2);
    return child;
  }
}

/** Equivalent to SharpNEAT's ConnectionGeneListBuilder. */
class ConnectionListBuilder {
  neurons = new Map<number, NeuronGene>();
  conns: ConnectionGene[] = [];
  private endpoints = new Set<string>();
  private sources = new Map<number, number[]>();

  tryAdd(c: ConnectionGene, parent: Genome): void {
    const key = `${c.src},${c.tgt}`;
    if (this.endpoints.has(key)) return;
    this.endpoints.add(key);
    this.conns.push({ ...c });
    for (const id of [c.src, c.tgt]) {
      if (!this.neurons.has(id)) {
        const n = parent.neurons.find((x) => x.id === id);
        if (n) this.neurons.set(id, { ...n });
      }
    }
    const list = this.sources.get(c.tgt);
    if (list) list.push(c.src);
    else this.sources.set(c.tgt, [c.src]);
  }

  isCyclic(src: number, tgt: number): boolean {
    return isCyclic(this.sources, src, tgt);
  }
}

function sourceMap(g: Genome): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const c of g.conns) {
    const list = m.get(c.tgt);
    if (list) list.push(c.src);
    else m.set(c.tgt, [c.src]);
  }
  return m;
}

/** Would the connection src->tgt create a cycle? That is, is tgt upstream of src? */
function isCyclic(sources: Map<number, number[]>, src: number, tgt: number): boolean {
  if (src === tgt) return true;
  const visited = new Set<number>([src]);
  const stack = [...(sources.get(src) ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    if (cur === tgt) return true;
    visited.add(cur);
    for (const s of sources.get(cur) ?? []) stack.push(s);
  }
  return false;
}

function removeIfRedundant(g: Genome, neuronId: number): void {
  const idx = g.neurons.findIndex((n) => n.id === neuronId);
  if (idx < 0 || g.neurons[idx].type !== 'hidden') return;
  if (g.conns.some((c) => c.src === neuronId || c.tgt === neuronId)) return;
  g.neurons.splice(idx, 1);
}

// ------------------------------------------------------------------ distance (Manhattan)

export function manhattanDistance(a: CoordVector, b: CoordVector, cfg: NeatConfig['distance']): number {
  const { matchCoeff, mismatchCoeff, mismatchConstant } = cfg;
  let d = 0;
  let i = 0;
  let j = 0;
  while (i < a.keys.length && j < b.keys.length) {
    if (a.keys[i] === b.keys[j]) {
      d += Math.abs(a.vals[i] - b.vals[j]) * matchCoeff;
      i++;
      j++;
    } else if (a.keys[i] < b.keys[j]) {
      d += mismatchConstant + Math.abs(a.vals[i]) * mismatchCoeff;
      i++;
    } else {
      d += mismatchConstant + Math.abs(b.vals[j]) * mismatchCoeff;
      j++;
    }
  }
  for (; i < a.keys.length; i++) d += mismatchConstant + Math.abs(a.vals[i]) * mismatchCoeff;
  for (; j < b.keys.length; j++) d += mismatchConstant + Math.abs(b.vals[j]) * mismatchCoeff;
  return d;
}

/** Centroid of ManhattanDistanceMetric: mean per coordinate (missing ones count as 0). */
export function manhattanCentroid(points: CoordVector[]): CoordVector {
  if (points.length === 1) return points[0];
  const totals = new Map<number, number>();
  for (const p of points) {
    for (let k = 0; k < p.keys.length; k++) totals.set(p.keys[k], (totals.get(p.keys[k]) ?? 0) + p.vals[k]);
  }
  const keys = [...totals.keys()].sort((a, b) => a - b);
  return { keys, vals: keys.map((k) => totals.get(k)! / points.length) };
}
