// Compares runs from their stats.csv: moving average (10 generations) of the speed of the best
// individual and of the mean speed of the population. Speed = distance in the fitness window (the
// second half of the trial) divided by its duration, (2 + √generation) / 2 seconds: trials get longer
// with the generation, so distance alone grows even if the creature does not improve.
//
//   npm run compare -- runs/run-a runs/run-b

import { readFileSync } from 'node:fs';

const WINDOW = 10;
const dirs = process.argv.slice(2);
const runs = dirs.map((dir) => {
  const [header, ...lines] = readFileSync(`${dir}/stats.csv`, 'utf8').trim().split('\n');
  const cols = header.split(',');
  const col = (name: string) => cols.indexOf(name);
  const rows = lines.map((l) => l.split(','));
  const window = (r: string[]) => (2 + Math.sqrt(Number(r[col('generation')]))) / 2;
  return {
    dir,
    gen: rows.map((r) => Number(r[col('generation')])),
    best: rows.map((r) => Number(r[col('best_distance')]) / window(r)),
    mean: rows.map((r) => Number(r[col('mean_distance')]) / window(r)),
  };
});

const movingMean = (xs: number[], end: number) => {
  const slice = xs.slice(Math.max(0, end - WINDOW + 1), end + 1);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
};

const maxGen = Math.max(...runs.map((r) => r.gen.length));
const width = Math.max(...dirs.map((d) => d.length)) + 2;
console.log(`moving average of ${WINDOW} generations, speed in units/s: best / population mean\n`);
console.log('gen'.padStart(5) + runs.map((r) => r.dir.padStart(width)).join(''));
for (let g = WINDOW - 1; g < maxGen; g += WINDOW) {
  const cells = runs.map((r) =>
    g < r.gen.length ? `${movingMean(r.best, g).toFixed(2)} / ${movingMean(r.mean, g).toFixed(2)}`.padStart(width) : ''.padStart(width),
  );
  console.log(String(g).padStart(5) + cells.join(''));
}
