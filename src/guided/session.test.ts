import { describe, expect, it } from 'vitest';
import type { PlannedSegment } from './plan';
import {
  addTally,
  begin,
  capMs,
  countsAsCompleted,
  endEarly,
  endsOnAnswer,
  finishSegment,
  isResumable,
  RESUME_GRACE_MS,
  newSession,
  pause,
  resume,
  summarize,
  TIME_GRACE_MS,
  toRecord,
  verdictOnTick,
  withActiveMs,
  type GuidedSession,
} from './session';

const answersSeg = (n: number, minutes = 2): PlannedSegment => ({ id: 'warmup', minutes, target: { kind: 'answers', n }, weak: false, cells: [] });
const timeSeg = (min: number): PlannedSegment => ({ id: 'count', minutes: min, target: { kind: 'time', ms: min * 60_000 }, weak: false });
const prog = (answers: number, right = answers) => ({ answers, right, activeMs: 0 });

const PLAN: PlannedSegment[] = [
  answersSeg(10),
  { id: 'speed', minutes: 2, target: { kind: 'answers', n: 20 }, weak: false },
  timeSeg(3),
];

const running = (): GuidedSession => begin(newSession(15, false, PLAN, 1000, '2026-10-22'));

describe('segment ends', () => {
  it('an answer target ends on reaching it', () => {
    expect(endsOnAnswer(answersSeg(10), prog(9), 0)).toBe(false);
    expect(endsOnAnswer(answersSeg(10), prog(10), 0)).toBe(true);
  });

  it('a time target ends on the first answer once the time is up, never on the clock alone', () => {
    const seg = timeSeg(3);
    expect(endsOnAnswer(seg, prog(2), 3 * 60_000 - 1)).toBe(false);
    expect(endsOnAnswer(seg, prog(3), 3 * 60_000)).toBe(true);
    expect(endsOnAnswer(seg, prog(0), 10 * 60_000)).toBe(false);
    expect(verdictOnTick(seg, prog(2), 3 * 60_000 + 1)).toBe('continue');
  });

  it('caps: a time segment ends a minute past its time, an answer segment at 2.5x its minutes', () => {
    expect(capMs(timeSeg(3))).toBe(3 * 60_000 + TIME_GRACE_MS);
    expect(capMs(answersSeg(10, 2))).toBe(5 * 60_000);
    expect(verdictOnTick(timeSeg(3), prog(1), capMs(timeSeg(3)))).toBe('end');
    expect(verdictOnTick(answersSeg(10, 2), prog(4), 5 * 60_000 - 1)).toBe('continue');
    expect(verdictOnTick(answersSeg(10, 2), prog(4), 5 * 60_000)).toBe('end');
  });

  it('never mid-run: a count run in progress is neither cut off at the cap nor called idle', () => {
    const seg = timeSeg(1);
    // Answered before, past the cap, a run in progress: it finishes first.
    expect(verdictOnTick(seg, prog(2), capMs(seg) + 30_000, true)).toBe('continue');
    expect(verdictOnTick(seg, prog(2), capMs(seg) + 30_000, false)).toBe('end');
    // A first run longer than the cap: being dealt (or answered), not idle.
    expect(verdictOnTick(seg, prog(0), capMs(seg) + 30_000, true)).toBe('continue');
    expect(verdictOnTick(seg, prog(0), capMs(seg) + 30_000, false)).toBe('idle');
  });

  it('nothing answered by the cap: idle (the host pauses), not end', () => {
    expect(verdictOnTick(timeSeg(3), prog(0), capMs(timeSeg(3)))).toBe('idle');
    expect(verdictOnTick(answersSeg(10), prog(0), 10 * 60_000)).toBe('idle');
  });
});

describe('advancement', () => {
  it('answers go to the running segment only', () => {
    let s = running();
    s = addTally(s, { answers: 2, right: 1 });
    expect(s.progress[0]).toMatchObject({ answers: 2, right: 1 });
    expect(addTally(pause(s), { answers: 5, right: 5 }).progress[0]).toMatchObject({ answers: 2, right: 1 });
    // An undo cannot take a segment below zero, nor right above answers.
    s = addTally(s, { answers: -3, right: -1 });
    expect(s.progress[0]).toMatchObject({ answers: 0, right: 0 });
  });

  it('finishing moves to the next transition, then to the summary after the last', () => {
    let s = running();
    s = finishSegment(s);
    expect(s).toMatchObject({ index: 1, phase: 'intro' });
    expect(s.progress[0]!.done).toBe(true);
    s = finishSegment(begin(s), true);
    expect(s.progress[1]).toMatchObject({ done: true, skipped: true });
    s = finishSegment(begin(s));
    expect(s).toMatchObject({ phase: 'done', outcome: 'completed', index: 2 });
    expect(finishSegment(s)).toBe(s);
  });

  it('pause and resume: resume re-enters the segment through its transition', () => {
    const s = pause(withActiveMs(running(), 4000));
    expect(s.phase).toBe('paused');
    const r = resume(s);
    expect(r.phase).toBe('intro');
    expect(r.progress[0]!.activeMs).toBe(4000);
    expect(resume(running())).toMatchObject({ phase: 'running' });
  });

  it('a resume restarts the cap and idle clocks: an idled segment runs again, not re-pauses', () => {
    const seg = timeSeg(3);
    const s0 = begin(newSession(15, false, [seg], 1000, '2026-10-22'));
    // Idled: past the cap with nothing answered.
    const idled = withActiveMs(s0, capMs(seg) + 500);
    expect(verdictOnTick(seg, idled.progress[0]!, capMs(seg) + 500)).toBe('idle');
    const back = begin(resume(pause(idled)));
    const p = back.progress[0]!;
    // The tick straight after the resume, and most of a cap later: still running.
    expect(verdictOnTick(seg, p, capMs(seg) + 1500)).toBe('continue');
    expect(verdictOnTick(seg, p, 2 * capMs(seg))).toBe('continue');
    // A whole fresh cap with nothing answered: idle again.
    expect(verdictOnTick(seg, p, 2 * capMs(seg) + 500)).toBe('idle');
    // Answered since the resume: the cap ends it.
    const answered = addTally(back, { answers: 1, right: 1 }).progress[0]!;
    expect(verdictOnTick(seg, answered, 2 * capMs(seg) + 500)).toBe('end');
  });

  it('answers from before the resume do not count in the new window', () => {
    const seg = answersSeg(10, 2);
    let s = addTally(running(), { answers: 4, right: 4 });
    s = begin(resume(pause(withActiveMs(s, 60_000))));
    expect(verdictOnTick(seg, s.progress[0]!, 60_000 + capMs(seg))).toBe('idle');
  });

  it('ending early is a summary with outcome ended, which earns no guided credit', () => {
    const s = endEarly(addTally(running(), { answers: 5, right: 5 }));
    expect(s).toMatchObject({ phase: 'done', outcome: 'ended' });
    expect(countsAsCompleted(s)).toBe(false);
  });

  it('completed needs answers in at least half the segments', () => {
    let s = running();
    s = finishSegment(begin(finishSegment(s, true)), true);
    s = finishSegment(addTally(begin(s), { answers: 3, right: 3 }));
    expect(s.outcome).toBe('completed');
    expect(countsAsCompleted(s)).toBe(false); // 1 of 3
    let t = addTally(running(), { answers: 3, right: 2 });
    t = finishSegment(t);
    t = finishSegment(addTally(begin(t), { answers: 1, right: 1 }));
    t = finishSegment(begin(t), true);
    expect(countsAsCompleted(t)).toBe(true); // 2 of 3
  });
});

describe('resume', () => {
  it('only an unfinished session from the same local day', () => {
    const s = running();
    expect(isResumable(s, '2026-10-22')).toBe(true);
    expect(isResumable(s, '2026-10-23')).toBe(false);
    expect(isResumable(endEarly(s), '2026-10-22')).toBe(false);
    expect(isResumable(null, '2026-10-22')).toBe(false);
  });

  it('B33: a session started at 23:50 still resumes at 00:05, but not the next evening', () => {
    const start = Date.parse('2026-10-23T06:50:00Z'); // 23:50 PDT on the 22nd
    const s = begin(newSession(15, true, PLAN, start, '2026-10-22'));
    expect(isResumable(s, '2026-10-23', start + 15 * 60_000)).toBe(true);
    expect(isResumable(s, '2026-10-23', start + 15 * 60_000 + RESUME_GRACE_MS - 1)).toBe(true);
    expect(isResumable(s, '2026-10-23', start + 15 * 60_000 + RESUME_GRACE_MS)).toBe(false);
    expect(isResumable(s, '2026-10-23', start + 20 * 60 * 60_000)).toBe(false);
    expect(isResumable(endEarly(s), '2026-10-23', start + 60_000)).toBe(false);
    // A clock that went backwards is not a resume.
    expect(isResumable(s, '2026-10-21', start - 60_000)).toBe(false);
  });
});

describe('summary', () => {
  it('per segment accuracy, best, and most improved against the last session', () => {
    let s = running();
    s = finishSegment(addTally(s, { answers: 10, right: 9 }));
    s = finishSegment(addTally(begin(s), { answers: 20, right: 12 }));
    s = finishSegment(addTally(begin(s), { answers: 4, right: 4 }));
    const last = { at: 500, preset: 15 as const, drive: false, rows: [{ id: 'warmup' as const, answers: 10, right: 7 }, { id: 'speed' as const, answers: 20, right: 14 }] };
    const sum = summarize(s, [last]);
    expect(sum.rows.map((r) => [r.id, r.pct, r.delta])).toEqual([
      ['warmup', 90, 20],
      ['speed', 60, -10],
      ['count', 100, null],
    ]);
    expect(sum).toMatchObject({ answers: 34, right: 25, best: 'count', improved: 'warmup' });
  });

  it('improvement under five points is not named; thin segments are not judged', () => {
    let s = running();
    s = finishSegment(addTally(s, { answers: 10, right: 8 }));
    s = finishSegment(addTally(begin(s), { answers: 2, right: 2 }));
    s = finishSegment(begin(s));
    const sum = summarize(s, [{ at: 1, preset: 15, drive: false, rows: [{ id: 'warmup', answers: 25, right: 19 }] }]);
    expect(sum.improved).toBeNull();
    expect(sum.best).toBe('warmup'); // speed's 100% is on 2 answers
    expect(sum.rows[2]!.pct).toBeNull();
  });

  it('a later session in the history is not "last time"', () => {
    const s = finishSegment(addTally(running(), { answers: 10, right: 10 }));
    const sum = summarize(s, [{ at: 99_999, preset: 15, drive: false, rows: [{ id: 'warmup', answers: 10, right: 1 }] }]);
    expect(sum.rows[0]!.delta).toBeNull();
  });

  it('toRecord keeps per-segment tallies', () => {
    const s = addTally(running(), { answers: 4, right: 3 });
    expect(toRecord(s).rows[0]).toEqual({ id: 'warmup', answers: 4, right: 3 });
  });
});
