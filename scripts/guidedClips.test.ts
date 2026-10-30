import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEGMENTS, PRESETS } from '../src/guided/plan';
import { allGuidedSentences, driveIntroLine, GUIDED_COMMANDS_HINT, introLine, percentSentence, transitionLine } from '../src/guided/lines';
import { segmentForClips, type ClipManifest } from '../src/audio/clips';

/** Wave L: everything the guided session says is recorded in every voice. */
const DIR = fileURLToPath(new URL('../public/clips', import.meta.url));

describe('guided session clips', () => {
  for (const voice of ['af_bella', 'bf_emma', 'bm_george']) {
    it(`${voice}: every sentence, and every whole line, resolves to recorded files`, () => {
      const manifest = (JSON.parse(readFileSync(`${DIR}/${voice}/manifest.json`, 'utf8')) as { clips: ClipManifest }).clips;
      for (const s of allGuidedSentences()) {
        expect(manifest[s], s).toBeTruthy();
        expect(existsSync(`${DIR}/${voice}/${manifest[s]}`), s).toBe(true);
      }
      const lines = [
        ...PRESETS.map((p) => introLine(p)),
        ...PRESETS.map((p) => driveIntroLine(p)),
        GUIDED_COMMANDS_HINT,
        ...SEGMENTS.flatMap((d) => [transitionLine(d, { kind: 'answers', n: 15 }, true), transitionLine(d, { kind: 'time', ms: 180_000 }, false)]),
        `Skipped. ${transitionLine(SEGMENTS[2]!, { kind: 'time', ms: 60_000 }, false)}`,
        percentSentence(80),
      ];
      for (const line of lines) expect(segmentForClips(line, manifest), line).not.toBeNull();
    });
  }
});
