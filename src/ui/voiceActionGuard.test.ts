import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../diag/diagnosticLog', () => ({ diag: vi.fn() }));
import { diag } from '../diag/diagnosticLog';
import { runVoiceAction } from './voiceActionGuard';

describe('runVoiceAction (D8)', () => {
  beforeEach(() => vi.mocked(diag).mockClear());

  it('runs the handler and logs nothing when it does not throw', () => {
    const run = vi.fn();
    const again = vi.fn();
    runVoiceAction('hit', run, 'drill', again);
    expect(run).toHaveBeenCalledWith('hit');
    expect(diag).not.toHaveBeenCalled();
    expect(again).not.toHaveBeenCalled();
  });

  it('logs a throwing handler with the action, error and context, and asks again', () => {
    const again = vi.fn();
    expect(() =>
      runVoiceAction(
        'stand',
        () => {
          throw new Error('round is undefined');
        },
        'table',
        again,
      ),
    ).not.toThrow();
    expect(diag).toHaveBeenCalledWith(
      'mic',
      'action-threw',
      expect.objectContaining({ action: 'stand', error: 'round is undefined', context: 'table' }),
    );
    expect(String(vi.mocked(diag).mock.calls[0]![2]!.stack)).toContain('round is undefined');
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('survives a throwing recovery path too', () => {
    expect(() =>
      runVoiceAction(
        { kind: 'count', value: 3 },
        () => {
          throw 'nope';
        },
        undefined,
        () => {
          throw new Error('again failed');
        },
      ),
    ).not.toThrow();
    expect(diag).toHaveBeenCalledWith('mic', 'action-threw', expect.objectContaining({ action: '{"kind":"count","value":3}', error: 'nope' }));
  });
});
