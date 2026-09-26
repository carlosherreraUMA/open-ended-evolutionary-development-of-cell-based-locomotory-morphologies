import { describe, expect, it } from 'vitest';
import { defaultNeatConfig } from '../src/neat/config.ts';
import { NeatEvolution } from '../src/neat/evolution.ts';
import { Network } from '../src/neat/network.ts';
import { Rng } from '../src/rng.ts';
import { DEFAULT_EXPERIMENT, experimentFor, grow, targetCellCount, Trial, type Body, type Cell } from '../src/sim/creature.ts';
import { evaluateGenome, INPUT_COUNT, OUTPUT_COUNT } from '../src/sim/evaluate.ts';
import { DEFAULT_PHYSICS, World, type PhysicsParams } from '../src/sim/physics.ts';

describe('physics', () => {
  it('a sphere falls and rests on the floor', () => {
    const w = new World([[0, 3, 0]], -2);
    for (let i = 0; i < 300; i++) w.step(0.02);
    expect(w.pos[1]).toBeCloseTo(-1.5, 3);
  });

  it('a rigid group keeps its distances while falling and tipping over', () => {
    const pts: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [2, 2, 0]];
    const w = new World(pts, -2);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) w.addConstraint(i, j, 0);
    for (let i = 0; i < 300; i++) w.step(0.02);
    expect(w.distance(0, 4)).toBeCloseTo(Math.hypot(2, 2), 2);
    expect(w.distance(0, 1)).toBeCloseTo(1, 2);
  });

  it('an irregular rigid body falling with infinite friction comes to rest (no spurious energy)', () => {
    // A tall asymmetric shape, similar to the champions that tipped over.
    const pts: [number, number, number][] = [];
    for (let y = 0; y < 5; y++) pts.push([0, y, 0]);
    pts.push([1, 4, 0], [2, 4, 0], [2, 4, 1], [0, 0, 1], [-1, 2, 0]);
    const w = new World(pts, -2);
    w.addRigidCluster(pts.map((_, i) => i));
    const [x0, z0] = w.centroidXZ();
    for (let i = 0; i < 600; i++) w.step(0.02);
    const [x1, z1] = w.centroidXZ();
    const before = w.pos.slice();
    w.step(0.02);
    const speed = Math.max(...w.pos.map((v, i) => Math.abs(v - before[i]))) / 0.02;
    expect(Math.hypot(x1 - x0, z1 - z0)).toBeLessThan(3);
    expect(speed).toBeLessThan(0.05);
    expect(w.distance(0, 7)).toBeCloseTo(Math.hypot(2, 4, 1), 4);
  });

  it('with infinite friction a pushed sphere does not slide; without friction it does', () => {
    const slide = (friction: number) => {
      const w = new World([[0, -1.5, 0]], -2, { ...DEFAULT_PHYSICS, friction });
      (w as unknown as { vel: Float64Array }).vel[0] = 5;
      for (let i = 0; i < 50; i++) w.step(0.02);
      return w.pos[0];
    };
    expect(Math.abs(slide(Infinity))).toBeLessThan(1e-6);
    expect(slide(0)).toBeGreaterThan(1);
  });
});

describe('creature', () => {
  const ea = new NeatEvolution(defaultNeatConfig(), 3);
  const genome = ea.factory.createGenome(0);

  it('grows up to the number of cells of the generation', () => {
    for (const g of [0, 10, 100]) {
      const body = grow(new Network(genome, INPUT_COUNT, OUTPUT_COUNT), g, new Rng(g), 'fixed');
      expect(Math.abs(body.cells.length - targetCellCount(g))).toBeLessThanOrEqual(1);
      const keys = new Set(body.cells.map((c) => c.pos.join(',')));
      expect(keys.size).toBe(body.cells.length);
    }
  });

  it('the original mode never exceeds noCells (Random.Range(-1,1) never returns 1)', () => {
    for (let s = 0; s < 20; s++) {
      const body = grow(new Network(genome, INPUT_COUNT, OUTPUT_COUNT), 0, new Rng(s), 'original');
      expect(body.cells.length).toBeLessThanOrEqual(targetCellCount(0));
    }
  });

  it('the same seed produces exactly the same evaluation', () => {
    const a = evaluateGenome(genome, 25, 99);
    const b = evaluateGenome(genome, 25, 99);
    expect(a).toEqual(b);
    expect(Number.isFinite(a.fitness)).toBe(true);
  });

  it('the simulation lasts 2 + sqrt(generation) seconds', () => {
    const body = grow(new Network(genome, INPUT_COUNT, OUTPUT_COUNT), 16, new Rng(1), 'fixed');
    const t = new Trial(body, 16, DEFAULT_EXPERIMENT);
    let steps = 0;
    while (!t.done) {
      t.step();
      steps++;
    }
    expect(steps).toBe(Math.ceil(6 / 0.02 - 1e-9));
  });

  it('the oscillator muscle follows L0·(1 + A·sin(2πft + φ)) with a shared frequency', () => {
    const params = { ...DEFAULT_EXPERIMENT, muscleModel: 'oscillator' as const, physics: { ...DEFAULT_EXPERIMENT.physics, medium: 'viscous' as const } };
    for (let s = 0; s < 40; s++) {
      const g = ea.factory.createGenome(0);
      const body = grow(new Network(g, INPUT_COUNT, OUTPUT_COUNT), 30, new Rng(s), 'fixed', 'oscillator', 0.3);
      const working = body.muscles.filter((m) => m.working);
      if (working.length < 2) continue;
      expect(new Set(working.map((m) => m.frequency)).size).toBe(1);
      const t = new Trial(body, 30, params);
      const L0 = [...t.muscleLengths];
      for (let k = 0; k < 37; k++) t.step();
      const time = 36 * params.dt; // the length is set at the start of the step
      body.muscles.forEach((m, i) => {
        const expected = m.working ? L0[i] * (1 + m.amplitude * Math.sin(2 * Math.PI * m.frequency * time + m.phase)) : L0[i];
        expect(t.muscleLengths[i]).toBeCloseTo(expected, 9);
        expect(Math.abs(m.amplitude)).toBeLessThanOrEqual(0.3);
      });
      return;
    }
    throw new Error('no random creature had two working muscles');
  });

  it('a hinge rotates around the centre of the parent cell and bends the body', () => {
    // Two vertebrae (lower + upper cell) joined by a hinge at the lower one,
    // with a shortening muscle between the upper ones.
    const base = { typeOfCell: 0, levelFromRoot: 0, levelInRegion: 0, orientation: 0, springCell: true };
    const body = {
      cells: [
        { ...base, pos: [0, 0, 0] as [number, number, number], parent: -1, joint: 'root' as const, region: 1 },
        { ...base, pos: [0, 1, 0] as [number, number, number], parent: 0, joint: 'fixed' as const, region: 1 },
        { ...base, pos: [1, 0, 0] as [number, number, number], parent: 0, joint: 'hinge' as const, region: 2 },
        { ...base, pos: [1, 1, 0] as [number, number, number], parent: 2, joint: 'fixed' as const, region: 2 },
      ],
      muscles: [{ a: 1, b: 3, working: true, frequency: 0.25, phase: Math.PI / 2, amplitude: 0.5 }],
      noRegions: 2,
      penalty: 1,
      groundY: -2,
    };
    const params = experimentFor('viscous', { muscleModel: 'oscillator' });
    const t = new Trial(body, 100, params);
    while (t.time < 2) t.step(); // half a period: the muscle asks for 0.5
    expect(t.world.distance(0, 2)).toBeCloseTo(1, 3);
    expect(t.world.distance(0, 3)).toBeCloseTo(Math.SQRT2, 3);
    expect(t.world.distance(1, 3)).toBeLessThan(0.7);
  });

  describe('CPG', () => {
    // Worm: vertebrae (lower cell + fixed upper cell) joined by hinges, with a muscle between the
    // upper cells of consecutive vertebrae.
    function worm(n: number, phi: number, w = 6): Body {
      const base = { typeOfCell: 0, levelFromRoot: 0, levelInRegion: 0, orientation: 0, springCell: true };
      const cells: Cell[] = [];
      for (let k = 0; k < n; k++) {
        cells.push({ ...base, pos: [k, 0, 0], parent: k === 0 ? -1 : 2 * (k - 1), joint: k === 0 ? 'root' : 'hinge', region: k + 1 });
        cells.push({ ...base, pos: [k, 1, 0], parent: 2 * k, joint: 'fixed', region: k + 1 });
      }
      const rng = new Rng(3);
      return {
        cells,
        muscles: Array.from({ length: n - 1 }, (_, k) => ({ a: 2 * k + 1, b: 2 * k + 3, working: true, frequency: 0.5, phase: 0, amplitude: 0.5, osc: k })),
        noRegions: n,
        penalty: 1,
        groundY: -2,
        cpg: {
          frequency: new Array(n).fill(0.5),
          initialPhase: Array.from({ length: n }, () => 2 * Math.PI * rng.next()),
          root: Array.from({ length: n }, (_, k) => 2 * k),
          couplings: Array.from({ length: n - 1 }, (_, k) => ({ i: k, j: k + 1, w, phi })),
        },
      };
    }
    const params = experimentFor('viscous', { muscleModel: 'cpg' });

    it('the oscillators synchronise with the phase lag of their couplings', () => {
      const t = new Trial(worm(6, Math.PI / 4), 100, params);
      while (t.time < 5) t.step();
      for (let k = 0; k + 1 < 6; k++) {
        const lag = (((t.theta[k] - t.theta[k + 1]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        expect(lag).toBeCloseTo(Math.PI / 4, 3);
      }
    });

    it('the emergent travelling wave makes the worm swim; reversing it reverses the direction', () => {
      const advance = (phi: number) => {
        const t = new Trial(worm(8, phi), 100, params);
        const x0 = t.world.centroid()[0];
        t.run();
        return t.world.centroid()[0] - x0;
      };
      const forward = advance(Math.PI / 4);
      const backward = advance(-Math.PI / 4);
      expect(Math.abs(forward)).toBeGreaterThan(0.05);
      expect(Math.sign(forward)).toBe(-Math.sign(backward));
    });
  });

  describe('Stokes fluid', () => {
    const base = { typeOfCell: 0, levelFromRoot: 0, levelInRegion: 0, orientation: 0, springCell: true };
    // Two vertebrae joined by a hinge and a muscle between the upper cells.
    const twoSegments = (amplitude: number): Body => ({
      cells: [
        { ...base, pos: [0, 0, 0], parent: -1, joint: 'root', region: 1 },
        { ...base, pos: [0, 1, 0], parent: 0, joint: 'fixed', region: 1 },
        { ...base, pos: [0, 2, 0], parent: 1, joint: 'fixed', region: 1 },
        { ...base, pos: [1, 0, 0], parent: 0, joint: 'hinge', region: 2 },
        { ...base, pos: [1, 1, 0], parent: 3, joint: 'fixed', region: 2 },
        { ...base, pos: [2, 0, 0], parent: 3, joint: 'fixed', region: 2 },
      ],
      muscles: [{ a: 1, b: 4, working: true, frequency: 0.5, phase: 0, amplitude }],
      noRegions: 2,
      penalty: 1,
      groundY: -2,
    });
    const params = experimentFor('viscous', { muscleModel: 'oscillator' });

    it('without forces nothing moves', () => {
      const t = new Trial(twoSegments(0), 100, params);
      const before = t.world.pos.slice();
      for (let i = 0; i < 100; i++) t.step();
      expect(Math.max(...t.world.pos.map((v, i) => Math.abs(v - before[i])))).toBeLessThan(1e-9);
    });

    it('a single oscillating degree of freedom does not advance (Purcell scallop theorem)', () => {
      const t = new Trial(twoSegments(0.4), 100, params);
      const c0 = t.world.centroid();
      while (t.time < 8 - 1e-9) t.step(); // 4 periodos completos
      const c1 = t.world.centroid();
      const bend = Math.abs(t.world.distance(1, 4) - 1);
      expect(Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2])).toBeLessThan(0.01);
      // and yet the body has been bending
      const probe = new Trial(twoSegments(0.4), 100, params);
      while (probe.time < 0.5) probe.step();
      expect(Math.abs(probe.world.distance(1, 4) - 1)).toBeGreaterThan(0.2);
      expect(bend).toBeLessThan(0.2);
    });

    it('with huge forces the result does not depend on the substeps (adaptive step)', () => {
      // Accumulative muscle with frequency ~0: its target length grows without limit.
      const body = (): Body => ({ ...twoSegments(0), muscles: [{ a: 1, b: 4, working: true, frequency: 0.001, phase: 1, amplitude: 0 }] });
      const advance = (substeps: number) => {
        const p = experimentFor('viscous', { muscleModel: 'accumulative', physics: { substeps } as PhysicsParams });
        const t = new Trial(body(), 100, p);
        const a = t.world.centroid();
        t.run();
        const b = t.world.centroid();
        return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      };
      const coarse = advance(4); // the value used for evolution
      const fine = advance(16);
      expect(Math.abs(coarse - fine)).toBeLessThan(0.1 * Math.max(fine, 0.01));
    });

    it('the hinge keeps its pivot at the centre of the parent cell', () => {
      const t = new Trial(twoSegments(0.4), 100, params);
      for (let i = 0; i < 200; i++) t.step();
      expect(t.world.distance(0, 3)).toBeCloseTo(1, 3);
      expect(t.world.distance(0, 4)).toBeCloseTo(Math.SQRT2, 3);
      expect(t.world.distance(0, 5)).toBeCloseTo(2, 3);
      expect(t.world.distance(0, 2)).toBeCloseTo(2, 9);
    });
  });

  describe('substrate', () => {
    // Worm lying on the floor: spine at z = 0 and side cells at z = 1, all at y = 0.
    function crawler(n: number, phi: number, adhesive: boolean): Body {
      const base = { typeOfCell: 0, levelFromRoot: 0, levelInRegion: 0, orientation: 0, springCell: true };
      const cells: Cell[] = [];
      for (let k = 0; k < n; k++) {
        cells.push({ ...base, pos: [k, 0, 0], parent: k === 0 ? -1 : 2 * (k - 1), joint: k === 0 ? 'root' : 'hinge', region: k + 1 });
        cells.push({ ...base, pos: [k, 0, 1], parent: 2 * k, joint: 'fixed', region: k + 1 });
      }
      return {
        cells,
        muscles: Array.from({ length: n - 1 }, (_, k) => ({ a: 2 * k + 1, b: 2 * k + 3, working: true, frequency: 0.5, phase: 0, amplitude: 0.5, osc: k })),
        noRegions: n,
        penalty: 1,
        groundY: -2,
        cpg: {
          frequency: new Array(n).fill(0.5),
          initialPhase: Array.from({ length: n }, (_, k) => -k * phi),
          root: Array.from({ length: n }, (_, k) => 2 * k),
          couplings: Array.from({ length: n - 1 }, (_, k) => ({ i: k, j: k + 1, w: 6, phi })),
        },
        adhesion: { adhesive: cells.map(() => adhesive), phase: cells.map(() => Math.PI / 4) },
      };
    }
    const params = experimentFor('substrate');
    const advance = (body: Body) => {
      const t = new Trial(body, 100, params);
      const [x0, z0] = t.world.centroidXZ();
      t.run();
      const [x1, z1] = t.world.centroidXZ();
      return { d: Math.hypot(x1 - x0, z1 - z0), t };
    };

    it('rests on the floor without moving if no muscle is working', () => {
      const body = crawler(4, 0, true);
      body.muscles.forEach((m) => (m.working = false));
      const t = new Trial(body, 100, params);
      while (t.time < 2) t.step(); // the weight pushes the cells ~0.01 into the floor
      const [x0, z0] = t.world.centroidXZ();
      t.run();
      const [x1, z1] = t.world.centroidXZ();
      expect(Math.hypot(x1 - x0, z1 - z0)).toBeLessThan(1e-3);
      for (let i = 0; i < t.world.n; i++) expect(t.world.pos[i * 3 + 1] - t.world.groundY).toBeCloseTo(0.5, 1);
    });

    it('with a wave and alternating adhesion it crawls; without adhesion it barely moves', () => {
      const crawling = advance(crawler(8, Math.PI / 4, true)).d;
      const sliding = advance(crawler(8, Math.PI / 4, false)).d;
      expect(crawling).toBeGreaterThan(1.5);
      expect(sliding).toBeLessThan(crawling / 10);
    });

    it('settling does not count: an inactive body that falls does not advance', () => {
      // L-shaped tower: at the start it tips over under its weight. After settling it must stay still.
      const base = { typeOfCell: 0, levelFromRoot: 0, levelInRegion: 0, orientation: 0, springCell: true };
      const cells: Cell[] = [{ ...base, pos: [0, 0, 0], parent: -1, joint: 'root', region: 1 }];
      for (let y = 1; y < 4; y++) cells.push({ ...base, pos: [0, y, 0], parent: y - 1, joint: 'fixed', region: 1 });
      cells.push({ ...base, pos: [1, 3, 0], parent: 3, joint: 'fixed', region: 1 }, { ...base, pos: [2, 3, 0], parent: 4, joint: 'fixed', region: 1 });
      const body: Body = {
        cells,
        muscles: [],
        noRegions: 1,
        penalty: 1,
        groundY: -2,
        cpg: { frequency: [0.5], initialPhase: [0], root: [0], couplings: [] },
        adhesion: { adhesive: cells.map(() => true), phase: cells.map(() => 0) },
      };
      const t = new Trial(body, 100, experimentFor('substrate'));
      expect(t.settleTime).toBeGreaterThan(0.5);
      const [x0, z0] = t.world.centroidXZ();
      t.run();
      const [x1, z1] = t.world.centroidXZ();
      expect(Math.hypot(x1 - x0, z1 - z0)).toBeLessThan(0.02);
      expect(t.fitness()).toBeLessThan(1e-5);
    });

    it('the result does not depend on the substeps', () => {
      const run = (substeps: number) => {
        const t = new Trial(crawler(8, Math.PI / 4, true), 100, experimentFor('substrate', { physics: { substeps } as PhysicsParams }));
        const [x0, z0] = t.world.centroidXZ();
        t.run();
        const [x1, z1] = t.world.centroidXZ();
        return Math.hypot(x1 - x0, z1 - z0);
      };
      const coarse = run(4);
      const fine = run(16);
      expect(Math.abs(coarse - fine)).toBeLessThan(0.05 * fine);
    });
  });
});
