import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { formatDiagnosticLog, localClockOf, scopeSince, type DiagEntry } from './diagnosticLog';
import { localRecordingStamp } from '../ui/saveFile';
import testKitSource from '../ui/screens/TestKit.tsx?raw';

/**
 * B31/B35: every time a test-kit artefact names is on the clock the log body
 * uses (local), and the body's offset label is the one its lines were in.
 */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
let saved: string | undefined;
beforeAll(() => {
  saved = env.TZ;
  env.TZ = 'America/Los_Angeles';
});
afterAll(() => {
  if (saved === undefined) delete env.TZ;
  else env.TZ = saved;
});

const e = (at: string, ms: number): DiagEntry => ({ at, ms, session: 's1', category: 'test', event: 'note' });

describe('local times in the test-kit artefacts (B31, B35)', () => {
  it('the scope line names the run start on the local clock, with the UTC stamp beside it', () => {
    expect(localClockOf('2026-10-29T01:30:05.000Z')).toBe('18:30:05');
    expect(scopeSince('the car run', '2026-10-29T01:30:05.000Z')).toBe('the car run started at 18:30:05 local (2026-10-29T01:30:05.000Z)');
    expect(testKitSource).toMatch(/scopeSince\(`the \$\{KITS\[kit\]\.label\} run`, since\)/);
    expect(testKitSource).not.toMatch(/since\.slice\(11, 19\)/);
  });

  it('the body offset is the one the lines were rendered in, not the one at export', () => {
    const pdt = formatDiagnosticLog([e('2026-10-31T20:00:00.000Z', 1), e('2026-10-31T21:00:00.000Z', 2)]);
    expect(pdt).toContain('# body clock is local (UTC-07:00); first/last below are UTC');
    const across = formatDiagnosticLog([e('2026-10-31T20:00:00.000Z', 1), { ...e('2026-11-02T20:00:00.000Z', 2), session: 's2' }]);
    expect(across).toContain('# body clock is local (UTC-07:00 at the first line, UTC-08:00 at the last); first/last below are UTC');
  });

  it('a recording made at 18:30 PDT on 28 Oct is named for 28 Oct, 18:30', () => {
    expect(localRecordingStamp(new Date('2026-10-29T01:30:05.000Z'))).toBe('2026-10-28T18-30-05');
    expect(testKitSource).toMatch(/const stamp = localRecordingStamp\(new Date\(\)\);/);
  });
});
