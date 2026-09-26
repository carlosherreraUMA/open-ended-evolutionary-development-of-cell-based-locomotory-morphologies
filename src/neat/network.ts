// Derived from SharpNEAT, Copyright (C) 2004-2010 Colin Green. Licensed under the GNU General
// Public License version 3 or later (see LICENSE).
//
// Acyclic network decoded from a genome (equivalent to SharpNEAT's FastAcyclicNetwork).
// Activation: SteepenedSigmoid on hidden and output neurons; the bias is 1.

import type { Genome } from './genome.ts';

export function steepenedSigmoid(x: number): number {
  return 1 / (1 + Math.exp(-4.9 * x));
}

export class Network {
  readonly inputs: Float64Array;
  readonly outputs: Float64Array;
  private values: Float64Array;
  /** Indices (into `values`) of the non-input neurons, in topological order. */
  private order: Int32Array;
  /** Connections grouped by target neuron, in the same order as `order`. */
  private connStart: Int32Array;
  private connSrc: Int32Array;
  private connW: Float64Array;
  private outputIdx: Int32Array;
  private inputCount: number;

  constructor(genome: Genome, inputCount: number, outputCount: number) {
    this.inputCount = inputCount;
    this.inputs = new Float64Array(inputCount);
    this.outputs = new Float64Array(outputCount);

    const index = new Map<number, number>();
    genome.neurons.forEach((n, i) => index.set(n.id, i));
    this.values = new Float64Array(genome.neurons.length);

    // Incoming connections per neuron (those pointing to non-existent neurons are dropped).
    const incoming: { src: number; w: number }[][] = genome.neurons.map(() => []);
    for (const c of genome.conns) {
      const s = index.get(c.src);
      const t = index.get(c.tgt);
      if (s === undefined || t === undefined) continue;
      incoming[t].push({ src: s, w: c.w });
    }

    // Topological order (Kahn). If a crossover left a cycle, those neurons are appended at the end,
    // ignoring the connections that close it.
    const isInput = (i: number) => genome.neurons[i].type === 'bias' || genome.neurons[i].type === 'input';
    const pending = new Int32Array(genome.neurons.length);
    const outgoing: number[][] = genome.neurons.map(() => []);
    incoming.forEach((list, t) => {
      for (const { src } of list) {
        outgoing[src].push(t);
        pending[t]++;
      }
    });
    const queue: number[] = [];
    genome.neurons.forEach((_, i) => {
      if (pending[i] === 0) queue.push(i);
    });
    const done = new Uint8Array(genome.neurons.length);
    const order: number[] = [];
    while (queue.length > 0) {
      const i = queue.shift()!;
      done[i] = 1;
      if (!isInput(i)) order.push(i);
      for (const t of outgoing[i]) if (--pending[t] === 0) queue.push(t);
    }
    genome.neurons.forEach((_, i) => {
      if (!done[i] && !isInput(i)) order.push(i);
    });

    this.order = Int32Array.from(order);
    const starts: number[] = [];
    const srcs: number[] = [];
    const ws: number[] = [];
    for (const t of order) {
      starts.push(srcs.length);
      for (const { src, w } of incoming[t]) {
        srcs.push(src);
        ws.push(w);
      }
    }
    starts.push(srcs.length);
    this.connStart = Int32Array.from(starts);
    this.connSrc = Int32Array.from(srcs);
    this.connW = Float64Array.from(ws);
    this.outputIdx = Int32Array.from(
      genome.neurons.map((n, i) => (n.type === 'output' ? i : -1)).filter((i) => i >= 0),
    );
  }

  activate(): void {
    const v = this.values;
    v.fill(0);
    v[0] = 1; // bias
    for (let i = 0; i < this.inputCount; i++) v[1 + i] = this.inputs[i];
    for (let k = 0; k < this.order.length; k++) {
      let sum = 0;
      for (let c = this.connStart[k]; c < this.connStart[k + 1]; c++) sum += v[this.connSrc[c]] * this.connW[c];
      v[this.order[k]] = steepenedSigmoid(sum);
    }
    for (let i = 0; i < this.outputIdx.length; i++) this.outputs[i] = v[this.outputIdx[i]];
  }
}
