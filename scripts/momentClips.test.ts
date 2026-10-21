import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allMomentSentences, momentLine } from '../src/habits/moment';
import { segmentForClips, type ClipManifest } from '../src/audio/clips';

/** Wave N: the daily-goal line is recorded in every voice, for every streak length. */
const DIR = fileURLToPath(new URL('../public/clips', import.meta.url));

describe('goal moment clips', () => {
  for (const voice of ['af_bella', 'bf_emma', 'bm_george']) {
    it(`${voice}: every line resolves to recorded files`, () => {
      const manifest = (JSON.parse(readFileSync(`${DIR}/${voice}/manifest.json`, 'utf8')) as { clips: ClipManifest }).clips;
      for (const s of allMomentSentences()) expect(manifest[s], s).toBeTruthy();
      for (let n = 1; n <= 102; n++) {
        const files = segmentForClips(momentLine(n), manifest);
        expect(files, String(n)).not.toBeNull();
        for (const f of files ?? []) expect(existsSync(`${DIR}/${voice}/${f}`), f).toBe(true);
      }
    });
  }
});
