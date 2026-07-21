// Barrel re-export for the audio module. Task 1 owns only the speech
// wrapper; later cycle-3 tasks (narrate.ts, wakeLock.ts, zones.ts) add
// their own re-exports here.
export * from './speech';
