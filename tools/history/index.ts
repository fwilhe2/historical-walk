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
  squares: { name: string; ring: number[] }[];
  canalWidth: Record<string, number>;               // m between quay walls, by OHM name
}

export const HISTORY: Record<string, History> = { potsdam: POTSDAM };
