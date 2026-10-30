import { describe, it, expect, afterEach, vi } from 'vitest';
import { PRESETS, PRESET_IDS, type VariantRules } from '../engine/variants/rules';
import { presetData } from '../engine/variants/strategy';
import { houseEdgePct } from '../engine/variants/houseEdge';
import { knownVariantEdge, loggedVariantRules, variantCostFor, variantEdgeFor, variantRulesSummary } from './casinoVariant';
import {
  _resetVariantEdges,
  _setVariantEdgeWorkerFactory,
  VARIANT_EDGE_TIMEOUT_MS,
  requestVariantEdge,
  retryVariantEdge,
  variantEdgeState,
} from './screens/casino/variantEdgeRunner';

/**
 * C22 follow-up: a variant game's house edge is worked out for its logged
 * rules (engine/variants ev.ts, the engine that made every preset's figure),
 * not taken from the preset. Rule effects are checked against named sources.
 */

const none = { decks: null, s17: null, das: null, surrender: null, payout: null, rsa: null, doubleSplitAces: null, maxSplitHands: null, doubleOn: null } as const;

describe('loggedVariantRules', () => {
  it.each(PRESET_IDS)('%s with nothing logged is the preset exactly', (id) => {
    expect(loggedVariantRules(none, id)).toEqual(PRESETS[id]);
  });

  it('takes each logged rule the engine plays', () => {
    const r = loggedVariantRules({ ...none, s17: true, das: false, surrender: true, payout: '6:5', rsa: false, maxSplitHands: 2, doubleOn: '10-11' }, 'freebet');
    expect(r).toMatchObject({ s17: true, das: false, ls: true, bjPays: 1.2, rsa: false, maxHands: 2, doubleOn: '10-11' });
    expect(loggedVariantRules({ ...none, doubleOn: 'any2' }, 'freebet').doubleOn).toBeUndefined();
    // A split ace that may not draw may still double, where logged.
    expect(loggedVariantRules({ ...none, doubleSplitAces: true }, 'freebet').doubleSplitAces).toBe(true);
    // Spanish 21 6:5 is played at 6:5 now.
    expect(loggedVariantRules({ ...none, payout: '6:5' }, 's21-h17').bjPays).toBe(1.2);
  });

  it('leaves alone what the variant fixes or the maths does not read', () => {
    // Switch pays a natural 1:1 by design; decks do not enter an infinite-deck figure.
    expect(loggedVariantRules({ ...none, payout: '3:2', decks: 8 }, 'switch')).toEqual(PRESETS.switch);
    // "No doubling on split aces" against Spanish 21's hit-and-double split aces is not "no drawing": left as the preset (the mismatch line says so).
    expect(loggedVariantRules({ ...none, doubleSplitAces: false }, 's21-h17')).toEqual(PRESETS['s21-h17']);
  });
});

describe('the edge is worked out for the logged rules', () => {
  it('a game logged as the preset takes the preset figure at once; Free Bet 6:5 its 6:5 figure', () => {
    expect(knownVariantEdge(PRESETS.freebet)).toBe(presetData('freebet').houseEdge);
    expect(knownVariantEdge({ ...PRESETS.freebet, bjPays: 1.2 })).toBe(presetData('freebet').houseEdge65);
    expect(knownVariantEdge({ ...PRESETS.freebet, s17: true })).toBeNull();
    expect(variantEdgeFor({ ...none, payout: '3:2' }, 'freebet')).toMatchObject({ edge: presetData('freebet').houseEdge, fromLogged: false });
  });

  it('Free Bet logged S17 / late surrender / no resplit aces move the edge by the published amounts', () => {
    // Source: wizardofodds.com/games/free-bet-blackjack/ "Rule Variants" (as ev.test.ts).
    const base = presetData('freebet').houseEdge;
    const at = (over: Partial<Parameters<typeof variantEdgeFor>[0]>) => {
      const e = variantEdgeFor({ ...none, ...over }, 'freebet', houseEdgePct);
      expect(e.fromLogged).toBe(true);
      return e.edge! - base;
    };
    expect(at({ s17: true })).toBeCloseTo(-0.31, 1);
    expect(at({ surrender: true })).toBeCloseTo(-0.21, 1);
    expect(at({ rsa: false })).toBeCloseTo(0.08, 1);
    // Before the fix the preset's edge was shown whatever was logged.
    expect(variantEdgeFor({ ...none, s17: true }, 'freebet', houseEdgePct).edge).not.toBe(base);
  });

  it('Spanish 21 H17 logged no surrender costs about the published 0.018%', () => {
    // Source: Wikipedia, Spanish 21 "Rule Changes": "No surrender (H17) | 0.018%" (published.ts PUBLISHED_S21_RULE_EFFECTS).
    const base = presetData('s21-h17').houseEdge;
    const e = variantEdgeFor({ ...none, surrender: false }, 's21-h17', houseEdgePct).edge!;
    expect(e - base).toBeGreaterThan(0);
    expect(e - base).toBeCloseTo(0.018, 1);
  });

  it('the cost adds the commission to the worked-out edge, and is unknown while it is worked out', () => {
    const fbS17 = houseEdgePct({ ...PRESETS.freebet, s17: true });
    expect(variantCostFor({ ...none, s17: true }, 'freebet', 'cardroom', houseEdgePct).total).toBeCloseTo(fbS17 + 1, 9);
    expect(variantCostFor({ ...none, s17: true }, 'freebet', 'cardroom', () => null)).toMatchObject({ edge: null, total: null, commissionPer100: 1 });
  });

  it('says the rules it used, the logged ones included', () => {
    const s = variantRulesSummary(loggedVariantRules({ ...none, s17: true, das: false, maxSplitHands: 2, rsa: false, doubleOn: '9-11' }, 'freebet'));
    expect(s).toContain('dealer stands soft 17');
    expect(s).toContain('no double after split');
    expect(s).toContain('split to 2 hands');
    expect(s).toContain('no resplitting aces');
    expect(s).toContain('double on 9-11 only');
    expect(variantRulesSummary(PRESETS.freebet)).toContain('split to 4 hands');
  });
});

/** A worker stand-in: answers each request on the next tick, by the engine, or fails. */
function fakeWorkers(fail = false): { made: number } {
  const counter = { made: 0 };
  _setVariantEdgeWorkerFactory(() => {
    counter.made += 1;
    const w = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null as ((e: ErrorEvent) => void) | null,
      terminate() {},
      postMessage(rules: VariantRules) {
        setTimeout(() => w.onmessage?.({ data: fail ? { type: 'error', message: 'boom' } : { type: 'done', edge: houseEdgePct(rules) } } as MessageEvent), 0);
      },
    };
    return w as unknown as Worker;
  });
  return counter;
}

describe('variantEdgeRunner', () => {
  afterEach(() => {
    _setVariantEdgeWorkerFactory(null);
    _resetVariantEdges();
  });

  it('works an edge out off the main thread once, then keeps it', async () => {
    const counter = fakeWorkers();
    const rules = { ...PRESETS.freebet, s17: true };
    expect(variantEdgeState(rules)).toEqual({ state: 'idle' });
    requestVariantEdge(rules);
    requestVariantEdge({ ...rules });
    expect(variantEdgeState(rules)).toEqual({ state: 'running' });
    await new Promise((r) => setTimeout(r, 5));
    expect(variantEdgeState(rules)).toEqual({ state: 'done', edge: houseEdgePct(rules) });
    requestVariantEdge(rules);
    expect(counter.made).toBe(1);
  });

  it('a failure is said, not retried', async () => {
    const counter = fakeWorkers(true);
    const rules = { ...PRESETS.freebet, rsa: false };
    requestVariantEdge(rules);
    await new Promise((r) => setTimeout(r, 5));
    expect(variantEdgeState(rules)).toEqual({ state: 'failed', message: 'boom' });
    requestVariantEdge(rules);
    expect(counter.made).toBe(1);
  });
});

/** R6: a worker that never answers until told to; records terminate(). */
function stuckWorkers(): { made: { terminated: boolean; answer: (edge: number) => void; error: (m: string) => void }[] } {
  const made: { terminated: boolean; answer: (edge: number) => void; error: (m: string) => void }[] = [];
  _setVariantEdgeWorkerFactory(() => {
    const w = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null as ((e: ErrorEvent) => void) | null,
      terminate() {
        rec.terminated = true;
      },
      postMessage() {},
    };
    const rec = {
      terminated: false,
      answer: (edge: number) => w.onmessage?.({ data: { type: 'done', edge } } as MessageEvent),
      error: (m: string) => w.onerror?.({ message: m } as ErrorEvent),
    };
    made.push(rec);
    return w as unknown as Worker;
  });
  return { made };
}

describe('variantEdgeRunner watchdog and retry (R6)', () => {
  afterEach(() => {
    vi.useRealTimers();
    _setVariantEdgeWorkerFactory(null);
    _resetVariantEdges();
  });

  it('a worker that never answers is stopped and the job failed, and the queue moves on', () => {
    vi.useFakeTimers();
    const { made } = stuckWorkers();
    const a = { ...PRESETS.freebet, s17: true };
    const b = { ...PRESETS.freebet, rsa: false };
    requestVariantEdge(a);
    requestVariantEdge(b);
    vi.advanceTimersByTime(VARIANT_EDGE_TIMEOUT_MS - 1);
    expect(variantEdgeState(a)).toEqual({ state: 'running' });
    vi.advanceTimersByTime(1);
    expect(variantEdgeState(a).state).toBe('failed');
    expect(made[0].terminated).toBe(true);
    expect(variantEdgeState(b)).toEqual({ state: 'running' });
    // A late answer from the stopped worker changes nothing.
    made[0].answer(1);
    expect(variantEdgeState(a).state).toBe('failed');
  });

  it('Switch gets longer before the watchdog fires', () => {
    vi.useFakeTimers();
    stuckWorkers();
    const sw = { ...PRESETS.switch, s17: true };
    requestVariantEdge(sw);
    vi.advanceTimersByTime(VARIANT_EDGE_TIMEOUT_MS);
    expect(variantEdgeState(sw)).toEqual({ state: 'running' });
    vi.advanceTimersByTime(VARIANT_EDGE_TIMEOUT_MS * 3);
    expect(variantEdgeState(sw).state).toBe('failed');
  });

  it('an answer in time clears the watchdog', () => {
    vi.useFakeTimers();
    const { made } = stuckWorkers();
    const a = { ...PRESETS.freebet, s17: true };
    requestVariantEdge(a);
    made[0].answer(0.5);
    vi.advanceTimersByTime(VARIANT_EDGE_TIMEOUT_MS * 5);
    expect(variantEdgeState(a)).toEqual({ state: 'done', edge: 0.5 });
  });

  it('after a timeout, an onerror or a factory throw, retry works it out again', () => {
    vi.useFakeTimers();
    const { made } = stuckWorkers();
    const a = { ...PRESETS.freebet, s17: true };
    requestVariantEdge(a);
    vi.advanceTimersByTime(VARIANT_EDGE_TIMEOUT_MS);
    retryVariantEdge(a);
    expect(variantEdgeState(a)).toEqual({ state: 'running' });
    made[1].error('crash');
    expect(variantEdgeState(a)).toEqual({ state: 'failed', message: 'crash' });
    retryVariantEdge(a);
    made[2].answer(0.7);
    expect(variantEdgeState(a)).toEqual({ state: 'done', edge: 0.7 });

    const b = { ...PRESETS.freebet, rsa: false };
    _setVariantEdgeWorkerFactory(() => {
      throw new Error('no workers');
    });
    requestVariantEdge(b);
    expect(variantEdgeState(b)).toEqual({ state: 'failed', message: 'no workers' });
    stuckWorkers();
    retryVariantEdge(b);
    expect(variantEdgeState(b)).toEqual({ state: 'running' });
    // Retry on a job that has not failed does nothing.
    retryVariantEdge(a);
    expect(variantEdgeState(a)).toEqual({ state: 'done', edge: 0.7 });
  });

  it('reset stops the worker in flight, and its late answer is not kept', () => {
    vi.useFakeTimers();
    const { made } = stuckWorkers();
    const a = { ...PRESETS.freebet, s17: true };
    requestVariantEdge(a);
    _resetVariantEdges();
    expect(made[0].terminated).toBe(true);
    made[0].answer(9);
    expect(variantEdgeState(a)).toEqual({ state: 'idle' });
    // The next job is not blocked by the old one, nor failed by its watchdog.
    const b = { ...PRESETS.freebet, rsa: false };
    requestVariantEdge(b);
    expect(variantEdgeState(b)).toEqual({ state: 'running' });
    vi.advanceTimersByTime(VARIANT_EDGE_TIMEOUT_MS - 1);
    expect(variantEdgeState(b)).toEqual({ state: 'running' });
  });
});
