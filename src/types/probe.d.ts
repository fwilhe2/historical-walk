// The probe handle main.ts installs under ?probe, driven by tools/shot.ts.
interface Window { hw?: { go(hash: string): Promise<void>; frames(n: number): Promise<void> } }
