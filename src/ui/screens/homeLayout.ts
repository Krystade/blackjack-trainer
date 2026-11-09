import { rungDone, type Ladder } from './nextStep';
import type { Onboarding } from '../../store/onboarding';

/**
 * Track 1 (1C): Home's blocks, in order. Pure, so the no-data Home cannot
 * leak a streak card or a backup nudge without a test failing.
 *
 * - No practice yet: the welcome (until answered), a line on what the app
 *   does, the ladder, the guided card, Play a shoe, the All stats link (the
 *   way into Stats does not move when data arrives), the build line. Streak,
 *   backup nudge, readiness and the switch nudge wait for the first answer.
 * - With practice: today's Home. The guided card sits below the ladder until
 *   basic strategy is passed or skipped, above it after.
 */
export type HomeBlock = 'welcome' | 'intro' | 'streak' | 'guided' | 'ladder' | 'suggest' | 'backup' | 'readiness' | 'play' | 'statsLink' | 'build';

export function homeLayout(hasData: boolean, ladder: Pick<Ladder, 'rungs'>, onboarding: Pick<Onboarding, 'welcome'>): HomeBlock[] {
  if (!hasData) {
    return [...(onboarding.welcome ? [] : (['welcome'] as const)), 'intro', 'ladder', 'guided', 'play', 'statsLink', 'build'];
  }
  const basic = ladder.rungs.find((r) => r.id === 'basic');
  const basicDone = basic !== undefined && rungDone(basic);
  return [
    'streak',
    ...(basicDone ? (['guided', 'ladder'] as const) : (['ladder', 'guided'] as const)),
    'suggest',
    'backup',
    'readiness',
    'play',
    'build',
  ];
}
