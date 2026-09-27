import { describe, it, expect, beforeEach } from 'vitest';
import {
  speak,
  speakAsync,
  lastSpeechPath,
  repeatLast,
  _resetSpeechPathForTest,
  _resetLastSpokenForTest,
} from './speech';
import { readDiagnosticLog, clearDiagnosticLog } from '../diag/diagnosticLog';

/**
 * Which voice spoke a line, as a fact the app records rather than a question
 * it asks.
 *
 * The field test used to ask the operator to identify the voice, which drew
 * the right complaint: "it's not like they're played the same way and the
 * code doesn't know wtf?" It does know -- `speak` has decided and logged it
 * since the 2026-09-20 voice-switch hunt.
 *
 * What nobody noticed is that `speakAsync`, the twin, recorded NOTHING. The
 * field test speaks exclusively through it, so every utterance the protocol
 * produced was absent from the very log the protocol exists to fill, while
 * the drill path looked fine. These tests hold both entry points to the same
 * contract so they cannot drift apart again.
 */

const paths = () =>
  readDiagnosticLog()
    .filter((e) => e.category === 'speak' && e.event === 'path')
    .map((e) => e.detail);

describe('the app records which voice spoke', () => {
  beforeEach(() => {
    clearDiagnosticLog();
    _resetSpeechPathForTest();
  });

  /**
   * With no clips configured in this environment, both entry points take the
   * live-TTS branch -- which is the branch that matters most here, because it
   * is the one that cannot be amplified and therefore the one that vanishes
   * under road noise.
   */
  it('writes the path to the log when speak() is used', () => {
    speak('Basic hit versus dealer nine.');
    expect(paths()).toHaveLength(1);
    expect(paths()[0]?.path).toBe('tts');
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR. Before 2026-09-23 this produced no
   * path entry at all, so the whole field test was silent in the log about
   * the one thing it was rewritten to capture.
   */
  it('writes the path to the log when speakAsync() is used, exactly as speak() does', async () => {
    await speakAsync('Basic hit versus dealer nine.');
    expect(paths()).toHaveLength(1);
    expect(paths()[0]?.path).toBe('tts');
  });

  it('names WHY it fell back, since a missing recording and a setting need different fixes', async () => {
    await speakAsync('Basic hit versus dealer nine.');
    // Clips are not enabled in this environment, so the honest answer is the
    // setting -- not a missing recording, which would send someone hunting a
    // clip that was never going to be used.
    expect(paths()[0]?.why).toBe('clips-off');
  });

  it('hands the decision back to the caller, so the app can state it instead of asking', async () => {
    expect(lastSpeechPath()).toBeNull();
    await speakAsync('Correct play was double.');
    const record = lastSpeechPath();
    expect(record?.path).toBe('tts');
    // Carries its own text, so a caller can tell this record is about the
    // line it just awaited rather than one that overtook it.
    expect(record?.text).toBe('Correct play was double.');
  });

  it('keeps the two entry points reporting the same thing for the same line', async () => {
    speak('Basic stand versus dealer six.');
    const fromSpeak = lastSpeechPath();
    _resetSpeechPathForTest();
    await speakAsync('Basic stand versus dealer six.');
    const fromAsync = lastSpeechPath();

    expect(fromAsync?.path).toBe(fromSpeak?.path);
    expect(fromAsync?.why).toBe(fromSpeak?.why);
  });
});

/**
 * Why the field test matches its path record on `tag` and not on `for`.
 *
 * `FieldTest.tsx` awaits an utterance and then reads `lastSpeechPath()` to
 * learn which voice spoke it. It used to accept any record whose `for` was
 * the same string and whose `seq` had advanced -- which a `repeatLast()`
 * landing in that window satisfies exactly, because a repeat re-speaks the
 * identical string and bumps `seq`. Skip-back on the steering wheel routes
 * straight to `repeatLast()`, and pressing the wheel is what several steps of
 * the protocol ASK the operator to do, so this is not a remote race: the
 * evidence the run collects would be a path taken at a different moment,
 * possibly down a different branch, stamped as the protocol's own line.
 */
describe('a path record can be told apart from a repeat of the same line', () => {
  beforeEach(() => {
    clearDiagnosticLog();
    _resetSpeechPathForTest();
    _resetLastSpokenForTest();
  });

  it('a repeat leaves a record that a text match cannot reject', () => {
    speak('Basic hit versus dealer nine.', { tag: 'route-1#1' });
    const mine = lastSpeechPath();
    expect(mine?.tag).toBe('route-1#1');

    repeatLast();
    const overtook = lastSpeechPath();

    // Both halves of the old guard pass for the repeat.
    expect(overtook?.for).toBe(mine?.for);
    expect(overtook?.seq).toBeGreaterThan(mine!.seq);
    // The tag is what tells them apart.
    expect(overtook?.tag).toBeUndefined();
  });

  it('two lines spoken in the same step carry distinguishable tags', () => {
    // The other half of the reason text cannot be the key: steps deliberately
    // speak the same line, and one step speaks several.
    speak('Did you have it?', { tag: 'mic-route#1' });
    speak('Did you have it?', { tag: 'mic-route#2' });
    const records = paths();
    expect(records.map((d) => d?.tag)).toEqual(['mic-route#1', 'mic-route#2']);
  });
});
