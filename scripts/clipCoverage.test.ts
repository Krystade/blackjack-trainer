import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { segmentForClips } from '../src/audio/clips';
import type { ClipManifest } from '../src/audio/clips';
import {
  narrateBotAction,
  narrateCorrection,
  narrateCountAnswer,
  narrateCountPrompt,
  narrateDealerUp,
  narrateFlashcardPrompt,
  narrateInsuranceOffer,
  narrateQuizPrompt,
  narrateShuffle,
  narrateSitOut,
} from '../src/audio/narrate';
import type { GradedEvent } from '../src/engine/grade';
import type { Rank, Suit } from '../src/engine/cards';
import type { Action } from '../src/engine/deviations';
import { DEFAULT_RULES } from '../src/engine/ruleset';
import { drawFlashcard } from '../src/drills/flashcards';
import { drawQuizItem } from '../src/drills/deviationQuiz';
import { reachableReasons } from './spokenPhrases';

/**
 * The end of the chain, asserted against the SHIPPED assets.
 *
 * Every other link is checked somewhere -- the phrase list against the app's
 * wording, the segmentation cascade against hand-built manifests -- and the
 * thing that actually matters was checked nowhere: that what the real app
 * says resolves to real files in a real manifest.
 *
 * It did not, for corrections and for every bot turn. Clip segmentation is
 * all-or-nothing, so ONE unmatched sentence dropped the whole utterance to
 * live TTS -- losing the good voice at the moment the app has something to
 * teach, and in a car losing the head unit with it (live speech opens no
 * media element; see audio/mediaSession.ts).
 *
 * Settlement lines are the documented exception: the amount is an unbounded
 * bankroll figure, so no clip library can cover them.
 */

const CLIPS_DIR = fileURLToPath(new URL('../public/clips', import.meta.url));
const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
const ACTIONS: Action[] = ['hit', 'stand', 'double', 'split', 'surrender'];

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
 * generated clips and nothing said so.
 */
function everyCorrection(): string[] {
  const texts = new Set<string>();
  for (const reason of reachableReasons()) {
    for (const expected of ACTIONS) {
      for (const tc of [-20, -4, -1, 0, 3, 20]) {
        texts.add(
          narrateCorrection({ correct: false, reason, expected, tc } as unknown as GradedEvent),
        );
      }
    }
  }
  return [...texts];
}

/** The prompts and running commentary, across both hand-narration styles. */
function everyPromptAndCommentary(): string[] {
  const texts = new Set<string>([
    narrateCountPrompt(),
    narrateInsuranceOffer(),
    narrateShuffle(),
    narrateSitOut(),
  ]);

  for (let rc = -20; rc <= 20; rc++) texts.add(narrateCountAnswer(rc));
  for (const rank of RANKS) texts.add(narrateDealerUp(rank));

  for (const seat of ['P1', 'P2', 'P3', 'P4', 'P5']) {
    for (const action of ACTIONS) {
      texts.add(narrateBotAction(seat, action));
      for (const rank of RANKS) {
        for (const suit of SUITS) texts.add(narrateBotAction(seat, action, { rank, suit }));
      }
    }
  }

  for (let seed = 0; seed < 400; seed++) {
    for (const category of ['all', 'hard', 'soft', 'pairs'] as const) {
      const fc = drawFlashcard(category, {}, 0, seed, DEFAULT_RULES);
      for (const style of ['cards', 'total'] as const) {
        texts.add(narrateFlashcardPrompt(fc.cards, fc.up, style));
      }
    }
    const quiz = drawQuizItem(seed, undefined, DEFAULT_RULES, 50);
    for (const tc of [-6, -1, 0, 2, 7]) {
      for (const style of ['cards', 'total'] as const) {
        texts.add(narrateQuizPrompt(quiz.cards, quiz.up, tc, style));
      }
    }
  }
  return [...texts];
}

describe('shipped clip coverage', () => {
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

    it(`resolves every prompt, bot turn and count read-back (${voice})`, () => {
      const manifest = manifestFor(voice);
      const unresolved = everyPromptAndCommentary().filter(
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

    /**
     * ...and the reverse, which is not symmetry for its own sake: an orphan is
     * a file every visitor downloads and nothing can ever play. Two had already
     * accumulated -- `basic-stand-versus-dealer-t.mp3` from the 'T'/'10' rank
     * bug, and `whats-the-running-count.mp3` from before slugs encoded terminal
     * punctuation -- and neither was visible from anywhere.
     */
    it(`ships no clip file the manifest does not name (${voice})`, () => {
      const named = new Set(Object.values(manifestFor(voice)));
      const orphans = readdirSync(`${CLIPS_DIR}/${voice}`)
        .filter((f) => f.endsWith('.mp3'))
        .filter((f) => !named.has(f));
      expect(orphans).toEqual([]);
    });

    /** "Correct." was covered and "Wrong." was not, for a long time. */
    it(`covers both verdicts, not just the happy one (${voice})`, () => {
      const manifest = manifestFor(voice);
      expect(segmentForClips('Correct.', manifest)).not.toBeNull();
      expect(segmentForClips('Wrong.', manifest)).not.toBeNull();
    });
  }
});
