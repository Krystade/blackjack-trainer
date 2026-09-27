import { describe, it, expect } from 'vitest';
import { diffSettings, formatChanges, MAX_CHANGES_LOGGED } from './settingsDiff';

describe('diffSettings', () => {
  it('finds nothing when nothing changed', () => {
    const s = { audio: { enabled: true, volume: 0.8 }, theme: 'felt' };
    expect(diffSettings(s, structuredClone(s))).toEqual([]);
  });

  it('names a nested change by its dotted path', () => {
    const before = { audio: { enabled: false, verbosity: 'results' } };
    const after = { audio: { enabled: true, verbosity: 'results' } };
    expect(diffSettings(before, after)).toEqual([
      { path: 'audio.enabled', from: false, to: true },
    ]);
  });

  it('reports a key that appeared and one that vanished', () => {
    const changes = diffSettings({ a: 1 }, { b: 2 });
    expect(changes).toContainEqual({ path: 'a', from: 1, to: undefined });
    expect(changes).toContainEqual({ path: 'b', from: undefined, to: 2 });
  });

  it('treats an array as one decision rather than one per element', () => {
    // A bet spread going from [1,1,2,4] to [1,2,4,8] is a single choice, and
    // four lines saying so would bury it.
    const changes = diffSettings({ spread: [1, 1, 2, 4] }, { spread: [1, 2, 4, 8] });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe('spread');
  });

  it('does not report an array that only looks different', () => {
    expect(diffSettings({ spread: [1, 2] }, { spread: [1, 2] })).toEqual([]);
  });

  it('sees through several levels', () => {
    const changes = diffSettings({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } });
    expect(changes).toEqual([{ path: 'a.b.c', from: 1, to: 2 }]);
  });
});

describe('formatChanges', () => {
  it('says so plainly when there is nothing', () => {
    expect(formatChanges([])).toBe('(no change)');
  });

  it('reads as a sentence a human can act on', () => {
    expect(formatChanges([{ path: 'audio.verbosity', from: 'results', to: 'full' }])).toBe(
      'audio.verbosity: results -> full',
    );
  });

  it('marks an absent value rather than printing nothing', () => {
    expect(formatChanges([{ path: 'a', from: undefined, to: 1 }])).toBe('a: (unset) -> 1');
  });

  it('truncates visibly, so dropped evidence is never silent', () => {
    const many = Array.from({ length: MAX_CHANGES_LOGGED + 5 }, (_, i) => ({
      path: `k${i}`,
      from: 0,
      to: 1,
    }));
    const out = formatChanges(many);
    expect(out).toContain('(+5 more)');
    // Vacuity guard: the cap must actually be doing something.
    expect(out).not.toContain(`k${MAX_CHANGES_LOGGED + 1}:`);
  });
});

/**
 * A value big enough to be a document rather than a diff.
 *
 * `render` meets a whole object in exactly one case: something appeared where
 * there was nothing. For a profile that is the rules, the bet spread and the
 * starting bankroll — around seven hundred characters, and it lands as the
 * FIRST body line of every fresh export, which is where someone scanning the
 * file before they paste it into a chat looks first.
 */
describe('a value too big to print', () => {
  const profile = {
    id: 'p1',
    name: 'Default (6D H17)',
    bankrollStart: 1000,
    bet: { spread: [1, 2, 4, 8, 12], unit: 25 },
    rules: { decks: 6, s17: false, das: true, surrender: 'late', peek: true, resplitAces: false },
  };

  it('does not dump a profile into the log to say one appeared', () => {
    const line = formatChanges(diffSettings({}, { 'Default (6D H17)': profile }));
    expect(line, 'the whole profile is in the log line').not.toContain('bankrollStart":1000');
    expect(line, "the profile's stake sizes are in the log line").not.toContain('25');
  });

  it('still says what appeared, and that something was left out', () => {
    const line = formatChanges(diffSettings({}, { 'Default (6D H17)': profile }));
    expect(line).toContain('Default (6D H17)');
    expect(line, 'the omission is silent').toMatch(/\(\d+ chars\)/);
    expect(line, 'a reader cannot see what kind of thing appeared').toContain('bankrollStart');
  });

  it('prints a small object in full, because there the value is the evidence', () => {
    const line = formatChanges(diffSettings({ a: undefined }, { a: { x: 1, y: 2 } }));
    expect(line).toContain('{"x":1,"y":2}');
  });

  it('prints a bet spread as itself, which is one decision and short', () => {
    const line = formatChanges(diffSettings({ spread: [1, 1, 2, 4] }, { spread: [1, 2, 4, 8] }));
    expect(line).toBe('spread: [1,1,2,4] -> [1,2,4,8]');
  });

  it('summarises an array only when it is too long to read', () => {
    const long = Array.from({ length: 60 }, (_, i) => i);
    const line = formatChanges(diffSettings({ xs: [] }, { xs: long }));
    expect(line).toContain('[60 values]');
  });
});
