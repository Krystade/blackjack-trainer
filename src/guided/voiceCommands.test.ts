import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchVoiceAction, resolveSpoken, VOICE_PHRASES, SPOKEN_FORM } from '../audio/voiceRecognition';
import { COUNT_BIAS_PHRASES, parseCountSpeech } from '../audio/voiceNumber';
import { looksLikeSelfEcho } from '../audio/selfEcho';
import { allGuidedSentences } from './lines';
import {
  COMMAND_PHRASES,
  _resetGuidedCommandsForTest,
  claimGuidedTranscript,
  matchGuidedCommand,
  setGuidedCommandHandler,
} from './voiceCommands';

const PHRASES = Object.keys(COMMAND_PHRASES);

afterEach(() => _resetGuidedCommandsForTest());

describe('guided commands never collide with an answer', () => {
  it('no command is a drill answer, a fuzzy near-miss of one, or a count', () => {
    for (const p of PHRASES) {
      expect(matchVoiceAction(p), p).toBeNull();
      expect(resolveSpoken([p]), p).toBeNull();
      expect(parseCountSpeech(p), p).toBeNull();
    }
  });

  it('no answer word, alias or spoken form is a command', () => {
    for (const a of [...VOICE_PHRASES, ...Object.values(SPOKEN_FORM)]) expect(matchGuidedCommand(a), a).toBeNull();
  });

  it('no count is a command', () => {
    const counts = [...COUNT_BIAS_PHRASES, 'zero', 'minus three', 'plus two', 'twelve', 'negative one', '-4', '7'];
    for (const c of counts) expect(matchGuidedCommand(c), c).toBeNull();
  });

  it('bare "skip" yields to any reading that is an answer (it is one sound from "spit", a split)', () => {
    expect(matchGuidedCommand('skip', ['skip'])).toBe('skip');
    expect(matchGuidedCommand('skip', ['skip', 'spit'])).toBeNull();
    expect(matchGuidedCommand('skip', ['skip', 'split them'])).toBeNull();
    expect(matchGuidedCommand('skip', ['skip', 'minus two'])).toBeNull();
    // The two-word forms do not yield: nothing answers to them.
    expect(matchGuidedCommand('skip segment', ['skip segment', 'split them'])).toBe('skip');
  });
});

describe('matching', () => {
  it('whole transcript only, fillers at the ends dropped, case and punctuation ignored', () => {
    expect(matchGuidedCommand('Pause.')).toBe('pause');
    expect(matchGuidedCommand('okay pause session')).toBe('pause');
    expect(matchGuidedCommand('Skip ahead please')).toBe('skip');
    expect(matchGuidedCommand('End session')).toBe('end');
    expect(matchGuidedCommand('carry on')).toBe('resume');
    expect(matchGuidedCommand("let's pause for a second")).toBeNull();
    expect(matchGuidedCommand('skip the next one')).toBeNull();
    expect(matchGuidedCommand('')).toBeNull();
  });

  it('a command made of the words the app just said is its own voice, not a command', () => {
    expect(matchGuidedCommand('pause', ['pause'], 'Press back to pause.')).toBeNull();
    expect(matchGuidedCommand('pause', ['pause'], 'Paused.')).toBe('pause');
    expect(matchGuidedCommand('skip', ['skip'], 'Skipped. Next: speed.')).toBe('skip');
  });

  it('nothing the guided session says contains a command (so it cannot command itself)', () => {
    for (const line of allGuidedSentences()) {
      for (const p of PHRASES) expect(looksLikeSelfEcho(p, line), `"${line}" contains "${p}"`).toBe(false);
    }
  });

  it('every command is at most two words (the self-echo length contract)', () => {
    for (const p of PHRASES) expect(p.split(' ').length, p).toBeLessThanOrEqual(2);
  });
});

describe('claimGuidedTranscript (useVoiceControl first refusal)', () => {
  it('claims nothing with no guided session running', () => {
    expect(claimGuidedTranscript('pause', ['pause'])).toBeNull();
  });

  it('claims what the session acts on, and passes on what it does not', () => {
    const handler = vi.fn((cmd: string) => cmd !== 'resume');
    setGuidedCommandHandler(handler);
    expect(claimGuidedTranscript('skip segment', ['skip segment'])).toBe('guided skip');
    expect(claimGuidedTranscript('resume', ['resume'])).toBeNull();
    expect(claimGuidedTranscript('stand pat', ['stand pat'])).toBeNull();
    expect(handler.mock.calls.map((c) => c[0])).toEqual(['skip', 'resume']);
  });

  it('a throwing handler never takes the microphone down', () => {
    setGuidedCommandHandler(() => {
      throw new Error('boom');
    });
    expect(claimGuidedTranscript('pause', ['pause'])).toBeNull();
  });
});
