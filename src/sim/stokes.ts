// Viscous medium without inertia (low Reynolds number): Stokes dynamics of articulated rigid bodies.
//
// Each segment (a group of cells joined by fixed joints) is a rigid body with linear velocity U and
// angular velocity Ω. There is no mass: at every instant drag exactly balances the forces from
// muscles, hinge springs, collisions and the hinges themselves:
//
//     R_s · V_s = F_s + J_sᵀ · λ          (for every segment s)
//     J · V     = β · e                   (both segments agree at the pivot of every hinge)
//
// R_s is the 6×6 resistance matrix of the segment, which adds up the anisotropic drag of the joints
// touching each of its cells (resistive force theory: moving sideways costs more than moving along
// a joint). λ are the hinge forces. e is the position error at the pivot, corrected gradually
// (Baumgarte stabilisation). Since no velocities are carried from one step to the next, there is no
// numerical jitter that evolution could exploit to "swim".

import type { PhysicsParams, PhysicsWorld } from './physics.ts';

export interface StokesHinge {
  /** Cell of the parent segment whose centre is the pivot. */
  parentCell: number;
  /** Cell of the child segment attached to the parent. */
  childCell: number;
}

interface Segment {
  cells: number[];
  /** Cell positions in the segment frame. */
  body: Float64Array;
  c: [number, number, number];
  q: [number, number, number, number];
}

interface Hinge {
  a: number;
  b: number;
  pivot: number;
  /** Pivot in the frame of the child segment. */
  offsetB: [number, number, number];
}

/** Correction rate of the position error at the pivots (1/s), independent of the substep. */
const CORRECTION_RATE = 50;
/** Maximum displacement of a cell in one substep: when forces are large, the step is subdivided. */
const MAX_DISPLACEMENT = 0.02;
/**
 * Substrate: the floor force is k·p + GROUND_HARDENING·k·p³ (p = penetration). At rest the linear term
 * dominates; when many muscles push at once, the cubic term stops a cell from going through.
 */
const GROUND_HARDENING = 1000;
/** Stiffness of collisions between spheres that are not joined. */
const COLLISION_STIFFNESS = 1000;

export class StokesWorld implements PhysicsWorld {
  readonly n: number;
  readonly pos: Float64Array;
  groundY = -2;
  private segments: Segment[] = [];
  private segOf: Int32Array;
  private hinges: Hinge[] = [];
  private si: number[] = [];
  private sj: number[] = [];
  private sk: number[] = [];
  private sRest: number[] = [];
  private dragEdges: [number, number][] = [];
  private noCollide = new Set<number>();
  /** Extra isotropic drag of each cell (e.g. adhesion to the substrate), can change at every step. */
  readonly cellDrag: Float64Array;
  /**
   * Largest substep for which the explicit integration is stable: half of the shortest
   * drag/stiffness relaxation time of the cells. Recomputed every time velocities are evaluated.
   */
  private stableStep = Infinity;
  /** Velocities of the previous step (only used with inertia or quadratic drag). */
  private prevV: Float64Array;

  constructor(
    positions: readonly (readonly [number, number, number])[],
    segments: number[][],
    hinges: StokesHinge[],
    public readonly params: PhysicsParams,
  ) {
    this.n = positions.length;
    this.pos = new Float64Array(this.n * 3);
    positions.forEach((p, i) => this.pos.set(p, i * 3));
    this.segOf = new Int32Array(this.n).fill(-1);
    this.cellDrag = new Float64Array(this.n);
    for (const cells of segments) {
      const c: [number, number, number] = [0, 0, 0];
      for (const i of cells) for (let k = 0; k < 3; k++) c[k] += this.pos[i * 3 + k] / cells.length;
      const body = new Float64Array(cells.length * 3);
      cells.forEach((i, m) => {
        for (let k = 0; k < 3; k++) body[m * 3 + k] = this.pos[i * 3 + k] - c[k];
        this.segOf[i] = this.segments.length;
      });
      this.segments.push({ cells, body, c, q: [0, 0, 0, 1] });
      for (let x = 0; x < cells.length; x++) for (let y = x + 1; y < cells.length; y++) this.disableCollision(cells[x], cells[y]);
    }
    if (this.segOf.some((s) => s < 0)) throw new Error('Every cell must belong to a segment.');
    this.prevV = new Float64Array(this.segments.length * 6);
    for (const { parentCell, childCell } of hinges) {
      const b = this.segOf[childCell];
      const cb = this.segments[b].c;
      const p = parentCell * 3;
      this.hinges.push({
        a: this.segOf[parentCell],
        b,
        pivot: parentCell,
        offsetB: [this.pos[p] - cb[0], this.pos[p + 1] - cb[1], this.pos[p + 2] - cb[2]],
      });
      for (const i of this.segments[b].cells) this.disableCollision(parentCell, i);
    }
  }

  /** Spring between two cells; returns its index so its length can be changed later. */
  addSpring(i: number, j: number, stiffness: number, rest?: number): number {
    this.si.push(i);
    this.sj.push(j);
    this.sk.push(stiffness);
    this.sRest.push(rest ?? this.distance(i, j));
    return this.si.length - 1;
  }

  setRestLength(spring: number, rest: number): void {
    this.sRest[spring] = rest;
  }

  addDragEdge(i: number, j: number): void {
    this.dragEdges.push([i, j]);
  }

  disableCollision(i: number, j: number): void {
    this.noCollide.add(Math.min(i, j) * this.n + Math.max(i, j));
  }

  /** Does the cell touch the floor? (only meaningful on the substrate) */
  touchesGround(i: number): boolean {
    return this.pos[i * 3 + 1] - this.groundY <= this.params.radius + 0.05;
  }

  distance(i: number, j: number): number {
    const p = this.pos;
    return Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
  }

  centroid(): [number, number, number] {
    const c: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < this.n; i++) for (let k = 0; k < 3; k++) c[k] += this.pos[i * 3 + k] / this.n;
    return c;
  }

  centroidXZ(): [number, number] {
    const [x, , z] = this.centroid();
    return [x, z];
  }

  /**
   * Advances dt with substeps of at most dt/substeps, shorter when some cell would move more than
   * MAX_DISPLACEMENT or when the stability limit requires it: the result does not depend on the
   * resolution even with huge forces (e.g. an accumulative muscle whose target length grows forever).
   */
  step(dt: number): void {
    const hMax = dt / this.params.substeps;
    // The Baumgarte correction uses a fixed rate, independent of the chosen substep; it is capped so
    // that no more than half of the error is corrected in one substep.
    const correctionRate = Math.min(CORRECTION_RATE, 0.5 / hMax);
    let remaining = dt;
    while (remaining > 1e-12) {
      if (this.params.cellMass > 0) {
        // With inertia the step is fixed: mass enters the system as m/h.
        const h = Math.min(remaining, hMax);
        const V = this.velocities(correctionRate, h);
        this.integrate(V, h);
        remaining -= h;
        continue;
      }
      const V = this.velocities(correctionRate, 0);
      const speed = this.maxCellSpeed(V);
      const h = Math.min(remaining, hMax, speed > 0 ? MAX_DISPLACEMENT / speed : hMax, this.stableStep);
      this.integrate(V, h);
      remaining -= h;
    }
  }

  private maxCellSpeed(V: Float64Array): number {
    let max = 0;
    this.segments.forEach((seg, s) => {
      const v = V.subarray(s * 6, s * 6 + 6);
      for (const i of seg.cells) {
        const a = [this.pos[i * 3] - seg.c[0], this.pos[i * 3 + 1] - seg.c[1], this.pos[i * 3 + 2] - seg.c[2]];
        const vx = v[0] + v[4] * a[2] - v[5] * a[1];
        const vy = v[1] + v[5] * a[0] - v[3] * a[2];
        const vz = v[2] + v[3] * a[1] - v[4] * a[0];
        max = Math.max(max, Math.hypot(vx, vy, vz));
      }
    });
    return max;
  }

  /**
   * Velocities (U, Ω) of all segments in the current state. With h > 0 and mass, inertia is treated
   * implicitly: (R + M/h)·V = F + M·V_previous/h.
   */
  private velocities(correctionRate: number, h: number): Float64Array {
    const n = this.n;
    const p = this.pos;
    const S = this.segments.length;

    // 1. Forces on the cells: springs (muscles and hinges) and collisions.
    const f = new Float64Array(n * 3);
    for (let k = 0; k < this.si.length; k++) {
      const a = this.si[k] * 3;
      const b = this.sj[k] * 3;
      const dx = p[a] - p[b];
      const dy = p[a + 1] - p[b + 1];
      const dz = p[a + 2] - p[b + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-9) continue;
      const mag = (-this.sk[k] * (d - this.sRest[k])) / d;
      f[a] += mag * dx;
      f[a + 1] += mag * dy;
      f[a + 2] += mag * dz;
      f[b] -= mag * dx;
      f[b + 1] -= mag * dy;
      f[b + 2] -= mag * dz;
    }
    const minD = 2 * this.params.radius;
    const collided = new Set<number>();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (this.noCollide.has(i * n + j)) continue;
        const dx = p[i * 3] - p[j * 3];
        const dy = p[i * 3 + 1] - p[j * 3 + 1];
        const dz = p[i * 3 + 2] - p[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const mag = (COLLISION_STIFFNESS * (minD - d)) / d;
        collided.add(i);
        collided.add(j);
        f[i * 3] += mag * dx;
        f[i * 3 + 1] += mag * dy;
        f[i * 3 + 2] += mag * dz;
        f[j * 3] -= mag * dx;
        f[j * 3 + 1] -= mag * dy;
        f[j * 3 + 2] -= mag * dz;
      }
    }

    // Substrate: weight and contact with the floor.
    if (this.params.medium === 'substrate') {
      const floor = this.groundY + this.params.radius;
      for (let i = 0; i < n; i++) {
        f[i * 3 + 1] -= this.params.weight;
        const pen = floor - p[i * 3 + 1];
        if (pen > 0) f[i * 3 + 1] += this.params.groundStiffness * pen * (1 + GROUND_HARDENING * pen * pen);
      }
    }

    // 2. Drag of every cell, and resistance matrix (and its inverse) of every segment.
    const G = dragTensors(p, n, this.dragEdges, this.params);
    const { cellMass, quadraticDrag } = this.params;
    const inertia = cellMass > 0 && h > 0 ? cellMass / h : 0;
    for (let i = 0; i < n; i++) {
      let extra = this.cellDrag[i] + inertia;
      if (quadraticDrag > 0 || inertia > 0) {
        const v = this.cellVelocity(i, this.prevV);
        if (quadraticDrag > 0) extra += quadraticDrag * Math.hypot(...v);
        // The M·V_previous/h term, applied as a force on the cell.
        for (let k = 0; k < 3; k++) f[i * 3 + k] += inertia * v[k];
      }
      G[i * 6] += extra;
      G[i * 6 + 3] += extra;
      G[i * 6 + 5] += extra;
    }
    // Stability limit: total stiffness pulling on each cell compared with its drag.
    const stiffness = new Float64Array(n);
    for (let k = 0; k < this.si.length; k++) {
      stiffness[this.si[k]] += this.sk[k];
      stiffness[this.sj[k]] += this.sk[k];
    }
    if (this.params.medium === 'substrate') {
      const floor = this.groundY + this.params.radius;
      for (let i = 0; i < n; i++) {
        if (p[i * 3 + 1] >= floor + 0.05) continue;
        const pen = Math.max(0, floor - p[i * 3 + 1]);
        stiffness[i] += this.params.groundStiffness * (1 + 3 * GROUND_HARDENING * pen * pen);
      }
    }
    for (const i of collided) stiffness[i] += COLLISION_STIFFNESS;
    this.stableStep = Infinity;
    for (let i = 0; i < n; i++) {
      if (stiffness[i] === 0) continue;
      const drag = Math.min(G[i * 6], G[i * 6 + 3], G[i * 6 + 5]);
      this.stableStep = Math.min(this.stableStep, (0.5 * drag) / stiffness[i]);
    }
    const rotDrag = ((4 / 3) * this.params.radius ** 2) * this.params.viscosity.parallel;
    const Rinv: Float64Array[] = [];
    const F = new Float64Array(S * 6);
    this.segments.forEach((seg, s) => {
      const R = new Float64Array(36);
      for (const i of seg.cells) {
        const a = [p[i * 3] - seg.c[0], p[i * 3 + 1] - seg.c[1], p[i * 3 + 2] - seg.c[2]];
        const g = G.subarray(i * 6, i * 6 + 6);
        const Gm = [g[0], g[1], g[2], g[1], g[3], g[4], g[2], g[4], g[5]];
        const A = skew(a);
        const GA = mul3(Gm, A);
        const AG = mul3(A, Gm);
        const AGA = mul3(AG, A);
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            R[r * 6 + c] += Gm[r * 3 + c];
            R[r * 6 + c + 3] -= GA[r * 3 + c];
            R[(r + 3) * 6 + c] += AG[r * 3 + c];
            R[(r + 3) * 6 + c + 3] -= AGA[r * 3 + c];
          }
          R[(r + 3) * 6 + r + 3] += rotDrag + 0.4 * inertia * this.params.radius ** 2;
        }
        const fi = [f[i * 3], f[i * 3 + 1], f[i * 3 + 2]];
        F[s * 6] += fi[0];
        F[s * 6 + 1] += fi[1];
        F[s * 6 + 2] += fi[2];
        F[s * 6 + 3] += a[1] * fi[2] - a[2] * fi[1];
        F[s * 6 + 4] += a[2] * fi[0] - a[0] * fi[2];
        F[s * 6 + 5] += a[0] * fi[1] - a[1] * fi[0];
      }
      Rinv.push(invertSPD(R, 6));
    });

    // 3. Velocities without hinges: V0 = R⁻¹ F.
    const V = new Float64Array(S * 6);
    for (let s = 0; s < S; s++) matVecAdd(Rinv[s], F.subarray(s * 6, s * 6 + 6), V.subarray(s * 6, s * 6 + 6));

    // 4. Hinge forces: (J R⁻¹ Jᵀ) λ = β e − J V0.
    const H = this.hinges.length;
    if (H > 0) {
      // 3×6 Jacobians of each hinge with respect to its two segments: velocity of the pivot as a
      // point of a minus velocity of the pivot as a point of b.
      const JA: Float64Array[] = [];
      const JB: Float64Array[] = [];
      const rhs = new Float64Array(H * 3);
      this.hinges.forEach((hg, k) => {
        const sa = this.segments[hg.a];
        const sb = this.segments[hg.b];
        const pv = hg.pivot * 3;
        const pa = [p[pv] - sa.c[0], p[pv + 1] - sa.c[1], p[pv + 2] - sa.c[2]];
        const pb = rotate(sb.q, hg.offsetB);
        JA.push(jacobian(pa, 1));
        JB.push(jacobian(pb, -1));
        const e = [sb.c[0] + pb[0] - p[pv], sb.c[1] + pb[1] - p[pv + 1], sb.c[2] + pb[2] - p[pv + 2]];
        const va = new Float64Array(3);
        const vb = new Float64Array(3);
        matVecAdd(JA[k], V.subarray(hg.a * 6, hg.a * 6 + 6), va, 3, 6);
        matVecAdd(JB[k], V.subarray(hg.b * 6, hg.b * 6 + 6), vb, 3, 6);
        for (let r = 0; r < 3; r++) rhs[k * 3 + r] = correctionRate * e[r] - va[r] - vb[r];
      });
      // Blocks J_k,s R_s⁻¹ (3×6), so the products are not repeated.
      const JRa = JA.map((J, k) => matMul(J, Rinv[this.hinges[k].a], 3, 6, 6));
      const JRb = JB.map((J, k) => matMul(J, Rinv[this.hinges[k].b], 3, 6, 6));
      const M = new Float64Array(9 * H * H);
      for (let k = 0; k < H; k++) {
        for (let l = 0; l < H; l++) {
          const hk = this.hinges[k];
          const hl = this.hinges[l];
          const pairs: [Float64Array, Float64Array][] = [];
          if (hk.a === hl.a) pairs.push([JRa[k], JA[l]]);
          if (hk.a === hl.b) pairs.push([JRa[k], JB[l]]);
          if (hk.b === hl.a) pairs.push([JRb[k], JA[l]]);
          if (hk.b === hl.b) pairs.push([JRb[k], JB[l]]);
          for (const [JR, J] of pairs) {
            for (let r = 0; r < 3; r++) {
              for (let c = 0; c < 3; c++) {
                let sum = 0;
                for (let m = 0; m < 6; m++) sum += JR[r * 6 + m] * J[c * 6 + m];
                M[(k * 3 + r) * 3 * H + l * 3 + c] += sum;
              }
            }
          }
        }
      }
      const lambda = solveSPD(M, rhs, 3 * H);
      // V += R⁻¹ Jᵀ λ
      this.hinges.forEach((hg, k) => {
        const lk = lambda.subarray(k * 3, k * 3 + 3);
        for (const [s, J] of [[hg.a, JA[k]], [hg.b, JB[k]]] as const) {
          const JtL = new Float64Array(6);
          for (let m = 0; m < 6; m++) JtL[m] = J[m] * lk[0] + J[6 + m] * lk[1] + J[12 + m] * lk[2];
          matVecAdd(Rinv[s], JtL, V.subarray(s * 6, s * 6 + 6));
        }
      });
    }

    return V;
  }

  private cellVelocity(i: number, V: Float64Array): [number, number, number] {
    const s = this.segOf[i];
    const seg = this.segments[s];
    const v = V.subarray(s * 6, s * 6 + 6);
    const a = [this.pos[i * 3] - seg.c[0], this.pos[i * 3 + 1] - seg.c[1], this.pos[i * 3 + 2] - seg.c[2]];
    return [v[0] + v[4] * a[2] - v[5] * a[1], v[1] + v[5] * a[0] - v[3] * a[2], v[2] + v[3] * a[1] - v[4] * a[0]];
  }

  /** Moves and rotates every segment for h and repositions its cells. */
  private integrate(V: Float64Array, h: number): void {
    this.prevV.set(V);
    const p = this.pos;
    this.segments.forEach((seg, s) => {
      const v = V.subarray(s * 6, s * 6 + 6);
      for (let k = 0; k < 3; k++) seg.c[k] += v[k] * h;
      const wx = v[3] * h;
      const wy = v[4] * h;
      const wz = v[5] * h;
      const angle = Math.hypot(wx, wy, wz);
      if (angle > 1e-12) {
        const sn = Math.sin(angle / 2) / angle;
        seg.q = quatMul([wx * sn, wy * sn, wz * sn, Math.cos(angle / 2)], seg.q);
      }
      seg.cells.forEach((i, m) => {
        const r = rotate(seg.q, [seg.body[m * 3], seg.body[m * 3 + 1], seg.body[m * 3 + 2]]);
        for (let k = 0; k < 3; k++) p[i * 3 + k] = seg.c[k] + r[k];
      });
    });
  }
}

/**
 * Drag tensor of each cell (xx, xy, xz, yy, yz, zz): the sum, over every joint touching it, of half
 * of  g_par·t tᵀ + g_perp·(I − t tᵀ). A cell without joints is a sphere with isotropic drag g_par.
 */
export function dragTensors(p: Float64Array, n: number, edges: [number, number][], params: PhysicsParams): Float64Array {
  const { parallel, perpendicular } = params.viscosity;
  const G = new Float64Array(n * 6);
  const count = new Uint16Array(n);
  const a = (parallel - perpendicular) / 2;
  const b = perpendicular / 2;
  for (const [i, j] of edges) {
    let tx = p[i * 3] - p[j * 3];
    let ty = p[i * 3 + 1] - p[j * 3 + 1];
    let tz = p[i * 3 + 2] - p[j * 3 + 2];
    const len = Math.hypot(tx, ty, tz);
    if (len < 1e-9) continue;
    tx /= len;
    ty /= len;
    tz /= len;
    for (const c of [i, j]) {
      const o = c * 6;
      G[o] += a * tx * tx + b;
      G[o + 1] += a * tx * ty;
      G[o + 2] += a * tx * tz;
      G[o + 3] += a * ty * ty + b;
      G[o + 4] += a * ty * tz;
      G[o + 5] += a * tz * tz + b;
      count[c]++;
    }
  }
  for (let c = 0; c < n; c++) {
    if (count[c] === 0) G[c * 6] = G[c * 6 + 3] = G[c * 6 + 5] = parallel;
  }
  return G;
}

// ------------------------------------------------------------------ small linear algebra

function skew([x, y, z]: number[]): number[] {
  return [0, -z, y, z, 0, -x, -y, x, 0];
}

function mul3(A: number[], B: number[]): number[] {
  const C = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return C;
}

/** 3×6 Jacobian of the velocity of the point with lever arm `arm`: sign·[I, −[arm]×]. */
function jacobian(arm: number[], sign: number): Float64Array {
  const J = new Float64Array(18);
  const A = skew(arm);
  for (let r = 0; r < 3; r++) {
    J[r * 6 + r] = sign;
    for (let c = 0; c < 3; c++) J[r * 6 + 3 + c] = -sign * A[r * 3 + c];
  }
  return J;
}

function matMul(A: Float64Array, B: Float64Array, rows: number, inner: number, cols: number): Float64Array {
  const C = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < inner; k++) {
      const a = A[r * inner + k];
      if (a === 0) continue;
      for (let c = 0; c < cols; c++) C[r * cols + c] += a * B[k * cols + c];
    }
  }
  return C;
}

function matVecAdd(A: Float64Array, x: Float64Array, out: Float64Array, rows = 6, cols = 6): void {
  for (let r = 0; r < rows; r++) {
    let sum = 0;
    for (let c = 0; c < cols; c++) sum += A[r * cols + c] * x[c];
    out[r] += sum;
  }
}

/** Solves A x = b by Gaussian elimination with partial pivoting (A is modified). */
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const x = b.slice();
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r * n + col]) > Math.abs(A[piv * n + col])) piv = r;
    if (piv !== col) {
      for (let c = 0; c < n; c++) [A[col * n + c], A[piv * n + c]] = [A[piv * n + c], A[col * n + c]];
      [x[col], x[piv]] = [x[piv], x[col]];
    }
    const d = A[col * n + col];
    if (Math.abs(d) < 1e-14) continue;
    for (let r = col + 1; r < n; r++) {
      const factor = A[r * n + col] / d;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) A[r * n + c] -= factor * A[col * n + c];
      x[r] -= factor * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sum = x[r];
    for (let c = r + 1; c < n; c++) sum -= A[r * n + c] * x[c];
    const d = A[r * n + r];
    x[r] = Math.abs(d) < 1e-14 ? 0 : sum / d;
  }
  return x;
}

/**
 * In-place Cholesky factorisation (lower triangle of A). Returns false if A is not positive definite
 * (e.g. redundant constraints), in which case the general elimination is used instead.
 */
function cholesky(A: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k++) d -= A[j * n + k] * A[j * n + k];
    if (!(d > 1e-12)) return false;
    d = Math.sqrt(d);
    A[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let v = A[i * n + j];
      for (let k = 0; k < j; k++) v -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = v / d;
    }
  }
  return true;
}

function choleskySubstitute(L: Float64Array, b: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    let v = b[i];
    for (let k = 0; k < i; k++) v -= L[i * n + k] * b[k];
    b[i] = v / L[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    let v = b[i];
    for (let k = i + 1; k < n; k++) v -= L[k * n + i] * b[k];
    b[i] = v / L[i * n + i];
  }
}

/** Solves A x = b for a symmetric positive definite A (A is modified). */
function solveSPD(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const copy = A.slice();
  if (!cholesky(A, n)) return solve(copy, b, n);
  const x = b.slice();
  choleskySubstitute(A, x, n);
  return x;
}

/** Inverse of a symmetric positive definite matrix. */
function invertSPD(A: Float64Array, n: number): Float64Array {
  const L = A.slice();
  if (!cholesky(L, n)) return invert(A, n);
  const inv = new Float64Array(n * n);
  const e = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    e.fill(0);
    e[c] = 1;
    choleskySubstitute(L, e, n);
    for (let r = 0; r < n; r++) inv[r * n + c] = e[r];
  }
  return inv;
}

function invert(A: Float64Array, n: number): Float64Array {
  const inv = new Float64Array(n * n);
  for (let c = 0; c < n; c++) {
    const e = new Float64Array(n);
    e[c] = 1;
    const col = solve(A.slice(), e, n);
    for (let r = 0; r < n; r++) inv[r * n + c] = col[r];
  }
  return inv;
}

function quatMul(a: number[], b: number[]): [number, number, number, number] {
  const q: [number, number, number, number] = [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const len = Math.hypot(...q);
  return q.map((x) => x / len) as [number, number, number, number];
}

function rotate([x, y, z, w]: number[], v: number[]): [number, number, number] {
  // v' = v + 2w (q×v) + 2 q×(q×v)
  const cx = y * v[2] - z * v[1];
  const cy = z * v[0] - x * v[2];
  const cz = x * v[1] - y * v[0];
  return [
    v[0] + 2 * (w * cx + y * cz - z * cy),
    v[1] + 2 * (w * cy + z * cx - x * cz),
    v[2] + 2 * (w * cz + x * cy - y * cx),
  ];
}
