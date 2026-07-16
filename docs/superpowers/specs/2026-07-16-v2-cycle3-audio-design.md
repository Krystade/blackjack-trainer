# v2 Cycle 3 — App-Wide Audio for Eyes-Free Car Use

**Date:** 2026-07-16
**Status:** Approved (owner directive 2026-07-16: autonomous completion; "both, phased"
audio chosen by owner in cycle-scoping Q&A; tap-zone answers, no voice input)
**Builds on:** v1 + cycle-1 (profiles) + cycle-2 (seats — narration must cover bots).

## Goal

Phase A: everything important in the app is spoken and/or chimed, so a passenger barely
needs to look. Phase B: the three drills gain true eyes-free modes — the app speaks the
drill, you answer by large fixed blind-tap zones with spoken confirmation — usable
without ever looking at the phone. No voice input (Chrome-only, network-dependent,
road-noise-fragile); explicitly deferred.

## Audio service (`src/audio/`)

```ts
export interface AudioSettings { enabled: boolean; verbosity: 'off'|'results'|'full';
  rate: number /*0.7..1.5*/; voiceURI: string|'default'; chimes: boolean; }
// Settings gains audio: AudioSettings (default: enabled false — audio is opt-in;
// browsers require a user gesture before speech anyway)
speak(text: string, opts?: { interrupt?: boolean }): void   // speechSynthesis queue wrapper
chime(kind: 'good'|'bad'|'attention'): void                 // WebAudio oscillator tones (no asset files)
```

- Pure **script builders** (`narrate.ts`) turn engine events into strings —
  `narrateCard(card) → "queen of hearts"`, `narrateAction`, `narrateResult`,
  `narrateCorrection(event) → "Wrong. Sixteen versus nine stands at true count plus four
  and above. True count was plus five."` — fully unit-testable with zero audio.
- Speech layer is a thin, untested-by-unit wrapper over `window.speechSynthesis`
  (guarded for absence); e2e hooks: `?e2e=1` records every speak() call to
  `window.__speechLog` for assertion, and mutes real synthesis.
- iOS/Android realities: first speak() must follow a user gesture (the mode's Start
  button satisfies this); screen kept awake via Wake Lock API when an audio mode is
  active (graceful no-op where unsupported); audio pauses if the tab backgrounds —
  document in README.

## Phase A — narration + chimes (whole app)

Verbosity 'results': round results ("Win, plus two"), corrections (training mode),
count-check prompts and verdicts, drill feedback, shuffle announcements. Verbosity
'full' adds: every dealt card by name in dealing order (including bot cards — this IS
count practice), bot actions ("player two hits… ten of clubs"), dealer play, insurance
offers. Chimes: good/bad on grading, attention before count checks. Settings screen
gains the Audio section (enabled, verbosity, rate, voice picker from
`speechSynthesis.getVoices()`, chimes, test button).

## Phase B — eyes-free drill modes

Each drill's setup gains "Eyes-free audio" toggle (requires audio enabled):

- **Audio count drill:** speaks cards at the configured pace (or manual: ANY tap
  anywhere advances — pairs with cycle-1 manual mode). At the end: "What's the running
  count? … The count is minus three." — a spoken-answer-after-pause self-check
  (honor system; pause length setting 2–5 s). Optional strict mode: keypad entry with
  spoken keys (passenger use).
- **Audio flashcards / deviation quiz:** speaks the scenario ("You have fourteen.
  Dealer shows ten." / quiz adds "True count plus four."), then waits for a tap in one
  of five FIXED full-screen zones — top-left Hit, top-right Stand, bottom-left Double,
  bottom-right Split, center Surrender (for insurance items: left Take, right Decline).
  Zone tapped is spoken back ("Stand… correct" + chime; wrong answers get the full
  correction script). Zones never move; a long-press anywhere repeats the prompt. All
  grading identical to visual modes (same GradedEvents/stats).

## Testing

- Unit: every script builder (cards incl. suit names, corrections for basic vs index
  reasons with sign-correct TC wording, results, bot actions) — pure string assertions.
- Unit: tap-zone hit-testing math (x/y → action for the 5-zone layout).
- E2e: enable audio via settings bootstrap; run a training round and each eyes-free
  drill asserting `window.__speechLog` contents (order + key phrases); chime calls
  logged; screenshots of audio modes + zone overlays (coordinator-reviewed).
- Manual QA checklist in README (real-device voice/lock-screen behavior).

## Atomic decomposition (lowest-level pieces)

C3.1 Audio service: speak/chime wrappers + AudioSettings + settings migration + e2e speech-log hook
C3.2 narrate.ts script builders + full unit suite (cards, results, corrections, count checks, bots, insurance)
C3.3 Settings UI: Audio section (toggles, verbosity, rate, voice picker, test button)
C3.4 Phase A wiring: Table narration (deal/actions/results/corrections/insurance/count checks/shuffle) at both verbosities + chimes
C3.5 Phase A wiring: drills + stats screens narration (feedback, drill results)
C3.6 Wake Lock integration for audio modes + README device-behavior notes
C3.7 Eyes-free count drill (spoken stream, manual-tap advance, spoken self-check answer, strict keypad option)
C3.8 Five-zone blind input component (fixed zones, long-press repeat, spoken echo) + hit-test unit tests
C3.9 Eyes-free flashcards + deviation quiz on the zone component (insurance two-zone variant)
C3.10 E2e specs (__speechLog assertions per mode) + screenshots + coordinator review

Out of scope: voice input; background-tab audio; recorded voice assets; per-voice
pronunciation tuning beyond rate; audio for Settings/profile-editor screens.
