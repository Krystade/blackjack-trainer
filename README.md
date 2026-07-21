# Blackjack Trainer

A phone-first static web app for practicing Hi-Lo card counting. Train with full blackjack simulation graded against perfect basic strategy and the H17-adjusted Illustrious 18.

## What It Is

**Blackjack Trainer** simulates realistic casino blackjack with instant strategy feedback:
- Grading against **perfect basic strategy** + the **Illustrious 18** deviation index (H17-adjusted)
- Three specialized drill modes: count speed, basic-strategy flashcards, and deviation quiz
- Built for practicing on a phone with offline-capable design

## Table Rules Implemented

- **Decks**: 6-deck shoe
- **Dealer**: Hits soft 17 (H17)
- **Splits**: Double after split (DAS), resplit up to 4 hands, split aces receive one card each
- **Surrender**: Late surrender available
- **Payout**: 3:2 blackjack
- **Game**: Peek game enabled

## Card Counting: Hi-Lo System

**Running Count**:
- 2–6: +1 per card
- 7–9: 0 per card
- 10, A: −1 per card

**True Count** = Running Count ÷ Decks Remaining (floored using half-deck estimation)

The app includes the full **Illustrious 18 deviation table** with H17 adjustments. Every deviation threshold and basic strategy cell is verified against vendored source documents in `docs/sources/`.

## Modes

**Training Mode**: Instant correction—the rule or index that applies is shown immediately after each decision.

**Test Mode**: Silent play with end-of-session report showing accuracy, count checks, and strategy adherence.

**Optional**: Bet-spread practice with simulated bankroll management; count accuracy checks every N rounds.

## Audio & car use

Audio is **opt-in** — enable it on the Settings screen (Audio section). It defaults to off.

- **First speech needs a tap.** Browsers block speech synthesis until a user gesture unlocks it. Use the **Test audio** button on the Settings screen, or a drill's **Start** button — either satisfies it.
- **Keep the tab foregrounded.** Audio pauses when the tab is backgrounded or the phone locks; browsers suspend `speechSynthesis` (and often reclaim the screen) in that state, and it won't resume speaking silently in the background.
- **The screen stays awake automatically** while an audio mode is running, via the Screen Wake Lock API. This is best-effort: unsupported browsers silently skip it (no error, no crash), and the lock is dropped and reacquired if the tab is hidden and shown again.
- **Voice availability and quality vary by device and OS.** The voice picker in Settings lists whatever voices the browser/OS expose — pick whichever sounds clearest.

### Manual QA checklist (real phone)

Run through this on an actual device before relying on audio for a drive — unit tests can't verify browser/OS audio behavior:

- [ ] Settings → Audio → **Voice** picker lists real device voices (not just "Default").
- [ ] Start an audio mode, let the phone sit idle for a couple minutes — speech keeps working and the screen does not sleep.
- [ ] Chimes (good/bad/attention) are clearly audible over road noise at a normal listening volume.
- [ ] In an eyes-free drill, blind zone taps register correctly through a screen protector.

## Getting Started

```bash
npm install
npm run dev
```

## Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run dev` | Start dev server (hot reload) |
| `npm test` | Run 594 unit tests (every strategy cell and index threshold pinned) |
| `npm run e2e` | Run Playwright e2e tests (15 tests + screenshots) |
| `npm run build` | Build production output to `dist/` |

## Deploying

The `dist/` folder contains a static site ready to deploy anywhere.

**GitHub Pages** (automatic):
1. Push to the `main` branch
2. Enable Pages in repository Settings → Pages → Source: GitHub Actions
3. The workflow (`.github/workflows/deploy.yml`) builds and deploys automatically on every push

The workflow:
- Installs dependencies
- Runs full test suite
- Builds production output
- Deploys to GitHub Pages

The GitHub Actions workflow gates deploys on the unit test suite (`npm test`) and the production build (`npm run build`) only; the Playwright e2e suite is not run in CI and must be run locally (`npm run e2e`) before pushing.

## Browser Storage

Stats and settings are stored in the browser's **localStorage** (per device). Use the **Export/Import** buttons on the Stats screen to move your progress and preferences between devices or browsers.

## Testing

- **Unit tests** (594 tests): Coverage of every strategy-chart cell and every Illustrious 18 index threshold
- **E2E tests** (15 tests): Playwright suite with visual regression screenshots

Run tests locally:
```bash
npm test              # Unit tests
npm run e2e           # E2E tests
```

The CI/CD pipeline runs unit tests + build before each deploy; e2e tests are run locally (see Deploying above).
