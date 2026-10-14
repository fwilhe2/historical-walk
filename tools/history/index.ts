/* Hand-made knowledge per city: what the map data cannot say on its
   own. Every entry should carry a comment with its reason or source. */
import type { Building } from '../../src/city/types.ts';
import { POTSDAM } from './potsdam.ts';

export interface History {
  name: string;
  spawn: { lat: number; lon: number; yaw: number };   // yaw: radians, 0 = looking north, positive turns left (west)
  water: number;
  credits: string[];
  drop: Set<string>;                                 // feature ids ('w123', 'ohm:r456') never to draw
  patch: Record<string, Partial<Building>>;          // corrections by building id
}

export const HISTORY: Record<string, History> = { potsdam: POTSDAM };
