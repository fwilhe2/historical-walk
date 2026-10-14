/* Hand-made knowledge per city: what the map data cannot say on its
   own. Every entry should carry a comment with its reason or source. */
import type { Building } from '../../src/city/types.ts';
import type { Landmark } from '../landmarks.ts';
import { POTSDAM } from './potsdam.ts';

export interface History {
  name: string;
  spawn: { x: number; z: number; yaw: number };       // local metres; yaw: radians, 0 = looking north, positive turns left (west)
  water: number;
  credits: string[];
  drop: Set<string>;                                 // feature ids ('w123', 'ohm:r456') never to draw
  patch: Record<string, Partial<Building>>;          // corrections by building id
  // The closely built town, in local metres: lost frontage inside it
  // is rebuilt as rows of houses from the historical map's blocks.
  // Outside (suburbs of villas and gardens) nothing is invented.
  town: number[];
  landmarks: Landmark[];
  // Open squares of the year that neither OSM nor OHM outline, as
  // local-metre rings; nothing is rebuilt on them.
  squares: { name: string; ring: number[]; kind?: 'square' | 'park' }[];
  canalWidth: Record<string, number>;               // m between quay walls, by OHM name
  rename: Record<string, string>;                    // today's street name → the year's, where OHM has none
  // Quarters destroyed and rebuilt to a new plan after the year: an
  // undated building in one is taken for a later one whatever it looks
  // like; dated survivors and landmarks stay.
  lost: { name: string; ring: number[] }[];
  about: Record<string, string>;
  regionParks: string[];
  centre: [number, number, number];
  bells: { hours?: string; quarters?: string };
  mapCaption?: string;
  shopStreets: string[];                             // streets (names of the year) whose houses had shops below                             // parks of today that were parks in the year, by name                     // HUD text for named buildings that are not modelled landmarks
}

export const HISTORY: Record<string, History> = { potsdam: POTSDAM };
