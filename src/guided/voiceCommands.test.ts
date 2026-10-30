import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchVoiceAction, resolveSpoken, setUserVoiceAliases, VOICE_PHRASES, SPOKEN_FORM } from '../audio/voiceRecognition';
import { COUNT_BIAS_PHRASES, parseCountSpeech } from '../audio/voiceNumber';
import { looksLikeSelfEcho } from '../audio/selfEcho';
import { allGuidedSentences, GUIDED_COMMANDS_HINT } from './lines';
import {
  COMMAND_PHRASES,
  RUNNING_PHRASES,
  _resetGuidedCommandsForTest,
  claimGuidedTranscript,
  matchGuidedCommand,
  setGuidedCommandHandler,
} from './voiceCommands';

const PHRASES = Object.keys(COMMAND_PHRASES);

afterEach(() => {
  _resetGuidedCommandsForTest();
  setUserVoiceAliases({});
});

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

  it('A9: the Drive hint names the commands but is not itself one, and its echo is not', () => {
    const t = GUIDED_COMMANDS_HINT;
    expect(matchGuidedCommand(t, [t], null, 'panel')).toBeNull();
    expect(matchGuidedCommand(t, [t], null, 'running')).toBeNull();
    // Heard straight after it, a fragment of it is its own voice.
    expect(matchGuidedCommand('skip segment', ['skip segment'], t, 'running')).toBeNull();
  });

  it('every command is at most two words (the self-echo length contract)', () => {
    for (const p of PHRASES) expect(p.split(' ').length, p).toBeLessThanOrEqual(2);
  });
});

describe("the operator's voice aliases", () => {
  it('a command he has made an answer in Settings is his answer, not a command', () => {
    expect(matchGuidedCommand('end session', ['end session'], null, 'running')).toBe('end');
    setUserVoiceAliases({ 'end session': 'stand', resume: 'hit' });
    expect(matchGuidedCommand('end session', ['end session'], null, 'running')).toBeNull();
    expect(matchGuidedCommand('resume', ['resume'], null, 'panel')).toBeNull();
    // The rest are untouched.
    expect(matchGuidedCommand('pause session', ['pause session'], null, 'running')).toBe('pause');
  });
});

describe('while a drill runs, two words only', () => {
  it('the bare words do nothing over a running drill, even on a single reading', () => {
    for (const bare of ['skip', 'pause', 'end', 'resume', 'carry on', 'keep going', 'resume session']) {
      expect(matchGuidedCommand(bare, [bare], null, 'running'), bare).toBeNull();
    }
  });

  it('the two-word forms work there, and everywhere', () => {
    expect(matchGuidedCommand('skip segment', ['skip segment'], null, 'running')).toBe('skip');
    expect(matchGuidedCommand('Pause session.', ['Pause session.'], null, 'running')).toBe('pause');
    expect(matchGuidedCommand('end session', ['end session'], null, 'running')).toBe('end');
    for (const p of Object.keys(RUNNING_PHRASES)) {
      expect(p.split(' ').length, p).toBe(2);
      expect(matchGuidedCommand(p, [p], null, 'panel'), p).toBe(RUNNING_PHRASES[p]);
    }
  });

  it('on the pause and transition screens the bare words work', () => {
    expect(matchGuidedCommand('skip', ['skip'], null, 'panel')).toBe('skip');
    expect(matchGuidedCommand('pause', ['pause'], null, 'panel')).toBe('pause');
    expect(matchGuidedCommand('end', ['end'], null, 'panel')).toBe('end');
    expect(matchGuidedCommand('resume', ['resume'], null, 'panel')).toBe('resume');
  });

  it('the claim asks the session which screen it is on, at each utterance', () => {
    let screen: 'running' | 'panel' = 'running';
    const handler = vi.fn(() => true);
    setGuidedCommandHandler(handler, () => screen);
    expect(claimGuidedTranscript('skip', ['skip'])).toBeNull();
    expect(claimGuidedTranscript('skip segment', ['skip segment'])).toBe('guided skip');
    screen = 'panel';
    expect(claimGuidedTranscript('skip', ['skip'])).toBe('guided skip');
    expect(handler).toHaveBeenCalledTimes(2);
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
