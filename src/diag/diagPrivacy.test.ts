import { describe, it, expect } from 'vitest';
import { createVoiceController, type RecognitionLike } from '../audio/voiceControl';
import { redactDetail, REDACTED } from './diagPrivacy';

/**
 * R3: the redaction works on what the app really logs. The voice result is
 * captured from the real controller, not written by hand to match the list.
 */
class Rec implements RecognitionLike {
  continuous = false;
  interimResults = true;
  lang = '';
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onresult: ((e: { results?: ArrayLike<ArrayLike<{ transcript?: string; confidence?: number }>> }) => void) | null = null;
  start(): void {
    this.onstart?.();
  }
  abort(): void {
    this.onend?.();
  }
}

function realResult(): Record<string, unknown> {
  const rec = new Rec();
  const logged: Array<[string, Record<string, unknown> | undefined]> = [];
  const c = createVoiceController({
    createRecognition: () => rec,
    now: () => 1000,
    schedule: () => 0,
    cancel: () => {},
    onAction: () => {},
    onState: () => {},
    log: (event, detail) => logged.push([event, detail]),
  });
  c.start();
  rec.onresult?.({ results: [[{ transcript: 'did you see her text', confidence: 0.9 }, { transcript: 'did you see', confidence: 0.4 }]] });
  const r = logged.find(([e]) => e === 'result');
  expect(r).toBeDefined();
  return r![1]!;
}

describe('redactDetail (R3)', () => {
  it("a voice result loses its words (heard AND the N-best readings), and keeps its counts", () => {
    const detail = realResult();
    const out = redactDetail('result', detail)!;
    expect(JSON.stringify(out)).not.toContain('her text');
    expect(JSON.stringify(out)).not.toContain('did you see');
    expect(out.alternatives).toBe(detail.alternatives);
    expect(out.offered).toBe(detail.offered);
    expect(out.confs).toEqual(detail.confs);
  });

  it('never grows the entry', () => {
    const detail = realResult();
    const out = redactDetail('result', detail)!;
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(JSON.stringify(detail).length);
    const tiny = redactDetail('heard-text', { text: 'a' })!;
    expect(JSON.stringify(tiny).length).toBeLessThanOrEqual(JSON.stringify({ text: 'a' }).length);
    const route = { first: "Jack's AirPods", inputs: "iPhone Microphone | Jack's AirPods", kind: 'bluetooth' };
    const r = redactDetail('route-snapshot', route)!;
    expect(r).toEqual({ first: REDACTED, inputs: REDACTED, kind: 'bluetooth' });
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(JSON.stringify(route).length);
  });

  it('leaves public fields and non-text values alone', () => {
    expect(redactDetail('audio-session', { wanted: 'play-and-record', got: 'playback' })).toBeNull();
    expect(redactDetail('volume-ignored', { wanted: 1.5, got: 1 })).toBeNull();
    expect(redactDetail('kit-record-stop', { labels: 3 })).toBeNull();
    expect(redactDetail('say-start', { text: 'Say hit' })).toBeNull();
  });

  it('is idempotent: an already redacted entry is not rewritten', () => {
    const once = redactDetail('result', realResult())!;
    expect(redactDetail('result', once)).toBeNull();
  });
});
