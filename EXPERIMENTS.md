# Experiment log

This is the record of what was tried after porting the 2016–2017 Unity project to the web, what
worked, what did not, and why. Run names (`e2-inherited`, …) refer to local output folders that are
not part of the repository; a selection of champions is in `gallery/`.

## Summary

Creatures now crawl reliably on a 3D substrate. The best ones move at ~0.5–0.55 units per second
(about 4 units in the 7 s measured), with bodies of 20–23 cells in 5–6 articulated segments,
~100 muscles and a wave that travels along the body, synchronised with gripping the floor. All
results are reproducible and the physics converges.

| Change | Effect | Evidence |
|---|---|---|
| Crawling with phase-controlled adhesion instead of swimming | ~70× more displacement per cycle than swimming at low Reynolds number | hand-built prototypes |
| **Inherited development seed** (E2) | mean population speed ×3 compared with stochastic development (0.33 vs ~0.10 u/s) | all 4 seeds of E2 (0.23–0.49) beat the single stochastic run |
| Deterministic development (E1) | gets stuck: all creatures identical, no muscles | clear |
| Not dividing the fitness by the number of regions (E5) | −4 % on average (from −45 % to +86 % depending on the seed) | 4 seeds: no reliable effect |
| Positional inputs (E3, E6) | slower start; small late improvement in E3 | 1 run each |
| Muscles only across hinges (E4, E5b) | worse | 1 run each |
| Long run (L1, 160 generations) | plateau at ~0.55 u/s; the population collapses into clones | 1 run |

Lessons:

- **Evolution finds every numerical loophole.** Several apparent successes were integration
  artefacts (see parts 2 and 4). Every result must be checked for independence from the time step.
- **Run-to-run variance is larger than most effects** (±50 % between runs with the same
  configuration). Nothing can be concluded from a single run; 3–4 seeds per configuration are needed.
- **The randomness in development is not only noise: it is the source of body diversity.**
  Making it heritable keeps the diversity and removes the evaluation noise.

Open questions, in order of priority:

1. Remove or smooth the fitness cut-off at 3 units, which probably causes the loss of diversity
   (a creature that passes it gets ×10 000 fitness and takes over the population).
2. Test every change with 3–4 seeds.
3. Revisit positional inputs with a higher complexity ceiling.
4. Scale up: 100+ cells and one-minute lifetimes need a different muscle architecture (all-pairs
   muscles grow as n²) and probably implicit integration.

## Metrics

- **Distance**: how far the centre of mass moves in the fitness window (the second half of the
  trial, after settling), before the 3-unit cut-off, the region division and the penalty.
- **Speed**: distance divided by the duration of the window, (2 + √generation) / 2 seconds. Trials
  get longer with the generation, so distance alone grows even if the creature does not improve.
- `npm run compare` prints moving averages of the speed of the best individual and of the mean
  speed of the population; `npm run assess` re-evaluates a saved population, in its own seed mode
  and with new growth seeds.

## Part 1 · The original design on the ground

The faithful port of `controler13.cs` reproduces the behaviour of the Unity project:

- **The muscle penalty is multiplicative**: `penalty *= 1 + frequency` for every working muscle.
  With ~15 working muscles it reaches ~10²⁰, so evolution gets rid of muscles altogether.
- **Muscle "energy" starts at `generation`**, so in generation 0 muscles hardly move.
- **Moving less than 3 units divides the fitness by 10 000.** Champions are tall rigid towers that
  score by tipping over, not by walking.
- As in Unity, every genome is re-evaluated each generation with a new random growth, so the best
  fitness jumps around.

## Part 2 · A viscous medium (swimming)

Cells are small, so a low-Reynolds medium seemed more appropriate than friction with a floor. At low
Reynolds numbers there is no inertia, and a body can only move through non-reciprocal shape changes
(Purcell's scallop theorem); anisotropic drag is needed (resistive force theory: moving sideways
costs more than moving along a joint).

- With the original accumulative muscles, evolution set frequencies to ~0: the muscle length is the
  integral of a sine, so a zero frequency makes it grow without limit and the body drifts.
- An **explicit oscillator** (`L = L0·(1 + A·sin(2πft + φ))`) and **coupled phase oscillators**
  (a CPG in the style of Ijspeert: one oscillator per rigid segment, coupled across the hinges)
  produced real oscillations, but no swimming: the penalty pushed frequencies to 0.
- Two bugs of the first physics engine were found on the way: hinges had no pivot (so muscles could
  not bend the body), and rigid bodies built from all-pairs distance constraints injected energy.
- The first viscous integrator (masses + XPBD) did not converge with stiff muscles, and evolution
  exploited the error: a champion "swam" 7.0 units with 8 substeps, 1.9 with 16 and 0.12 with 128.
  It was replaced by an **inertia-free Stokes solver for articulated rigid bodies**
  (`src/sim/stokes.ts`), with an adaptive, stability-limited step. It satisfies the scallop theorem
  and its results do not depend on the resolution (there are tests for both).

Even with a correct solver and a steady-state fitness (distance in the second half of the trial),
nothing evolved to swim. A hand-built 8-segment worm driven by a perfect CPG travelling wave moved
only ~0.2 % of its length per cycle.

## Part 3 · Prototypes before evolving

Instead of evolving for hours, three locomotion mechanisms were first compared with the same
hand-built worm (8 vertebrae, ±50 % muscles, 0.5 Hz travelling wave):

| Mechanism | Advance per cycle, % of body length |
|---|---|
| Swimming at low Reynolds number | 0.2 % |
| Inertia + quadratic drag (intermediate Reynolds) | ≤ 0.8 % |
| **Crawling with adhesion controlled by the oscillator phase** | **~15 %** |

Controls: without switching adhesion, or with all segments in phase, crawling gives ~0. Crawling is
how real cells (amoebae, keratocytes) and worms (peristalsis) move: a contraction wave travelling
along the body, synchronised with gripping and releasing the substrate.

## Part 4 · Crawling on a 3D substrate

The `substrate` medium: the same Stokes solver plus weight and a floor. Cells touching the floor can
be attached (friction 2000) or free (20); the network decides, per cell, whether it is adhesive and
its phase offset relative to the oscillator of its segment. The whole body is immersed in the same
fluid as the viscous medium.

- With the original multiplicative penalty the network switches muscles on almost as a block
  (~86 per creature), the penalty reaches 10¹⁸ and evolution removes them: no crawlers. With a
  **bounded penalty** (geometric mean, between 1 and 2) crawlers appear.
- More loopholes were closed: cells were pushed through the floor by many muscles (the floor now
  hardens cubically with depth), many stiff muscles made the explicit integration unstable (the step
  is now limited by the drag/stiffness relaxation time) and the hinge correction depended on the
  number of substeps (it now uses a fixed rate).
- **Settling phase** (proposed by the author): before each trial the body is simulated with muscles
  at rest, oscillators stopped and no adhesion, until it stands still (cap 10 s). Falling and tipping
  over no longer count as locomotion.
- **Force sharing** (`--sharing`): each cell shares its contractile force among its muscles, which
  bounds its total stiffness and makes the simulation ~10× faster.

## Part 5 · Overnight experiments (26 September 2026)

Base configuration: 3D substrate, CPG, second-half fitness, settling, geometric-mean penalty, force
sharing, population 50, 5 species. Performance work before the night: Cholesky factorisation in the
integrator (×1.6) and the substrate immersed in the viscous fluid (×2).

### E1 · Stochastic vs deterministic development

*Hypothesis*: stochastic growth (the same genome grows different bodies at every evaluation; the best
genome of an earlier run moved between 0.58 and 4.78 depending on the growth) makes selection very
noisy. Deterministic development should evolve faster.

*Result*: the deterministic run gets stuck. After 25 generations the whole population is the same
creature: a single rigid region, no hinges, no muscles. The initial genomes have very few
connections, the network outputs tie at ~0.5 and choosing the maximum always gives the same answer
(fixed joint). Without body variation there is nothing to select. **The random draw in development
is not only noise: it is the source of body diversity.** Stopped.

### E2 · Inherited development seed

*Hypothesis*: if the development seed is part of the genome (inherited, mutating with probability
0.05), the body is a fixed function of genome and seed: no re-evaluation noise, diversity is kept
(each lineage has its own seed) and whatever is selected is inherited.

*Result*: clearly better. Speed (units/s, best / population mean, 10-generation moving average):

| Generation | Stochastic (E1) | Inherited seed (E2) |
|---|---|---|
| 29 | 0.32 / 0.09 | 0.30 / 0.22 |
| 49 | 0.33 / 0.10 | 0.36 / 0.30 |
| 99 | 0.31 / 0.11 | ~0.40 / ~0.30 |

The stochastic run stalls from generation ~30; the population of E2 triples its mean speed.

Fair assessment of the final populations (generation 100, distance in the fitness window):

| Population | In its own seed mode | Mean of 3 new growths |
|---|---|---|
| E1 (stochastic) | median 0.52, 10/50 > 1 | median 0.57, 3/50 > 1 |
| E2 (inherited) | **median 1.50, 42/50 > 1** | median 0.57, 4/50 > 1 |

The improvement lies in the combination of genome and seed, i.e. in the particular body that
develops: with other seeds the genome grows ordinary creatures. This is what one would expect if an
individual is genotype plus development, as in a real organism. **Adopted.**

Why E2 plateaus (champion of generation 99 with its frequency forced to different values): muscles
only achieve 40–50 % of the requested stretch, and speed peaks at 1 Hz (0.43 u/s; at 0.44 Hz, the
frequency it evolved, 0.35 u/s). The limit is mainly mechanical: ~80 muscles between ~20 cells, all
with the same phase, pulling in incompatible directions. The network treats all cells almost alike:
every segment has the same frequency, every cell is adhesive and the amplitude is at its maximum.
Its inputs (levels, orientation and region encoded as 1/(x+1)) barely distinguish one cell from
another. The gait that works is uniform: the same wave across every hinge.

### E3 · Positional inputs

*Hypothesis*: giving the network the position of the cell relative to the root (x, y, z, distance),
like a morphogenetic gradient, would let it differentiate parts of the body.

*Result*: a small late improvement (0.42 / 0.36 at generation 89 vs 0.35 / 0.30 for E2), with a
slower start: with 4 more inputs the network reaches the original complexity ceiling (20
connections on average) sooner and spends more time simplifying. One run only.

### E4 · Local muscles

*Hypothesis*: in the C# code there is a muscle between every pair of spring cells of different
regions (80–120 per body, working against each other). Muscles only between segments joined by a
hinge (like a muscle crossing a joint) should conflict less.

*Result* (stopped at generation 40): no improvement. The champions have **only 2 regions** (one
hinge), so all 50 muscles cross the same hinge and the option changes nothing. The reason is in the
original fitness, which divides by the number of regions: an 8-segment worm scores 8 times less
than two blocks moving the same way.

Frequencies stay at 0.50 Hz because going to 1 Hz increases speed by 20 % but the penalty by 33 %:
the penalty does its job (efficiency).

### E5 · Not dividing by the number of regions

*Hypothesis*: without the division, articulated bodies and peristaltic waves could evolve.

*Result of the first run*: looked like the biggest improvement of the night (0.48 / 0.27 at
generation 19, 0.59 / 0.48 at 79), with articulated bodies of 4–5 regions. E5b (plus local muscles)
was worse. **The replicates below show that this apparent improvement was not reliable.**

### E6 · No region division + positional inputs

Clearly behind E5 at generation 39 (0.31 / 0.22 vs 0.51 / 0.38); stopped at generation ~45. As in
E3, positional inputs slow down the start. To be revisited with a higher complexity ceiling.

### L1 · Long run

A continuation of the first E5 run from generation 100 to 163.

- Plateau at ~0.55 u/s for the best and ~0.48 u/s for the population mean.
- Every time the original curriculum adds a cell to every body (generations 114, 146, …), the mean
  distance halves and recovers within 2–10 generations.
- Fair assessment at generation 160: the best, the top-5 mean and the median are all exactly 3.95.
  **The population has collapsed into clones of the champion.** Probable cause: the fitness cut-off
  at 3 units (below it the fitness is divided by 10 000). As soon as one creature passes 3 units its
  fitness jumps ×10 000 and roulette selection copies it into the whole population. Without
  diversity there is no progress, which explains the plateau.

### Replicates: E2 vs E5 over four seeds

Mean population speed over generations 40–59 (units/s):

| Seed | E2 | E5 | Difference |
|---|---|---|---|
| 1 | 0.29 | 0.38 | +30 % |
| 2 | 0.30 | 0.18 | −39 % |
| 3 | 0.23 | 0.42 | +86 % |
| 4 | **0.49** | 0.27 | −45 % |
| **Mean** | **0.33** | **0.31** | **−4 %** |

**Not dividing by regions has no reliable effect.** The variation between runs with the same
configuration (±50 %) is larger than the effect; the large advantage of the first E5 run was the
variability of a single run.

Note: the machine went to sleep for about two hours during the night, so there was less computing
time than planned.

## Gallery

`gallery/` contains champions from these runs. Load them all at once in the viewer with
"Load champions" and pick one from the list:

| File | Speed | Body |
|---|---|---|
| `1-stochastic-baseline-gen100` | 0.28 u/s | 20 cells, 2 regions |
| `2-inherited-seed-gen100` | 0.37 u/s | 20 cells, 3 regions |
| `3/4/5-no-region-division-gen020/050/100` | 0.45 / 0.50 / 0.47 u/s | 13–20 cells, 4–5 regions |
| `6/7-long-run-gen130/160` | 0.52 / 0.54 u/s | 22–23 cells, 6 regions |
| `8-inherited-seed-replicate-gen060` | 0.45 u/s | 17 cells, 2 regions |
