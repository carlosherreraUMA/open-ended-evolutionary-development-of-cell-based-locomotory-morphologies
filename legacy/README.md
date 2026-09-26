# Legacy Unity scripts (2016–2017)

These are the original C# scripts of the Unity 5.4 project, recovered from the last surviving
`.unitypackage`. They are kept for reference and history; they do not compile on their own.

They depended on [UnityNEAT](https://github.com/lordjesus/UnityNEAT) (a Unity port of SharpNEAT),
which is not included here. The Unity scene, prefabs, third-party assets and the UnityNEAT sources
are not part of this repository.

## Files

- `controler13.cs` — the controller that was active in `Creature.prefab` in the last version of the
  project. It is the one ported to TypeScript in `src/sim/creature.ts`.
- `CellStructure.cs` — the cell and spring-link data structures used by the controllers.
- `CellTouchesPlane.cs`, `GrowCell.cs` — small helpers. Note that `CellTouchesPlane.onCollisionEnter`
  was never called by Unity, because the method name must start with a capital letter.
- `Controller4.cs` … `controler15.cs`, `CreatureController9.cs`, `CreatureController10.cs`,
  `creatureController7.cs`, `creatureController8.cs`, `controller5.cs`, `controller6.cs`,
  `ReneControl.cs` — earlier and later iterations of the controller, kept as history.

## Changes made to UnityNEAT's `Optimizer.cs` (not included)

The experiment also relied on a modified `Optimizer.cs` from UnityNEAT:

- the networks had 11 inputs and 12 outputs (`NUM_INPUTS = 11`, `NUM_OUTPUTS = 12`);
- the trial duration grew with the generation: `TrialDuration = 2 + sqrt(Generation)`;
- evolution ran at 25× real time (`Time.timeScale = 25`).

The NEAT configuration (`Resources/experiment.config.xml`) used a population of 8 and 2 species,
acyclic networks and an absolute complexity ceiling of 20 connections.

## Known bugs in `controler13.cs`

The TypeScript port can reproduce them exactly (`--mode original`) or fix them (`--mode fixed`, the
default):

1. Integer divisions in the network inputs (`1/(level+1)`, `1/region`, `grid.Count/noCells`) made
   almost every input 0.
2. `typeOfCell` was never stored (always 0).
3. `levelInRegion` of a child attached with a fixed joint was always 1.
4. `Random.Range(-1, 1)` on integers never returns 1, and it was re-drawn at every check of the
   growth loop.
