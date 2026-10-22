# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A first-person walk through a historical city (Potsdam, 1900), built from map data, not procedurally: today's OpenStreetMap filtered and completed by OpenHistoricalMap's dated features and a georeferenced historical map (the Messtischblatt of 1903). TypeScript on Vite, three r160 (pinned). Shaped after [lunar-walk](https://github.com/fwilhe2/lunar-walk); a shared engine repo may be split out later, so keep engine code (render, player, ui, geom, city/massing) free of Potsdam specifics. `README.md` explains where the city comes from — read it before changing anything that decides what is shown for 1900.

## Running

```sh
npm install
npm run dev                 # Vite, http://localhost:5173
npm run check               # tsc for the app, the tests and the tools
npm run test                # vitest (tests/*.test.ts)
npm run fetch potsdam       # network: data/potsdam/{osm,ohm}.json, mtb1903.png
npm run city potsdam        # data → src/cities/potsdam/city.json
node tools/shot.ts OUT 'name=#x=…&z=…&yaw=…&pitch=…&t=…[&y=…][|KeyM]'
```

`npm run test` (Vitest on Node). Tools run directly under Node's type stripping: imports with `.ts` extensions, no parameter properties or enums (`erasableSyntaxOnly` in `tools/tsconfig.json` checks this).

**Verify visual changes with `tools/shot.ts`**: it starts Vite, opens the page in headless Firefox with `?probe`, sets each view through `window.hw.go(hash)` and saves PNGs; `|KeyM` after a hash presses keys first (and again after, to undo toggles). `--fps` measures the frame rate after each shot (the probe's state has `cpu`, the render's own ms); `--query=off=ao,bloom,msaa,shadow,prepass` times parts of the pipeline, `--query=debug=ao` shows the occlusion. The dev machine is a laptop iGPU: watch the frame rate. Read the PNGs. The view hash is `x`, `z` (metres, local frame), `yaw` (degrees, 0 north, 90 west), `pitch`, `t` (local solar hour; the HUD shows the clock, Central European Time since 1893), `y` (eye height — means flying). For checking data, rasterise it over the historical map with a small PIL script (data/potsdam/mtb1903.png covers `city.bounds` exactly, pixel-linear).

## Layout

- `tools/` — the data pipeline (Node): `cities.ts` (bbox, origin, year, historical map), `fetch.ts`, `osm.ts` (projection, rings, dates), `mask.ts` (built-up mask and block outlines from the map raster), `landmarks.ts` (frames and part builders), `history/<city>.ts` (hand-made knowledge, every entry with its reason), `history/<city>-landmarks.ts`, `build-city.ts` (decides, for each feature, whether and how it is shown), `shot.ts`.
- `src/city/types.ts` — the `City` the app loads; `src/cities/<id>/city.json` is generated, never hand-edited.
- `src/geom/poly.ts` — imports nothing; shared by tools and app.
- `src/city/` — `massing.ts` (pure: walls and roofs of one building), `buildings.ts` (merged meshes per 200 m tile, facade and roof shaders), `ground.ts` (the plan rasterised into weight textures; also answers `isWater`/`surface` for the walker), `water.ts`, `props.ts` (walls and railings, columns, lanterns, street furniture), `trees.ts` (grown from seeds in a unit space, near/far levels re-sorted as you walk), `skyview.ts` (pure: a height field of the roofs; how much sky a wall vertex or the ground sees).
- `src/city/terrain.ts` — `heightAt()`, the one height source: the ground mesh, buildings (at their lowest corner), props, trees, boats and the walker all ask it. Zero in the town and on the water.
- `src/city/boats.ts`, `src/audio/sound.ts` (all synthesised). There are no figures or horses: the user had the pedestrians taken out for looking artificial, and the box-horse tram and cabs went with them — don't bring moving figures back unless they look real.
- `src/player/` — input (keys, mouse, touch), collision (segments on a grid), walker. `src/ui/` — HUD, the 1903 map. `src/app/view.ts` — the URL hash.
- `src/render/` — `atmo.ts` (pure: the atmosphere model, single scattering with Rayleigh, haze and ozone; its GLSL twin; tested), `sky.ts` (the sky-view lookup table, dome, sun light and shadow box, environment map, exposure), `clouds.ts` (cumulus baked into a density/light map), `post.ts` (HDR target with MSAA and depth → AO, water reflections, haze, bloom, AgX → screen; depth pre-pass), `waves.ts` (ripples shared by the water and the post pass), `quality.ts` (tiers).
- `src/city/groundtex.ts` — ground surfaces baked once into texture arrays (setts, slabs, mosaic, gravel, grass, earth); `ground.ts` lays them by the raster and by a street frame (distance to the kerb, street bearing) computed from the street lines.

## Things that are easy to break

- **Coordinates**: x east, z south, y up; rings flat `[x, z, …]`, outer rings positive by `area()` (clockwise on a north-up map), holes negative. Outward wall normal of a positive ring edge (dx, dz) is (dz, −dx). Yaw 0 looks north; forward is (−sin yaw, −cos yaw).
- **Roofs** (`massing.ts`): plane roofs are the lower envelope of planes over the footprint's rectangle, each plane's region clipped exactly from the triangulated footprint; walls follow the same envelope, so wall tops meet roof edges (tests check this). Irregular footprints and domes/spires use distance-to-outline profiles on refined triangles. Keep `roofAt()` and the meshing in step.
- **What is shown for the year** is decided only in `tools/build-city.ts`, in this order: OSM buildings (date, OHM's say over the spot, the mask, post-war look), OHM buildings, patches, landmarks (they replace the footprint under their `at` point), open areas, rebuilt frontage, streets (OHM first, OSM filtered by the mask), canals and bridges, railings. The build fails on a building without valid colours or rings; keep that check.
- **Names**: show only names of the year — OHM's and the landmarks'. OSM names are today's.
- **Hashes in tools** are unsigned (`>>> 0`); shift them with `>>>`, never `>>` (a negative index once left half the rebuilt houses without a colour).
- Ground texture channels: A = setts, slabs, grass; B = water, rail, gravel; C (half resolution) = blurred footprints for contact shade. Painted opaque in order, so weights sum to at most one. Water discards the ground; the walker reads the same raster.
- three r160: `onBeforeCompile` uniforms need their GLSL declared; `customProgramCacheKey` per patched material. Array render targets are mipmapped as 2D textures (broken): `groundtex.ts` mipmaps by hand.
- **Light units**: the noon sun at the ground is about 5 (`atmo.ts` `sunE`); emissive lamps and windows are in those units, and the exposure opens up to ×14 at night (`sky.ts`), so artificial light is dim on purpose.
- **Post pass contracts**: the water writes alpha 0 (that is how `post.ts` finds it; every other opaque material writes 1); the sky dome writes no depth (cleared depth = sky); objects on `PREPASS_LAYER` (the buildings) are drawn depth-only first, so nothing that discards fragments may be on it.
- **Shader patches by text**: facades (`buildings.ts`, the relief's sun shadow), the ground (`ground.ts`, the kerb's shade and the shadow lookup at the traced hit), leaves (`trees.ts`) and awnings (`buildings.ts`, light through the canvas) patch three's `lights_fragment_begin` after `getDirectionalLightInfo( directionalLight, directLight );`; the facades also patch `lights_fragment_maps` (glass mirrors the houses opposite); the facade and roof shaders apply the vertex colour themselves (three's `color_fragment` is removed), so their window, sash and stone colours are their own.
- **The raised pavement** is traced, not built: the ground shader follows the eye ray from the kerb's plane (14 cm) down against the street frame's distance (half floats: 8 bits made the edge ragged) and shades the hit — top, kerb face or road; the shadow map is looked up at the hit (`gHitOff`). Keep `KERB` and the door steps' height (`massing.ts`) in step.
- **Massing details** (`buildMassing(…, true, details)`): eaves, gutters and downpipes, awnings and door steps skip party walls via `details.exposed` (buildings.ts tests the ground just outside an edge). The awnings and door steps lay out the bays as the facade shader does; change both together. Metal and cloth are kept off the depth pre-pass (`userData.noPrepass`): cloth discards fragments.
- **Sky view**: walls carry `aSky` per vertex, the ground a 2 m raster drawn on the GPU (`GROUND_SKY_GLSL`); the hidden share is lit by `bounce` (sky.ts). Materials that use it set `userData.skyView` so main.ts leaves their `envMapIntensity` alone.

## Toward a shared engine

The user may split the engine from the cities (and from [lunar-walk](https://github.com/fwilhe2/lunar-walk)) later. Keep the line clean: `src/render`, `src/player`, `src/ui`, `src/geom`, `src/city/{massing,buildings,ground,groundtex,water,props,trees,skyview,terrain,boats}.ts` must not name Potsdam or hard-code its places; city specifics live in `tools/cities.ts`, `tools/history/<city>*.ts` and the generated `city.json`. The app picks the city by `?city=<id>` (default potsdam) from `src/cities/*/city.json`; the bell towers, the shop boards' lettering and the map raster come from the city's data.

## Writing history

Every hand-made number or polygon in `tools/history/` carries its source or says it is an estimate. Prefer data (OHM, OSM tags, the map) over hand edits; prefer a general rule in `build-city.ts` over a per-building patch.
