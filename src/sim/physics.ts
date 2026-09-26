// Creature physics in three media:
//  - 'ground' (this class, World): spheres with mass, distance constraints (XPBD), rigid bodies
//    via shape matching, gravity, linear drag and a floor with friction, like the Unity scene.
//  - 'viscous' (StokesWorld, in stokes.ts): a low-Reynolds fluid without inertia.
//  - 'substrate' (StokesWorld): the same, plus weight and a floor to which the cells that touch it
//    can adhere or not depending on the phase of their oscillator (crawling, like real cells).
// Replaces Unity's Rigidbody / FixedJoint / HingeJoint / SpringJoint.

/** What the Trial and the viewer need from a physics world. */
export interface PhysicsWorld {
  readonly n: number;
  readonly pos: Float64Array;
  groundY: number;
  setRestLength(index: number, rest: number): void;
  distance(i: number, j: number): number;
  centroid(): [number, number, number];
  centroidXZ(): [number, number];
  step(dt: number): void;
}

export type Medium = 'ground' | 'viscous' | 'substrate';

export interface PhysicsParams {
  medium: Medium;
  gravity: number;
  /** Linear drag, like Rigidbody.drag. */
  drag: number;
  radius: number;
  mass: number;
  /** Friction coefficient with the floor. Infinity = never slides (the Unity physic material). */
  friction: number;
  substeps: number;
  iterations: number;
  /** Viscous media: drag coefficients of each joint, along it and sideways (see experimentFor). */
  viscosity: { parallel: number; perpendicular: number };
  /** Viscous media: mass of each cell (0 = no inertia, pure Stokes). */
  cellMass: number;
  /** Viscous media: quadratic drag, dominant at intermediate Reynolds numbers (0 = linear only). */
  quadraticDrag: number;
  /** Substrate: weight of each cell and stiffness of the contact with the floor. */
  weight: number;
  groundStiffness: number;
  /** Substrate: friction of a cell touching the floor, when attached or free. */
  adhesion: { stuck: number; free: number };
}

export const DEFAULT_PHYSICS: PhysicsParams = {
  medium: 'ground',
  gravity: 9.81,
  drag: 1,
  radius: 0.5,
  mass: 10,
  friction: Infinity,
  substeps: 8,
  iterations: 2,
  viscosity: { parallel: 100, perpendicular: 200 },
  cellMass: 0,
  quadraticDrag: 0,
  weight: 20,
  groundStiffness: 2000,
  adhesion: { stuck: 200, free: 2 },
};

export class World implements PhysicsWorld {
  readonly n: number;
  readonly pos: Float64Array;
  private prev: Float64Array;
  private vel: Float64Array;
  private invMass: number;

  // Distance constraints: i, j, rest length and compliance (0 = rigid).
  private ci: number[] = [];
  private cj: number[] = [];
  private cRest: number[] = [];
  private cCompliance: number[] = [];
  private lambda: Float64Array = new Float64Array(0);

  private noCollide = new Set<number>();
  private clusters: RigidCluster[] = [];

  constructor(
    positions: readonly (readonly [number, number, number])[],
    public groundY: number,
    public readonly params: PhysicsParams = DEFAULT_PHYSICS,
  ) {
    this.n = positions.length;
    this.pos = new Float64Array(this.n * 3);
    positions.forEach((p, i) => this.pos.set(p, i * 3));
    this.prev = this.pos.slice();
    this.vel = new Float64Array(this.n * 3);
    this.invMass = 1 / params.mass;
  }

  /** Adds a distance constraint and returns its index (so its length can be changed later). */
  addConstraint(i: number, j: number, compliance: number, rest?: number): number {
    this.ci.push(i);
    this.cj.push(j);
    this.cRest.push(rest ?? this.distance(i, j));
    this.cCompliance.push(compliance);
    this.lambda = new Float64Array(this.ci.length);
    return this.ci.length - 1;
  }

  setRestLength(c: number, rest: number): void {
    this.cRest[c] = rest;
  }

  /** Spheres connected by a joint do not collide with each other (as in Unity). */
  disableCollision(i: number, j: number): void {
    this.noCollide.add(Math.min(i, j) * this.n + Math.max(i, j));
  }

  /** A group of cells that moves as a rigid body (fixed joints). */
  addRigidCluster(indices: number[]): void {
    if (indices.length < 2) return;
    const p = this.pos;
    const c = [0, 0, 0];
    for (const i of indices) for (let k = 0; k < 3; k++) c[k] += p[i * 3 + k] / indices.length;
    const rest = new Float64Array(indices.length * 3);
    indices.forEach((i, n) => {
      for (let k = 0; k < 3; k++) rest[n * 3 + k] = p[i * 3 + k] - c[k];
    });
    this.clusters.push({ indices, rest, q: [0, 0, 0, 1] });
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) this.disableCollision(indices[a], indices[b]);
    }
  }

  distance(i: number, j: number): number {
    const p = this.pos;
    return Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]);
  }

  step(dt: number): void {
    const { substeps, iterations, gravity, drag } = this.params;
    const h = dt / substeps;
    const damping = 1 / (1 + drag * h);
    const { pos, prev, vel } = this;
    for (let s = 0; s < substeps; s++) {
      for (let k = 0; k < this.n * 3; k += 3) {
        vel[k + 1] -= gravity * h;
        vel[k] *= damping;
        vel[k + 1] *= damping;
        vel[k + 2] *= damping;
        prev[k] = pos[k];
        prev[k + 1] = pos[k + 1];
        prev[k + 2] = pos[k + 2];
        pos[k] += vel[k] * h;
        pos[k + 1] += vel[k + 1] * h;
        pos[k + 2] += vel[k + 2] * h;
      }
      this.lambda.fill(0);
      // The floor contact is solved inside the loop, together with the constraints: if it were
      // applied afterwards, friction would deform the rigid bodies and the correction in the next
      // substep would turn into velocity (energy that does not exist).
      for (let it = 0; it < iterations; it++) {
        this.solveClusters();
        this.solveConstraints(h);
        this.solveCollisions();
        this.solveGround();
      }
      for (let k = 0; k < this.n * 3; k++) vel[k] = (pos[k] - prev[k]) / h;
    }
  }

  /** Shape matching: puts each rigid group back in its rest shape, with the best-fitting rotation. */
  private solveClusters(): void {
    const p = this.pos;
    for (const cl of this.clusters) {
      const n = cl.indices.length;
      const c = [0, 0, 0];
      for (const i of cl.indices) for (let k = 0; k < 3; k++) c[k] += p[i * 3 + k] / n;
      // A = sum (p_i - c) rest_i^T, stored row by row.
      const A = new Float64Array(9);
      cl.indices.forEach((i, m) => {
        for (let r = 0; r < 3; r++) {
          const d = p[i * 3 + r] - c[r];
          for (let col = 0; col < 3; col++) A[r * 3 + col] += d * cl.rest[m * 3 + col];
        }
      });
      extractRotation(A, cl.q);
      const R = quatToMatrix(cl.q);
      cl.indices.forEach((i, m) => {
        const rx = cl.rest[m * 3];
        const ry = cl.rest[m * 3 + 1];
        const rz = cl.rest[m * 3 + 2];
        p[i * 3] = c[0] + R[0] * rx + R[1] * ry + R[2] * rz;
        p[i * 3 + 1] = c[1] + R[3] * rx + R[4] * ry + R[5] * rz;
        p[i * 3 + 2] = c[2] + R[6] * rx + R[7] * ry + R[8] * rz;
      });
    }
  }

  private solveConstraints(h: number): void {
    const p = this.pos;
    const w = this.invMass * 2;
    for (let c = 0; c < this.ci.length; c++) {
      const a = this.ci[c] * 3;
      const b = this.cj[c] * 3;
      const dx = p[a] - p[b];
      const dy = p[a + 1] - p[b + 1];
      const dz = p[a + 2] - p[b + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-9) continue;
      const alpha = this.cCompliance[c] / (h * h);
      const C = d - this.cRest[c];
      const dLambda = (-C - alpha * this.lambda[c]) / (w + alpha);
      this.lambda[c] += dLambda;
      const k = (dLambda * this.invMass) / d;
      p[a] += dx * k;
      p[a + 1] += dy * k;
      p[a + 2] += dz * k;
      p[b] -= dx * k;
      p[b + 1] -= dy * k;
      p[b + 2] -= dz * k;
    }
  }

  private solveCollisions(): void {
    const p = this.pos;
    const minD = this.params.radius * 2;
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        if (this.noCollide.has(i * this.n + j)) continue;
        const a = i * 3;
        const b = j * 3;
        const dx = p[a] - p[b];
        const dy = p[a + 1] - p[b + 1];
        const dz = p[a + 2] - p[b + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const k = (minD - d) / (2 * d);
        p[a] += dx * k;
        p[a + 1] += dy * k;
        p[a + 2] += dz * k;
        p[b] -= dx * k;
        p[b + 1] -= dy * k;
        p[b + 2] -= dz * k;
      }
    }
  }

  private solveGround(): void {
    const p = this.pos;
    const prev = this.prev;
    const floor = this.groundY + this.params.radius;
    const mu = this.params.friction;
    for (let k = 0; k < this.n * 3; k += 3) {
      const pen = floor - p[k + 1];
      if (pen <= 0) continue;
      p[k + 1] = floor;
      const dx = p[k] - prev[k];
      const dz = p[k + 2] - prev[k + 2];
      const slide = Math.hypot(dx, dz);
      if (slide === 0) continue;
      // Coulomb friction on positions: sliding is cancelled up to mu * penetration.
      const cancel = mu === Infinity ? 1 : Math.min(1, (mu * pen) / slide);
      p[k] -= dx * cancel;
      p[k + 2] -= dz * cancel;
    }
  }

  centroid(): [number, number, number] {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < this.n; i++) {
      x += this.pos[i * 3];
      y += this.pos[i * 3 + 1];
      z += this.pos[i * 3 + 2];
    }
    return [x / this.n, y / this.n, z / this.n];
  }

  /** Centre of mass in the horizontal plane (x, z). */
  centroidXZ(): [number, number] {
    let x = 0;
    let z = 0;
    for (let i = 0; i < this.n; i++) {
      x += this.pos[i * 3];
      z += this.pos[i * 3 + 2];
    }
    return [x / this.n, z / this.n];
  }
}

interface RigidCluster {
  indices: number[];
  /** Rest positions relative to the centre of the group. */
  rest: Float64Array;
  /** Current rotation (quaternion x, y, z, w), reused as the starting point. */
  q: number[];
}

function quatToMatrix([x, y, z, w]: number[]): number[] {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/**
 * Rotational part of A (row-major), iterative method of Müller et al. 2016,
 * "A Robust Method to Extract the Rotational Part of Deformations". Updates q.
 */
function extractRotation(A: Float64Array, q: number[]): void {
  for (let iter = 0; iter < 20; iter++) {
    const R = quatToMatrix(q);
    // omega = sum_k (column k of R) x (column k of A) / (|sum_k R_k · A_k| + eps)
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let dot = 0;
    for (let k = 0; k < 3; k++) {
      const rx = R[k], ry = R[3 + k], rz = R[6 + k];
      const ax = A[k], ay = A[3 + k], az = A[6 + k];
      ox += ry * az - rz * ay;
      oy += rz * ax - rx * az;
      oz += rx * ay - ry * ax;
      dot += rx * ax + ry * ay + rz * az;
    }
    const inv = 1 / (Math.abs(dot) + 1e-9);
    ox *= inv;
    oy *= inv;
    oz *= inv;
    const angle = Math.hypot(ox, oy, oz);
    if (angle < 1e-9) break;
    const s = Math.sin(angle / 2) / angle;
    const dq = [ox * s, oy * s, oz * s, Math.cos(angle / 2)];
    // q = dq * q
    const [x, y, z, w] = q;
    q[0] = dq[3] * x + dq[0] * w + dq[1] * z - dq[2] * y;
    q[1] = dq[3] * y - dq[0] * z + dq[1] * w + dq[2] * x;
    q[2] = dq[3] * z + dq[0] * y - dq[1] * x + dq[2] * w;
    q[3] = dq[3] * w - dq[0] * x - dq[1] * y - dq[2] * z;
    const len = Math.hypot(q[0], q[1], q[2], q[3]);
    for (let k = 0; k < 4; k++) q[k] /= len;
  }
}
