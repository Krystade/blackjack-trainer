# Second-Pass Priority List — 2026-07-21

Synthesis of three research streams (`training-tools-landscape.md`, `practitioner-pain-points.md`,
`web-tts-options.md`) plus the operator's road-test feedback (F1–F4) and the parked defect log.

**Status: APPROVED 2026-07-21 — operator goal is "autonomously complete all 3 tiers". Tier 1 in progress.**

## The strategic finding

No researched competitor — Casino Vérité (CVBJ), Blackjack Apprenticeship, Wizard of Odds,
Expert Card Counting — ships an **interactive eyes-free audio drill**. The only audio product
found was a passive sleep-learning track. Our audio layer is therefore not catch-up work; it is
the single feature this app has that the established tools do not.

That reframes the road-test bugs: **F1/F2 are not cosmetic polish, they are the differentiator
being broken on first contact.** They rank above new features.

The second finding: **true-count conversion** is independently confirmed as (a) an `[ESSENTIAL]`
missing drill by the tooling research and (b) the hard, error-prone step by the practitioner
research — described as "a physical skill, not a calculation". It is also *pure mental
arithmetic requiring no cards*, which makes it the ideal audio-native drill. It is the one item
that sits at the intersection of "essential gap" and "our differentiator".

## Ranked list

### Tier 1 — Restore the differentiator (do first, small, high-confidence)

| # | Item | Why it ranks here | Effort |
|---|---|---|---|
| 1 | **F2 — show labeled zones by default**; make screen-blanking an explicit "dim screen" opt-in | Blocking. Ticking eyes-free currently removes every answer affordance; operator read it as "the quiz is broken". Zones must be *learnable* before they can be used blind. `visible` prop already exists (T8) — T9 hardcoding `false` was the defect. | XS |
| 2 | **F1 — speech-driven pacing** for the count drill (await `onend`, then advance) | Blocking for car use. `speak()` silently queues (MDN), so a fixed-interval driver is structurally blind to falling behind and drift compounds every card. Not tunable — needs the clock inverted. Guard: hold an utterance reference (GC drops callbacks); Safari won't fire `onend` after `cancel()`. | S |
| 3 | **F3a — voice auto-selection heuristic** (prefer `Google`/`Natural`/`Neural`, penalise `Microsoft David`/`Zira`/`eSpeak`) | Largest perceived-quality win per line of code. The API exposes no quality flag, so name-scoring is what every real implementation does. | XS |
| 4 | **Card-detail narration setting**: `full` ("queen of hearts") / `rank` ("queen") / `face` (all ten-value cards collapse to "face" or "ten") | Operator request 2026-07-21. Suit is irrelevant to Hi-Lo and every ten-value card carries the same −1 tag, so collapsing them is both faster and closer to how a counter actually thinks. Shorter utterances also independently reduce drift. | XS |
| 4b | **F5 — Test-audio button ignores the selected voice and rate** | Operator: "I change the voice and retest and it doesn't change at all", on BOTH platforms. ROOT-CAUSED: `Settings.tsx:309` calls `speak(text, { interrupt: true })` with no `rate`/`voiceURI`, so it always uses the browser default. `useAudio` forwards both correctly, so the picker likely works everywhere EXCEPT the button used to test it — making a working feature look dead. Introduced by the T3 task brief. Also make voice lookup match on `voiceURI` **or** `name`, since iOS reports different/empty `voiceURI`s (operator sees a very different voice list on iPhone vs PC). | XS |

### Tier 2 — The essential missing drills (research-backed)

| # | Item | Why | Effort |
|---|---|---|---|
| 5 | **True-count conversion drill** — spoken "running count plus eight, two decks remaining" → answer the TC. Audio-native, no cards, works blind. | `[ESSENTIAL]` gap + confirmed hardest step + perfect fit for our differentiator. Note: practitioner research found **no widely-agreed benchmark** for TC-conversion speed (unlike deck countdown) — an opportunity to define one. | M |
| 6 | **Timed / auto-advancing count drill with speed ramp**, showing the **≤30 s per deck** table-ready benchmark (~20–25 s = "pro" tier) | `[ESSENTIAL]` gap: manual advance cannot train reaction time. The benchmark is well-sourced and convergent, cheap to display, and turns a drill into a goal. | S |
| 7 | **Deck / discard-tray depth-estimation drill** | Flagged the *clearest* missing capability; both CVBJ and BJA treat it as a skill distinct from counting — you can count perfectly and still get the TC wrong. **Caveat: inherently visual (judging a tray), so it cannot be an audio drill** — this one is for at-home practice. | M |
| 8 | **Per-drill speed & accuracy telemetry** with error-type breakdown | `[ESSENTIAL]` gap; also the prerequisite for items 5–7 to be measurable rather than vibes. | M |

### Tier 3 — Quality investment (validate before committing)

| # | Item | Why | Effort |
|---|---|---|---|
| 9 | **Pre-generated audio clip library** (~80 clips: 13 ranks, numbers ≈ −20..+20, ~20 phrases; ≈1 MB) played via Web Audio buffer scheduling | Fixes voice quality *and* timing determinism *and* offline-in-the-car reliability in one move. Generate once at build time with a client-side neural TTS — no API key, no backend, works on a static host. Supersedes #3 where it applies. | L |
| 10 | Voice **preview** in the settings picker | Cheap usability win; makes #3 self-serve. | XS |

**Gate before #9:** validate audio quality on the operator's *phone* first. All quality
complaints so far are from desktop Chrome (legacy SAPI5 voices), which is the worst case and
not the target device. Do not invest L-sized effort against a PC-only symptom.

**Known platform ceiling:** Apple engineers confirm Siri/Enhanced/Premium voices are unreachable
from the Web Speech API on iOS Safari. iOS will never sound great via live TTS — which is an
argument *for* #9 if the target device is an iPhone.

### Tier 4 — Parked (do not queue proactively)

M6 bot-mistake RNG correlated with shoe seed (fix changes seeded fixtures) · M8 bot cards render
instantly while narration paces · `dealSpeedMs` stale in-flight timer · `cvcxParse` single-space
decorated negative TC · payout audit's 2 trivial insurance quadrants · `game.ts` at 949 lines ·
`Stats.tsx` reads `loadSettings().audio` directly instead of via props · countdown/tag-guess
submode has no eyes-free support (deliberate exclusion, twice — confirm it should stay that way).

## Evidence quality — read this before trusting the above

- **Reddit (r/blackjack, r/CardCounting) was completely inaccessible** — a hard crawler block on
  every attempt. This is a gap, *not* "checked and found nothing." The demand signal for
  eyes-free/commute practice is therefore **inferred** (people improvise arithmetic drills while
  driving) rather than verified by explicit requests. The strongest direct evidence for that
  demand is the operator's own use case.
- `blackjackapprenticeship.com` and `blackjacktheforum.com` returned 403 on direct fetch; claims
  from them are tagged `[SEARCH-SNIPPET ONLY]` and treated as lower confidence.
- App-store feature requests are largely search-engine synthesis, not individually quote-verified.
- Speed benchmarks (#6) and the CVBJ feature inventory ARE high confidence — primary manuals and
  multiple independently-fetched threads.

## Recommendation

Do **Tier 1 in one pass** (four small items, all root-caused, all defending the differentiator),
then re-test on the phone in a car. Let that road test decide between Tier 2 (#5 first — it is
the intersection of essential and audio-native) and Tier 3 #9.

Do not start Tier 3 #9 before the phone test.
