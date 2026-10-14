// earcut 3.0.1 ships no types of its own.
declare module 'earcut' {
  export default function earcut(data: ArrayLike<number>, holeIndices?: ArrayLike<number> | null, dim?: number): number[];
}
