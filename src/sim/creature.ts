// Growth, muscles and fitness of a creature. Port of Assets/controler13.cs, the controller that was
// active in Creature.prefab.
//
// Mode 'original': reproduces the behaviour of the C# code, bugs included.
// Mode 'fixed': the same algorithm with these bugs fixed:
//   1. Integer divisions in the network inputs: 1/(level+1), 1/region and grid.Count/noCells were
//      almost always 0 in C#.
//   2. typeOfCell was never stored (always 0); now it is 0 = fixed joint, 1 = hinge.
//   3. levelInRegion of a child attached with a fixed joint was always 1; now it is the parent's + 1.
//   4. Random.Range(-1, 1) on integers never returns 1, and it was re-drawn at every check of the
//      loop; now the target size is noCells + {-1, 0, 1}, drawn once.

import { Rng } from '../rng.ts';
import type { Network } from '../neat/network.ts';
import { DEFAULT_PHYSICS, World, type Medium, type PhysicsParams, type PhysicsWorld } from './physics.ts';
import { StokesWorld } from './stokes.ts';

export type SimMode = 'original' | 'fixed';

/**
 * How muscles move:
 *  - 'accumulative' (the C# code): at every step 0.15·sin(2π·f·t + a) is added to the length. The
 *    length is the integral of a sine: the real amplitude is ~1.2/f, and with f ≈ 0 the muscle does
 *    not oscillate, it keeps growing or shrinking.
 *  - 'oscillator': L(t) = L0·(1 + A·sin(2π·f·t + φ)). One frequency f shared by the whole creature
 *    (output 9 of the network with no inputs, bias only), and per muscle the phase φ = 2π·output 10
 *    and the amplitude A = maxAmplitude·output 11 (output 11 was unused). No energy mechanism.
 *  - 'cpg': coupled phase oscillators, see below.
 */
export type MuscleModel = 'accumulative' | 'oscillator' | 'cpg';

// Model 'cpg': one phase oscillator per rigid segment (a group of cells joined by fixed joints),
// coupled to the neighbouring segments through the hinges, in the style of Ijspeert:
//   dθᵢ/dt = 2π·νᵢ + Σⱼ wᵢⱼ·sin(θⱼ − θᵢ − φᵢⱼ)
// During development the network sets the intrinsic frequency ν of each segment (queried with its
// root cell), and the weight w and phase lag φ of each hinge (queried with the parent-child pair).
// Initial phases are random: coordination emerges from the coupling. Each muscle follows the
// oscillator of its proximal segment: L = L0·(1 + A·sin θ), with A ∈ [−maxAmplitude, maxAmplitude]
// (the sign allows antagonistic muscles).

export interface ExperimentParams {
  mode: SimMode;
  physics: PhysicsParams;
  /** Fixed simulation step (Unity's Time.fixedDeltaTime). */
  dt: number;
  /** Stiffness of the spring that pulls each hinge back to its initial angle. */
  hingeStiffness: number;
  /** SpringJoint.spring of the muscles. */
  muscleStiffness: number;
  /** Amplitude of the per-step length change of 'accumulative' muscles. */
  muscleRange: number;
  /** Height above which the creature is penalised. */
  maxHeight: number;
  muscleModel: MuscleModel;
  /** Maximum relative amplitude of the 'oscillator' and 'cpg' models (0.5 = ±50 % of the initial length). */
  maxAmplitude: number;
  /** Model 'cpg': maximum intrinsic frequency (Hz) and maximum coupling weight (rad/s). */
  maxFrequency: number;
  maxCoupling: number;
  /**
   * 'full' (the C# code): |mid − end| + |start − end|.
   * 'second-half': only |mid − end|, so that a one-off deformation at the beginning (while the body
   * settles or the oscillators synchronise) does not count as locomotion.
   */
  fitnessWindow: 'full' | 'second-half';
  /**
   * 'product' (the C# code): ∏(1 + frequency) over the working muscles; with dozens of muscles it
   * reaches 10¹⁸ and evolution gets rid of them.
   * 'geometric-mean': (∏(1 + frequency))^(1/k), between 1 and 2 whatever the number k of muscles.
   */
  musclePenalty: 'product' | 'geometric-mean';
  /**
   * Viscous media: every cell shares its contractile force among its muscles (working or passive).
   * A muscle between a and b has stiffness k / max(nₐ, n_b), so the total stiffness of a cell never
   * exceeds k. Without this, with ~100 muscles the simulation needs tiny substeps.
   */
  muscleSharing: boolean;
  /**
   * Settling phase before the trial, which does not count at all: the body is simulated with the
   * muscles at their rest length, the oscillators stopped and no adhesion, until the maximum speed of
   * its cells stays below `speed` for `hold` seconds (or until `maxTime`). Then the oscillators and
   * the clock start, and the settled position is the starting point. null = no settling (as in Unity).
   */
  settle: { speed: number; hold: number; maxTime: number } | null;
  /**
   * 'stochastic' (the C# code): the direction and type of every new cell are drawn with the network
   *   outputs as probabilities (Choose), and the number of cells varies by ±1. The same genome grows
   *   different bodies at every evaluation.
   * 'deterministic': the most likely free direction and the most likely type are chosen (like
   *   ChooseFix, which was written in the C# code but never used), with exactly noCells cells.
   */
  development: 'stochastic' | 'deterministic';
  /**
   * 'per-evaluation' (as in Unity): every evaluation uses a new seed, so the same genome grows
   *   differently every time.
   * 'inherited': the seed belongs to the genome (Genome.devSeed), is inherited and mutates now and then.
   */
  seedMode: 'per-evaluation' | 'inherited';
  /**
   * The network also receives the position relative to the root (x, y, z and distance, divided by 4)
   * of the queried cell (or of the midpoint of the pair): like a morphogenetic gradient, it lets
   * cells in different parts of the body behave differently. Adds 4 inputs (15 in total).
   */
  positionalInputs: boolean;
  /**
   * 'all' (the C# code): a muscle between every pair of spring cells in different regions (80-120 in
   *   a 20-cell body, which work against each other).
   * 'hinge': only between cells of two segments directly joined by a hinge, like a muscle crossing
   *   a joint.
   */
  muscleScope: 'all' | 'hinge';
  /**
   * true (the C# code): the fitness is divided by the number of regions, which penalises articulated
   * bodies (an 8-segment worm scores 8 times less than two blocks that move the same way).
   */
  divideByRegions: boolean;
}

export const DEFAULT_EXPERIMENT: ExperimentParams = {
  mode: 'fixed',
  physics: DEFAULT_PHYSICS,
  dt: 0.02,
  hingeStiffness: 10,
  muscleStiffness: 100,
  muscleRange: 0.15,
  maxHeight: 5,
  muscleModel: 'accumulative',
  maxAmplitude: 0.5,
  maxFrequency: 1,
  maxCoupling: 6,
  fitnessWindow: 'full',
  musclePenalty: 'product',
  muscleSharing: false,
  settle: null,
  development: 'stochastic',
  seedMode: 'per-evaluation',
  positionalInputs: false,
  muscleScope: 'all',
  divideByRegions: true,
};

/**
 * Starting parameters for each medium. In the fluid (no inertia, see stokes.ts) muscles are stiffer
 * than in Unity so that they respond in ~0.1 s (drag/stiffness), much faster than their oscillation
 * (≥ 1 s). With 4 substeps the result differs by < 3 % from 16 substeps.
 */
export function experimentFor(medium: Medium, overrides: Partial<ExperimentParams> = {}): ExperimentParams {
  const base: ExperimentParams =
    medium === 'substrate'
      ? {
          ...DEFAULT_EXPERIMENT,
          muscleModel: 'cpg',
          fitnessWindow: 'second-half',
          settle: { speed: 0.01, hold: 0.5, maxTime: 10 },
          muscleStiffness: 1000,
          // Friction is high in absolute terms so that the explicit integrator is stable: every
          // relaxation time (friction/stiffness) stays above the substep. What matters physically
          // is the attached/free ratio (100).
          physics: {
            ...DEFAULT_PHYSICS,
            medium,
            substeps: 4,
            // The same fluid as the viscous medium: a cell that lifts off is still in the liquid.
            viscosity: { parallel: 50, perpendicular: 100 },
            weight: 20,
            groundStiffness: 500,
            adhesion: { stuck: 2000, free: 20 },
          },
        }
      : medium === 'viscous'
      ? {
          ...DEFAULT_EXPERIMENT,
          muscleStiffness: 1000,
          physics: { ...DEFAULT_PHYSICS, medium, substeps: 4, viscosity: { parallel: 50, perpendicular: 100 } },
        }
      : { ...DEFAULT_EXPERIMENT, physics: { ...DEFAULT_PHYSICS, medium } };
  return { ...base, ...overrides, physics: { ...base.physics, ...overrides.physics } };
}

export type JointType = 'root' | 'fixed' | 'hinge';

export interface Cell {
  pos: [number, number, number];
  parent: number;
  joint: JointType;
  typeOfCell: number;
  levelFromRoot: number;
  levelInRegion: number;
  region: number;
  orientation: number;
  springCell: boolean;
}

export interface Muscle {
  a: number;
  b: number;
  working: boolean;
  frequency: number;
  phase: number;
  /** Only in the 'oscillator' and 'cpg' models. */
  amplitude: number;
  /** Model 'cpg': the oscillator driving the muscle. */
  osc?: number;
}

export interface Cpg {
  /** Intrinsic frequency of each oscillator (Hz). */
  frequency: number[];
  initialPhase: number[];
  /** Root cell of the segment of each oscillator. */
  root: number[];
  couplings: { i: number; j: number; w: number; phi: number }[];
}

export interface Body {
  cells: Cell[];
  muscles: Muscle[];
  noRegions: number;
  /** Initial penalty: product of (1 + frequency) over the working muscles. */
  penalty: number;
  groundY: number;
  cpg?: Cpg;
  /** Substrate: which cells can adhere, and with what phase offset relative to their oscillator. */
  adhesion?: { adhesive: boolean[]; phase: number[] };
}

const DIRECTIONS: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
];

/** Number of cells for a generation: (int)(7 + Mathf.Sqrt(2*generation) - generation/90). */
export function targetCellCount(generation: number): number {
  return Math.trunc(7 + Math.sqrt(2 * generation) - Math.floor(generation / 90));
}

export function trialDuration(generation: number): number {
  return 2 + Math.sqrt(generation);
}

/** Roulette selection over the network outputs (Choose in the C# code). */
function choose(probs: number[], rng: Rng): number {
  let total = 0;
  for (const p of probs) total += p;
  let point = rng.next() * total;
  for (let i = 0; i < probs.length; i++) {
    if (point < probs[i]) return i;
    point -= probs[i];
  }
  return probs.length - 1;
}

export function grow(
  net: Network,
  generation: number,
  rng: Rng,
  mode: SimMode,
  muscleModel: MuscleModel = 'accumulative',
  maxAmplitude = DEFAULT_EXPERIMENT.maxAmplitude,
  limits: Pick<ExperimentParams, 'maxFrequency' | 'maxCoupling' | 'musclePenalty'> &
    Partial<Pick<ExperimentParams, 'development' | 'muscleScope'>> = DEFAULT_EXPERIMENT,
  withAdhesion = false,
): Body {
  const fixed = mode === 'fixed';
  // In C# these were integer divisions: 1/(x+1) was 1 if x == 0 and 0 otherwise.
  const inv = (x: number) => (fixed ? 1 / x : Math.trunc(1 / x));
  const typeOf = (c: Cell) => (fixed ? c.typeOfCell : 0);

  const noCells = targetCellCount(generation);
  const cells: Cell[] = [
    { pos: [0, 0, 0], parent: -1, joint: 'root', typeOfCell: 0, levelFromRoot: 0, levelInRegion: 0, region: 1, orientation: 0, springCell: true },
  ];
  const occupied = new Set<string>(['0,0,0']);
  let groundY = -2; // initial position of the Plane in firstScene
  let noRegions = 1;

  const deterministic = limits.development === 'deterministic';
  const fixedTarget = deterministic ? noCells : noCells + rng.int(3) - 1;
  const target = () => (fixed ? fixedTarget : noCells + rng.int(2) - 1);
  const inputs = net.inputs;
  const outputs = net.outputs;
  // Positional inputs (only if the network has more than 11 inputs).
  const positional = inputs.length > 11;
  const setPosition = (p: readonly number[]) => {
    if (!positional) return;
    inputs[11] = p[0] / 4;
    inputs[12] = p[1] / 4;
    inputs[13] = p[2] / 4;
    inputs[14] = Math.hypot(p[0], p[1], p[2]) / 4;
  };

  for (let guard = 0; cells.length < target() && guard < 10000; guard++) {
    const size = cells.length;
    for (let i = 0; i < size; i++) {
      if (cells.length >= target()) continue;
      const parent = cells[i];
      inputs.fill(0);
      inputs[0] = typeOf(parent);
      inputs[1] = inv(parent.levelFromRoot + 1);
      inputs[2] = inv(parent.levelInRegion + 1);
      inputs[3] = inv(parent.orientation + 1);
      inputs[4] = inv(parent.region);
      inputs[5] = fixed ? cells.length / noCells : Math.trunc(cells.length / noCells);
      setPosition(parent.pos);
      net.activate();

      const springCell = outputs[8] > 0.2;
      const neighbour = (o: number): [number, number, number] => {
        const d = DIRECTIONS[o];
        return [parent.pos[0] + d[0], parent.pos[1] + d[1], parent.pos[2] + d[2]];
      };
      let orientation: number;
      let type: number;
      if (deterministic) {
        // The most likely free direction; if all are occupied, the cell does not grow.
        const ranked = [0, 1, 2, 3, 4, 5].sort((a, b) => outputs[b] - outputs[a] || a - b);
        const free = ranked.find((o) => !occupied.has(neighbour(o).join(',')));
        if (free === undefined) continue;
        orientation = free;
        type = outputs[6] >= outputs[7] ? 0 : 1;
      } else {
        orientation = choose(Array.from(outputs.subarray(0, 6)), rng);
        type = choose(Array.from(outputs.subarray(6, 8)), rng);
      }

      const pos = neighbour(orientation);
      const key = pos.join(',');
      if (occupied.has(key)) continue;
      occupied.add(key);
      if (pos[1] - 1 < groundY) groundY = pos[1] - 1;

      const child: Cell = {
        pos,
        parent: i,
        joint: type === 0 ? 'fixed' : 'hinge',
        typeOfCell: type,
        levelFromRoot: parent.levelFromRoot + 1,
        levelInRegion: type === 0 ? (fixed ? parent.levelInRegion + 1 : 1) : 0,
        region: type === 0 ? parent.region : parent.region + 1,
        orientation,
        springCell,
      };
      noRegions = Math.max(noRegions, child.region);
      cells.push(child);
    }
  }

  // Muscles between spring cells of different regions; the network decides whether and how they move.
  const setCellInputs = (c: Cell, offset: number) => {
    inputs[offset] = typeOf(c);
    inputs[offset + 1] = inv(c.levelFromRoot + 1);
    inputs[offset + 2] = inv(c.levelInRegion + 1);
    inputs[offset + 3] = inv(c.orientation + 1);
    inputs[offset + 4] = inv(c.region);
  };
  // Query with a pair of cells (the same inputs the C# code used for the muscles).
  const queryPair = (ca: Cell, cb: Cell) => {
    setCellInputs(ca, 0);
    inputs[5] = Math.hypot(ca.pos[0] - cb.pos[0], ca.pos[1] - cb.pos[1], ca.pos[2] - cb.pos[2]);
    setCellInputs(cb, 6);
    setPosition([(ca.pos[0] + cb.pos[0]) / 2, (ca.pos[1] + cb.pos[1]) / 2, (ca.pos[2] + cb.pos[2]) / 2]);
    net.activate();
  };

  // CPG: one oscillator per rigid segment and one coupling per hinge.
  let cpg: Cpg | undefined;
  let oscOfCluster = new Map<number, number>();
  let clusterOf: number[] = [];
  if (muscleModel === 'cpg') {
    clusterOf = rigidClusters(cells);
    cpg = { frequency: [], initialPhase: [], root: [], couplings: [] };
    cells.forEach((c, r) => {
      if (c.joint === 'fixed') return;
      oscOfCluster.set(clusterOf[r], cpg!.root.length);
      cpg!.root.push(r);
      inputs.fill(0);
      setCellInputs(c, 0);
      setPosition(c.pos);
      net.activate();
      cpg!.frequency.push(limits.maxFrequency * outputs[9]);
      cpg!.initialPhase.push(2 * Math.PI * rng.next());
    });
    cells.forEach((c, r) => {
      if (c.joint !== 'hinge') return;
      queryPair(cells[c.parent], c);
      cpg!.couplings.push({
        i: oscOfCluster.get(clusterOf[c.parent])!,
        j: oscOfCluster.get(clusterOf[r])!,
        w: limits.maxCoupling * outputs[8],
        phi: 2 * Math.PI * outputs[10],
      });
    });
  }

  // Substrate: for every cell the network decides whether it is adhesive (output 11 > 0.5) and its
  // phase offset relative to the oscillator of its segment (ψ = 2π·output 10), queried with the cell alone.
  let adhesion: Body['adhesion'];
  if (withAdhesion) {
    adhesion = { adhesive: [], phase: [] };
    for (const c of cells) {
      inputs.fill(0);
      setCellInputs(c, 0);
      setPosition(c.pos);
      net.activate();
      adhesion.adhesive.push(outputs[11] > 0.5);
      adhesion.phase.push(2 * Math.PI * outputs[10]);
    }
  }

  // Local muscles: only between rigid segments directly joined by a hinge.
  const localMuscles = limits.muscleScope === 'hinge';
  const segmentOf = localMuscles ? rigidClusters(cells) : [];
  const pairKey = (x: number, y: number) => `${Math.min(x, y)},${Math.max(x, y)}`;
  const hingeAdjacent = new Set<string>();
  if (localMuscles) {
    cells.forEach((c, i) => {
      if (c.joint === 'hinge') hingeAdjacent.add(pairKey(segmentOf[i], segmentOf[c.parent]));
    });
  }

  const muscles: Muscle[] = [];
  const oscillator = muscleModel === 'oscillator';
  // Frequency shared by the whole creature: the network queried with no inputs (bias only).
  inputs.fill(0);
  net.activate();
  const bodyFrequency = outputs[9];
  let penalty = 1;
  for (let a = 0; a < cells.length; a++) {
    const ca = cells[a];
    if (!ca.springCell) continue;
    for (let b = 0; b < cells.length; b++) {
      const cb = cells[b];
      if (!(ca.region < cb.region && cb.springCell)) continue;
      if (localMuscles && !hingeAdjacent.has(pairKey(segmentOf[a], segmentOf[b]))) continue;
      queryPair(ca, cb);
      const working = outputs[8] > 0.5;
      if (cpg) {
        const osc = oscOfCluster.get(clusterOf[a])!;
        const frequency = cpg.frequency[osc];
        muscles.push({ a, b, working, frequency: working ? frequency : 0, phase: 0, amplitude: working ? maxAmplitude * (2 * outputs[11] - 1) : 0, osc });
        if (working) penalty *= 1 + frequency;
      } else if (oscillator) {
        muscles.push({
          a,
          b,
          working,
          frequency: working ? bodyFrequency : 0,
          phase: working ? 2 * Math.PI * outputs[10] : 0,
          amplitude: working ? maxAmplitude * outputs[11] : 0,
        });
        if (working) penalty *= 1 + bodyFrequency;
      } else {
        muscles.push({ a, b, working, frequency: working ? outputs[9] : 0, phase: working ? outputs[10] : 0, amplitude: 0 });
        if (working) penalty *= 1 + outputs[9];
      }
    }
  }

  const working = muscles.filter((m) => m.working).length;
  if (limits.musclePenalty === 'geometric-mean' && working > 0) penalty = penalty ** (1 / working);

  return { cells, muscles, noRegions, penalty, groundY, cpg, adhesion };
}

/** Groups of cells joined by fixed joints (they behave as a rigid body). */
function rigidClusters(cells: Cell[]): number[] {
  const root = cells.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  cells.forEach((c, i) => {
    if (c.joint === 'fixed') root[find(i)] = find(c.parent);
  });
  return cells.map((_, i) => find(i));
}

export function buildWorld(body: Body, params: ExperimentParams): { world: PhysicsWorld | StokesWorld; muscleConstraints: number[] } {
  const cluster = rigidClusters(body.cells);
  const members = new Map<number, number[]>();
  cluster.forEach((c, i) => members.set(c, [...(members.get(c) ?? []), i]));
  // Pairs of cells joined by the weak spring of a hinge (which pulls it back to its initial angle).
  const hingeSprings: [number, number][] = [];
  body.cells.forEach((c, i) => {
    if (c.joint !== 'hinge') return;
    for (const a of members.get(cluster[c.parent])!) {
      if (a === c.parent) continue;
      for (const b of members.get(cluster[i])!) hingeSprings.push([a, b]);
    }
  });

  if (params.physics.medium !== 'ground') {
    const world = new StokesWorld(
      body.cells.map((c) => c.pos),
      [...members.values()],
      body.cells.flatMap((c, i) => (c.joint === 'hinge' ? [{ parentCell: c.parent, childCell: i }] : [])),
      params.physics,
    );
    body.cells.forEach((c, i) => {
      if (c.parent >= 0) world.addDragEdge(i, c.parent);
    });
    // On the substrate the floor starts just below the lowest layer of cells.
    if (params.physics.medium === 'substrate') {
      world.groundY = Math.min(...body.cells.map((c) => c.pos[1])) - params.physics.radius;
    }
    for (const [a, b] of hingeSprings) world.addSpring(a, b, params.hingeStiffness);
    const musclesAt = new Array<number>(body.cells.length).fill(0);
    for (const m of body.muscles) {
      musclesAt[m.a]++;
      musclesAt[m.b]++;
    }
    const muscleConstraints = body.muscles.map((m) => {
      world.disableCollision(m.a, m.b);
      const shared = params.muscleSharing ? Math.max(musclesAt[m.a], musclesAt[m.b]) : 1;
      return world.addSpring(m.a, m.b, params.muscleStiffness / shared);
    });
    return { world, muscleConstraints };
  }

  const world = new World(body.cells.map((c) => c.pos), body.groundY, params.physics);
  // Fixed joints: each rigid group moves as a rigid body. If the group hangs from a hinge, the parent
  // cell is included in it as the pivot: the group can only rotate around the centre of the parent
  // (like the anchor of Unity's HingeJoint), so muscles crossing the hinge bend the body there.
  for (const list of members.values()) {
    const hingeCell = list.find((i) => body.cells[i].joint === 'hinge');
    world.addRigidCluster(hingeCell === undefined ? list : [...list, body.cells[hingeCell].parent]);
  }
  body.cells.forEach((c, i) => {
    if (c.joint === 'fixed') world.disableCollision(i, c.parent);
  });
  for (const [a, b] of hingeSprings) world.addConstraint(a, b, 1 / params.hingeStiffness);
  const muscleConstraints = body.muscles.map((m) => {
    world.disableCollision(m.a, m.b);
    return world.addConstraint(m.a, m.b, 1 / params.muscleStiffness);
  });
  return { world, muscleConstraints };
}

/** One evaluation of the creature for TrialDuration seconds (FixedUpdate + GetFitness). */
export class Trial {
  readonly world: PhysicsWorld | StokesWorld;
  readonly duration: number;
  readonly muscleLengths: number[];
  private readonly restLengths: number[];
  /** Current phases of the CPG oscillators. */
  readonly theta: number[];
  private steps = 0;
  private muscleConstraints: number[];
  private energy: number;
  private penalty: number;
  private first: number[];
  private mid: number[];
  /** Substrate: oscillator of the segment of each cell, and which cells are attached right now. */
  private cellOsc: number[] = [];
  readonly stuck: Uint8Array;
  /** Distance travelled in the fitness window, before the cut-off, regions and penalty. */
  distance = 0;
  /** Seconds the settling phase lasted (0 if there was none). */
  readonly settleTime: number;

  constructor(
    readonly body: Body,
    generation: number,
    readonly params: ExperimentParams = DEFAULT_EXPERIMENT,
  ) {
    const built = buildWorld(body, params);
    this.world = built.world;
    this.muscleConstraints = built.muscleConstraints;
    this.muscleLengths = body.muscles.map((m) => this.world.distance(m.a, m.b));
    this.restLengths = [...this.muscleLengths];
    this.theta = [...(body.cpg?.initialPhase ?? [])];
    this.duration = trialDuration(generation);
    this.energy = generation;
    this.penalty = body.penalty;
    this.stuck = new Uint8Array(body.cells.length);
    if (params.physics.medium === 'substrate') {
      if (!body.cpg || !body.adhesion) throw new Error('The substrate needs the cpg muscle model and adhesion.');
      const oscOfRoot = new Map(body.cpg.root.map((r, k) => [r, k]));
      this.cellOsc = body.cells.map((_, i) => {
        let r = i;
        while (body.cells[r].joint === 'fixed') r = body.cells[r].parent;
        return oscOfRoot.get(r)!;
      });
    }
    this.settleTime = params.settle ? this.settle(params.settle) : 0;
    this.first = this.position();
    this.mid = this.first.map(() => 0);
  }

  /** Simulates without any activity until the body stands still; returns the time it took. */
  private settle({ speed, hold, maxTime }: NonNullable<ExperimentParams['settle']>): number {
    const { dt } = this.params;
    const world = this.world;
    const free = this.params.physics.adhesion.free;
    let t = 0;
    let quiet = 0;
    const prev = new Float64Array(world.pos.length);
    while (t < maxTime - 1e-9 && quiet < hold - 1e-9) {
      if (world instanceof StokesWorld && this.params.physics.medium === 'substrate') {
        for (let i = 0; i < world.n; i++) world.cellDrag[i] = world.touchesGround(i) ? free : 0;
      }
      prev.set(world.pos);
      world.step(dt);
      t += dt;
      let max = 0;
      for (let i = 0; i < world.n; i++) {
        const d = Math.hypot(world.pos[i * 3] - prev[i * 3], world.pos[i * 3 + 1] - prev[i * 3 + 1], world.pos[i * 3 + 2] - prev[i * 3 + 2]);
        max = Math.max(max, d / dt);
      }
      quiet = max < speed ? quiet + dt : 0;
    }
    return t;
  }

  /** Position that counts for the fitness: (x, z) when there is a floor; (x, y, z) in the fluid. */
  private position(): number[] {
    return this.params.physics.medium === 'viscous' ? this.world.centroid() : this.world.centroidXZ();
  }

  /** Simulated time; computed from the number of steps so that no error accumulates. */
  get time(): number {
    return this.steps * this.params.dt;
  }

  get done(): boolean {
    return this.time >= this.duration - 1e-9;
  }

  step(): void {
    const { dt, muscleRange, maxHeight } = this.params;
    const half = this.duration / 2;
    if (this.time < half && this.time > half - 0.1) this.mid = this.position();

    this.body.muscles.forEach((m, k) => {
      if (!m.working) return;
      if (this.params.muscleModel === 'cpg') {
        this.muscleLengths[k] = this.restLengths[k] * (1 + m.amplitude * Math.sin(this.theta[m.osc!]));
        this.world.setRestLength(this.muscleConstraints[k], Math.max(0, this.muscleLengths[k]));
        return;
      }
      if (this.params.muscleModel === 'oscillator') {
        this.muscleLengths[k] =
          this.restLengths[k] * (1 + m.amplitude * Math.sin(2 * Math.PI * m.frequency * this.time + m.phase));
        this.world.setRestLength(this.muscleConstraints[k], this.muscleLengths[k]);
        return;
      }
      if (m.frequency + m.phase <= 0) return;
      // As in the C# code, the change accumulates step by step on the muscle length.
      const variation = muscleRange * Math.sin(2 * this.time * Math.PI * m.frequency + m.phase);
      this.energy -= variation;
      if (this.energy > 0) this.muscleLengths[k] += variation;
      this.world.setRestLength(this.muscleConstraints[k], Math.max(0, this.muscleLengths[k]));
    });

    // In the fluid there is no "up": the height penalty only makes sense with a floor.
    if (this.params.physics.medium !== 'viscous') {
      const pos = this.world.pos;
      for (let i = 0; i < this.world.n; i++) {
        if (pos[i * 3 + 1] > maxHeight) this.penalty = 1e14;
      }
    }

    if (this.params.physics.medium === 'substrate') this.updateAdhesion();
    if (this.body.cpg) this.stepOscillators(dt);
    this.world.step(dt);
    this.steps++;
  }

  /** An adhesive cell touching the floor attaches during half of the cycle of its oscillator. */
  private updateAdhesion(): void {
    const world = this.world as StokesWorld;
    const { stuck: stuckDrag, free } = this.params.physics.adhesion;
    const { adhesive, phase } = this.body.adhesion!;
    for (let i = 0; i < world.n; i++) {
      const contact = world.touchesGround(i);
      const stuck = contact && adhesive[i] && Math.sin(this.theta[this.cellOsc[i]] + phase[i]) > 0;
      this.stuck[i] = stuck ? 1 : 0;
      world.cellDrag[i] = !contact ? 0 : stuck ? stuckDrag : free;
    }
  }

  /** Integrates the phases of the coupled oscillators (explicit Euler). */
  private stepOscillators(dt: number): void {
    const { frequency, couplings } = this.body.cpg!;
    const th = this.theta;
    const d = frequency.map((f) => 2 * Math.PI * f);
    for (const { i, j, w, phi } of couplings) {
      // The coupling is symmetric: j tends to lag φ behind i, and i to lead j by φ.
      d[i] += w * Math.sin(th[j] - th[i] + phi);
      d[j] += w * Math.sin(th[i] - th[j] - phi);
    }
    for (let k = 0; k < th.length; k++) th[k] += d[k] * dt;
  }

  fitness(): number {
    const end = this.position();
    const dist = (p: number[], q: number[]) => Math.hypot(...p.map((x, i) => x - q[i]));
    let fit = dist(this.mid, end) + (this.params.fitnessWindow === 'second-half' ? 0 : dist(this.first, end));
    this.distance = fit;
    if (fit < 3) fit /= 10000;
    return fit / ((this.params.divideByRegions === false ? 1 : this.body.noRegions) * this.penalty);
  }

  run(): number {
    while (!this.done) this.step();
    return this.fitness();
  }
}
