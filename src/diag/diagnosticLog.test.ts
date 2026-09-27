import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The log runs in node here, which is the point: it has to work with no
 * localStorage at all (vitest), with a full one (a real phone at the end of a
 * long session), and with one that throws on access (private-mode Safari).
 * A logger that only works in the easy case is not a logger you can send into
 * a car.
 */

function installStorage(impl?: Partial<Storage>): Record<string, string> {
  const data: Record<string, string> = {};
  const store: Storage = {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
    clear: () => {
      for (const k of Object.keys(data)) delete data[k];
    },
    key: (i) => Object.keys(data)[i] ?? null,
    get length() {
      return Object.keys(data).length;
    },
    ...impl,
  };
  (globalThis as { localStorage?: Storage }).localStorage = store;
  return data;
}

function uninstallStorage(): void {
  delete (globalThis as { localStorage?: Storage }).localStorage;
}

// Imported lazily per test: the module captures a page-load id and a boot
// time at import, so a fresh copy is needed whenever a test cares about
// either, or about starting from an empty buffer.
async function fresh(): Promise<typeof import('./diagnosticLog')> {
  vi.resetModules();
  return import('./diagnosticLog');
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  uninstallStorage();
});

describe('recording', () => {
  it('records an event and reads it straight back, before any flush', async () => {
    const log = await fresh();
    log.diag('mic', 'session-start', { n: 1 });

    const entries = log.readDiagnosticLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.category).toBe('mic');
    expect(entries[0]!.event).toBe('session-start');
    expect(entries[0]!.detail).toEqual({ n: 1 });
  });

  it('survives the page going away, which is when it matters most', async () => {
    const log = await fresh();
    log.diag('mic', 'session-end');
    log.flushDiagnostics();

    // A second module instance stands in for the next page load.
    const reloaded = await fresh();
    expect(reloaded.readDiagnosticLog().map((e) => e.event)).toContain('session-end');
  });

  it('stamps each page load so a reload is visible in the log', async () => {
    const first = await fresh();
    first.diag('env', 'page-load');
    first.flushDiagnostics();

    const second = await fresh();
    second.diag('env', 'page-load');

    const sessions = new Set(second.readDiagnosticLog().map((e) => e.session));
    expect(sessions.size).toBe(2);
  });

  it('drops undefined detail values rather than logging "undefined"', async () => {
    const log = await fresh();
    log.diag('mic', 'result', { heard: 'stand', said: undefined });
    expect(log.readDiagnosticLog()[0]!.detail).toEqual({ heard: 'stand' });
  });

  it('stringifies anything that is not a scalar, so nothing can be lost to JSON', async () => {
    const log = await fresh();
    log.diag('err', 'window-error', { error: new Error('boom') });
    expect(String(log.readDiagnosticLog()[0]!.detail!.error)).toContain('boom');
  });
});

describe('never getting in the way', () => {
  it('does not throw when there is no storage at all', async () => {
    uninstallStorage();
    const log = await fresh();
    expect(() => log.diag('mic', 'session-start')).not.toThrow();
    expect(() => log.flushDiagnostics()).not.toThrow();
    // Still readable in memory: a private window must not lose the session
    // the operator is having right now, only the one before it.
    expect(log.readDiagnosticLog()).toHaveLength(1);
  });

  it('does not throw when storage refuses the write', async () => {
    installStorage({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const log = await fresh();
    log.diag('mic', 'session-start');
    expect(() => log.flushDiagnostics()).not.toThrow();
  });

  it('does not throw when storage refuses to be read', async () => {
    installStorage({
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    const log = await fresh();
    log.diag('mic', 'session-start');
    expect(() => log.readDiagnosticLog()).not.toThrow();
  });

  it('ignores stored rubbish rather than failing to start', async () => {
    const data = installStorage();
    data['bjtrainer.diagnostics.v1'] = 'not json at all';
    const log = await fresh();
    expect(log.readDiagnosticLog()).toEqual([]);
  });
});

describe('staying small', () => {
  it('keeps the newest entries and drops the oldest', async () => {
    const log = await fresh();
    for (let i = 0; i < log.MAX_ENTRIES + 50; i++) log.diag('mic', `e${i}`);
    log.flushDiagnostics();

    const events = log.readDiagnosticLog().map((e) => e.event);
    expect(events.length).toBeLessThanOrEqual(log.MAX_ENTRIES);
    expect(events).toContain(`e${log.MAX_ENTRIES + 49}`);
    expect(events).not.toContain('e0');
  });

  it('stays inside the byte cap even when single entries are huge', async () => {
    const data = installStorage();
    const log = await fresh();
    const big = 'x'.repeat(5000);
    for (let i = 0; i < 300; i++) {
      log.diag('heard', 'utterance', { heard: big });
      log.flushDiagnostics();
    }
    expect((data['bjtrainer.diagnostics.v1'] ?? '').length).toBeLessThanOrEqual(log.MAX_BYTES);
  });
});

describe('the pasteable form', () => {
  it('says so when there is nothing, rather than producing a bare header', async () => {
    const log = await fresh();
    expect(log.formatDiagnosticLog([])).toBe('Diagnostic log is empty.');
  });

  it('puts the elapsed time, the category and the detail on one line', async () => {
    const log = await fresh();
    log.diag('mic', 'session-end', { sessionMs: 45000 });
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());

    expect(text).toContain('session-end');
    expect(text).toContain('sessionMs=45000');
    expect(text).toContain('# Blackjack Trainer diagnostic log');
  });

  it('quotes a value containing spaces, so a transcript stays one field', async () => {
    const log = await fresh();
    log.diag('heard', 'utterance', { heard: 'how was your dad' });
    expect(log.formatDiagnosticLog(log.readDiagnosticLog())).toContain(
      'heard="how was your dad"',
    );
  });

  it('formats elapsed time as minutes and seconds', async () => {
    const log = await fresh();
    expect(log.formatElapsed(0)).toBe('0:00.000');
    expect(log.formatElapsed(83_400)).toBe('1:23.400');
  });
});

describe('the summary the Settings panel shows', () => {
  it('counts sessions, failures and phrases separately', async () => {
    const log = await fresh();
    log.diag('mic', 'session-start');
    log.diag('mic', 'session-start');
    log.diag('mic', 'session-end');
    log.diag('mic', 'session-error', { error: 'audio-capture' });
    log.diag('heard', 'utterance', { heard: 'stand' });

    const s = log.summariseDiagnostics(log.readDiagnosticLog());
    expect(s.micStarts).toBe(2);
    expect(s.micEnds).toBe(1);
    expect(s.micErrors).toBe(1);
    expect(s.heard).toBe(1);
    expect(s.total).toBe(5);
  });
});

describe('subscribers', () => {
  it('is told when something is recorded and when the log is cleared', async () => {
    const log = await fresh();
    let calls = 0;
    const off = log.subscribeDiagnostics(() => calls++);

    log.diag('mic', 'session-start');
    expect(calls).toBe(1);
    log.clearDiagnosticLog();
    expect(calls).toBe(2);

    off();
    log.diag('mic', 'session-start');
    expect(calls).toBe(2);
  });

  it('survives a subscriber that throws', async () => {
    const log = await fresh();
    log.subscribeDiagnostics(() => {
      throw new Error('the panel exploded');
    });
    expect(() => log.diag('mic', 'session-start')).not.toThrow();
    expect(log.readDiagnosticLog()).toHaveLength(1);
  });
});

describe('clearing', () => {
  it('removes both the stored log and anything still buffered', async () => {
    const log = await fresh();
    log.diag('mic', 'a');
    log.flushDiagnostics();
    log.diag('mic', 'b');

    log.clearDiagnosticLog();
    expect(log.readDiagnosticLog()).toEqual([]);
  });
});

/**
 * THE EXPORT IS EVIDENCE, so it has to be unambiguous and honest about what
 * it is missing. Every test here was written against a defect the previous
 * tests were shaped to pass: they used a value with a space (the one input
 * the old quoting handled), entries with no detail at all (so the byte cap
 * never engaged), and a "huge" entry comfortably under the cap (so the one
 * case that escaped the cap was never built).
 */
describe('the export as an artefact', () => {
  const NL = String.fromCharCode(10);
  const DQ = String.fromCharCode(34);
  const BS = String.fromCharCode(92);

  it('cannot have a fake log line injected through a value', async () => {
    const log = await fresh();
    // This is not hypothetical: `err window-error`, `err unhandled-rejection`
    // and `test say-failed` all carry an Error message or String(e), and a
    // stack routinely contains newlines. `heard utterance` carries whatever
    // was said in the car.
    log.diag('err', 'window-error', {
      message: 'boom' + NL + ' 0:00.000 [zzz] mic   session-start      n=1 confirmedInMs=1',
    });
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    const body = text.split(NL).filter((l) => l && !l.startsWith('#'));
    expect(body, 'a value broke into a second line').toHaveLength(1);
    expect(body[0]).toContain('session-start');
    expect(body[0]).not.toMatch(/^\s*0:00\.000/);
  });

  it('keeps field boundaries when a value contains = or a quote', async () => {
    const log = await fresh();
    // The input carries real quote characters, which is what a transcript of
    // someone reading a line back would contain.
    log.diag('heard', 'utterance', {
      heard: 'hit=stand',
      verdict: 'he said ' + DQ + 'double' + DQ + ' then',
    });
    const line = log
      .formatDiagnosticLog(log.readDiagnosticLog())
      .split(NL)
      .find((l) => l.includes('utterance'))!;
    // Both values quoted, and the inner quote escaped, so the line round-trips.
    expect(line).toContain('heard=' + DQ + 'hit=stand' + DQ);
    // The inner quotes survive as escaped quotes, so the value round-trips
    // through JSON.parse rather than terminating the field early.
    expect(line).toContain(DQ + 'he said ' + BS + DQ + 'double' + BS + DQ + ' then' + DQ);
  });

  it('quotes exactly the values that would be ambiguous bare', async () => {
    const log = await fresh();
    log.diag('test', 'x', { a: 'Correct?', b: 'two words', c: 'hit=stand' });
    const line = log
      .formatDiagnosticLog(log.readDiagnosticLog())
      .split(NL)
      .find((l) => l.includes(' x '))!;
    // logfmt's rule: a bare value carries no delimiter, so the columns stay
    // scannable -- which is how this log is actually read -- while anything
    // that could be misread is quoted and escaped. A parser can rely on that
    // in both directions; it could not rely on "quoted when it has a space".
    expect(line).toContain('a=Correct?');
    expect(line).toContain('b=' + DQ + 'two words' + DQ);
    expect(line).toContain('c=' + DQ + 'hit=stand' + DQ);
  });

  it('serialises an object instead of collapsing it to [object Object]', async () => {
    const log = await fresh();
    log.diag('test', 'obj', { where: { lat: 1, lon: 2 } });
    const line = log
      .formatDiagnosticLog(log.readDiagnosticLog())
      .split(NL)
      .find((l) => l.includes('obj'))!;
    expect(line).not.toContain('[object Object]');
    expect(line).toContain('"lat":1');
  });

  it('keeps close to MAX_ENTRIES of ordinary traffic, not half of it', async () => {
    const log = await fresh();
    // WITH DETAIL, which is the point. The old test logged bare events, so the
    // byte cap never engaged and it could not notice that a real drive was
    // being cut to ~2000 entries while MAX_ENTRIES said 3000.
    const detail = { context: 'flashcards', heard: 'x'.repeat(50) };
    for (let i = 0; i < log.MAX_ENTRIES + 200; i += 1) log.diag('mic', 'e' + i, detail);
    // FLUSHED, because the byte cap lives in `trim()` and `trim()` only runs
    // on a flush -- which a real device does every second. Without this line
    // the test exercised only the entry-count cap in `diag()` and reported
    // 3000 where a device keeps 2139, so it passed on the exact defect it
    // was written against.
    log.flushDiagnostics();
    const n = log.readDiagnosticLog().length;
    expect(n).toBeLessThanOrEqual(log.MAX_ENTRIES);
    // The old eighth-at-a-time loop overshot roughly fourfold. Anything above
    // 90% of the cap means the trim is taking what it needs and no more.
    expect(n, 'the trim is still overshooting').toBeGreaterThan(log.MAX_ENTRIES * 0.9);
  });

  it("holds a full drive of the app's most verbose traffic", () => {
    // `speak path` is the widest line the app writes -- it carries the
    // utterance twice (`said` and `for`) plus the path, the tag and the
    // reason. Measured against the old 400_000 ceiling it kept 1544 of 3000,
    // so the constant was advertising roughly twice the capacity that
    // existed, and the half it discarded was the front of the drive: the run
    // start, the condition, and the first route steps.
    return fresh().then((log) => {
      const said = 'Basic hit versus dealer nine.';
      for (let i = 0; i < log.MAX_ENTRIES; i += 1) {
        log.diag('speak', 'path', {
          path: 'clip',
          said,
          for: said,
          tag: `route-1#${i}`,
          why: 'no-clip',
        });
      }
      log.flushDiagnostics();
      expect(log.readDiagnosticLog().length).toBeGreaterThan(log.MAX_ENTRIES * 0.9);
    });
  });

  it('cuts an oversized entry rather than letting it past the byte cap', async () => {
    const log = await fresh();
    // The old guard was `out.length > 1`, so a single entry larger than the
    // whole cap was exempt -- it reached setItem, threw QuotaExceededError and
    // permanently disabled persistence with nothing in the log saying so.
    log.diag('heard', 'utterance', { heard: 'y'.repeat(log.MAX_BYTES + 5000) });
    const stored = JSON.stringify(log.readDiagnosticLog());
    expect(stored.length).toBeLessThanOrEqual(log.MAX_BYTES);
    // ...and says it was cut, rather than silently returning a shorter string.
    expect(JSON.stringify(log.readDiagnosticLog())).toContain('chars]');
  });

  /**
   * FLUSHED FIRST, WHICH IS THE ONLY STATE A DEVICE EVER EXPORTS FROM.
   *
   * This test used to read the header straight after the writes, with no
   * flush -- and it passed for a reason that had nothing to do with the
   * behaviour it names. `persistDropped()` folds the module counter into
   * storage and zeroes it, and `flushDiagnostics` calls it on every successful
   * write, so on a phone (which flushes every second) the counter is non-zero
   * for microseconds and zero the rest of the time. Reproduced on the shipped
   * build: a 3400-entry drive exported 3001 entries, no `# TRIMMED`, and a
   * first line that was a mid-drive heartbeat -- no `run-start`, no page load,
   * no condition. The reader concludes the run was never started, which is one
   * of the three hypotheses this whole file exists to separate.
   *
   * Every assertion below therefore flushes first.
   */
  it('says in the header when it threw entries away', async () => {
    const log = await fresh();
    const detail = { context: 'flashcards', heard: 'z'.repeat(50) };
    for (let i = 0; i < log.MAX_ENTRIES + 500; i += 1) log.diag('mic', 'e' + i, detail);
    log.flushDiagnostics();
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    // Silence here is the defect: the reader cannot tell "never logged" from
    // "logged and discarded", and those have opposite diagnoses.
    expect(text, 'a flushed log reported no losses').toMatch(
      /# TRIMMED: \d+ older entries dropped/,
    );
  });

  it('still says so after a reload, which is where the entries outlive the count', async () => {
    const first = await fresh();
    for (let i = 0; i < first.MAX_ENTRIES + 500; i += 1) first.diag('mic', 'e' + i);
    first.flushDiagnostics();

    // A new page load: the same storage, fresh module state.
    const second = await fresh();
    expect(
      second.formatDiagnosticLog(second.readDiagnosticLog()),
      'the losses stopped being reported once the page reloaded',
    ).toMatch(/# TRIMMED: \d+ older entries dropped/);
  });

  it('puts a wall clock on every line, not only in the header', async () => {
    const log = await fresh();
    log.diag('test', 'one');
    const body = log
      .formatDiagnosticLog(log.readDiagnosticLog())
      .split(NL)
      .filter((l) => l && !l.startsWith('#'));
    // Elapsed is per page load, and a log routinely spans nine of them: two
    // lines that look adjacent can be forty minutes apart, and nothing could
    // be tied to a moment the operator remembers.
    expect(body[0]).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}\s/);
  });

  it('warns that the export carries speech captured in the car', async () => {
    const log = await fresh();
    log.diag('heard', 'utterance', { heard: 'something a passenger said' });
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    // The Settings panel warns; the artefact that actually leaves the device
    // did not. And it has to name everything in the file, not just the
    // transcripts: an operator who reads the header and decides it is safe to
    // paste into a public chat also ships their own name (Bluetooth device
    // labels carry it), their car, their phone build and the app URL.
    expect(text).toMatch(/speech captured in the vehicle/i);
    expect(text, 'the header does not mention anyone else in the car').toMatch(/anyone else present/i);
    expect(text, 'the header does not mention device names').toMatch(/audio device names/i);
    expect(text, 'the header does not mention the browser and OS').toMatch(/browser and OS version/i);
    expect(text, 'the header does not mention the URL').toMatch(/app URL/i);
    expect(text, 'the header does not mention profile names').toMatch(/profile names/i);
  });
});

/**
 * Properties a mutation run walked straight through.
 *
 * Each of these is a single-character-class change that broke something the
 * log exists to do, passed all 4490 tests, and would have reached a drive.
 */
describe('the parts of the log that were never pinned', () => {
  it('discards the OLDEST entries, not the newest, when the cap bites', async () => {
    // `slice(0, MAX_ENTRIES)` instead of `slice(len - MAX_ENTRIES)` keeps the
    // first minutes of a drive and throws away the thing that just went
    // wrong. The export is read by grep in a car park, looking for the most
    // recent fault -- so this inverts the artefact's entire purpose while
    // leaving the entry count exactly as advertised.
    // FLUSHED, so `trim()` actually runs. The cap inside `diag()` slices the
    // buffer correctly on its own, so without a flush this test never reaches
    // the function it is about -- the same omission that let the capacity
    // test below pass on the defect it was written against.
    const log = await fresh();
    for (let i = 0; i < log.MAX_ENTRIES; i += 1) log.diag('mic', 'e' + i);
    log.flushDiagnostics();
    for (let i = 0; i < 50; i += 1) log.diag('mic', 'late' + i);
    log.flushDiagnostics();

    const kept = log.readDiagnosticLog();
    expect(kept.length).toBeLessThanOrEqual(log.MAX_ENTRIES);
    expect(kept[kept.length - 1]!.event, 'the newest entry was thrown away').toBe('late49');
    expect(kept[0]!.event, 'the oldest entry survived instead').not.toBe('e0');
  });

  it('keeps the buffer when the write fails, so a private window still has a log', async () => {
    // Clearing the buffer before `setItem` lands loses the whole session in
    // exactly the environments that cannot persist -- the entries are gone
    // from memory and never reached storage.
    installStorage({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const log = await fresh();
    log.diag('mic', 'session-start');
    log.diag('mic', 'listen-on');
    log.flushDiagnostics();
    // ...and the failure itself is now recorded, in the buffer that is still
    // live. Without that line the gap after the next reload reads as the
    // operator having closed the app.
    expect(log.readDiagnosticLog().map((e) => e.event)).toEqual([
      'session-start',
      'listen-on',
      'persist-failed',
    ]);
  });

  it('says why persistence died, rather than leaving a hole that reads as a closed app', async () => {
    installStorage({
      setItem: () => {
        throw new DOMException('over quota', 'QuotaExceededError');
      },
    });
    const log = await fresh();
    log.diag('mic', 'listen-on');
    log.flushDiagnostics();

    const entry = log.readDiagnosticLog().find((e) => e.event === 'persist-failed');
    expect(entry, 'persistence died with nothing in the log to say so').toBeTruthy();
    expect(entry?.detail?.why).toBe('QuotaExceededError');
  });

  it('empties the buffer once the write has actually landed', async () => {
    // The other half: never clearing would re-write every entry on every
    // flush and duplicate the whole log into storage.
    const data = installStorage();
    const log = await fresh();
    log.diag('mic', 'session-start');
    log.flushDiagnostics();
    log.flushDiagnostics();
    const stored = JSON.parse(data['bjtrainer.diagnostics.v1']!) as { event: string }[];
    expect(stored.map((e) => e.event)).toEqual(['session-start']);
  });

  it('lets storage recover after the log is cleared', async () => {
    // A quota failure latches `storageUsable = false` for the page's life.
    // Clearing is the operator's remedy -- if it does not un-latch, the log
    // stays memory-only afterwards with nothing saying so.
    let failing = true;
    const data: Record<string, string> = {};
    installStorage({
      getItem: (k) => (k in data ? data[k]! : null),
      setItem: (k, v) => {
        if (failing) throw new Error('QuotaExceededError');
        data[k] = String(v);
      },
      removeItem: (k) => {
        delete data[k];
      },
    });
    const log = await fresh();
    log.diag('mic', 'session-start');
    log.flushDiagnostics();

    failing = false;
    log.clearDiagnosticLog();
    log.diag('mic', 'listen-on');
    expect(() => log.flushDiagnostics()).not.toThrow();
    // The proof it un-latched: a second page's worth of entries reaches
    // storage and comes back after a reload.
    const reloaded = await fresh();
    expect(reloaded.readDiagnosticLog().map((e) => e.event)).toContain('listen-on');
  });

  it('does not report losses it did not have after a clear', async () => {
    // `droppedEntries` is module state and `clearDiagnosticLog` left it
    // standing, so a one-line log carried "# TRIMMED: 500 older entries
    // dropped" and a reader discarded a complete record as truncated.
    const log = await fresh();
    for (let i = 0; i < log.MAX_ENTRIES + 500; i += 1) log.diag('mic', 'e' + i);
    log.flushDiagnostics();
    expect(log.formatDiagnosticLog(log.readDiagnosticLog())).toContain('# TRIMMED');

    log.clearDiagnosticLog();
    log.diag('mic', 'session-start');
    log.flushDiagnostics();
    const after = log.formatDiagnosticLog(log.readDiagnosticLog());
    expect(after, 'a cleared log still claims losses').not.toContain('# TRIMMED');
  });

  it('renders an empty value as something a reader can see', async () => {
    // `text=` with nothing after it is indistinguishable from a missing key
    // in a grep-read export, and an empty transcript is a real case.
    const log = await fresh();
    log.diag('heard', 'utterance', { text: '', verdict: 'empty' });
    expect(log.formatDiagnosticLog(log.readDiagnosticLog())).toContain('text=""');
  });

  it('keeps the elapsed column aligned when the clock goes backwards', async () => {
    // A negative `ms` (the documented clock-resync case) rendered as
    // `0:00.-45`, which breaks every column to its right.
    const log = await fresh();
    expect(log.formatElapsed(-45)).toMatch(/^-?\d+:\d{2}\.\d{3}$/);
  });
});

/**
 * Correlation: which run, which step, for entries outside the `test` category.
 *
 * Only `test` entries ever carried a step, and nothing carried a run. So a
 * clip that broke, a wheel press, or an audio hold lapsing could be tied to
 * the step that caused it only by adjacency in the file -- and adjacency is
 * exactly what the async `.then()` in clips.ts and the interleaved heartbeat
 * break. Two runs under the same condition in one export were separable only
 * by proximity to `run-start`, which is absent whenever the app was killed
 * mid-run.
 */
describe('ambient context on every entry', () => {
  it('stamps the run and step onto entries that never carried them', async () => {
    const log = await fresh();
    log.setDiagContext({ run: 'a1b2c3', step: 'route-1' });
    log.diag('speak', 'clip-end', { reason: 'ended' });

    expect(log.readDiagnosticLog().at(-1)!.detail).toMatchObject({
      run: 'a1b2c3',
      step: 'route-1',
      reason: 'ended',
    });
  });

  it("does not overwrite a caller's own value", async () => {
    // A step that explicitly names a different step is saying something.
    const log = await fresh();
    log.setDiagContext({ step: 'route-1' });
    log.diag('test', 'answer', { step: 'mic-route' });
    expect(log.readDiagnosticLog().at(-1)!.detail!.step).toBe('mic-route');
  });

  it('stops stamping once the run is over', async () => {
    // Otherwise an ordinary drill's entries are filed under a field-test run
    // that ended, which is worse than no correlation at all.
    const log = await fresh();
    log.setDiagContext({ run: 'a1b2c3', step: 'route-1' });
    log.setDiagContext({ run: undefined, step: undefined });
    log.diag('speak', 'path', { path: 'clip' });
    const detail = log.readDiagnosticLog().at(-1)!.detail!;
    expect(detail.run).toBeUndefined();
    expect(detail.step).toBeUndefined();
  });

  it('names the timezone, because the export mixes two clocks', async () => {
    // The body prints local time and the header prints UTC, and nothing said
    // so -- a reader anchoring "around ten past" against the header landed
    // hours from the body lines.
    const log = await fresh();
    log.diag('mic', 'session-start');
    expect(log.formatDiagnosticLog(log.readDiagnosticLog())).toMatch(
      /# body clock is local \(UTC[+-]\d{2}:\d{2}\); first\/last below are UTC/,
    );
  });
});

/**
 * The export has to survive its own storage being wrong.
 *
 * `readStored` validated `event` alone, and `formatDiagnosticLog` then called
 * `e.category.padEnd(5)` -- so a single stored entry without a `category` threw
 * a TypeError. Settings formats the log during render whether or not the panel
 * is open, so the ErrorBoundary caught it and bounced to home: Export, View and
 * Clear all live inside the panel that would not render, which left no way back
 * except devtools. The log that exists to explain a bad drive became the thing
 * preventing anyone from reading it.
 */
describe('a corrupt stored entry', () => {
  it('is dropped rather than crashing the export', async () => {
    const store = installStorage();
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
        { at: '2026-09-24T10:00:00.000Z', ms: 1, session: 'a', category: 'mic', event: 'ok' },
        // No `category` -- the shape that threw.
        { at: '2026-09-24T10:00:01.000Z', ms: 2, session: 'a', event: 'broken' },
        // No `at`, which `clockOf` and the day separator both parse.
        { ms: 3, session: 'a', category: 'mic', event: 'alsobroken' },
    ]);
    const log = await fresh();

    const entries = log.readDiagnosticLog();
    expect(entries.map((e) => e.event)).toEqual(['ok']);
    expect(() => log.formatDiagnosticLog(entries)).not.toThrow();
  });

  it('counts itself into the dropped total, so the header admits the hole', async () => {
    const store = installStorage();
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
        { at: '2026-09-24T10:00:00.000Z', ms: 1, session: 'a', category: 'mic', event: 'ok' },
        { at: '2026-09-24T10:00:01.000Z', ms: 2, session: 'a', event: 'broken' },
    ]);
    const log = await fresh();
    log.readDiagnosticLog();
    expect(log.diagnosticEntriesDropped()).toBeGreaterThan(0);
  });

  /**
   * `category` and `event` were the only columns printed raw, while detail
   * values go through `quoteIfNeeded` precisely because an injected newline can
   * insert a convincing fake log line -- and `readStored` accepts any string
   * for either.
   */
  it('cannot forge a log line through the category or event column', async () => {
    const store = installStorage();
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
        {
          at: '2026-09-24T10:00:00.000Z',
          ms: 1,
          session: 'a',
          category: 'mic',
          event: 'x\n12:00:00.000     0.000 [a] focus holding',
        },
    ]);
    const log = await fresh();
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    // The escaped text may still APPEAR -- inside a quoted field, on one
    // line. What must not happen is a SECOND line that reads as a log row, so
    // count rows by shape rather than searching for the payload.
    const rows = text
      .split('\n')
      .filter((l) => /^\d\d:\d\d:\d\d[.]\d\d\d /.test(l));
    expect(rows, 'a newline in `event` produced a second, fake log row').toHaveLength(1);
  });
});

/**
 * A log spanning more than one day has to say where the days change.
 *
 * The body prints HH:MM:SS.mmm only, and nothing caps the log by age -- 3000
 * entries is days of ordinary use. A reader meeting `23:58:41` then `00:02:10`
 * reads it as the clock running backwards, or takes two adjacent lines for
 * seconds apart when they are twenty hours apart. Only `# first`/`# last`
 * carried a date, and they bracket the whole file.
 */
describe('the export across a day boundary', () => {
  it('marks each local day once, in order', async () => {
    const store = installStorage();
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
        { at: '2026-09-24T12:00:00.000Z', ms: 1, session: 'a', category: 'mic', event: 'one' },
        { at: '2026-09-24T12:00:01.000Z', ms: 2, session: 'a', category: 'mic', event: 'two' },
        { at: '2026-09-26T12:00:00.000Z', ms: 3, session: 'b', category: 'mic', event: 'three' },
    ]);
    const log = await fresh();
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    const days = text.split('\n').filter((l) => l.startsWith('# --- '));
    expect(days, 'the day never changed in the body of the export').toHaveLength(2);
  });

  it('does not repeat the separator inside one day', async () => {
    const store = installStorage();
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
        { at: '2026-09-24T12:00:00.000Z', ms: 1, session: 'a', category: 'mic', event: 'one' },
        { at: '2026-09-24T12:00:01.000Z', ms: 2, session: 'a', category: 'mic', event: 'two' },
    ]);
    const log = await fresh();
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    expect(text.split('\n').filter((l) => l.startsWith('# --- '))).toHaveLength(1);
  });
});

/**
 * Two tabs buffer independently and append on their own schedule, so entries
 * arrive in FLUSH order rather than time order. The wall-clock column then jumps
 * backwards mid-file, and `# first` printed `entries[0]` -- the first thing
 * written, not the earliest thing that happened.
 */
describe('entries written out of order by two tabs', () => {
  it('renders in time order and reports the true first and last', async () => {
    const store = installStorage();
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
        { at: '2026-09-24T10:00:00.500Z', ms: 500, session: 'b', category: 'mic', event: 'tabB' },
        { at: '2026-09-24T10:00:00.100Z', ms: 100, session: 'a', category: 'mic', event: 'tabA1' },
        { at: '2026-09-24T10:00:00.900Z', ms: 900, session: 'a', category: 'mic', event: 'tabA2' },
    ]);
    const log = await fresh();
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());

    const body = text.split('\n').filter((l) => /tab(A1|A2|B)/.test(l));
    expect(body.map((l) => l.match(/tab(?:A1|A2|B)/)![0])).toEqual(['tabA1', 'tabB', 'tabA2']);
    expect(text, 'the header named the first entry WRITTEN, not the earliest').toContain(
      '# first 2026-09-24T10:00:00.100Z',
    );
    expect(text).toContain('# last  2026-09-24T10:00:00.900Z');
  });
});

/**
 * A detail value that is not a string used to escape both caps.
 *
 * Reproduced by the reviewer at 3,289,010 bytes -- past MAX_BYTES, with no
 * `# TRIMMED`, because `trim()`'s loop is gated on `out.length > 1` and one
 * oversized entry is never more than one entry. On a real device that `setItem`
 * throws QuotaExceededError, which disables persistence for the page's life.
 */
describe('an oversized non-string detail', () => {
  it('is capped like a long string is', async () => {
    const store = installStorage();
    const log = await fresh();
    // 200k elements, the size the reviewer actually reproduced at 3,289,010
    // bytes. A smaller array still lands under MAX_BYTES even uncapped, so a
    // test built on one passes whether or not the cap exists.
    log.diag('speak', 'clip-chain', { files: Array.from({ length: 200_000 }, (_, i) => 'f' + i) });
    log.flushDiagnostics();

    const stored = store['bjtrainer.diagnostics.v1'] ?? '';
    expect(stored.length, 'a single entry wrote past the byte cap').toBeLessThan(log.MAX_BYTES);
  });

  it('leaves a small object intact, so the cap is not just deleting detail', async () => {
    const log = await fresh();
    log.diag('speak', 'clip-chain', { files: ['a', 'b'] });
    log.flushDiagnostics();
    const entry = log.readDiagnosticLog().find((e) => e.event === 'clip-chain');
    expect(entry?.detail?.files).toEqual(['a', 'b']);
  });
});

/**
 * The drop count has to outlive the page load, because the entries do.
 *
 * It was plain module state, so it reset to zero on every load while the
 * trimmed entries stayed gone. iOS unloads a backgrounded PWA freely, so a
 * drive that reloads twice and trims on the first two exported a header saying
 * nothing had been discarded -- the exact confusion the header exists to
 * prevent, in the commonest shape of a long drive.
 */
describe('the drop count across page loads', () => {
  it('carries the previous load\'s drops into this one', async () => {
    const first = await fresh();
    for (let i = 0; i < first.MAX_ENTRIES + 20; i += 1) first.diag('mic', 'e' + i);
    first.flushDiagnostics();
    expect(first.diagnosticEntriesDropped()).toBeGreaterThan(0);

    // A reload: same storage, fresh module state.
    const second = await fresh();
    expect(
      second.diagnosticEntriesDropped(),
      'the new page load reported that nothing had ever been dropped',
    ).toBeGreaterThan(0);
  });

  it('is cleared along with the entries it counted', async () => {
    const first = await fresh();
    for (let i = 0; i < first.MAX_ENTRIES + 20; i += 1) first.diag('mic', 'e' + i);
    first.flushDiagnostics();
    first.clearDiagnosticLog();

    const second = await fresh();
    expect(
      second.diagnosticEntriesDropped(),
      'a cleared log still claimed entries had been discarded',
    ).toBe(0);
  });
});

/**
 * The forgery guard was only half written: values, `category` and `event` went
 * through `quoteIfNeeded`, and the detail KEY was interpolated raw. Reproduced
 * in a real export: a key carrying a newline produced a whole extra body line,
 * indistinguishable from a genuine one down to a session id that appears
 * nowhere else in the file.
 */
describe('a detail key that tries to write its own log line', () => {
  // Built from a char code rather than written as an escape, so nothing in the
  // toolchain between here and the file can quietly turn it into a real break.
  const LF = String.fromCharCode(10);

  it('cannot add a row to the export', async () => {
    const log = await fresh();
    const key = `x${LF}22:00:00.000  0:00.000 [zzz] mic   session-start      note=forged`;
    log.diag('mic', 'listen-on', { [key]: 1 });

    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    // Counted by SHAPE rather than by searching for the payload: the payload
    // legitimately appears inside a quoted field on one line, which is exactly
    // what the fix does with it.
    const rows = text.split(LF).filter((l) => /^\d\d:\d\d:\d\d[.]\d\d\d /.test(l));
    // ONE ROW FOR ONE ENTRY. The payload does appear on that row -- inside a
    // quoted field, which is exactly what the fix does with it -- so searching
    // for the payload would fail for the right reason and pass for the wrong
    // one. What matters is that it did not become a row of its own.
    expect(rows, 'a detail key forged an extra log row').toHaveLength(1);
    expect(rows[0], 'the key was not quoted, so the break survived').toContain('"x');
  });

  it('leaves an ordinary key unquoted, so the export stays greppable', async () => {
    const log = await fresh();
    log.diag('mic', 'listen-on', { context: 'flashcards' });
    expect(log.formatDiagnosticLog(log.readDiagnosticLog())).toContain('context=flashcards');
  });
});

/**
 * A phone corrects its wall clock by NTP whenever it rejoins a network, which
 * on this app's one use is during a drive.
 *
 * `at` moves with it; `ms` does not, being `performance.now()`. Sorting on `at`
 * alone therefore printed the lines around a correction in the wrong order —
 * and the microphone lifecycle, whose whole diagnostic value is which event
 * preceded which, came out as `error` before `start`.
 */
describe('a page load whose wall clock is corrected mid-drive', () => {
  it('still prints the lifecycle in the order it happened', async () => {
    const store = installStorage();
    // One session. The phone gains three seconds between `start` and `result`,
    // so the wall clock alone puts everything after the correction first.
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
      { at: '2026-09-24T10:00:10.000Z', ms: 1_000, session: 'a', category: 'mic', event: 'start' },
      { at: '2026-09-24T10:00:11.000Z', ms: 2_000, session: 'a', category: 'mic', event: 'live' },
      { at: '2026-09-24T10:00:09.000Z', ms: 3_000, session: 'a', category: 'mic', event: 'result' },
      { at: '2026-09-24T10:00:10.000Z', ms: 4_000, session: 'a', category: 'mic', event: 'error' },
      { at: '2026-09-24T10:00:11.000Z', ms: 5_000, session: 'a', category: 'mic', event: 'end' },
    ]);
    const log = await fresh();
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());

    const order = text
      .split(String.fromCharCode(10))
      .filter((l) => /(start|live|result|error|end)$/.test(l.trim()))
      .map((l) => l.trim().split(/\s+/).pop());
    expect(order, 'the corrected clock reordered the microphone lifecycle').toEqual([
      'start',
      'live',
      'result',
      'error',
      'end',
    ]);
  });

  it('says the clock moved, since the printed times still jump', async () => {
    const store = installStorage();
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
      { at: '2026-09-24T10:00:10.000Z', ms: 1_000, session: 'a', category: 'mic', event: 'start' },
      { at: '2026-09-24T10:00:09.000Z', ms: 3_000, session: 'a', category: 'mic', event: 'result' },
      { at: '2026-09-24T10:00:11.000Z', ms: 5_000, session: 'a', category: 'mic', event: 'end' },
    ]);
    const log = await fresh();
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    // Unexplained, a backwards wall clock in a correctly ordered file reads as
    // the log being broken.
    expect(text, 'a corrected clock is not mentioned anywhere in the export').toContain(
      'clock moved',
    );
    // ...and the times are still the ones that were recorded. Printing a
    // reconstructed timestamp would put a number in the file that no clock ever
    // showed, so the backwards jump has to survive into the body -- which is
    // exactly why the header line above has to exist.
    const stamps = text
      .split(String.fromCharCode(10))
      .filter((l) => /(start|result|end)$/.test(l.trim()))
      .map((l) => l.trim().split(/\s+/)[0]!);
    expect(stamps, 'three lines did not reach the body').toHaveLength(3);
    expect(
      stamps[1]! < stamps[0]!,
      'the printed time was reconstructed rather than recorded',
    ).toBe(true);
  });

  it('places a corrected page load against another tab by the clock it mostly ran on', () => {
    // Two tabs, which this app ships cross-tab machinery for. Tab `a` is
    // corrected five seconds forward after its first line, so its FIRST
    // entry is the odd one out — anchoring the session on it would drag every
    // one of its lines five seconds early and file them all ahead of tab `b`,
    // which is the interleaving the previous fix here exists to get right.
    const store = installStorage();
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
      { at: '2026-09-24T10:00:00.000Z', ms: 0, session: 'a', category: 'mic', event: 'a0' },
      { at: '2026-09-24T10:00:05.100Z', ms: 100, session: 'a', category: 'mic', event: 'a1' },
      { at: '2026-09-24T10:00:05.200Z', ms: 200, session: 'a', category: 'mic', event: 'a2' },
      { at: '2026-09-24T10:00:05.300Z', ms: 300, session: 'a', category: 'mic', event: 'a3' },
      { at: '2026-09-24T10:00:05.150Z', ms: 50, session: 'b', category: 'mic', event: 'b0' },
    ]);
    return fresh().then((log) => {
      const text = log.formatDiagnosticLog(log.readDiagnosticLog());
      const order = text
        .split(String.fromCharCode(10))
        .filter((l) => /(a0|a1|a2|a3|b0)$/.test(l.trim()))
        .map((l) => l.trim().split(/\s+/).pop());
      expect(order, 'the corrected tab was filed by the clock it only used once').toEqual([
        'a0',
        'a1',
        'b0',
        'a2',
        'a3',
      ]);
    });
  });

  it('leaves an ordinary log alone, and says nothing about a clock that never moved', async () => {
    const store = installStorage();
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
      { at: '2026-09-24T10:00:01.000Z', ms: 1_000, session: 'a', category: 'mic', event: 'start' },
      { at: '2026-09-24T10:00:02.000Z', ms: 2_000, session: 'a', category: 'mic', event: 'end' },
    ]);
    const log = await fresh();
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    expect(text, 'an untouched clock was reported as corrected').not.toContain('clock moved');
    expect(text.indexOf('start')).toBeLessThan(text.indexOf('end'));
  });

  it('does not report ordinary drift between the two clocks', async () => {
    const store = installStorage();
    // 40ms apart: the wall clock and `performance.now()` are independent and
    // wander, and `ms` is rounded. A threshold that caught this would put a
    // scary line in every export.
    store['bjtrainer.diagnostics.v1'] = JSON.stringify([
      { at: '2026-09-24T10:00:01.000Z', ms: 1_000, session: 'a', category: 'mic', event: 'start' },
      { at: '2026-09-24T10:00:02.040Z', ms: 2_000, session: 'a', category: 'mic', event: 'end' },
    ]);
    const log = await fresh();
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    expect(text).not.toContain('clock moved');
  });
});
