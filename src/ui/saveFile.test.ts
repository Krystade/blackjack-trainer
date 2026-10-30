import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { REVOKE_AFTER_MS, backupFileName, localFileStamp, saveFiles, saveTextFile } from './saveFile';

/**
 * B1/B3/B10: the one file hand-over every export uses. The iPhone app's
 * route to a saved file is the share sheet; the download fallback must keep
 * its blob URL alive past the click (a synchronous revoke saved an empty
 * file in Safari) and click an ATTACHED anchor.
 */

interface FakeAnchor {
  href: string;
  download: string;
  rel: string;
  attachedAtClick: boolean | null;
  click: () => void;
  remove: () => void;
}

let anchors: FakeAnchor[];
let attached: Set<FakeAnchor>;
let revoked: string[];
let urlN: number;

function stubDom(nav: Record<string, unknown>) {
  anchors = [];
  attached = new Set();
  revoked = [];
  urlN = 0;
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('document', {
    createElement: () => {
      const a: FakeAnchor = {
        href: '',
        download: '',
        rel: '',
        attachedAtClick: null,
        click: () => {
          a.attachedAtClick = attached.has(a);
        },
        remove: () => {
          attached.delete(a);
        },
      };
      anchors.push(a);
      return a;
    },
    body: { appendChild: (a: FakeAnchor) => attached.add(a) },
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++urlN}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => {
    revoked.push(u);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saveFiles', () => {
  it('shares the file when the browser can, and downloads nothing', async () => {
    const shared: File[][] = [];
    stubDom({
      canShare: (d: { files?: File[] }) => Boolean(d.files?.length),
      share: async (d: { files: File[] }) => {
        shared.push(d.files);
      },
    });
    expect(await saveTextFile('{"a":1}', 'x.json')).toBe('shared');
    expect(shared).toHaveLength(1);
    expect(shared[0]![0]!.name).toBe('x.json');
    expect(await shared[0]![0]!.text()).toBe('{"a":1}');
    expect(anchors).toHaveLength(0);
  });

  it('a dismissed share sheet is cancelled, not a download', async () => {
    stubDom({
      canShare: () => true,
      share: async () => {
        throw new DOMException('dismissed', 'AbortError');
      },
    });
    expect(await saveTextFile('{}', 'x.json')).toBe('cancelled');
    expect(anchors).toHaveLength(0);
  });

  it('a share that fails for another reason falls back to the download', async () => {
    stubDom({
      canShare: () => true,
      share: async () => {
        throw new DOMException('no activation', 'NotAllowedError');
      },
    });
    expect(await saveTextFile('{}', 'x.json')).toBe('downloaded');
    expect(anchors).toHaveLength(1);
  });

  it('downloads through an attached anchor and revokes the URL only after the click has had time', async () => {
    stubDom({});
    expect(await saveTextFile('{}', 'backup.json')).toBe('downloaded');
    expect(anchors).toHaveLength(1);
    const a = anchors[0]!;
    expect(a.download).toBe('backup.json');
    expect(a.attachedAtClick).toBe(true);
    expect(attached.size).toBe(0);
    // The empty-file bug: a revoke on the same turn as the click.
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(revoked).toEqual([a.href]);
  });

  it('several files download one by one when they cannot be shared', async () => {
    stubDom({ canShare: () => false, share: async () => undefined });
    const r = await saveFiles([
      { name: 'a.m4a', data: new Blob(['x'], { type: 'audio/mp4' }) },
      { name: 'a.json', data: '{}' },
    ]);
    expect(r).toBe('downloaded');
    expect(anchors.map((a) => a.download)).toEqual(['a.m4a', 'a.json']);
  });

  it('reports a failure when nothing could be handed over', async () => {
    stubDom({});
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('no blob urls');
    });
    expect(await saveTextFile('{}', 'x.json')).toBe('failed');
  });
});

describe('file names use the local date (B35)', () => {
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

  it('a 19:30 PDT backup is named for that evening, not the next UTC day', () => {
    const d = new Date('2026-10-29T02:30:00Z'); // 19:30 PDT on Oct 28
    expect(localFileStamp(d)).toBe('2026-10-28');
    expect(localFileStamp(d, true)).toBe('2026-10-28-1930');
    expect(backupFileName(d)).toBe('bjtrainer-backup-2026-10-28-1930.json');
  });
});
