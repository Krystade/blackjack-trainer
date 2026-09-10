import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { correctionSentences } from './correctionPhrases';

const JSON_PATH = fileURLToPath(new URL('./correction-phrases.json', import.meta.url));

/**
 * The drift alarm.
 *
 * `generate-audio-clips.py` reads the committed JSON, so the JSON is what
 * decides which clips exist. If the app's correction wording changes and this
 * file is not regenerated, every correction quietly drops to live TTS -- a
 * failure with no error, no log line, and no way to notice except by driving.
 * That has already happened once here (soft flashcard prompts; see the
 * generator's header), which is why this is a test rather than a convention.
 *
 * Regenerate with:  UPDATE_CORRECTION_PHRASES=1 npx vitest run scripts/
 * then re-run the generator to synthesise whatever is newly listed.
 */
describe('correction phrases', () => {
  it('matches the committed list the clip generator reads', () => {
    const derived = correctionSentences();

    if (process.env.UPDATE_CORRECTION_PHRASES === '1') {
      writeFileSync(JSON_PATH, `${JSON.stringify(derived, null, 2)}\n`, 'utf8');
    }

    const committed = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as string[];
    expect(derived).toEqual(committed);
  });

  /**
   * The two sentences that carry the actual answer. A correction that loses
   * these to live TTS has lost the part worth hearing -- and in a car, the
   * recorded voice is also the only one the head unit can see at all.
   */
  it('covers the sentences that state the right play and the count', () => {
    const derived = correctionSentences();
    expect(derived).toContain('Correct play was stand.');
    expect(derived).toContain('Correct play was surrender.');
    expect(derived).toContain('True count was plus three.');
    expect(derived).toContain('True count was minus one.');
    expect(derived).toContain('True count was zero.');
    expect(derived).toContain('Wrong.');
  });

  /** The composed quiz label exists nowhere but the quiz. */
  it('covers the quiz label the deviation quiz builds for itself', () => {
    const derived = correctionSentences();
    expect(derived.some((s) => s.startsWith('No index applies here'))).toBe(true);
    expect(derived.some((s) => s.startsWith('(near '))).toBe(true);
  });

  /**
   * Every entry has to be a whole sentence, because a clip IS a sentence:
   * clips.ts splits on terminal punctuation and looks each piece up exactly.
   * A fragment in this list would be a file that can never be matched.
   */
  it('lists only whole sentences, since segmentation matches nothing else', () => {
    for (const sentence of correctionSentences()) {
      expect(sentence).toMatch(/[.?!]$/);
      expect(sentence).toBe(sentence.trim());
    }
  });
});
