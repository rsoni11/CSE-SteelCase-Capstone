# Performance Report - Truck Loading Tetris

## Scope

Validated simulator behavior under a 50+ box load and applied low-risk rendering optimizations that preserve current drag-and-drop logic.

## Bottlenecks Identified

1. `TruckLoadingPrototype.jsx` created a new `BoxGeometry`, `MeshStandardMaterial`, and edge geometry for every spawned box.
2. Every box cast and received dynamic shadows, increasing GPU cost as box count grew.
3. Renderer used full device pixel ratio and a 2048 shadow map, which is expensive on high-DPI displays.

## Optimizations Implemented

1. Added shared geometry/material caches by size and color:
   - Reused `THREE.BoxGeometry` per dimension group.
   - Reused `THREE.EdgesGeometry` per dimension group.
   - Reused `THREE.MeshStandardMaterial` by color.
2. Reduced shadow cost:
   - New boxes only cast shadows for the first ~30 objects.
3. Reduced renderer shadow overhead:
   - Pixel ratio capped at 1.5.
   - Directional shadow map reduced from 2048 to 1024.
4. Added stress-test utility:
   - One-click `55` box spawn mode.
   - In-app sampled FPS result (`avg` and `min`) displayed in UI.

## Stress Test Setup

1. Open app and choose a load example (or use current box list).
2. Click `Run 55-Box Stress Test`.
3. The app clears current boxes, spawns 55, and samples FPS for ~5 seconds.
4. Result is shown in panel/header (`PASS` if avg and min are both >= 30 FPS).

## Approximate Results (Expected)

- Before optimizations: high-20s to low-30s FPS at 50+ boxes on typical laptop GPUs.
- After optimizations: low-30s to mid-40s FPS at 50+ boxes in same conditions.

Actual values vary by hardware/browser; use the built-in stress test result as the source of truth for your machine.

## AI Best Fit Search Budget (Sprint 7, US1 task 3)

The suggestion search runs synchronously on the main thread, so it has a hard
requirement rather than a target: a suggestion for a trailer holding up to 50
cartons must come back inside **200 ms**, and a "Calculating…" indicator is on
screen for the whole of it.

### How the budget is held

- `fitSearch.js` samples adaptively instead of on a flat grid: exact
  contact positions ("anchors") first, then a step of 0.125 ft near loaded cargo
  and 1.0 ft across open deck. Sampling is capped per axis
  (`MAX_ANCHORS_X/Z`, `MAX_SWEEP_X/Z`), which is what bounds the candidate count.
- The search checks the clock between sweeps and stops adding candidates once it
  is past `TIME_BUDGET_MS` and already has a result.
- `ControlPanel` prints the measured time and how many orientations were swept
  in full (e.g. `6/6 rotations tried · 40 ms`), so a machine that cannot hold the
  budget shows it rather than hiding it.

### Measured

| Cartons on the trailer | Search time |
| --- | --- |
| 0 | ~7 ms |
| 25 | ~44 ms |
| 50 | ~80 ms |
| 75 (`MAX_BOXES`) | ~118 ms |

Measured under `node --test` on an Apple Silicon laptop, all six orientations
scored. The same search after the in-app 55-box stress test measured ~40 ms in
Chrome — the stress-test load is a regular stack, so it yields fewer distinct
anchor positions than the mixed loads used in the table.

`npm test` asserts the budget directly: `a suggestion for a 50-carton trailer
lands inside the 200 ms budget` fails the build if any of the five Steelcase
SKUs overruns.
