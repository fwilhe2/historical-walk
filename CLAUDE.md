# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A first-person walk through a historical city (Potsdam, 1900), built from map data, not procedurally: today's OpenStreetMap filtered and completed by OpenHistoricalMap's dated features and a georeferenced historical map (the Messtischblatt of 1903). TypeScript on Vite, three r160 (pinned), Bun. Shaped after `../lunar-walk`; a shared engine repo may be split out later, so keep engine code (render, player, ui, geom, city/massing) free of Potsdam specifics. `README.md` explains where the city comes from — read it before changing anything that decides what is shown for 1900.

## Running

```sh
bun install
bun run dev                 # Vite, http://localhost:5173
bun run check               # tsc for the app, the tests and the tools
bun run test                # vitest (tests/*.test.ts)
bun run fetch potsdam       # network: data/potsdam/{osm,ohm}.json, mtb1903.png
bun run city potsdam        # data → src/cities/potsdam/city.json
node tools/shot.ts OUT 'name=#x=…&z=…&yaw=…&pitch=…&t=…[&y=…][|KeyM]'
```

`bun run test`, not `bun test` (Vitest on Node). Tools run directly under Node's type stripping: imports with `.ts` extensions, no parameter properties or enums (`erasableSyntaxOnly` in `tools/tsconfig.json` checks this).

**Verify visual changes with `tools/shot.ts`**: it starts Vite, opens the page in headless Firefox with `?probe`, sets each view through `window.hw.go(hash)` and saves PNGs; `|KeyM` after a hash presses keys first (and again after, to undo toggles). Read the PNGs. The view hash is `x`, `z` (metres, local frame), `yaw` (degrees, 0 north, 90 west), `pitch`, `t` (hour), `y` (eye height — means flying). For checking data, rasterise it over the historical map with a small PIL script (data/potsdam/mtb1903.png covers `city.bounds` exactly, pixel-linear).

## Layout

- `tools/` — the data pipeline (Node): `cities.ts` (bbox, origin, year, historical map), `fetch.ts`, `osm.ts` (projection, rings, dates), `mask.ts` (built-up mask and block outlines from the map raster), `landmarks.ts` (frames and part builders), `history/<city>.ts` (hand-made knowledge, every entry with its reason), `history/<city>-landmarks.ts`, `build-city.ts` (decides, for each feature, whether and how it is shown), `shot.ts`.
- `src/city/types.ts` — the `City` the app loads; `src/cities/<id>/city.json` is generated, never hand-edited.
- `src/geom/poly.ts` — imports nothing; shared by tools and app.
- `src/city/` — `massing.ts` (pure: walls and roofs of one building), `buildings.ts` (merged meshes per 200 m tile, facade and roof shaders), `ground.ts` (the plan rasterised into weight textures; also answers `isWater`/`surface` for the walker), `water.ts`, `props.ts` (trees, walls and railings, columns).
- `src/player/` — input, collision (segments on a grid), walker. `src/render/` — renderer, sky and sun. `src/ui/` — HUD, the 1903 map. `src/app/view.ts` — the URL hash.

## Things that are easy to break

- **Coordinates**: x east, z south, y up; rings flat `[x, z, …]`, outer rings positive by `area()` (clockwise on a north-up map), holes negative. Outward wall normal of a positive ring edge (dx, dz) is (dz, −dx). Yaw 0 looks north; forward is (−sin yaw, −cos yaw).
- **Roofs** (`massing.ts`): plane roofs are the lower envelope of planes over the footprint's rectangle, each plane's region clipped exactly from the triangulated footprint; walls follow the same envelope, so wall tops meet roof edges (tests check this). Irregular footprints and domes/spires use distance-to-outline profiles on refined triangles. Keep `roofAt()` and the meshing in step.
- **What is shown for the year** is decided only in `tools/build-city.ts`, in this order: OSM buildings (date, OHM's say over the spot, the mask, post-war look), OHM buildings, patches, landmarks (they replace the footprint under their `at` point), open areas, rebuilt frontage, streets (OHM first, OSM filtered by the mask), canals and bridges, railings. The build fails on a building without valid colours or rings; keep that check.
- **Names**: show only names of the year — OHM's and the landmarks'. OSM names are today's.
- **Hashes in tools** are unsigned (`>>> 0`); shift them with `>>>`, never `>>` (a negative index once left half the rebuilt houses without a colour).
- Ground texture channels: A = setts, slabs, grass; B = water, rail, gravel; C (half resolution) = blurred footprints for contact shade. Painted opaque in order, so weights sum to at most one. Water discards the ground; the walker reads the same raster.
- three r160: `onBeforeCompile` uniforms need their GLSL declared; `customProgramCacheKey` per patched material.

## Writing history

Every hand-made number or polygon in `tools/history/` carries its source or says it is an estimate. Prefer data (OHM, OSM tags, the map) over hand edits; prefer a general rule in `build-city.ts` over a per-building patch.
