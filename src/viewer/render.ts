// 3D view of a creature with three.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Trial } from '../sim/creature.ts';

/** Colours of the C# code: the root Rigidbody uses New Material and children are tinted by region. */
function regionColor(region: number, isRoot: boolean): THREE.Color {
  if (isRoot) return new THREE.Color(0.32, 0.043, 0.043);
  // En C#: b = 1/(region+1) (float); r = 1/(1+region%2) y g = 1/(1+region%3) eran enteras.
  const r = region % 2 === 0 ? 1 : 0;
  const g = region % 3 === 0 ? 1 : 0;
  const b = 1 / (region + 1);
  return new THREE.Color(r * 0.85 + 0.1, g * 0.85 + 0.1, b * 0.9 + 0.1);
}

const TRAIL_MAX = 20000;
const DUST_COUNT = 6000;
const SKY = { ground: 0x14171c, viscous: 0x0f1c26, substrate: 0x161a17 };

export class CreatureView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private ground: THREE.Mesh;
  private grid: THREE.GridHelper;
  private group = new THREE.Group();
  private spheres: THREE.Mesh[] = [];
  /** Substrate: a ring under each cell, shown when it is attached. */
  private rings: THREE.Mesh[] = [];
  /** CPG model: oscillator of the segment of each cell (to light it up with its phase). */
  private cellOsc: number[] = [];
  private joints: THREE.LineSegments | null = null;
  private muscles: THREE.LineSegments | null = null;
  private trail: THREE.Line | null = null;
  private trailCount = 0;
  private trailLast = new THREE.Vector3();
  private jointPairs: [number, number][] = [];
  private trial: Trial | null = null;
  /** Fixed particles in the fluid: a reference to see the displacement. */
  private dust: THREE.Points;
  private lastTarget = new THREE.Vector3();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x14171c);
    this.scene.fog = new THREE.Fog(0x14171c, 40, 110);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.camera.position.set(8, 5, 11);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xcfd8e6, 0x2a2520, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(12, 20, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25 });
    this.scene.add(sun, sun.target);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x252a31, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.grid = new THREE.GridHelper(400, 400, 0x3a414b, 0x2e343c);
    this.scene.add(this.ground, this.grid, this.group);

    const dustPos = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < dustPos.length; i++) dustPos[i] = (Math.random() - 0.5) * 70;
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    this.dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({ color: 0x8fb8d8, size: 0.06, transparent: true, opacity: 0.55 }),
    );
    this.scene.add(this.dust);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private get viscous(): boolean {
    return this.trial?.params.physics.medium === 'viscous';
  }

  setTrial(trial: Trial): void {
    this.trial = trial;
    const sky = SKY[trial.params.physics.medium];
    (this.scene.background as THREE.Color).set(sky);
    this.scene.fog!.color.set(sky);
    this.ground.visible = this.grid.visible = !this.viscous;
    this.dust.visible = this.viscous;
    this.group.clear();
    this.spheres = [];
    const { cells, muscles } = trial.body;
    const geo = new THREE.SphereGeometry(trial.params.physics.radius * 0.8, 24, 16);
    cells.forEach((c, i) => {
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: regionColor(c.region, i === 0), roughness: 0.45, metalness: 0.05 }),
      );
      mesh.castShadow = true;
      this.spheres.push(mesh);
      this.group.add(mesh);
    });

    // Oscillator of each cell: that of the root of its segment (first ancestor that is not a fixed joint).
    this.cellOsc = [];
    const cpg = trial.body.cpg;
    if (cpg) {
      const oscOfRoot = new Map(cpg.root.map((r, k) => [r, k]));
      cells.forEach((_, i) => {
        let r = i;
        while (cells[r].joint === 'fixed') r = cells[r].parent;
        this.cellOsc.push(oscOfRoot.get(r)!);
      });
    }

    this.rings = [];
    if (trial.params.physics.medium === 'substrate') {
      const ringGeo = new THREE.RingGeometry(0.28, 0.42, 24);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x3ddc84, side: THREE.DoubleSide });
      cells.forEach(() => {
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.visible = false;
        this.rings.push(ring);
        this.group.add(ring);
      });
    }

    this.jointPairs = [];
    const jointColors: number[] = [];
    cells.forEach((c, i) => {
      if (c.parent < 0) return;
      this.jointPairs.push([i, c.parent]);
      const col = c.joint === 'hinge' ? new THREE.Color(0xffb347) : new THREE.Color(0xdde3ea);
      jointColors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    });
    this.joints = this.makeLines(this.jointPairs.length, jointColors, 1, true);
    this.muscles = this.makeLines(muscles.length, new Array(muscles.length * 6).fill(0), 0.9, true);

    this.trailCount = 0;
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: 0x6cc4ff, transparent: true, opacity: 0.7 }),
    );
    this.trail.frustumCulled = false;
    this.group.add(this.trail);

    this.lastTarget.copy(this.focus());
    this.controls.target.copy(this.lastTarget);
    this.update();
  }

  private makeLines(count: number, colors: number[], opacity: number, depthTest: boolean): THREE.LineSegments {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: opacity < 1, opacity, depthTest }),
    );
    lines.frustumCulled = false;
    this.group.add(lines);
    return lines;
  }

  /** Copies the simulation positions to the scene. */
  update(): void {
    const trial = this.trial;
    if (!trial) return;
    const p = trial.world.pos;
    this.spheres.forEach((m, i) => m.position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
    this.rings.forEach((ring, i) => {
      ring.visible = trial.stuck[i] === 1;
      ring.position.set(p[i * 3], trial.world.groundY + 0.01, p[i * 3 + 2]);
    });
    if (this.cellOsc.length) {
      this.spheres.forEach((m, i) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        const glow = 0.5 * (1 + Math.sin(trial.theta[this.cellOsc[i]]));
        mat.emissive.copy(mat.color).multiplyScalar(0.8 * glow);
      });
    }

    const fill = (lines: THREE.LineSegments | null, pairs: readonly (readonly [number, number])[]) => {
      if (!lines) return;
      const attr = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
      pairs.forEach(([a, b], k) => {
        attr.setXYZ(k * 2, p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
        attr.setXYZ(k * 2 + 1, p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
      });
      attr.needsUpdate = true;
    };
    fill(this.joints, this.jointPairs);
    const muscles = trial.body.muscles;
    fill(this.muscles, muscles.map((m) => [m.a, m.b] as const));

    // Working muscles in red (stronger the further from their initial length); passive ones faint.
    if (this.muscles) {
      const col = this.muscles.geometry.getAttribute('color') as THREE.BufferAttribute;
      muscles.forEach((m, k) => {
        let c: [number, number, number];
        if (m.working) {
          const stretch = Math.min(1, Math.abs(trial.world.distance(m.a, m.b) - trial.muscleLengths[k]) + 0.35);
          c = [1, 0.25 + 0.4 * (1 - stretch), 0.3];
        } else {
          c = [0.28, 0.32, 0.38];
        }
        col.setXYZ(k * 2, ...c);
        col.setXYZ(k * 2 + 1, ...c);
      });
      col.needsUpdate = true;
    }

    this.ground.position.y = trial.world.groundY;
    this.grid.position.y = trial.world.groundY + 0.001;

    // Path of the centre of mass: projected on the floor, or in 3D in the fluid.
    const [cx, cy, cz] = trial.world.centroid();
    const pt = this.viscous ? new THREE.Vector3(cx, cy, cz) : new THREE.Vector3(cx, trial.world.groundY + 0.02, cz);
    if (this.trail && this.trailCount < TRAIL_MAX && (this.trailCount === 0 || this.trailLast.distanceTo(pt) > 0.005)) {
      const attr = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.setXYZ(this.trailCount++, pt.x, pt.y, pt.z);
      attr.needsUpdate = true;
      this.trail.geometry.setDrawRange(0, this.trailCount);
      this.trailLast.copy(pt);
    }

    // The camera smoothly follows the centre of mass.
    const delta = this.focus().sub(this.lastTarget).multiplyScalar(0.08);
    this.lastTarget.add(delta);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
  }

  /** Point the camera looks at. */
  private focus(): THREE.Vector3 {
    const w = this.trial!.world;
    const [x, y, z] = w.centroid();
    return this.viscous ? new THREE.Vector3(x, y, z) : new THREE.Vector3(x, w.groundY + 1, z);
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
