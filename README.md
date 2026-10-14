# Historical Walk

A first-person walk through a historical city centre, built from real
maps rather than generated: **Potsdam in 1900**, the Prussian Residenz
inside its excise wall, with the Stadtkanal still open, the
Garnisonkirche, the Heilig-Geist-Kirche and the Stadtschloss still
standing, and the old town around the Alter Markt as it was before
14 April 1945.

```sh
bun install
bun run dev        # http://localhost:5173
```

Click to walk. **WASD** walk, **Shift** walk briskly, mouse looks.
**F** flies over the roofs (**Space**/**C** up and down), **M** opens the
Messtischblatt of 1903 at your position, **[ ]** move the sun through
the day, **G** steps through the landmarks, **V** tints every building by
its source, **N** mutes the sound, **H**
hides the HUD. Time runs at the clock's pace: the Garnisonkirche strikes
the hours, St. Nikolai the quarters. The URL hash always holds your
position, so a view can be shared.

The engine follows [lunar-walk](../lunar-walk) (Vite, TypeScript,
three r160, Bun), rebuilt small for a town instead of a planet.

## Where the city comes from

Every building, street and stretch of water is placed from map data.
What differs is how sure each one is, and the HUD says which kind you
are looking at ("Built"):

| Source | What | How it is chosen for 1900 |
|---|---|---|
| **OpenStreetMap** (ODbL), today's map | buildings that stand today, footprint by footprint; streets; water | kept when `start_date` ≤ 1900; undated ones only where the 1903 map shows built-up ground and they do not look post-war |
| **OpenHistoricalMap** (CC0) | lost buildings with dates (Stadtschloss 1748–1945, Garnisonkirche, Langer Stall, Kommandantur …), streets with their old names, the Stadtkanal, the excise wall, the horse tram | kept when standing in the year (`start_date` ≤ 1900 < `end_date`) |
| **Messtischblatt 3544/3644** (1903), via the LGB Brandenburg WMS (© SBB-PK, dl-de/by-2-0) | which blocks were built up | read from its hatching (`tools/mask.ts`) |
| **Descriptions** of the landmarks (cited in `tools/history/potsdam-landmarks.ts`) | towers, domes, gates | modelled part by part on their mapped footprints |

### The 1903 map as a filter and a guide

The Messtischblatt hatches every built-up block, houses and yards
alike, and leaves streets, squares and parks white. Blurring its ink
over a few metres and thresholding gives a mask of the town as built in
1903, georeferenced by the WMS request itself (pixels are linear in
lat/lon, and so in the local frame). It is used three ways:

1. **Undated buildings** from OSM are kept only if at least half their
   footprint is on the mask and they are not obviously post-war (five
   storeys or more, or a flat roof over three). That removes the
   post-war slabs on the bombed old town's blocks and the buildings on
   former squares.
2. **Streets** of today that run mostly over the mask are the roads cut
   through old blocks after the war, and are dropped; so are bridges
   with no bridge of 1900 near them.
3. **Lost frontage** inside the excise wall (the closely built town) is
   rebuilt: each block of the mask is traced, straightened, and its
   frontage cut into parcels of 10–16 m; a parcel is built unless a
   kept building, water, or a square or park of 1900 is there. The
   houses are plain townhouses of their time and place — two or three
   storeys, ridge along the street, gable or mansard roof. **They are
   not the houses that stood there**, which the map cannot tell; they
   are the right massing in the right place. The HUD marks them
   "lost · from the 1903 map".

### Hand-made knowledge

`tools/history/potsdam.ts` holds what no map says, each entry with its
reason: the town outline in which frontage is rebuilt (the excise
wall's line and the Havel bank), open squares no dataset outlines (the
Alter Markt), the Stadtkanal's width, street renamings OHM does not
cover, the spawn point. `tools/history/potsdam-landmarks.ts` models the
landmarks, with sources and with every estimated number marked as such.

### Known approximations

- Facades are drawn in the shader (window bays, doors, sills, cornice,
  plinth) from each wall's length and storey height, not from the real
  elevations; roofs follow the footprint's rectangle (or rise from every
  eave on irregular footprints), without dormers.
- Trees are today's trees from OSM.
- The ground is level; the Havel and the canal lie 1.6 m below it.
- Street paving is setts on carriageways and slabs on pavements
  everywhere.

## Pipeline

```sh
bun run fetch potsdam      # data/potsdam/{osm,ohm}.json and mtb1903.png (network)
bun run city potsdam       # src/cities/potsdam/city.json (no network)
bun run check              # tsc: app, tests, tools
bun run test               # vitest
node tools/shot.ts OUT 'name=#x=…&z=…&yaw=…&pitch=…&t=…[&y=…][|KeyM]'   # screenshots (headless Firefox)
```

The reduced map data and the map raster are committed, so building the
city never needs the network. To add a city: a `CitySpec` in
`tools/cities.ts` (bounding box, origin, year, historical map WMS) and a
`History` in `tools/history/`.

## Credits

Map data © OpenStreetMap contributors (ODbL). Historical map data:
OpenHistoricalMap contributors (CC0). Messtischblatt 3544/3644 (1903):
© Staatsbibliothek zu Berlin – Preußischer Kulturbesitz, dl-de/by-2-0,
via Landesvermessung und Geobasisinformation Brandenburg (data changed:
read as a built-up mask, shown sepia).
