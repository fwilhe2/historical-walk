/* The city as the app loads it: everything in metres in a local
   frame, x east and z south (three's convention, so −z is north),
   origin at the city's chosen centre. Written by tools/build-city.ts
   into src/cities/<id>/city.json; nothing here is computed at run
   time from lat/lon.

   Rings are flat [x0, z0, x1, z1, …] arrays, not closed (the last
   point is not repeated). Outer rings have positive area by
   geom/poly.ts's area(), which is clockwise on a north-up map (and
   seen from above); holes run the other way. */
export type Ring = number[];

export type RoofShape = 'flat' | 'gabled' | 'hipped' | 'mansard' | 'pyramidal' | 'dome' | 'spire' | 'half-hipped';

// Where a building's footprint came from, so the HUD and the docs
// can say how much of what you see is surveyed and how much inferred.
export type Source =
  | 'osm'        // standing today, mapped in OpenStreetMap, dated or inside the 1903 built-up area
  | 'ohm'        // lost, footprint from OpenHistoricalMap with its dates
  | 'mtb'        // lost, frontage reconstructed from the 1903 Messtischblatt's built-up block
  | 'model';     // a landmark modelled part by part from its description (tools/history/)

export interface Building {
  id: string;
  src: Source;
  outer: Ring;
  holes?: Ring[];
  base?: number;          // m above ground where the walls start (arcades, building:min_level)
  eave: number;           // wall height to the eaves, m
  roofH: number;          // ridge above eaves, m
  roof: RoofShape;
  ridge?: number;         // ridge bearing, radians from +x; absent = the footprint's long axis
  storey: number;         // m per storey, drives the window rows
  colour: string;         // facade, #rrggbb
  roofColour: string;
  name?: string;
  addr?: string;
  year?: number;          // built (start_date), when known
  kind?: 'church' | 'palace' | 'gate' | 'house' | 'shed' | 'public' | 'colonnade';
  // Facade drawing: the default is plastered with windows; 'brick'
  // shows coursed brick (the Dutch Quarter, St. Peter und Paul),
  // 'stone' ashlar joints, 'copper' plain green sheet (lanterns).
  wall?: 'plaster' | 'brick' | 'stone' | 'copper';
  windows?: false;        // blank walls (sheds, the city wall's gates, colonnades)
  ornate?: true;          // pilasters between the bays and a central risalit (baroque and classicist facades)
}

export type AreaKind = 'water' | 'park' | 'grass' | 'square' | 'garden' | 'yard' | 'sand' | 'cemetery' | 'rail' | 'wood';
export interface Area { kind: AreaKind; outer: Ring; holes?: Ring[]; name?: string }

export type StreetKind = 'main' | 'street' | 'lane' | 'path' | 'bridge' | 'footbridge';
export interface Street { kind: StreetKind; name?: string; w: number; pts: Ring; paving: 'cobble' | 'sett' | 'gravel' | 'earth' | 'plank' }

export interface Wall { pts: Ring; h: number; t: number; kind: 'city' | 'garden' | 'railing' | 'parapet'; base?: number }
export interface Rail { pts: Ring; kind: 'rail' | 'tram' }
export interface Tree { x: number; z: number; h: number; r: number }
// A column: a shaft of radius r from base to base + h, with a plinth
// and a capital; porticos, colonnades and the drums of domes.
export interface Column { x: number; z: number; r: number; h: number; base: number }
// A gas lantern on its post, on the pavement's kerb side.
export interface Lamp { x: number; z: number }
export interface Label { x: number; z: number; text: string; kind: 'landmark' | 'street' | 'square'; about?: string; r?: number }

export interface City {
  id: string;
  name: string;
  year: number;
  origin: [number, number];                        // lat, lon of (0, 0)
  bounds: [number, number, number, number];        // minX, minZ, maxX, maxZ
  // The land round the town, coarsely (water, woods, the royal parks),
  // over regionBounds; drawn beyond `bounds` only.
  region: Area[];
  regionBounds: [number, number, number, number];
  // The ground's height above the town's level on a grid (city/terrain.ts):
  // decimetres as base64 little-endian Int16, row by row from (x0, z0).
  terrain?: { x0: number; z0: number; step: number; nx: number; nz: number; dm: string };
  spawn: { x: number; z: number; yaw: number };
  buildings: Building[];
  areas: Area[];
  streets: Street[];
  walls: Wall[];
  rails: Rail[];
  trees: Tree[];
  columns: Column[];
  lamps: Lamp[];
  labels: Label[];
  water: number;                                    // the Havel's level, m (negative: below the streets)
  credits: string[];
}
