// Main page: controls the evolution worker and replays the champion in 3D
// (the equivalent of the "Start EA", "Stop EA" and "Run best" buttons of the Unity Optimizer).

import { parseChampion, serializeChampion, type ChampionJson } from '../champion.ts';
import type { GenerationStats, PopulationJson } from '../neat/evolution.ts';
import { Genome } from '../neat/genome.ts';
import { experimentFor, type ExperimentParams, type MuscleModel, type SimMode, type Trial } from '../sim/creature.ts';
import type { Medium } from '../sim/physics.ts';
import { createTrial } from '../sim/evaluate.ts';
import { CreatureView } from './render.ts';
import type { FromWorker, ToWorker } from './worker.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (x: number) => (x === 0 ? '0' : Math.abs(x) >= 0.01 && Math.abs(x) < 1e5 ? x.toFixed(3) : x.toExponential(2));

const view = new CreatureView($('viewport'));
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const send = (m: ToWorker) => worker.postMessage(m);

let history: Omit<GenerationStats, 'best'>[] = [];
let running = false;
let started = false;
let champion: ChampionJson | null = null;
let pendingChampion: ChampionJson | null = null;
let trial: Trial | null = null;
let replayOf: ChampionJson | null = null;
let accumulator = 0;
let holdUntil = 0;

// ------------------------------------------------------------------ evolution

function readParams(): ExperimentParams {
  const raw = $<HTMLInputElement>('friction').value.trim();
  const friction = raw === '∞' || raw.toLowerCase() === 'inf' || raw === '' ? Infinity : Number(raw);
  return experimentFor($<HTMLSelectElement>('medium').value as Medium, {
    mode: $<HTMLSelectElement>('mode').value as SimMode,
    muscleModel: $<HTMLSelectElement>('muscles').value as MuscleModel,
    fitnessWindow: $<HTMLSelectElement>('fitness').value as ExperimentParams['fitnessWindow'],
    musclePenalty: $<HTMLSelectElement>('penalty').value as ExperimentParams['musclePenalty'],
    muscleSharing: $<HTMLInputElement>('sharing').checked,
    seedMode: $<HTMLInputElement>('inherited').checked ? 'inherited' : 'per-evaluation',
    physics: { friction: Number.isFinite(friction) || friction === Infinity ? friction : Infinity } as ExperimentParams['physics'],
  });
}

function start(population?: PopulationJson) {
  const populationSize = Number($<HTMLInputElement>('pop').value);
  const specieCount = Number($<HTMLInputElement>('species').value);
  if (!(populationSize > specieCount)) {
    showError('The population must be larger than the number of species.');
    return;
  }
  showError('');
  history = [];
  champion = pendingChampion = null;
  send({ type: 'start', populationSize, specieCount, seed: Number($<HTMLInputElement>('seed').value), params: readParams(), population });
  running = started = true;
  updateButtons();
}

$('start').onclick = () => start();
const syncMedium = () => {
  const medium = $<HTMLSelectElement>('medium').value;
  $('friction-field').hidden = medium !== 'ground';
  // The substrate needs the CPG: adhesion follows the oscillators.
  const muscles = $<HTMLSelectElement>('muscles');
  if (medium === 'substrate') muscles.value = 'cpg';
  muscles.disabled = medium === 'substrate';
};
$('medium').onchange = syncMedium;
syncMedium();
$('pause').onclick = () => {
  running = !running;
  send({ type: running ? 'resume' : 'pause' });
  updateButtons();
};
$<HTMLInputElement>('load-pop').onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) start(JSON.parse(await file.text()) as PopulationJson);
};
$('download-pop').onclick = () => send({ type: 'getPopulation' });

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  if (msg.type === 'generation') {
    history.push(msg.stats);
    champion = msg.champion;
    showStats(msg.stats);
    drawChart();
    if (!trial) startReplay(champion);
    else if ($<HTMLInputElement>('follow').checked) pendingChampion = champion;
    updateButtons();
  } else if (msg.type === 'population') {
    download(`population-gen${msg.population.generation}.json`, JSON.stringify(msg.population));
  } else {
    showError(msg.message);
  }
};

function showStats(s: Omit<GenerationStats, 'best'>) {
  $('s-gen').textContent = String(s.generation);
  $('s-best').textContent = fmt(s.maxFitness);
  $('s-mean').textContent = fmt(s.meanFitness);
  $('s-complexity').textContent = `${s.meanComplexity.toFixed(1)} (${s.mode === 'simplifying' ? 'simplifying' : 'complexifying'})`;
  $('s-species').textContent = s.specieSizes.join(' / ');
}

function updateButtons() {
  $<HTMLButtonElement>('pause').disabled = !started;
  $('pause').textContent = !started || running ? 'Pause' : 'Resume';
  $('start').textContent = started ? 'Restart' : 'Start';
  $<HTMLButtonElement>('download-pop').disabled = !started;
  $<HTMLButtonElement>('replay').disabled = !replayOf;
  $<HTMLButtonElement>('download-champ').disabled = !replayOf;
}

function showError(text: string) {
  $('error').hidden = !text;
  $('error').textContent = text;
}

// ------------------------------------------------------------------ chart

function drawChart() {
  const canvas = $<HTMLCanvasElement>('chart');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (history.length < 2) return;

  const log = (x: number) => Math.log10(Math.max(x, 1e-8));
  const ys = history.flatMap((s) => [log(s.maxFitness), log(s.meanFitness)]);
  const lo = Math.floor(Math.min(...ys));
  const hi = Math.max(lo + 1, Math.ceil(Math.max(...ys)));
  const pad = { l: 30, r: 8, t: 8, b: 16 };
  const X = (i: number) => pad.l + (i / (history.length - 1)) * (w - pad.l - pad.r);
  const Y = (v: number) => h - pad.b - ((v - lo) / (hi - lo)) * (h - pad.t - pad.b);

  ctx.font = '10px system-ui';
  ctx.fillStyle = '#8b94a3';
  ctx.strokeStyle = '#2b313a';
  ctx.lineWidth = 1;
  const step = Math.max(1, Math.ceil((hi - lo) / 4));
  for (let v = lo; v <= hi; v += step) {
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(v));
    ctx.lineTo(w - pad.r, Y(v));
    ctx.stroke();
    ctx.fillText(`1e${v}`, 2, Y(v) + 3);
  }
  ctx.fillText(`gen ${history[history.length - 1].generation}`, w - pad.r - 44, h - 3);

  const line = (color: string, get: (s: Omit<GenerationStats, 'best'>) => number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    history.forEach((s, i) => (i ? ctx.lineTo(X(i), Y(log(get(s)))) : ctx.moveTo(X(i), Y(log(get(s))))));
    ctx.stroke();
  };
  line('#6cc4ff', (s) => s.meanFitness);
  line('#ff8a5b', (s) => s.maxFitness);
}

// ------------------------------------------------------------------ champion replay

function startReplay(c: ChampionJson) {
  replayOf = c;
  trial = createTrial(Genome.fromJSON(c.genome), c.eval.generation, c.eval.seed, c.params);
  view.setTrial(trial);
  accumulator = 0;
  $('c-fitness').textContent = fmt(c.fitness);
  $('c-replay').textContent = 'running…';
  $('c-cells').textContent = String(c.eval.cells);
  $('c-regions').textContent = String(c.eval.regions);
  $('c-muscles').textContent = `${c.eval.workingMuscles} working of ${c.eval.muscles}`;
  $('c-gen').textContent = String(c.eval.generation);
  $('hud-title').textContent = `Champion · fitness ${fmt(c.fitness)}`;
  $('legend-dust').hidden = c.params.physics.medium !== 'viscous';
  $('legend-cpg').hidden = c.params.muscleModel !== 'cpg';
  $('legend-stuck').hidden = c.params.physics.medium !== 'substrate';
  updateButtons();
}

$('replay').onclick = () => replayOf && startReplay(replayOf);
$('download-champ').onclick = () => replayOf && download(`champion-gen${replayOf.eval.generation}.json`, serializeChampion(replayOf));
// Several champions can be loaded at once (e.g. the whole champions/ folder of a run) and chosen
// from the list, sorted by generation.
let gallery: { name: string; champion: ChampionJson }[] = [];
$<HTMLInputElement>('load-champ').onchange = async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  if (files.length === 0) return;
  gallery = await Promise.all(files.map(async (f) => ({ name: f.name, champion: parseChampion(await f.text()) })));
  gallery.sort((a, b) => a.champion.eval.generation - b.champion.eval.generation || a.name.localeCompare(b.name));
  const select = $<HTMLSelectElement>('gallery');
  select.innerHTML = '';
  gallery.forEach((g, i) => {
    const d = g.champion.eval.distance;
    select.add(new Option(`${g.name} · gen ${g.champion.eval.generation}${d !== undefined ? ` · distance ${d.toFixed(2)}` : ''}`, String(i)));
  });
  select.value = String(gallery.length - 1);
  $('gallery-field').hidden = gallery.length < 2;
  $<HTMLInputElement>('follow').checked = false;
  pendingChampion = null;
  startReplay(gallery[gallery.length - 1].champion);
};
$<HTMLSelectElement>('gallery').onchange = (e) => {
  const g = gallery[Number((e.target as HTMLSelectElement).value)];
  if (g) startReplay(g.champion);
};

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

let last = performance.now();
function frame(now: number) {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (trial) {
    if (!trial.done) {
      accumulator += elapsed * Number($<HTMLSelectElement>('speed').value);
      while (accumulator >= trial.params.dt && !trial.done) {
        trial.step();
        accumulator -= trial.params.dt;
      }
      if (trial.done) {
        // Determinism check: the replay must give the same fitness as the evolution did.
        const f = trial.fitness();
        const same = replayOf && Math.abs(f - replayOf.fitness) <= 1e-9 * Math.max(1, Math.abs(f));
        $('c-replay').textContent = same ? `${fmt(f)} ✓ identical` : `${fmt(f)} (differs)`;
        holdUntil = now + 1500;
      }
    } else if (now > holdUntil) {
      if (pendingChampion && pendingChampion !== replayOf) startReplay(pendingChampion);
      else if (replayOf) startReplay(replayOf);
      pendingChampion = null;
    }
    view.update();
    $('hud-time').textContent =
      `t = ${trial.time.toFixed(2)} s of ${trial.duration.toFixed(2)} s` +
      (trial.settleTime ? ` · settled in ${trial.settleTime.toFixed(1)} s` : '');
    $('hud-progress').style.width = `${Math.min(100, (100 * trial.time) / trial.duration)}%`;
  }
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateButtons();
