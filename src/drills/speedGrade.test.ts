import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _setStorage, loadStats } from '../store/persist';
import { DEFAULT_RULES } from '../engine/ruleset';
import { generateAllCells } from './flashcards';
import { drawSpeedQuestion } from './speedDrill';
import { gradeSpeedAnswer } from './speedGrade';
import { loadFlashSr, loadQuizSr } from './gradeAnswer';
import { BLIND_TAP_CHANNEL } from './spacedRepetition';

const NOW = 1_700_000_000_000;
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  _setStorage(ls);
  // The SR decks read window.localStorage directly; same map, so one check sees both.
  vi.stubGlobal('window', { localStorage: ls });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const H17 = { ...DEFAULT_RULES };
const chart = { ids: generateAllCells().map((c) => c.id), weights: null };

describe('D-R9: Speed records only misses', () => {
  it('a correct answer writes nothing to Stats or either review deck', () => {
    const q = drawSpeedQuestion('double', chart, H17, 11)!;
    expect(gradeSpeedAnswer(q, q.answer, 900, NOW)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('a miss is tallied wrong on its cell and lapses its flashcard review', () => {
    const q = drawSpeedQuestion('double', chart, H17, 11)!;
    const e = gradeSpeedAnswer(q, !q.answer, 900, NOW, BLIND_TAP_CHANNEL)!;
    expect(e.correct).toBe(false);
    expect(e.elapsedMs).toBeUndefined();
    const cell = loadStats().cellStats?.[q.cellId];
    expect(cell).toMatchObject({ right: 0, wrong: 1 });
    expect(loadFlashSr()[q.cellId]).toBeDefined();
    expect(loadStats().latencyHistory ?? []).toHaveLength(0);
  });

  it('a deviation miss is reviewed in the quiz deck under its index', () => {
    let q = null;
    for (let seed = 1; seed < 500 && !q?.deviationId; seed++) {
      q = drawSpeedQuestion('deviation', { ids: ['hard-12-v-3'], weights: null }, H17, seed);
    }
    expect(q?.deviationId).toBeTruthy();
    gradeSpeedAnswer(q!, !q!.answer, 900, NOW);
    expect(loadQuizSr()[q!.deviationId!]).toBeDefined();
    expect(loadFlashSr()[q!.cellId]).toBeUndefined();
  });
});
