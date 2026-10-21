#!/usr/bin/env python3
"""
Generate the pre-rendered audio clip library for the eyes-free drills.

WHY: on some platforms (notably iOS Safari) the Web Speech API can only reach
low-quality "robotic" voices — the good Siri/Enhanced voices are unreachable
from the browser. For the small, FIXED vocabulary the eyes-free drills speak,
we can instead ship pre-rendered neural-voice clips and play them back with
the Web Audio API. Anything not in a manifest falls back to live TTS at
runtime, so this is a pure enhancement — never a hard dependency.

This runs ONCE at build time on a developer machine. The shipped app has NO
runtime dependency on any TTS endpoint; it just serves the static mp3 files
under public/clips/. Only the fixed, non-sensitive vocabulary below is sent to
the chosen TTS backend during generation ("queen", "plus five", …).

The vocabulary is a set of concatenation-ready SEGMENTS: the runtime resolves
a to-speak string longest-first (whole-string exact match, then per-sentence
split on ". " / "? " / "! " keeping the terminal punctuation, then
per-comma-item dropping commas). Every string below is one such segment,
mirrored EXACTLY (including capitalization and punctuation) from
src/audio/narrate.ts and the local helpers in
src/ui/screens/drills/TrueCountDrillView.tsx. If that wording ever drifts,
re-run this; if a key ever drifts out of sync, the runtime simply falls back
to live speech for that segment — never a hard failure.

CORRECTIONS AND BOT TURNS ARE NO LONGER OUT OF SCOPE. Neither can be mirrored
here by hand — a correction's reason text comes out of the strategy engine and
the deviation set, through narrateReason's nine-step rewrite — so both are
DERIVED from the real TypeScript modules by scripts/spokenPhrases.ts and read
from scripts/spoken-phrases.json. Regenerate that file (and re-run this) with:

    UPDATE_SPOKEN_PHRASES=1 npx vitest run scripts/

scripts/spokenPhrases.test.ts fails if the app's wording drifts away from the
committed list, which is the alarm this file never had — see the soft-hand
note in build_vocabulary() for what silent drift costs.

STILL OUT OF SCOPE, and permanently: table settlement lines with amounts. The
amount is a bankroll figure with no upper bound, so that sentence set cannot be
enumerated at all — those stay on the live-TTS runtime fallback.

Usage:
    pip install edge-tts                          # --engine edge (default)
    python scripts/generate-audio-clips.py --list  # print vocab, no synth, no backend import
    python scripts/generate-audio-clips.py --list-json  # the vocab as a JSON list (scripts/clipManifest.test.ts)

    # Single voice, default backend (edge-tts):
    python scripts/generate-audio-clips.py --voice en-US-AriaNeural

    # Multiple voices in one run (comma-list or repeated --voice):
    python scripts/generate-audio-clips.py --voice en-US-AriaNeural,en-US-GuyNeural
    python scripts/generate-audio-clips.py --voice en-US-AriaNeural --voice en-US-GuyNeural \\
        --label en-US-AriaNeural=Aria --label en-US-GuyNeural=Guy

    # Kokoro (local ONNX model — no network):
    pip install kokoro-onnx soundfile
    python scripts/generate-audio-clips.py --engine kokoro --model-dir ./models \\
        --voice af_heart

    # ElevenLabs (needs ELEVENLABS_API_KEY in the environment):
    pip install requests
    python scripts/generate-audio-clips.py --engine elevenlabs --voice <voiceId>

Output layout (multi-voice):
    public/clips/<voiceId>/<slug>.mp3
    public/clips/<voiceId>/manifest.json   { "clips": { "<text>": "<slug>.mp3", ... } }
    public/clips/index.json                { "voices": [{"id","label"}, ...], "default": "<id>" }

A run MERGES into what is already there (Wave L review S2): an existing
manifest entry outside today's vocabulary is kept, with a warning, as long as
its file is still on disk, and index.json keeps the voices this run did not
touch. Overwriting used to drop every hand-recorded line at once (31 Drive
checks lines per voice) and every other voice from the index.
scripts/clipManifest.test.ts holds the other half: every shipped manifest key
must be in build_vocabulary(), so a line recorded by hand without being
derived fails there rather than lingering as a kept orphan.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

# --- Vocabulary, mirrored EXACTLY from src/audio/narrate.ts and the local ---
# --- helpers in src/ui/screens/drills/TrueCountDrillView.tsx. ---------------

RANK_NAMES = ["ace", "two", "three", "four", "five", "six", "seven", "eight",
              "nine", "ten", "jack", "queen", "king"]
SUIT_NAMES = ["spades", "hearts", "diamonds", "clubs"]

# RANK_PLURAL from narrate.ts, in the same order as RANK_NAMES.
RANK_PLURAL = ["aces", "twos", "threes", "fours", "fives", "sixes", "sevens",
               "eights", "nines", "tens", "jacks", "queens", "kings"]

# NUMBER_WORDS[0..20] from narrate.ts — numberWord() falls back to digits
# beyond this range (e.g. 21 -> "21"), which is intentional and mirrored here.
NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven",
                "eight", "nine", "ten", "eleven", "twelve", "thirteen",
                "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
                "nineteen", "twenty"]

# DECK_WORDS from TrueCountDrillView.tsx.
DECK_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven",
              "eight"]


def number_word(n: int) -> str:
    """Mirror of numberWord() in narrate.ts."""
    if 0 <= n < len(NUMBER_WORDS):
        return NUMBER_WORDS[n]
    return str(n)


def narrate_tc(tc: int) -> str:
    """Mirror of narrateTc() in narrate.ts."""
    if tc == 0:
        return "zero"
    if tc > 0:
        return f"plus {number_word(tc)}"
    return f"minus {number_word(abs(tc))}"


def narrate_total(total: int, soft: bool) -> str:
    """Mirror of narrateTotal() in narrate.ts."""
    word = number_word(total)
    return f"soft {word}" if soft else word


def capitalize(s: str) -> str:
    """Mirror of the local capitalize() helpers (narrate.ts / TrueCountDrillView.tsx)."""
    return s[:1].upper() + s[1:] if s else s


def narrate_decks_remaining(decks: float) -> str:
    """Mirror of narrateDecksRemaining() in TrueCountDrillView.tsx."""
    whole = int(decks // 1)
    is_half = (decks % 1) != 0
    whole_word = DECK_WORDS[whole] if 0 <= whole < len(DECK_WORDS) else str(whole)
    if whole == 0 and is_half:
        return "half a deck remaining"
    if is_half:
        return f"{whole_word} and a half decks remaining"
    return f"{whole_word} {'deck' if whole == 1 else 'decks'} remaining"


SPOKEN_PHRASES_PATH = Path(__file__).with_name("spoken-phrases.json")


def load_spoken_phrases() -> list[str]:
    """Every sentence a correction or a bot turn can consist of.

    Generated from the app's own modules (scripts/spokenPhrases.ts), never
    written by hand: the reason half of a correction is produced by the strategy
    engine and the deviation set, and no Python mirror of that could stay
    correct.
    """
    try:
        with SPOKEN_PHRASES_PATH.open(encoding="utf-8") as fh:
            phrases = json.load(fh)
    except FileNotFoundError:
        print(f"warning: {SPOKEN_PHRASES_PATH} missing — corrections and bot "
              f"turns will fall back to live TTS. Regenerate with "
              f"`UPDATE_SPOKEN_PHRASES=1 npx vitest run scripts/`.",
              file=sys.stderr)
        return []
    if not isinstance(phrases, list) or not all(isinstance(p, str) for p in phrases):
        print(f"error: {SPOKEN_PHRASES_PATH} is not a list of strings",
              file=sys.stderr)
        sys.exit(2)
    return phrases


def build_vocabulary() -> list[str]:
    """Every fixed, concatenation-ready segment the eyes-free drills can speak.

    Composed/dynamic strings (results with amounts, corrections with reasons,
    multi-card groups) are intentionally NOT here — they fall back to live TTS.
    """
    phrases: list[str] = []

    # Bare card items — used as per-comma-item segments in card lists.
    # Single-card narration in 'rank' detail (default): bare rank word.
    phrases.extend(RANK_NAMES)

    # Single-card narration in 'full' detail: "<rank> of <suit>".
    for rank in RANK_NAMES:
        for suit in SUIT_NAMES:
            phrases.append(f"{rank} of {suit}")

    # narrateCountAnswer(rc) = "The count is <tc>."
    for tc in range(-20, 21):
        phrases.append(f"The count is {narrate_tc(tc)}.")

    # Fixed prompts / interjections.
    phrases.append("What's the running count?")
    phrases.append("Shuffling.")
    phrases.append("Correct.")
    phrases.append("Insurance offered.")
    # H5: Settings' "Test audio" line opens with this (narrate.ts
    # TEST_AUDIO_LINE). Unrecorded, the all-or-nothing cascade sent the whole
    # test to live TTS -- the button tested the voice the car does not use.
    phrases.append("Audio is working.")

    # Flashcard sentences: "You have <phrase>." — hard totals, soft totals,
    # and pairs (narrateFlashcardPrompt's narrateHandTotalPhrase()).
    for total in range(4, 22):  # hard totals 4..21 ("twenty-one" is never
        phrases.append(f"You have {narrate_total(total, False)}.")  # spoken — 21 falls back to digits, per numberWord)
    for total in range(12, 22):  # soft totals soft-twelve..soft-twenty, soft 21
        phrases.append(f"You have {narrate_total(total, True)}.")
    for plural in RANK_PLURAL:  # "a pair of <plural>"
        phrases.append(f"You have a pair of {plural}.")

    # narrateDealerUp(up) = "Dealer shows <rank>."
    for rank in RANK_NAMES:
        phrases.append(f"Dealer shows {rank}.")

    # Quiz: "True count <tc>." (also reused verbatim by the true-count drill's
    # result/self-check line — de-duped naturally since the text is identical).
    for tc in range(-20, 21):
        phrases.append(f"True count {narrate_tc(tc)}.")

    # True-count drill: narrateTcQuestion()'s "Running count <tc>." sentence.
    for tc in range(-20, 21):
        phrases.append(f"Running count {narrate_tc(tc)}.")

    # True-count drill: narrateDecksRemaining(), capitalized as a sentence.
    deck_values: list[float] = [0.5]  # "half a deck remaining"
    deck_values.extend(w + 0.5 for w in range(1, 9))  # "<word> and a half decks remaining"
    deck_values.append(1.0)  # "one deck remaining"
    deck_values.extend(range(2, 9))  # "<word> decks remaining"
    for decks in deck_values:
        phrases.append(f"{capitalize(narrate_decks_remaining(decks))}.")

    # narrateHandPhrase(style='cards') — the DEFAULT since the card-by-card
    # soft-hand change. A soft non-pair hand is spoken as its two ranks
    # ("You have ace, three.") rather than as a total, and the generator
    # predated that: every soft non-pair prompt therefore missed the cascade
    # and fell back to live TTS. Because the fallback is whole-utterance, it
    # also cost the already-covered "Dealer shows nine." half of the line.
    # Both orders are needed — the ace is whichever card was dealt first.
    non_ace = [r for r in RANK_NAMES if r != "ace"]
    for other in non_ace:
        phrases.append(f"You have ace, {other}.")
        phrases.append(f"You have {other}, ace.")

    # gateDrillAnswer()'s refusal (A1). Spoken when an unavailable action is
    # tapped on the eyes-free ZonePad, which has no disabled state — so this
    # line IS the affordance, and it deserves the good voice.
    for action in ["Hit", "Stand", "Double", "Split", "Surrender"]:
        phrases.append(f"{action} isn't available on this hand.")

    # narrateCorrection() opens with a bare "Wrong." sentence; only "Correct."
    # was covered, so every miss dropped to live TTS on its first word.
    phrases.append("Wrong.")

    # ...and the rest of that same utterance, which the "Wrong." clip alone
    # could never rescue: segmentation is ALL-OR-NOTHING, so one unmatched
    # sentence sent the whole correction to live TTS anyway. The same list now
    # carries every bot turn ("Player two hits." / "Ten of clubs."), the table's
    # most frequent utterance and previously unclipped in full. Derived from the
    # real modules rather than mirrored here — see the header.
    phrases.extend(load_spoken_phrases())

    # Wave N: the daily-goal moment (src/habits/moment.ts): "Daily goal done."
    # then the streak sentence, one clip per streak length up to one hundred.
    phrases.extend(moment_sentences())

    # De-dupe while preserving order (e.g. "True count <tc>." appears once
    # from the quiz section and once from the true-count drill's own helper —
    # they mirror the identical wording, so only one clip is generated).
    seen: set[str] = set()
    unique: list[str] = []
    for p in phrases:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return unique


TENS_WORDS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
              "eighty", "ninety"]


def streak_number_word(n: int) -> str:
    """Mirror of streakNumberWord() in src/habits/moment.ts."""
    if n <= 20:
        return number_word(n)
    if n == 100:
        return "one hundred"
    t, u = divmod(n, 10)
    return TENS_WORDS[t] if u == 0 else f"{TENS_WORDS[t]}-{number_word(u)}"


def moment_sentences() -> list[str]:
    """Mirror of allMomentSentences() in src/habits/moment.ts."""
    out = ["Daily goal done.", "A new streak starts today.", "Over one hundred days in a row."]
    for n in range(2, 101):
        out.append(f"{capitalize(streak_number_word(n))} days in a row.")
    return out


# Terminal punctuation, encoded into the slug rather than thrown away.
#
# The slug lowercases and strips punctuation, so "ace of clubs" (a comma item
# inside a flashed card group) and "Ace of clubs." (the second sentence of a bot
# turn) reduced to the same filename and tripped the collision guard. They are
# NOT the same utterance to a synthesiser: a list item runs on, a sentence falls
# at the end, and giving a bot turn the list-item recording would leave every
# card sounding like it expects another one. Same story for "Correct." against a
# spoken read-back's "Correct?".
#
# "." keeps the bare slug so the clips already generated for it stay valid.
TERMINAL_SUFFIX = {".": "", "?": "-q", "!": "-ex"}
ITEM_SUFFIX = "-item"


def slug(text: str) -> str:
    """Deterministic, filesystem-safe id for an utterance."""
    s = text.lower().strip()
    s = s.replace("'", "")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-") + TERMINAL_SUFFIX.get(text.strip()[-1:], ITEM_SUFFIX)


def build_manifest(vocab: list[str]) -> dict[str, str]:
    """text -> filename map, with a slug-collision guard: two different
    utterances must never share a file."""
    manifest: dict[str, str] = {}
    slug_to_text: dict[str, str] = {}
    for text in vocab:
        s = slug(text)
        if s in slug_to_text and slug_to_text[s] != text:
            print(f"SLUG COLLISION: {s!r} <- {slug_to_text[s]!r} and {text!r}",
                  file=sys.stderr)
            sys.exit(2)
        slug_to_text[s] = text
        manifest[text] = f"{s}.mp3"
    return manifest


def merge_manifest(
    fresh: dict[str, str], previous: dict[str, str], file_exists
) -> tuple[dict[str, str], list[str]]:
    """Today's manifest plus every previous entry it lacks whose file still
    exists. Returns (merged, kept): `kept` names the entries carried over, so
    the run can say so. A fresh entry always wins for its own text."""
    merged = dict(fresh)
    kept: list[str] = []
    taken = set(fresh.values())
    for text, filename in previous.items():
        if text in merged or filename in taken or not file_exists(filename):
            continue
        merged[text] = filename
        taken.add(filename)
        kept.append(text)
    return merged, kept


def read_manifest(path: Path) -> dict[str, str]:
    """The clips map of an existing manifest.json, or {} when there is none."""
    try:
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return {}
    clips = data.get("clips", {}) if isinstance(data, dict) else {}
    return {k: v for k, v in clips.items() if isinstance(k, str) and isinstance(v, str)}


def merge_index(previous: dict, voices: list[str], labels: dict[str, str]) -> dict:
    """index.json with this run's voices added (or relabelled where --label
    says so) and every other voice kept. The default stays unless it is gone."""
    entries = [v for v in previous.get("voices", []) if isinstance(v, dict) and "id" in v]
    by_id = {v["id"]: v for v in entries}
    for v in voices:
        if v in by_id:
            if v in labels:
                by_id[v]["label"] = labels[v]
        else:
            entry = {"id": v, "label": labels.get(v, default_label(v))}
            entries.append(entry)
            by_id[v] = entry
    default = previous.get("default")
    if default not in by_id:
        default = voices[0]
    return {"voices": entries, "default": default}


# --- TTS backends. Each module is imported lazily, inside its synth ---------
# --- function, so `--list` (and picking a different --engine) never pays ---
# --- for or requires the other backends' dependencies. -----------------------

async def synth_edge(text: str, path: Path, voice: str) -> None:
    import edge_tts  # imported lazily so --list works without the dep

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(path))


_kokoro_instance = None  # loaded once per run, reused across all clips/voices


def _get_kokoro(model_dir: str):
    global _kokoro_instance
    if _kokoro_instance is None:
        from kokoro_onnx import Kokoro  # imported lazily

        model_path = Path(model_dir) / "kokoro-v1.0.onnx"
        voices_path = Path(model_dir) / "voices-v1.0.bin"
        _kokoro_instance = Kokoro(str(model_path), str(voices_path))
    return _kokoro_instance


async def synth_kokoro(text: str, path: Path, voice: str, model_dir: str) -> None:
    import soundfile as sf  # imported lazily

    def _do() -> None:
        k = _get_kokoro(model_dir)
        samples, sr = k.create(text, voice=voice, speed=1.0, lang="en-us")
        sf.write(str(path), samples, sr, format="MP3")

    # Kokoro inference is CPU-bound and blocking; run it off the event loop
    # so the semaphore-bounded gather() still overlaps work across voices.
    await asyncio.to_thread(_do)


async def synth_elevenlabs(text: str, path: Path, voice: str) -> None:
    import os

    import requests  # imported lazily

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise RuntimeError(
            "ELEVENLABS_API_KEY is not set in the environment — never hardcode a key"
        )
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {"text": text}

    def _do() -> None:
        resp = requests.post(url, headers=headers, json=payload, timeout=60)
        resp.raise_for_status()
        path.write_bytes(resp.content)

    await asyncio.to_thread(_do)


async def synth_one(engine: str, text: str, path: Path, voice: str, model_dir: str) -> None:
    if engine == "edge":
        await synth_edge(text, path, voice)
    elif engine == "kokoro":
        await synth_kokoro(text, path, voice, model_dir)
    elif engine == "elevenlabs":
        await synth_elevenlabs(text, path, voice)
    else:
        raise ValueError(f"unknown engine {engine!r}")


# --- Multi-voice plumbing -----------------------------------------------------

DEFAULT_VOICE_BY_ENGINE = {"edge": "en-US-AriaNeural"}


def parse_voices(raw: list[str]) -> list[str]:
    """--voice is repeatable and/or comma-separated; de-dupe, preserve order."""
    voices: list[str] = []
    for item in raw:
        for v in item.split(","):
            v = v.strip()
            if v and v not in voices:
                voices.append(v)
    return voices


def resolve_voices(args: argparse.Namespace) -> list[str]:
    voices = parse_voices(args.voice)
    if voices:
        return voices
    default = DEFAULT_VOICE_BY_ENGINE.get(args.engine)
    return [default] if default else []


def parse_labels(raw: list[str]) -> dict[str, str]:
    labels: dict[str, str] = {}
    for item in raw:
        if "=" not in item:
            print(f"invalid --label {item!r}, expected id=Name", file=sys.stderr)
            sys.exit(2)
        vid, _, name = item.partition("=")
        labels[vid] = name
    return labels


def default_label(voice_id: str) -> str:
    """Title-case fallback display name for a voice id with no --label."""
    s = re.sub(r"[-_]+", " ", voice_id).strip()
    return s.title() if s else voice_id


# --- Main ---------------------------------------------------------------------

async def main_async(args: argparse.Namespace) -> int:
    vocab = build_vocabulary()
    manifest = build_manifest(vocab)

    if args.list_json:
        # ASCII-escaped: a Windows console would re-encode a raw em dash.
        print(json.dumps(vocab))
        return 0

    if args.list:
        for text in vocab:
            print(f"{slug(text):45s}  {text}")
        print(f"\n{len(vocab)} clips", file=sys.stderr)
        return 0

    voices = resolve_voices(args)
    if not voices:
        print(f"error: --voice is required for engine {args.engine!r} (no default)",
              file=sys.stderr)
        return 2
    labels = parse_labels(args.label)

    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)

    # Bounded concurrency (shared across voices) so we don't hammer the endpoint.
    sem = asyncio.Semaphore(args.concurrency)
    any_failures = False

    for voice in voices:
        voice_dir = out_root / voice
        voice_dir.mkdir(parents=True, exist_ok=True)
        failures: list[str] = []

        async def worker(text: str, voice_dir: Path = voice_dir, voice: str = voice) -> None:
            path = voice_dir / manifest[text]
            if path.exists() and not args.force:
                return
            async with sem:
                try:
                    await synth_one(args.engine, text, path, voice, args.model_dir)
                except Exception as e:  # noqa: BLE001 - report and continue
                    failures.append(f"{text!r}: {e}")

        await asyncio.gather(*(worker(t) for t in vocab))

        if failures:
            any_failures = True
            print(f"[{voice}] {len(failures)} clip(s) FAILED:", file=sys.stderr)
            for f in failures:
                print(f"  {f}", file=sys.stderr)
            continue

        manifest_path = voice_dir / "manifest.json"
        merged, kept = merge_manifest(
            manifest, read_manifest(manifest_path), lambda f, d=voice_dir: (d / f).exists()
        )
        if kept:
            print(f"[{voice}] kept {len(kept)} recorded clip(s) outside the vocabulary "
                  f"(derive them in scripts/spokenPhrases.ts; clipManifest.test.ts fails until then):",
                  file=sys.stderr)
            for text in kept:
                print(f"  {text!r}", file=sys.stderr)
        manifest_path.write_text(
            json.dumps({"clips": merged}, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        total = sum(
            (voice_dir / f).stat().st_size for f in merged.values() if (voice_dir / f).exists()
        )
        print(f"[{voice}] generated {len(vocab)} clips ({total / 1024:.0f} KB) -> {voice_dir}")
        print(f"[{voice}] manifest: {manifest_path}")

    index_path = out_root / "index.json"
    try:
        previous_index = json.loads(index_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        previous_index = {}
    index = merge_index(previous_index if isinstance(previous_index, dict) else {}, voices, labels)
    index_path.write_text(
        json.dumps(index, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"index: {index_path}")

    return 1 if any_failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--engine", choices=["edge", "kokoro", "elevenlabs"], default="edge",
                        help="TTS backend to synthesize with (default: edge)")
    parser.add_argument("--voice", action="append", default=[],
                        help="voice id; repeatable and/or comma-separated "
                             "(default: en-US-AriaNeural for --engine edge; "
                             "required for kokoro/elevenlabs)")
    parser.add_argument("--label", action="append", default=[],
                        help="id=Name display name for a voice; repeatable "
                             "(default: title-cased from the id)")
    parser.add_argument("--model-dir", default=".",
                        help="directory containing kokoro-v1.0.onnx + voices-v1.0.bin "
                             "(--engine kokoro only)")
    parser.add_argument("--out", default="public/clips")
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--force", action="store_true",
                        help="re-synthesize even if a clip file already exists")
    parser.add_argument("--list", action="store_true",
                        help="print the vocabulary and exit (no synthesis, no backend import)")
    parser.add_argument("--list-json", action="store_true",
                        help="print the vocabulary as a JSON list and exit")
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
