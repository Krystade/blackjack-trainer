#!/usr/bin/env python3
"""
Generate the pre-rendered audio clip library for the eyes-free drills.

WHY: on some platforms (notably iOS Safari) the Web Speech API can only reach
low-quality "robotic" voices — the good Siri/Enhanced voices are unreachable
from the browser. For the small, FIXED vocabulary the eyes-free drills speak,
we can instead ship pre-rendered neural-voice clips and play them back with
the Web Audio API. Anything not in the manifest falls back to live TTS at
runtime, so this is a pure enhancement — never a hard dependency.

This runs ONCE at build time on a developer machine. The shipped app has NO
runtime dependency on any TTS endpoint; it just serves the static mp3 files
under public/clips/. Only the fixed, non-sensitive vocabulary below is sent to
Microsoft's endpoint during generation ("queen", "plus five", …).

The manifest keys are the EXACT strings emitted by src/audio/narrate.ts. If
narrate.ts wording changes, re-run this and the runtime lookup keeps matching;
if a key ever drifts, the runtime simply falls back to live speech for it.

Usage:
    pip install edge-tts
    python scripts/generate-audio-clips.py               # generate all
    python scripts/generate-audio-clips.py --voice en-US-GuyNeural
    python scripts/generate-audio-clips.py --list        # print vocab, no synth

Voice: a single fixed neural voice is inherent to a clip library (that is the
trade-off vs. live TTS, which is voice-configurable but lower quality on some
platforms). Default en-US-AriaNeural — clear and neutral.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

# --- Vocabulary, mirrored EXACTLY from src/audio/narrate.ts ------------------

RANK_NAMES = ["ace", "two", "three", "four", "five", "six", "seven", "eight",
              "nine", "ten", "jack", "queen", "king"]
SUIT_NAMES = ["spades", "hearts", "diamonds", "clubs"]

# NUMBER_WORDS[0..20] from narrate.ts
NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven",
                "eight", "nine", "ten", "eleven", "twelve", "thirteen",
                "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
                "nineteen", "twenty"]


def narrate_tc(tc: int) -> str:
    """Mirror of narrateTc() in narrate.ts."""
    if tc == 0:
        return "zero"
    if tc > 0:
        return f"plus {NUMBER_WORDS[tc]}"
    return f"minus {NUMBER_WORDS[abs(tc)]}"


def build_vocabulary() -> list[str]:
    """Every fixed, high-frequency utterance the eyes-free drills can speak.

    Composed/dynamic strings (results with amounts, corrections with reasons,
    multi-card groups) are intentionally NOT here — they fall back to live TTS.
    """
    phrases: list[str] = []

    # Single-card narration in 'rank'/'face' detail (default): bare rank word.
    phrases.extend(RANK_NAMES)

    # Single-card narration in 'full' detail: "<rank> of <suit>".
    for rank in RANK_NAMES:
        for suit in SUIT_NAMES:
            phrases.append(f"{rank} of {suit}")

    # narrateTc across the realistic true-count range (used by the count-drill
    # answer, the true-count drill, and correction tails).
    for tc in range(-20, 21):
        phrases.append(narrate_tc(tc))

    # narrateCountAnswer(rc) = "The count is <tc>."
    for tc in range(-20, 21):
        phrases.append(f"The count is {narrate_tc(tc)}.")

    # Fixed prompts / interjections.
    phrases.append("What's the running count?")
    phrases.append("Shuffling.")
    phrases.append("Correct.")
    phrases.append("Insurance offered.")

    # De-dupe while preserving order (rank words also appear inside card names,
    # but the bare-rank entries and "<rank> of <suit>" entries are distinct).
    seen: set[str] = set()
    unique: list[str] = []
    for p in phrases:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return unique


def slug(text: str) -> str:
    """Deterministic, filesystem-safe id for an utterance."""
    s = text.lower().strip()
    s = s.replace("'", "")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


async def synth_one(text: str, path: Path, voice: str) -> None:
    import edge_tts  # imported lazily so --list works without the dep

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(path))


async def main_async(args: argparse.Namespace) -> int:
    vocab = build_vocabulary()

    # slug collision guard — two different utterances must never share a file.
    manifest: dict[str, str] = {}
    slug_to_text: dict[str, str] = {}
    for text in vocab:
        s = slug(text)
        if s in slug_to_text and slug_to_text[s] != text:
            print(f"SLUG COLLISION: {s!r} <- {slug_to_text[s]!r} and {text!r}",
                  file=sys.stderr)
            return 2
        slug_to_text[s] = text
        manifest[text] = f"{s}.mp3"

    if args.list:
        for text in vocab:
            print(f"{slug(text):40s}  {text}")
        print(f"\n{len(vocab)} clips", file=sys.stderr)
        return 0

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Bounded concurrency so we don't hammer the endpoint.
    sem = asyncio.Semaphore(args.concurrency)
    failures: list[str] = []

    async def worker(text: str) -> None:
        path = out_dir / manifest[text]
        if path.exists() and not args.force:
            return
        async with sem:
            try:
                await synth_one(text, path, args.voice)
            except Exception as e:  # noqa: BLE001 - report and continue
                failures.append(f"{text!r}: {e}")

    await asyncio.gather(*(worker(t) for t in vocab))

    if failures:
        print(f"{len(failures)} clip(s) FAILED:", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        return 1

    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {"voice": args.voice, "clips": manifest},
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    total = sum(
        (out_dir / f).stat().st_size for f in manifest.values() if (out_dir / f).exists()
    )
    print(f"Generated {len(vocab)} clips ({total / 1024:.0f} KB) with voice "
          f"{args.voice} -> {out_dir}")
    print(f"Manifest: {manifest_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice", default="en-US-AriaNeural")
    parser.add_argument("--out", default="public/clips")
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--force", action="store_true",
                        help="re-synthesize even if a clip file already exists")
    parser.add_argument("--list", action="store_true",
                        help="print the vocabulary and exit (no synthesis)")
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
