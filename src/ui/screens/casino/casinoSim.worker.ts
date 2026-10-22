import { runGame, type RunPrior, type RunProgress } from '../../../engine/casinoRun';
import type { SimSpec } from '../../../engine/casinoSim';

/**
 * Wave K: the casino simulator off the main thread. One message in (a game's
 * spec), a progress message after every chunk, a final one at the end.
 * Cancel is the page terminating this worker; the page keeps the last
 * progress it was sent. Wave Q: the page sends the next request to the same
 * worker once a run ends, and a request can continue an earlier run (`prior`).
 */

export interface SimRequest {
  spec: SimSpec;
  seed: number;
  /** The counted simulation's seed (casinoRun.ts `RunOptions.countSeed`). */
  countSeed?: number;
  /** The cap on the total time, the prior run's included. */
  timeCapMs: number;
  maxRounds?: number;
  /** Rounds one exit costs, for the stopping rule (casinoRun.ts `RunOptions.exitRounds`). */
  exitRounds?: number;
  /** Wave Q: the run this one continues (casinoRun.ts `RunPrior`). */
  prior?: RunPrior;
}

export type SimMessage = { type: 'progress'; progress: RunProgress } | { type: 'done'; progress: RunProgress } | { type: 'error'; message: string };

// Typed by hand: the app's lib is the DOM's, and pulling in the WebWorker lib
// beside it redeclares half of it.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SimRequest>) => void) | null;
  postMessage: (msg: SimMessage) => void;
};

ctx.onmessage = (e: MessageEvent<SimRequest>) => {
  const { spec, seed, countSeed, timeCapMs, maxRounds, exitRounds, prior } = e.data;
  try {
    const run = runGame(spec, { seed, countSeed, timeCapMs, maxRounds, exitRounds, prior, now: () => performance.now() });
    for (;;) {
      const step = run.next();
      ctx.postMessage({ type: step.done ? 'done' : 'progress', progress: step.value } satisfies SimMessage);
      if (step.done) break;
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies SimMessage);
  }
};
