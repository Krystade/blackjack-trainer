import { useMemo, useRef, useState } from 'react';
import { mulberry32 } from '../../../engine/cards';
import { NO_REDEALS, afterRedealAnswer, afterRedealDeal, planRedealDraw } from '../../../drills/learningRedeal';
import type { RedealPlan, RedealQueue } from '../../../drills/learningRedeal';

/**
 * E2 (W2-2): one hand drill's learning-step re-deals for the session
 * (drills/learningRedeal.ts), plus the last item answered, which
 * `ReviewContext.repeat` needs. Refs, because a draw or a grade can run from
 * a timer, the wheel or voice holding an older render's closure, and a stale
 * queue would deal the wrong card.
 */
export interface LearningRedeal {
  /** What the next draw from `poolIds` must do. */
  plan: (poolIds: readonly string[]) => RedealPlan;
  /** `key` was dealt: its slot is spent and every other slot is a card nearer. */
  dealt: (key: string) => void;
  /** True when the last answer was to `key` too, with no other card between. */
  isRepeat: (key: string) => boolean;
  /** An answer to `key` (`null`: an item with no schedule, a distractor). A miss books a re-deal. */
  answered: (key: string | null, correct: boolean, poolSize: number) => void;
  /** #22 "Wrong tap": the withdrawn miss is not dealt again. */
  withdraw: (key: string) => void;
}

export function useLearningRedeal(): LearningRedeal {
  const queueRef = useRef<RedealQueue>(NO_REDEALS);
  const lastRef = useRef<string | null>(null);
  const [rng] = useState(() => mulberry32(Math.floor(Math.random() * 1_000_000_000)));
  return useMemo(
    () => ({
      plan: (poolIds) => planRedealDraw(queueRef.current, poolIds),
      dealt: (key) => {
        queueRef.current = afterRedealDeal(queueRef.current, key);
      },
      isRepeat: (key) => lastRef.current === key,
      answered: (key, correct, poolSize) => {
        lastRef.current = key;
        if (key !== null) queueRef.current = afterRedealAnswer(queueRef.current, key, correct, poolSize, rng);
      },
      withdraw: (key) => {
        queueRef.current = queueRef.current.filter((s) => s.key !== key);
      },
    }),
    [rng],
  );
}
