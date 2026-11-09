import { describe, expect, it } from 'vitest';
import charts from '../screens/Charts.tsx?raw';
import rulesChip from '../components/RulesChip.tsx?raw';
import profileEditor from '../screens/ProfileEditor.tsx?raw';
import trueCount from '../screens/drills/TrueCountDrillView.tsx?raw';
import produceTc from '../screens/drills/ProduceTcDrillView.tsx?raw';
import deckEst from '../screens/drills/DeckEstimationView.tsx?raw';
import indexTest from '../screens/drills/IndexTestView.tsx?raw';
import sideCount from '../screens/drills/SideCountDrillView.tsx?raw';
import countDrill from '../screens/drills/CountDrillView.tsx?raw';
import betSizing from '../screens/drills/BetSizingView.tsx?raw';
import { TERMS } from './terms';

/**
 * T2-2B: where the glossary is wired. A source check, so a refactor that
 * drops a screen's Term fails here rather than silently.
 */
const WIRED: Record<string, string> = {
  'Charts.tsx': charts,
  'RulesChip.tsx': rulesChip,
  'ProfileEditor.tsx': profileEditor,
  'TrueCountDrillView.tsx': trueCount,
  'ProduceTcDrillView.tsx': produceTc,
  'DeckEstimationView.tsx': deckEst,
  'IndexTestView.tsx': indexTest,
  'SideCountDrillView.tsx': sideCount,
  'CountDrillView.tsx': countDrill,
};

describe('glossary wiring', () => {
  it.each(Object.entries(WIRED))('%s renders a Term', (_name, src) => {
    expect(src).toMatch(/<Term\b/);
  });

  it('every literal Term id in the wired screens is a real term', () => {
    for (const [name, src] of Object.entries(WIRED)) {
      for (const m of src.matchAll(/<Term id="([^"]+)"/g)) expect(TERMS, `${name}: ${m[1]}`).toHaveProperty(m[1]);
      for (const m of src.matchAll(/\bterm="([^"]+)"/g)) expect(TERMS, `${name}: ${m[1]}`).toHaveProperty(m[1]);
    }
  });

  it('Bet sizing is left to its own track (no Term there)', () => {
    expect(betSizing).not.toMatch(/<Term\b/);
  });

  it("ProfileEditor's $ per unit row stays as it was (another track adds a row under it)", () => {
    const lines = profileEditor.split(/\r?\n/).map((l) => l.trim());
    const at = lines.indexOf('label="$ per unit"');
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toBe('value={draft.unitDollars}');
  });
});
