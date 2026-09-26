// Seeded pseudo-random generator (sfc32). The whole project uses this class instead of
// Math.random so that evolutions and replays are reproducible.

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spareGaussian: number | null = null;

  constructor(seed: number) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = seed >>> 0;
    for (let i = 0; i < 15; i++) this.nextUint32();
  }

  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform real in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Normal N(mu, sigma) via Box-Muller. */
  gaussian(mu = 0, sigma = 1): number {
    if (this.spareGaussian !== null) {
      const s = this.spareGaussian;
      this.spareGaussian = null;
      return mu + sigma * s;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spareGaussian = r * Math.sin(2 * Math.PI * v);
    return mu + sigma * r * Math.cos(2 * Math.PI * v);
  }

  shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }
}

/** Mixes several integers into a 32-bit seed (to derive per-evaluation seeds). */
export function hashSeed(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h ^= v >>> 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

/** SharpNEAT's probabilistic rounding: 2.3 -> 3 with probability 0.3. */
export function probabilisticRound(val: number, rng: Rng): number {
  const integer = Math.floor(val);
  return rng.next() < val - integer ? integer + 1 : integer;
}

/** Roulette throw: an index with probability proportional to its weight. Uniform if all are 0. */
export function rouletteThrow(weights: readonly number[], rng: Rng): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return rng.int(weights.length);
  let point = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    if (point < weights[i]) return i;
    point -= weights[i];
  }
  // Guard against rounding errors: last index with non-zero weight.
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
  return weights.length - 1;
}
