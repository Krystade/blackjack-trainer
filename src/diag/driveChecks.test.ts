import { describe, it, expect } from 'vitest';
import { formatDiagnosticLog, type DiagEntry } from './diagnosticLog';
import {
  DC_LINES,
  DRIVE_CHECKS,
  DRIVE_CHECKS_CONTEXT,
  backPressesSince,
  countRunMechanicsOk,
  driveCountCards,
  driveTapEvidence,
  finalStartedFromCheckpoint,
  misheardEvidence,
  muteEvidence,
  queueEvidence,
  runningCountOf,
  summariseVoiceTiming,
  voiceTimingRows,
  voiceTimingStatus,
  voiceTimingFailWhy,
  pushToTalkWentLive,
  statusFromYes,
  type CountRunFacts,
} from './driveChecks';
import { driveChecksBlock } from './driveChecksReport';
import { SPEECH_TAIL_MS } from '../audio/voiceControl';

let ms = 0;
function e(category: DiagEntry['category'], event: string, detail?: Record<string, unknown>, session = 's1'): DiagEntry {
  ms += 10;
  return { at: new Date(ms).toISOString(), ms, session, category, event, detail };
}
const FROM = { session: 's1', ms: 0 };

describe('the catalogue', () => {
  it('numbers the ten checks 1..10 with only 9 and 10 parked', () => {
    expect(DRIVE_CHECKS.map((d) => d.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(DRIVE_CHECKS.filter((d) => d.parked).map((d) => d.n)).toEqual([9, 10]);
  });
});

describe('yes / no', () => {
  it('maps yes to pass, no to fail, no answer to skipped', () => {
    expect([statusFromYes('yes'), statusFromYes('no'), statusFromYes('skip')]).toEqual(['pass', 'fail', 'skipped']);
  });
});

describe('voice timing (D-R6 echo-timing lines)', () => {
  const timing = (since: number | null, ownWords: boolean, outcome: string, context = DRIVE_CHECKS_CONTEXT) =>
    e('mic', 'echo-timing', { sincePromptEndMs: since, ownWords, outcome, tailMs: SPEECH_TAIL_MS, context });

  it('reads only this screen, this page load, since the mark', () => {
    ms = 100;
    const before = timing(50, false, 'accepted');
    const mark = { session: 's1', ms: 150 };
    ms = 200;
    const rows = voiceTimingRows(
      [before, timing(300, false, 'suppressed'), timing(900, false, 'accepted', 'count-drill'), { ...timing(1, false, 'accepted'), session: 's2' }],
      mark,
    );
    expect(rows).toEqual([{ sincePromptEndMs: 300, ownWords: false, outcome: 'suppressed', tailMs: SPEECH_TAIL_MS }]);
  });

  it('summarises median and how many the post-speech tail suppressed', () => {
    ms = 0;
    const rows = voiceTimingRows(
      [
        timing(50, false, 'suppressed'), // inside the 100ms tail: counted
        timing(-100, true, 'suppressed'), // while speaking: suppressed but not by the tail
        timing(800, false, 'accepted'),
        timing(1200, false, 'accepted'),
      ],
      FROM,
    );
    const s = summariseVoiceTiming(rows);
    expect(s).toMatchObject({ answers: 4, medianMs: 425, accepted: 2, suppressed: 2, tailSuppressed: 1, ownWords: 1, tailMs: 100 });
    expect(s.rows).toBe('50/real/suppressed,-100/own/suppressed,800/real/accepted,1200/real/accepted');
  });

  it('fails when a real answer was thrown away', () => {
    const own = { sincePromptEndMs: 100, ownWords: true, outcome: 'suppressed', tailMs: 700 };
    const real = { sincePromptEndMs: 300, ownWords: false, outcome: 'accepted', tailMs: 700 };
    expect(voiceTimingStatus([])).toBe('skipped');
    expect(voiceTimingStatus([own, real])).toBe('pass');
    expect(voiceTimingStatus([{ sincePromptEndMs: 100, ownWords: false, outcome: 'suppressed', tailMs: 700 }, real])).toBe('fail');
  });

  it("A14: fails when none of the driver's answers arrived", () => {
    const own = { sincePromptEndMs: 100, ownWords: true, outcome: 'suppressed', tailMs: 700 };
    const rejected = { sincePromptEndMs: 400, ownWords: false, outcome: 'rejected', tailMs: 700 };
    expect(voiceTimingStatus([own])).toBe('fail');
    expect(voiceTimingFailWhy([own])).toBe('no-real-answer-accepted');
    expect(voiceTimingStatus([rejected, rejected])).toBe('fail');
    // The app accepting its own words is not the driver answering either.
    expect(voiceTimingStatus([{ ...own, outcome: 'accepted' }])).toBe('fail');
  });
});

describe('misheard escalation', () => {
  const miss = (step: string) => e('speak', 'misheard', { step, context: DRIVE_CHECKS_CONTEXT });
  const reaskSaid = (said: string) => e('test', 'drive-check-reask', { said });
  const tone = (kind: string) => e('speak', 'turn-cue', { kind });

  it('passes tone, re-ask with the bare question, then a tone', () => {
    ms = 0;
    const ev = misheardEvidence([miss('tone'), miss('reask'), reaskSaid(DC_LINES.misheardPrompt), tone('your-turn')], FROM, DC_LINES.misheardPrompt);
    expect(ev).toEqual({ steps: 'tone,reask', toneAfterReask: true, noHint: true, sequenceOk: true });
  });

  it('fails without the tone after the re-ask', () => {
    ms = 0;
    const ev = misheardEvidence([tone('your-turn'), miss('tone'), miss('reask'), reaskSaid(DC_LINES.misheardPrompt)], FROM, DC_LINES.misheardPrompt);
    expect(ev.toneAfterReask).toBe(false);
    expect(ev.sequenceOk).toBe(false);
  });

  it('fails when the re-ask carried a hint', () => {
    ms = 0;
    const ev = misheardEvidence([miss('tone'), miss('reask'), reaskSaid(`${DC_LINES.misheardPrompt} Hint: stand.`), tone('your-turn')], FROM, DC_LINES.misheardPrompt);
    expect(ev.noHint).toBe(false);
    expect(ev.sequenceOk).toBe(false);
  });

  it('fails when the re-ask came first', () => {
    ms = 0;
    expect(misheardEvidence([miss('reask'), reaskSaid(DC_LINES.misheardPrompt), tone('your-turn')], FROM, DC_LINES.misheardPrompt).sequenceOk).toBe(false);
  });
});

describe('log readers', () => {
  it('counts back presses that reached a handler', () => {
    ms = 0;
    const log = [
      e('wheel', 'dispatch', { command: 'back', handled: true }),
      e('wheel', 'dispatch', { command: 'back', handled: false }),
      e('wheel', 'dispatch', { command: 'forward', handled: true }),
    ];
    expect(backPressesSince(log, FROM)).toEqual({ dispatched: 2, handled: 1 });
  });

  it('reads the speech queue: second line queued, paths, nothing dropped', () => {
    ms = 0;
    const log = [
      e('speak', 'queued', { said: 'B' }),
      e('speak', 'path', { path: 'clip', said: 'A' }),
      e('speak', 'path', { path: 'tts', said: 'B' }),
    ];
    expect(queueEvidence(log, FROM, 'A', 'B')).toEqual({ secondQueued: true, dropped: false, firstPath: 'clip', secondPath: 'tts' });
    expect(queueEvidence([...log, e('speak', 'queue-dropped', { said: 'B' })], FROM, 'A', 'B').dropped).toBe(true);
  });

  it('reads mute: the queued line dropped rather than spoken', () => {
    ms = 0;
    expect(muteEvidence([e('speak', 'queue-dropped', { said: 'Q' })], FROM, 'Q')).toEqual({ queuedSpoke: false, queueDropped: true });
    expect(muteEvidence([e('speak', 'path', { said: 'Q', path: 'tts' })], FROM, 'Q').queuedSpoke).toBe(true);
  });

  it('times the voice and the microphone from the LAST Drive tap', () => {
    ms = 0;
    const log = [
      e('nav', 'eyes-free-on', { context: 'home-drive' }),
      e('speak', 'path', { said: 'old' }),
      e('nav', 'eyes-free-on', { context: 'home-drive' }), // ms 30
      e('speak', 'path-chosen', { said: 'Count drill.' }), // 40
      e('mic', 'session-start', {}), // 50
    ];
    expect(driveTapEvidence(log)).toMatchObject({ tapInLog: true, speechMs: 10, micMs: 20 });
    expect(driveTapEvidence([e('nav', 'eyes-free-on', { context: 'settings' })])).toEqual({ tapInLog: false, speechMs: null, micMs: null });
  });
});

describe('count run', () => {
  it('is seeded', () => {
    expect(driveCountCards(42)).toEqual(driveCountCards(42));
    expect(driveCountCards(42)).not.toEqual(driveCountCards(43));
    expect(runningCountOf([{ rank: '2', suit: 's' }, { rank: 'K', suit: 'h' }, { rank: '5', suit: 'd' }])).toBe(1);
  });

  const facts: CountRunFacts = {
    checkpointAnswer: 2,
    checkpointTruth: 2,
    paused: true,
    cardsWhilePaused: 0,
    resumedAt: 3,
    expectedResumeAt: 3,
    finalFirstProposal: 3,
    finalFirstDirection: 'forward',
    finalAnswer: 1,
    finalTruth: 1,
  };

  it('knows a final entry that started from the checkpoint answer', () => {
    expect(finalStartedFromCheckpoint(facts)).toBe(true);
    expect(finalStartedFromCheckpoint({ ...facts, finalFirstProposal: 1, finalFirstDirection: 'back' })).toBe(true);
    // Started from zero instead: the first forward press proposes one.
    expect(finalStartedFromCheckpoint({ ...facts, finalFirstProposal: 1 })).toBe(false);
  });

  it('needs pause held, resume at the next card, and the checkpoint origin', () => {
    expect(countRunMechanicsOk(facts)).toBe(true);
    expect(countRunMechanicsOk({ ...facts, paused: false })).toBe(false);
    expect(countRunMechanicsOk({ ...facts, cardsWhilePaused: 1 })).toBe(false);
    expect(countRunMechanicsOk({ ...facts, resumedAt: 4 })).toBe(false);
    expect(countRunMechanicsOk({ ...facts, finalFirstProposal: 1 })).toBe(false);
  });
});

describe('the export block', () => {
  const row = (run: string, check: string, n: number, status: string, extra: Record<string, unknown> = {}) =>
    e('test', 'drive-check', { run, check, n, status, ...extra });

  it('is absent when no check ever settled', () => {
    expect(driveChecksBlock([e('test', 'note', {})])).toEqual([]);
  });

  it('shows the latest run only, last result per check, in check order', () => {
    ms = 0;
    const block = driveChecksBlock([
      row('dc-old', 'voice-timing', 1, 'fail'),
      row('dc-old', 'talk-back', 3, 'fail'), // not re-run in the new run: must not appear
      row('dc-new', 'mute', 8, 'skipped'),
      row('dc-new', 'voice-timing', 1, 'pass', { medianMs: 820, tailSuppressed: 1, rows: '820/real/accepted' }),
      row('dc-new', 'mute', 8, 'pass', { answer: 'yes' }),
    ]);
    expect(block[0]).toBe('# --- drive-checks run=dc-new pass=2 fail=0 skipped=0 ---');
    expect(block[1]).toMatch(/^# {2}1 voice-timing {2}pass {4}medianMs=820 tailSuppressed=1 rows=820\/real\/accepted$/);
    expect(block[2]).toMatch(/^# {2}8 mute +pass +answer=yes$/);
    expect(block.at(-1)).toBe('# --- end drive-checks ---');
    expect(block).toHaveLength(4);
  });

  it('lands in the exported log, above the body', () => {
    ms = 0;
    const text = formatDiagnosticLog([e('test', 'note', {}), row('dc-x', 'speech-queue', 4, 'fail', { overlapOrCut: 'yes' })]);
    const lines = text.split('\n');
    const head = lines.indexOf('# --- drive-checks run=dc-x pass=0 fail=1 skipped=0 ---');
    expect(head).toBeGreaterThan(0);
    expect(lines[head + 1]).toMatch(/^# {2}4 speech-queue +fail +overlapOrCut=yes$/);
    expect(lines.findIndex((l) => / note\b/.test(l) && !l.startsWith('#'))).toBeGreaterThan(head);
  });
});

describe('A13: talk mode needs the mic to have gone live', () => {
  it('reads ptt-live in the window, and only there', () => {
    ms = 0;
    const before = e('mic', 'ptt-live', { forMs: 4000 });
    const from = { session: 's1', ms: before.ms + 1 };
    const waiting = e('mic', 'ptt-open', { context: DRIVE_CHECKS_CONTEXT });
    const neverOpened = e('mic', 'ptt-close', { why: 'never-opened' });
    expect(pushToTalkWentLive([before, waiting, neverOpened], from)).toBe(false);
    expect(pushToTalkWentLive([before, waiting, e('mic', 'ptt-live', { forMs: 4000 })], from)).toBe(true);
    expect(pushToTalkWentLive([e('mic', 'ptt-live', {}, 's0')], from)).toBe(false);
  });
});
