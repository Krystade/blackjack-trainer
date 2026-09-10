import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { segmentForClips } from '../src/audio/clips';
import type { ClipManifest } from '../src/audio/clips';
import { narrateCorrection } from '../src/audio/narrate';
import type { GradedEvent } from '../src/engine/grade';
import { reachableReasons } from './correctionPhrases';

/**
 * The end of the chain, asserted against the SHIPPED assets.
 *
 * Every other link is checked somewhere -- the phrase list against the app's
 * wording, the segmentation cascade against hand-built manifests -- and the
 * thing that actually matters was still checked nowhere: that a correction
 * spoken by the real app resolves to real files in a real manifest.
 *
 * It did not. Clip segmentation is all-or-nothing, and corrections were
 * explicitly excluded from the generator, so EVERY wrong answer dropped the
 * whole utterance to live TTS -- losing the good voice at the one moment the
 * app has something to teach, and, in a car, losing the head unit with it
 * (live speech opens no media element; see audio/mediaSession.ts).
 */

const CLIPS_DIR = fileURLToPath(new URL('../public/clips', import.meta.url));

function voiceIds(): string[] {
  const index = JSON.parse(readFileSync(`${CLIPS_DIR}/index.json`, 'utf8')) as {
    voices: { id: string }[];
  };
  return index.voices.map((v) => v.id);
}

/** The file wraps the map in `{ "clips": ... }`; the runtime type IS the map. */
function manifestFor(voiceId: string): ClipManifest {
  const file = JSON.parse(readFileSync(`${CLIPS_DIR}/${voiceId}/manifest.json`, 'utf8')) as {
    clips: ClipManifest;
  };
  return file.clips;
}

/**
 * EVERY correction the app can speak, not a sample.
 *
 * A sample is what shipped first, and it is what caught the bug that made
 * this necessary: the phrase extractor spelled the ten rank 'T' where the
 * engine spells it '10', so every ten-up correction was missing from the
 * generated clips and nothing said so. Enumerating from the same source the
 * generator reads closes that loop -- the assets are now checked against the
 * exact set they were built from, and against the app's real wording.
 */
function everyCorrection(): string[] {
  const texts = new Set<string>();
  for (const reason of reachableReasons()) {
    for (const expected of ['hit', 'stand', 'double', 'split', 'surrender']) {
      for (const tc of [-20, -4, -1, 0, 3, 20]) {
        texts.add(
          narrateCorrection({ correct: false, reason, expected, tc } as unknown as GradedEvent),
        );
      }
    }
  }
  return [...texts];
}

describe('shipped clip coverage for corrections', () => {
  const voices = voiceIds();

  it('has at least one voice to check', () => {
    expect(voices.length).toBeGreaterThan(0);
  });

  for (const voice of voices) {
    it(`resolves every correction the app can speak (${voice})`, () => {
      const manifest = manifestFor(voice);
      const unresolved = everyCorrection().filter(
        (text) => segmentForClips(text, manifest) === null,
      );
      expect(unresolved).toEqual([]);
    });

    /** A manifest entry with no file behind it is a chain that dies mid-word. */
    it(`ships a file for every clip the manifest names (${voice})`, () => {
      const manifest = manifestFor(voice);
      const present = new Set(readdirSync(`${CLIPS_DIR}/${voice}`));
      const missing = Object.values(manifest).filter((file) => !present.has(file));
      expect(missing).toEqual([]);
    });

    /** "Correct." was covered and "Wrong." was not, for a long time. */
    it(`covers both verdicts, not just the happy one (${voice})`, () => {
      const manifest = manifestFor(voice);
      expect(segmentForClips('Correct.', manifest)).not.toBeNull();
      expect(segmentForClips('Wrong.', manifest)).not.toBeNull();
    });
  }
});
