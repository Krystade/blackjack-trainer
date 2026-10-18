import { describe, expect, it } from 'vitest';
import { CHIME_ACTIVITY_MS, chimeContourForTest, chimeEarconForTest, type ChimeKind } from './speech';
import { earconDurationMs, earconSamples, type Earcon } from './tone';

const KINDS: readonly ChimeKind[] = ['good', 'bad', 'attention', 'mark', 'blocked', 'ready', 'turn', 'heard', 'again'];
/** The only two kinds allowed to SOUND negative: a wrong answer and a refused tap. */
const NEGATIVE: ReadonlySet<ChimeKind> = new Set(['bad', 'blocked']);
const POSITIVE = KINDS.filter((k) => !NEGATIVE.has(k));

/** Upward zero crossings in [from, to): a pitch estimate for a pure tone. */
function crossings(s: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = Math.max(1, from); i < to; i++) if (s[i - 1]! < 0 && s[i]! >= 0) n++;
  return n;
}

/** Any odd partial above the fundamental (3rd, 5th, ...): the harsh "buzz". */
function hasOddPartials(e: Earcon): boolean {
  return (e.harmonics ?? [1]).some((amp, i) => i > 0 && (i + 1) % 2 === 1 && amp > 0);
}

/** Frequency ratio between two pitches, folded into one octave. */
function foldedRatio(a: number, b: number): number {
  let r = Math.max(a, b) / Math.min(a, b);
  while (r >= 2) r /= 2;
  return r;
}
/** A tritone: six semitones, the dissonant interval. */
const isTritone = (a: number, b: number) => Math.abs(foldedRatio(a, b) - Math.SQRT2) < 0.03;

/**
 * 2026-10-18, Jack from the car: "A low tone seems to play to indicate the
 * wrong thing. One tone sounds like an incorrect tone when it isn't marking
 * that." What he heard as "incorrect" was "got it" (a lone low tone) and "say
 * again" (an octave fall). These pin down what a tone MEANS by its shape.
 */
describe('what each chime means, by its shape', () => {
  it.each(POSITIVE)('%s never falls: no glide down, no note starting below the last, ends at or above its start', (kind) => {
    const e = chimeEarconForTest(kind);
    for (const n of e.notes) expect(n.endHz ?? n.hz, `${kind} glides down`).toBeGreaterThanOrEqual(n.hz);
    // Against the previous note's START: a gesture repeated after a gap
    // ("say again" is the rising glide twice) is a repetition, not a fall.
    for (let i = 1; i < e.notes.length; i++) {
      expect(e.notes[i]!.hz, `${kind} steps down`).toBeGreaterThanOrEqual(e.notes[i - 1]!.hz);
    }
    const [start, end] = chimeContourForTest(kind);
    expect(end).toBeGreaterThanOrEqual(start);
  });

  it.each(POSITIVE)('%s has no buzz and no dissonant interval', (kind) => {
    const e = chimeEarconForTest(kind);
    expect(hasOddPartials(e), `${kind} sounds harsh`).toBe(false);
    for (let i = 1; i < e.notes.length; i++) {
      expect(isTritone(e.notes[i - 1]!.endHz ?? e.notes[i - 1]!.hz, e.notes[i]!.hz), `${kind} uses a tritone`).toBe(false);
    }
  });

  it.each(POSITIVE)('%s sits in the 500-2000Hz band a phone speaker reproduces', (kind) => {
    for (const n of chimeEarconForTest(kind).notes) {
      for (const hz of [n.hz, n.endHz ?? n.hz]) {
        expect(hz).toBeGreaterThanOrEqual(500);
        expect(hz).toBeLessThanOrEqual(2000);
      }
    }
  });

  it('only "wrong" and "refused" sound negative: they buzz, and "wrong" falls a tritone', () => {
    for (const kind of NEGATIVE) expect(hasOddPartials(chimeEarconForTest(kind)), kind).toBe(true);
    const bad = chimeEarconForTest('bad').notes;
    expect(bad.length).toBe(2);
    expect(bad[1]!.hz).toBeLessThan(bad[0]!.hz);
    expect(isTritone(bad[0]!.hz, bad[1]!.hz)).toBe(true);
  });

  it('the low negative tones are never a bare low sine (110/220Hz was inaudible on a phone)', () => {
    for (const kind of KINDS) {
      const e = chimeEarconForTest(kind);
      for (const n of e.notes) {
        expect(n.hz, `${kind} below 300Hz`).toBeGreaterThanOrEqual(300);
        // Below 500Hz the energy has to come from partials in the speaker's band.
        if (n.hz < 500) expect((e.harmonics ?? [1]).filter((a) => a > 0).length, `${kind} is a bare low sine`).toBeGreaterThan(2);
      }
    }
  });

  it('"speak now" (ready, turn) and "say again" rise across the tone', () => {
    for (const kind of ['ready', 'turn', 'again'] as const) {
      const e = chimeEarconForTest(kind);
      const first = e.notes[0]!;
      const last = e.notes[e.notes.length - 1]!;
      expect(Math.max(last.endHz ?? last.hz, last.hz), `${kind} does not rise`).toBeGreaterThan(first.hz * 1.15);
    }
  });

  it('"got it" is a short, high, neutral tick: not the lowest-but-one tone it used to be', () => {
    const heard = chimeEarconForTest('heard');
    expect(heard.notes.length).toBe(1);
    expect(earconDurationMs(heard)).toBeLessThanOrEqual(80);
    // Above every "speak now" pitch and far above anything negative.
    for (const kind of ['ready', 'turn', 'bad', 'blocked'] as const) {
      for (const n of chimeEarconForTest(kind).notes) expect(heard.notes[0]!.hz).toBeGreaterThan(n.endHz ?? n.hz);
    }
  });

  it('"say again" is a re-prompt, not a verdict: unlike "wrong" in contour, timbre and pitch', () => {
    const again = chimeEarconForTest('again');
    const bad = chimeEarconForTest('bad');
    expect(hasOddPartials(again)).toBe(false);
    const [aStart, aEnd] = chimeContourForTest('again');
    const [bStart, bEnd] = chimeContourForTest('bad');
    expect(aEnd).toBeGreaterThan(aStart);
    expect(bEnd).toBeLessThan(bStart);
    expect(again.notes[0]!.hz).toBeGreaterThan(bad.notes[0]!.hz);
    // And unlike "your turn" in note count: the same gesture, twice.
    expect(again.notes.length).toBeGreaterThan(chimeEarconForTest('turn').notes.length);
  });

  it('every chime is short: under the deaf window it opens on the microphone', () => {
    for (const kind of KINDS) {
      const ms = earconDurationMs(chimeEarconForTest(kind));
      expect(ms, kind).toBeGreaterThanOrEqual(40);
      expect(ms, kind).toBeLessThan(CHIME_ACTIVITY_MS);
    }
  });
});

/**
 * Brewster: earcons are told apart by rhythm, note count and timbre before
 * pitch. Two kinds with the same shape could be told apart only by absolute
 * pitch, which nobody has at 70mph.
 */
describe('no two chimes share a shape', () => {
  const shape = (kind: ChimeKind): string => {
    const e = chimeEarconForTest(kind);
    const glide = e.notes.map((n) => Math.sign((n.endHz ?? n.hz) - n.hz)).join(',');
    const steps = e.notes.slice(1).map((n, i) => Math.sign(n.hz - (e.notes[i]!.endHz ?? e.notes[i]!.hz))).join(',');
    const h = e.harmonics ?? [1];
    const timbre = hasOddPartials(e) ? 'buzz' : h.some((a, i) => i > 0 && a > 0) ? 'bell' : 'pure';
    return `${e.notes.length}|${glide}|${steps}|${timbre}`;
  };

  it('note count, glide, step direction and timbre differ for every pair', () => {
    const seen = new Map<string, ChimeKind>();
    for (const kind of KINDS) {
      const s = shape(kind);
      expect(seen.get(s), `${kind} has the same shape as ${seen.get(s)}`).toBeUndefined();
      seen.set(s, kind);
    }
  });

  it('no two kinds are the same earcon', () => {
    const all = KINDS.map((k) => JSON.stringify(chimeEarconForTest(k)));
    expect(new Set(all).size).toBe(KINDS.length);
  });
});

describe('the synthesised samples follow the table', () => {
  it('a rising glide really rises (zero crossings speed up across the note)', () => {
    const s = earconSamples(chimeEarconForTest('turn'));
    const half = s.length >> 1;
    expect(crossings(s, half, s.length)).toBeGreaterThan(crossings(s, 0, half) * 1.15);
  });

  it('a multi-note earcon has silence between its notes, so the rhythm is audible', () => {
    const e = chimeEarconForTest('mark');
    const s = earconSamples(e);
    const first = Math.round((24_000 * e.notes[0]!.ms) / 1000);
    const gap = Math.round((24_000 * (e.notes[0]!.gapMs ?? 0)) / 1000);
    expect(gap).toBeGreaterThan(0);
    for (let i = first; i < first + gap; i++) expect(s[i]).toBe(0);
    expect(s.length).toBe(Math.round((24_000 * earconDurationMs(e)) / 1000));
  });

  it('harmonics never push the waveform past the peak', () => {
    for (const kind of KINDS) {
      const s = earconSamples(chimeEarconForTest(kind), 0.5);
      let max = 0;
      for (const v of s) max = Math.max(max, Math.abs(v));
      expect(max, kind).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(max, kind).toBeGreaterThan(0.2);
    }
  });
});
