import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUSH_TO_TALK_CAP_MS,
  PUSH_TO_TALK_MS,
  endPushToTalk,
  isPushToTalkOpen,
  markPushToTalkLive,
  pushToTalkPhase,
  startPushToTalk,
  _resetVoiceSessionForTest,
} from './voiceSession';

/**
 * The push-to-talk window, which is a budget for SPEAKING and was being spent
 * on waiting.
 *
 * The 2026-09-30 drive measured the first microphone of a page load taking
 * 6033ms to reach `listening`. The window was five seconds counted from the
 * button press, so the first press of a cold page opened a window that closed
 * about a second before the engine could hear anything: the operator heard the
 * press acknowledged, spoke into a microphone that was not yet live, and got
 * nothing back. The second press worked, because by then the engine was warm.
 *
 * These cases are written against the clock because the whole defect is a
 * timing one -- there is no state to inspect that distinguishes the broken
 * version from the fixed one, only when the window closes relative to when the
 * microphone actually opened.
 */
describe('the push-to-talk window is spent on speaking, not on waiting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetVoiceSessionForTest();
  });

  afterEach(() => {
    _resetVoiceSessionForTest();
    vi.useRealTimers();
  });

  it('opens as waiting, which is not yet the speaking window', () => {
    startPushToTalk('test');
    expect(pushToTalkPhase()).toBe('waiting');
    expect(isPushToTalkOpen()).toBe(true);
  });

  /** The regression itself: this is the press that used to be thrown away. */
  it('is still open after the old five seconds when the microphone has not opened', () => {
    startPushToTalk('test');
    vi.advanceTimersByTime(PUSH_TO_TALK_MS + 1);
    expect(pushToTalkPhase()).toBe('waiting');
    expect(isPushToTalkOpen()).toBe(true);
  });

  it('starts the speaking window when the microphone goes live, not when the button was pressed', () => {
    startPushToTalk('test');
    // A cold start of the length the drive actually measured.
    vi.advanceTimersByTime(6033);
    markPushToTalkLive();
    expect(pushToTalkPhase()).toBe('speaking');

    // Four seconds of speaking time left, well past the press plus five.
    vi.advanceTimersByTime(PUSH_TO_TALK_MS - 1);
    expect(isPushToTalkOpen()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(pushToTalkPhase()).toBe('closed');
  });

  it('gives a live window its full speaking time even past the cap', () => {
    startPushToTalk('test');
    // Live only just inside the cap: the speaking window must still be whole,
    // or the cap would reintroduce the bug for the slowest starts -- the exact
    // case it exists to rescue.
    vi.advanceTimersByTime(PUSH_TO_TALK_CAP_MS - 10);
    markPushToTalkLive();
    vi.advanceTimersByTime(PUSH_TO_TALK_MS - 1);
    expect(pushToTalkPhase()).toBe('speaking');
  });

  it('closes a window whose microphone never opens, so the mic is not held forever', () => {
    startPushToTalk('test');
    vi.advanceTimersByTime(PUSH_TO_TALK_CAP_MS - 1);
    expect(isPushToTalkOpen()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(pushToTalkPhase()).toBe('closed');
  });

  it('gives up waiting later than the slowest start ever measured', () => {
    // 6033ms on 2026-09-30, and that was one watchdog cycle plus a retry. A cap
    // at or under it would close the window in exactly the case it is for.
    expect(PUSH_TO_TALK_CAP_MS).toBeGreaterThan(6033 * 1.5);
  });

  it('restarts the speaking window when pressed again while speaking', () => {
    startPushToTalk('test');
    markPushToTalkLive();
    vi.advanceTimersByTime(PUSH_TO_TALK_MS - 500);
    startPushToTalk('test');
    // Without the restart this would have closed 500ms in.
    vi.advanceTimersByTime(PUSH_TO_TALK_MS - 1);
    expect(pushToTalkPhase()).toBe('speaking');
  });

  it('restarts the wait when pressed again while still waiting', () => {
    startPushToTalk('test');
    vi.advanceTimersByTime(PUSH_TO_TALK_CAP_MS - 500);
    startPushToTalk('test');
    vi.advanceTimersByTime(PUSH_TO_TALK_CAP_MS - 1);
    expect(pushToTalkPhase()).toBe('waiting');
  });

  /**
   * The cloud recogniser ends its own session about every ninety seconds and
   * the controller restarts it, so `listening` can arrive again inside one
   * window. It must not hand out more speaking time than the press bought.
   */
  it('does not extend the speaking window when the microphone reports live twice', () => {
    startPushToTalk('test');
    markPushToTalkLive();
    vi.advanceTimersByTime(PUSH_TO_TALK_MS - 100);
    markPushToTalkLive();
    vi.advanceTimersByTime(101);
    expect(pushToTalkPhase()).toBe('closed');
  });

  /**
   * One word does not need five seconds, and the window cannot be ended by a
   * second press -- while it is open the car owns the buttons. So the length
   * is whatever the caller passes (PUSH_TO_TALK_MS by default).
   */
  it('speaks for as long as the press asked for, not a fixed five seconds', () => {
    startPushToTalk('test', 2000);
    markPushToTalkLive();
    vi.advanceTimersByTime(1999);
    expect(pushToTalkPhase()).toBe('speaking');
    vi.advanceTimersByTime(2);
    expect(pushToTalkPhase()).toBe('closed');
  });

  it('waits the same cap however short the speaking window is', () => {
    // The wait is for the microphone, which does not open any faster because
    // the operator wants to say less into it.
    startPushToTalk('test', 1000);
    vi.advanceTimersByTime(PUSH_TO_TALK_CAP_MS - 1);
    expect(pushToTalkPhase()).toBe('waiting');
  });

  it('extends by the length the extending press asked for', () => {
    startPushToTalk('test', 2000);
    markPushToTalkLive();
    vi.advanceTimersByTime(1500);
    startPushToTalk('test', 2000);
    vi.advanceTimersByTime(1999);
    expect(pushToTalkPhase()).toBe('speaking');
    vi.advanceTimersByTime(2);
    expect(pushToTalkPhase()).toBe('closed');
  });

  it('ignores a microphone going live when no window is open', () => {
    markPushToTalkLive();
    expect(pushToTalkPhase()).toBe('closed');
  });

  it('closes from either phase when a screen is left', () => {
    startPushToTalk('test');
    endPushToTalk();
    expect(pushToTalkPhase()).toBe('closed');

    startPushToTalk('test');
    markPushToTalkLive();
    endPushToTalk();
    expect(pushToTalkPhase()).toBe('closed');
  });

  it('leaves no timer behind that could close a later window', () => {
    startPushToTalk('test');
    endPushToTalk();
    startPushToTalk('test');
    markPushToTalkLive();
    // The abandoned window's cap would have fired in here.
    vi.advanceTimersByTime(PUSH_TO_TALK_MS - 1);
    expect(pushToTalkPhase()).toBe('speaking');
  });
});
