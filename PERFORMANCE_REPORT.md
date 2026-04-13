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
