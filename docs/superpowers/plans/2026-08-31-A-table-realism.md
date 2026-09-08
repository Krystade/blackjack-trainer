# Table Realism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Fix a real counting-accuracy bug: an all-naturals round (most commonly a solo player blackjack) never reveals or counts the dealer's hole card, so the trainer's shoe diverges from what a real table would show. (B) Give the table screen an actual "card comes from the deck and lands" entrance animation instead of cards just appearing, staggered across the opening two-pass deal, respecting `prefers-reduced-motion`, skippable, and paced by the existing "Deal speed" setting -- without ever delaying when a card is counted or when the player can act.

**Architecture:** (A) is a ~3-line engine fix: `Game.finishAfterPlayerDone()` currently short-circuits straight to `finishRound()` when every hand at the table is already resolved before the dealer's turn, skipping `playDealerAndSettle()` (and with it `revealHole()`) entirely. `playDealerAndSettle()` already has the correct casino logic (always reveal the hole; only draw further cards if some hand still needs a real dealer total) -- the fix is to stop bypassing it. (B) is presentation-only and touches no grading/counting/interaction: the engine gains a small write-once-per-round `dealOrder` log (mirroring the existing `botActionLog` pattern) recording the exact casino order of the opening two-pass deal; every dealt card is rendered in the DOM on the SAME render it always has been (no card's presence, attributes, or the running count are ever gated on a timer), and a CSS `animation-delay` computed from that log's index staggers the pure-visual entrance. A single React-side timer (mirroring the existing bot-narration pacing effect in `useGame.ts`) only decides how long to keep offering a skip control -- it never decides what is in the DOM.

**Tech Stack:** React 19 + TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` -- no enums, no constructor parameter properties), Vite, vitest (`include: ['src/**/*.test.ts']`, `environment: 'node'` -- no DOM, no `.test.tsx`), Playwright e2e (`?e2e=1`, helpers in `e2e/helpers.ts`).

**Spec:** Two verbatim operator requests (quoted in full in section 1 below) plus the operator's own framing notes on subtleties and constraints -- no separate spec document exists; this plan **is** the spec, argued from the operator's words plus the codebase facts gathered below.

## Global Constraints

- No enums, no constructor parameter properties (`erasableSyntaxOnly`).
- vitest only picks up `src/**/*.test.ts`, `environment: 'node'` -- no DOM. React components (`Table.tsx`, `PlayingCard.tsx`) cannot be unit tested; their rendered behavior is proven in Playwright e2e only.
- Never hardcode a hex color; use the CSS custom properties in `src/ui/themes.css`.
- Animation is presentation only: the running count and every `GradedEvent` must be produced at the moment a card is actually dealt (inside the synchronous engine call), never on an animation's completion.
- Respect `prefers-reduced-motion`; the dealing animation must be skippable; it must honor the existing `settings.dealSpeedMs` ("Deal speed") setting rather than inventing a second pacing knob.
- `e2e/table-seats.spec.ts`'s fast-forward spec must keep passing.
- House comment style: explain WHY, citing the concrete failure prevented -- not just what the code does.
- Validation commands: `npx vitest run`, `npx tsc --noEmit -p tsconfig.app.json`, `E2E_PORT=<port> npx playwright test`, `npx oxlint`.

---

## 1. Requests restated, current behavior, and root cause

### 1.1 Request A -- "I just got a blackjack and it instantly went to the next hand, the dealer is supposed to play out the hand so I can continue counting"

**Current behavior, traced exactly.** `Game.startRound()` (`src/engine/game.ts:349-425`) deals the two-pass round, then for a player natural falls into `resolveAfterPeek()` (`game.ts:817-837`):

```ts
private resolveAfterPeek(): void {
  this.resolveBotsBefore();

  for (const hand of this.hands) {
    if (isBlackjack(hand.cards)) {
      hand.result = 'blackjack';
      hand.done = true;
      hand.net = (this.rules.bj65 ? 1.2 : 1.5) * hand.bet;
      this.bankroll += hand.net;
    }
  }

  const firstLive = this.hands.findIndex((h) => h.result === undefined);
  if (firstLive === -1) {
    this.finishAfterPlayerDone();
    return;
  }
  this._active = firstLive;
  this.phase = 'player';
}
```

For a solo table (no bots) with a player natural, `firstLive === -1` (the only hand is already resolved), so it calls `finishAfterPlayerDone()` (`game.ts:928-952`):

```ts
private finishAfterPlayerDone(): void {
  this.resolveBotsAfter();

  // v1 PARITY (cycle-2 regression fix): if every hand at the table is
  // already resolved -- the all-naturals case -- the dealer never acts at
  // all. v1 short-circuited a player natural with `finishRound(); return;`
  // without ever entering playDealerAndSettle, so the hole card stayed
  // face-down and uncounted. Routing that case through the dealer would
  // leak the hole (and any draws) into the shoe position and the running
  // count, desynchronising every later round of a seeded session.
  ...
  const someHandUnresolved = this.seats
    .flatMap((s) => s.hands)
    .some((h) => h.result === undefined);
  if (!someHandUnresolved) {
    this.finishRound();
    return;
  }

  this.playDealerAndSettle();
}
```

Because every hand at the table (here: the one player hand) already has a `result`, `someHandUnresolved` is `false`, so `finishRound()` is called directly and `playDealerAndSettle()` -- the ONLY place that calls `this.revealHole()` for a non-dealer-natural round -- never runs. `game.holeRevealed` stays `false` forever for that round, and the hole card's Hi-Lo tag is never added to `runningCount`, even though the card was already drawn from (removed from) the shoe during the deal (`game.ts:411`: `const hole = this.shoe.draw(); this.dealerCards.push(hole);`).

**This is a confirmed, already-documented, intentional behavior**, not a latent accident -- there is an existing test that asserts exactly this as correct:

```ts
// src/engine/game.test.ts:1416-1434
it('solo player natural: hole stays down, dealer does not draw, RC excludes the hole', () => {
  const game = Game.withRiggedShoe(cfg(), rig('A', '9', 'K', '5', '6'));
  game.startRound();
  expect(game.phase).toBe('settled');
  expect(game.hands[0].result).toBe('blackjack');
  expect(game.bankroll).toBe(101.5);
  expect(game.holeRevealed).toBe(false);
  expect(game.dealerCards).toHaveLength(2);
  // Only the three FACE-UP cards are counted: A(-1) + 9(0) + K(-1) = -2.
  // The hole 5 (+1) and the would-be draw 6 (+1) must not appear.
  expect(game.runningCount).toBe(-2);
  expect(game.shoe.cardsRemaining).toBe(1);
});
```

This is precisely the operator's bug: **the trainer's own test suite currently locks in a shoe/count divergence from reality.** The same gap exists on a solo wong-out (`sitOut()`, `game.ts:446-498`) with zero bots -- also covered by an existing test that pins the buggy behavior:

```ts
// src/engine/game.test.ts:697-711
it('solo sit-out: no player hand, dealer up counted, bankroll untouched, phase settled', () => {
  const game = Game.withRiggedShoe(cfg(), rig('5', 'K'));
  ...
  game.sitOut();
  ...
  // Only the face-up dealer card counts; the hole stays hidden/uncounted
  // because with no live hand the dealer never plays out.
  expect(game.runningCount).toBe(hiLoTag('5'));
  expect(game.holeRevealed).toBe(false);
});
```

**Root cause, precisely:** the shortcut lives ONLY in `finishAfterPlayerDone()` (`game.ts:928-952`), not in `resolveAfterPeek()`, `insuranceDecision()`, or `sitOut()` themselves -- they all eventually funnel into `finishAfterPlayerDone()` when nothing is left to play. Note this means **the code comment's own justification is stale**: it worries that "routing that case through the dealer would leak the hole (and any draws) into the shoe position and the running count." But `playDealerAndSettle()` (`game.ts:1003-1045`) as it stands TODAY already guards exactly that:

```ts
// game.ts:1003-1045 (existing code, unchanged by this plan)
private playDealerAndSettle(): void {
  this.revealHole();

  const allHands = this.seats.flatMap((s) => s.hands);
  const liveHands = allHands.filter(
    (h) => h.result === undefined && !h.surrendered && !isBust(h.cards),
  );
  if (liveHands.length > 0) {
    while (this.dealerShouldHit()) {
      const c = this.shoe.draw();
      this.dealerCards.push(c);
      this.runningCount += hiLoTag(c.rank);
    }
  }
  ...
  for (const hand of this.hands) {
    if (hand.result === undefined) {
      this.settleHandVsDealer(hand, dealerBust, dealerTotal);
      this.bankroll += hand.net!;
    }
  }
  ...
  this.finishRound();
}
```

`revealHole()` always runs (fixing the count gap), but the `while (this.dealerShouldHit())` loop is gated on `liveHands.length > 0` -- when every hand is already a natural (or otherwise resolved), `liveHands` is empty, so the loop never executes and the shoe is NOT touched beyond the two cards already dealt. `settleHandVsDealer` is likewise gated on `hand.result === undefined`, so an already-settled natural is never re-settled (no double payout). **Routing the all-naturals case through `playDealerAndSettle()` today reveals the hole card and changes nothing else** -- no extra draw, no re-settlement, no shoe-position change beyond what already happened. The `someHandUnresolved` shortcut in `finishAfterPlayerDone()` is simply obsolete relative to the guards `playDealerAndSettle()` grew later; removing it is the entire fix.

**What must NOT change (verified by inspection, not assumption):**

- **Payouts / bankroll / 3:2 vs 6:5.** `resolveAfterPeek()`'s blackjack payout block (`game.ts:820-828`, using `this.rules.bj65`) is untouched -- naturals are still paid there, once, before `finishAfterPlayerDone()` is ever called. `playDealerAndSettle()`'s settle loop only touches hands with `result === undefined`, so an already-paid natural's `net`/`bankroll` credit is never revisited. Grep confirms this directly: `settleHandVsDealer` and `playDealerAndSettle` contain zero `this.events.push` calls and zero additional `this.bankroll +=` beyond the one gated by `result === undefined`.
- **Win/lose/push markers.** Same reasoning -- a hand already carrying `result: 'blackjack'` is filtered out of every downstream loop by the `result === undefined` guards that already exist.
- **Multi-hand rounds where only ONE hand has a blackjack.** This case is *already handled correctly today and is unaffected by this fix* -- worth stating explicitly since the operator flagged it as a subtlety to verify. If hand 1 of 2 is a natural and hand 2 is not, hand 2's `result` stays `undefined`, so `someHandUnresolved` was already `true` even before this fix, and `finishAfterPlayerDone()` already called `playDealerAndSettle()` on the unpatched code. Existing coverage: `src/engine/game.test.ts:1126` ("hand0 live (10,6=16), hand1 natural (A,K=BJ): BJ settled immediately, player completes hand0, outcomes summed") already exercises and locks in this path. The bug ONLY manifests when **every** hand at the table -- every player hand AND every bot hand -- is already resolved before the dealer's turn: solo natural, two-for-two player naturals with no bots, or (rare) a bot seat that also happens to already be resolved.
- **The dealer peek / insurance flow on a ten or ace upcard.** Both `settleDealerBlackjack()` (dealer natural via peek) and the insurance-declined/no-dealer-BJ branch of `insuranceDecision()` already call `revealHole()` or `resolveAfterPeek()` respectively -- `resolveAfterPeek()` funnels into the exact same `finishAfterPlayerDone()` this fix touches, so a solo player natural reached via "dealer shows Ace, insurance declined, no dealer blackjack" hits the identical bug today and is fixed identically. Section 4 adds a test for this exact path since it is not covered today.
- **Bots never producing `GradedEvents`.** Confirmed by grep: `resolveBotSeat`/`playOneBotDecision` (`game.ts:729-805`) never call `this.events.push`, and neither does `playDealerAndSettle`/`settleHandVsDealer`/`revealHole`. This fix adds no new call sites for any of those methods, so it cannot introduce a bot-sourced `GradedEvent`.

### 1.2 Request B -- "I want some actual dealing animations of a card coming from a deck and landing on the table instead of it just appearing on the table"

**Current behavior.** `Game.startRound()`/`act()`/`sitOut()` are fully synchronous -- by the time any of them returns, every card for that step already exists in `game.hands[i].cards` / `game.dealerCards`. `Table.tsx` renders them directly with no animation at all:

```tsx
// src/ui/screens/Table.tsx:404-408
<div className="dealer-area">
  {game.dealerCards.map((c, i) => (
    <PlayingCard key={i} card={c} faceDown={i === 1 && !game.holeRevealed} />
  ))}
</div>
```

```tsx
// src/ui/screens/Table.tsx:445-449
<div className="hand-cards">
  {hand.cards.map((c, j) => (
    <PlayingCard key={j} card={c} />
  ))}
</div>
```

`PlayingCard` (`src/ui/components/PlayingCard.tsx:37-55`) is a pure, stateless renderer with no notion of "just arrived" -- it takes `card`/`faceDown`/`size` and returns a `<div>`. `src/ui/app.css` has zero `@keyframes` for the table screen; the one existing motion pattern in the file is the mistake-card's entrance:

```css
/* src/ui/app.css:2555-2570 */
@media (prefers-reduced-motion: no-preference) {
  .mistake-card {
    animation: mistake-card-in 140ms ease-out;
  }
}
@keyframes mistake-card-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
```

Because every card for a whole two-pass deal (or a whole dealer settlement draw-out) mounts in the SAME React render, a naive per-card CSS mount animation would make an entire batch fade in simultaneously rather than card-by-card, which does not read as "dealt."

**The setting to honor.** `settings.dealSpeedMs` already exists, is user-labeled "Deal speed" (`Settings.tsx:238-246`, a 0-1000ms stepper, default 300ms, `src/store/types.ts:24,170`), and is ALREADY used for exactly one thing: pacing the bot-narration text reveal (`useGame.ts:360-367`). Reusing this same setting for the new card-entrance stagger is a natural fit (the user's mental model is already "how fast cards come out"), not a second, competing pacing knob.

**A critical, non-obvious regression risk found during research (see section 5 for full detail): many existing e2e specs read the DOM immediately (one-shot `.isVisible()`/`.count()`, not Playwright's auto-retrying `expect().toHaveCount()`) right after a Deal/Stand click, under the DEFAULT 300ms `dealSpeedMs` (they never call `withSettings(page, { dealSpeedMs: 0 })`).** Most concretely, `e2e/profiles.spec.ts:89-91`:

```ts
await bar.getByRole('button', { name: 'Stand', exact: true }).click();
const dealerCards = page.locator('.dealer-area .card[data-card]');
const count = await dealerCards.count(); // one-shot, NOT auto-retrying
if (count < 2) continue; // hole never got revealed on this path
```

Any design that gates a card's DOM *presence* (mounting it late, or hiding it behind a JS-driven reveal counter before its "turn") would make this read 0 or 1 instead of 2 immediately after Stand, silently turning nearly every seed in that spec's 1..250 seed-hunt into a spurious `continue`, very likely failing `expect(foundSeed).not.toBeNull()`. This directly shaped the design decision in section 2.1 below: **every dealt card mounts in the DOM on exactly the render it always has; only its CSS opacity/transform is staggered.** This preserves the invariant every existing table spec already depends on ("the DOM fully reflects the round's state the instant a synchronous engine call returns"), so this risk is designed around rather than merely hoped around.

---

## 2. Design decisions

### 2.1 Stagger via CSS `animation-delay` computed from an index, never via delayed DOM mounting

**Chosen:** every dealt card renders into the DOM immediately and always (byte-identical timing to today). A per-card CSS custom property `--deal-i` (an index into the round's deal order) feeds `animation-delay: calc(var(--deal-i, 0) * var(--deal-speed, 0ms))`, so cards *visually* settle in staggered over time while being fully present, with correct attributes, from the first paint.

**Rejected: a JS-gated incremental reveal (mirror `botNarrationRevealed` for card DOM presence, not just narration text).** This was the initial design and was abandoned specifically because of the regression found in 1.2/5: it reintroduces a real race against `e2e/profiles.spec.ts`'s one-shot `dealerCards.count()` check and every other spec that reads table DOM immediately after an action under the non-zero default `dealSpeedMs`. It also could not cleanly explain "what renders while a card is not yet revealed" (an empty slot causes layout jank; a face-down placeholder that later swaps content requires yet another state machine) for no benefit the CSS approach doesn't already provide.

**Rejected: absolute-position "FLIP" animation from a literal shoe/deck sprite to each card's landing rect.** Would read as more literally "coming from a deck," but requires measuring DOM rects in JS (`getBoundingClientRect` on a shoe element that doesn't currently exist anywhere in the UI), recomputing on every resize/orientation change, and coordinating with React's commit timing -- meaningfully more code and more ways to flake (especially across the four themes' differing layouts) for a cosmetic gain over a well-chosen CSS keyframe (slide down + slight rotate + fade, evoking a card sliding out from the dealer's hand) that costs one keyframe block and no JS measurement at all.

### 2.2 One shared keyframe animates both "new card mounts" and "the dealer's hole card flips face-up" -- no separate flip animation

`PlayingCard` always renders a `<div>` with class `card` plus either `card-back` (face-down) or `card-red`/`card-black` (face-up) (`PlayingCard.tsx:40-53`). Scoping the animation rule to `.card-back, .card-red, .card-black` (not the constant shared `.card` base class) means: a brand-new card mounting as face-up triggers the rule fresh; a brand-new card mounting as `card-back` (the dealer's hole card during the deal) triggers it too; and later, when `game.holeRevealed` flips true and that SAME `<div>`'s class changes from `card-back` to `card-red`/`card-black`, the newly-matching selector triggers the animation again on the existing node -- a genuine "flip" reveal with no extra code. Scoping to the constant `.card` class instead would never re-trigger on that class change (the browser does not restart an animation whose triggering selector/value has not changed), silently losing the hole-card flip entirely.

**Rejected: a bespoke `rotateY` "flip" keyframe distinct from the deal-in slide.** CSS cannot cheaply distinguish "this is a fresh mount" from "this is an existing node whose class just started matching" -- both fire the same rule. Given that, one keyframe that reads reasonably as "a card turning into view" for both cases is simpler and safer than authoring and switching between two, for a distinction the CSS engine cannot make for us anyway.

**Accepted, documented limitation:** the dealer's hole-card slot keeps whatever `--deal-i` it was assigned during the opening deal (0 or 1), so its later flip replays with that same tiny (0-1 slot) delay baked in. This is a harmless, near-imperceptible quirk, not worth the extra state needed to zero it out specifically for the flip case.

### 2.3 New engine state (`dealOrder`) instead of deriving deal order from `game.seats` post-hoc in the UI

**Chosen:** the engine appends one `DealSlot` entry per card to a new `dealOrder: DealSlot[]` array, in the exact order it deals them, reset every round in `beginRound()`.

**Rejected: derive "casino deal order" in Table.tsx purely from the shape of `game.seats`/`game.dealerCards` after the fact.** This looks tempting (no engine change) but is provably unsafe: `resolveBotsBefore()` -- which can insert a new hand via a bot **split** -- runs *inside* `resolveAfterPeek()`, which itself only runs *after* the entire two-pass deal loop finishes, but ALL of it happens inside the one synchronous `startRound()` call, before React ever gets a render in between. So by the time the UI's first post-deal render happens, a bot seated before the player may have already split, and `seat.hands[0].cards[1]` may already be a POST-split replacement card, not the card actually dealt in pass 2. Deriving order from that shape would occasionally (and silently) mistime a bot's card. Recording the order live, DURING the two deal passes (which strictly finish before any bot decision is made), sidesteps this entirely and costs about 15 lines, mirroring a pattern (`botActionLog`) the codebase already trusts for exactly this kind of "presentation needs to know order; the engine is the only thing that reliably knows it" problem.

### 2.4 Skip = collapse remaining stagger to zero, not a hard `animation: none` kill-switch

**Chosen:** clicking "skip" (the existing message-strip tap / fast-forward button, extended) simply stops the deal-pacing timer and flips a `dealAnimating` flag to `false`; while `false`, every card's `--deal-i` is computed as `0` instead of its real index. Any card still waiting on its (now-zeroed) delay starts its normal 220ms entrance immediately; anything already mid-flight is unaffected and finishes naturally within that same ~220ms window. The whole table visibly settles within about a quarter of a second of the tap.

**Rejected: a container-level `.deal-skip { animation: none !important }` override.** The obvious first design, but it does not scope correctly: `.dealer-area`, `.hand-cards`, and `.bot-hand-cards` are the SAME containers a later mid-round hit's card lands in, and a persistent skip-class on an ancestor would keep killing every later card's ordinary entrance animation for the rest of the round (a hit dealt long after the deal finished would silently get no animation at all) unless the class were removed the instant the deal settles -- but by then it has already done its one job, so it is dead weight that only exists to occasionally regress a later hit. Zeroing the per-card `--deal-i` computation instead is scoped, by construction, to exactly the cards that were ever part of the opening deal.

**Known verification step, not asserted as guaranteed:** whether a live change to `--deal-i` on an element whose animation is already scheduled-but-not-yet-started retroactively reschedules it is a genuinely browser-dependent nuance of the CSS Animations spec. The practical effect either way is a snap-in within one frame or within ~220ms -- both read as "skipped" to a user -- but this should be confirmed by eye (per the project's own "verify visual work visually" practice) on the real target browser(s) with a high Deal Speed + full table before calling Stage C done, rather than assumed from this plan alone.

### 2.5 Prefers-reduced-motion: omit the `animation` property entirely under `no-preference` is false, not shrink the stagger to zero

**Chosen:** follow the file's own established pattern exactly (`app.css:2555-2559`'s `@media (prefers-reduced-motion: no-preference) { .mistake-card { animation: ... } }`) -- the ENTIRE `animation` shorthand (including the delay) lives inside a `prefers-reduced-motion: no-preference` block. Under `reduce`, no animation-related property is set at all, so every card renders in its final, fully-visible state the instant it is in the DOM -- exactly today's behavior, not a faster version of the new one.

**Rejected: keep the stagger's timing (respecting `dealSpeedMs`) but drop only the transform/motion component under `reduce`.** This was considered (so a reduced-motion user still gets a paced, non-jarring reveal without literal motion) but rejected: `prefers-reduced-motion` is a vestibular/motion-sensitivity signal, not a "make things happen more slowly" signal, and silently keeping a multi-card pacing delay alive because of it would make an accessibility preference also change how quickly the table becomes usable to that user -- which is scope creep this preference was never meant to cover, and it would require a second, harder-to-reason-about code path only reduced-motion users exercise (a heavier and IMO worse-tested branch than "no animation, no delay at all").

### 2.6 Deduplicate `startRound()`/`sitOut()`'s two-pass deal loops into one shared private method

**Chosen:** since `dealOrder` logging must be added to both the (already near-identical) two-pass loops in `startRound()` (`game.ts:391-412`) and `sitOut()` (`game.ts:470-487`), extract a single `dealTwoPassRound()` private method used by both.

**Rejected: add the logging separately to each copy.** The two loops are already suspiciously identical (a maintenance smell -- any future change to deal timing has to remember to touch both). Adding new logging to both copies independently would be the second time this exact duplication has had to be kept in sync by hand; folding it into one method now removes the duplication rather than deepening it, at zero behavior change (verified line-by-line in section 3, Task 2).

---

## 3. File-by-file changes (dependency order)

### Task 1 -- `src/engine/game.ts`: fix the all-resolved shortcut (Request A)

Delete the `someHandUnresolved` short-circuit in `finishAfterPlayerDone()` (`game.ts:928-952`) entirely:

```ts
// BEFORE (game.ts:928-952)
private finishAfterPlayerDone(): void {
  this.resolveBotsAfter();

  // v1 PARITY (cycle-2 regression fix): ...
  const someHandUnresolved = this.seats
    .flatMap((s) => s.hands)
    .some((h) => h.result === undefined);
  if (!someHandUnresolved) {
    this.finishRound();
    return;
  }

  this.playDealerAndSettle();
}
```

```ts
// AFTER
/** Casino seat order: once the player's last hand is done, seats after the
 * player autoplay, then the dealer plays out and everyone settles.
 *
 * ALWAYS routes through playDealerAndSettle(), even when every hand at the
 * table (an all-naturals round) is already resolved before the dealer's
 * turn. A real dealer still turns the hole card over in that case -- the
 * card counter watching the table has already seen it leave the shoe and
 * needs its rank to keep an accurate count, even though nobody's outcome
 * depends on it. playDealerAndSettle()'s own `liveHands` guard (below) is
 * what still correctly skips any FURTHER draw in that case -- a real dealer
 * does not hit out their own hand just for show once nobody is left to beat.
 * Previously this method special-cased the all-resolved case with an early
 * `finishRound(); return;` that skipped playDealerAndSettle() (and with it
 * revealHole()) altogether, which is what produced the exact bug an
 * attentive counter would notice: a solo player blackjack left the hole
 * card face-down and its Hi-Lo tag permanently missing from runningCount,
 * even though the card had already been drawn out of the shoe. */
private finishAfterPlayerDone(): void {
  this.resolveBotsAfter();
  this.playDealerAndSettle();
}
```

No other method changes for Request A -- `playDealerAndSettle()`, `settleHandVsDealer()`, `resolveAfterPeek()`, `settleDealerBlackjack()`, and `insuranceDecision()` are all correct as written today (verified in section 1.1) and are untouched.

### Task 2 -- `src/engine/game.ts`: `dealOrder` log + two-pass loop dedup (groundwork for Request B)

Add the type and field near `botActionLog` (`game.ts:183-187`):

```ts
/** Casino order of the CURRENT round's opening two-pass deal, one entry per
 * card in the exact order dealTwoPassRound() deals it: every seat's hands in
 * seat order for pass 1, then the dealer's up-card, then every seat's hands
 * again for pass 2, then the dealer's hole card. Reset in beginRound().
 *
 * PRESENTATION-ONLY, read by Table.tsx to time the opening deal's CSS
 * entrance animation (Table Realism, Request B) -- grading, the running
 * count, and every phase transition are already fully decided by the time
 * this array exists, so a UI (or a test) that ignores it entirely sees the
 * exact same game state, at the exact same moment, it always has.
 *
 * A bot split during resolveBotsBefore() -- which runs AFTER this log is
 * fully populated, since it happens inside resolveAfterPeek(), which itself
 * only runs once the whole two-pass loop below has finished -- never
 * appends to or otherwise disturbs this log, so the opening deal's
 * animation timing can never be corrupted by what a bot decides to do next. */
export type DealSlot =
  | { kind: 'player'; handIndex: number; cardIndex: 0 | 1 }
  | { kind: 'bot'; seatIndex: number; handIndex: number; cardIndex: 0 | 1 }
  | { kind: 'dealer'; cardIndex: 0 | 1 };
dealOrder: DealSlot[] = [];
```

Reset it in `beginRound()` (`game.ts:298-324`), right next to the existing `botActionLog` reset:

```ts
// game.ts:298-302, adding one line
private beginRound(): void {
  this.roundNo += 1;
  this.countCheckDue = false;
  this.insuranceNet = null;
  this.botActionLog = [];
  this.dealOrder = []; // NEW
  ...
```

Replace `startRound()`'s two-pass block (`game.ts:391-412`, everything from the "Two-pass casino deal" comment through `this.dealerCards.push(hole); // hidden: not counted yet`) and `sitOut()`'s equivalent block (`game.ts:470-487`) with a single shared private method:

```ts
/** Deal the two-pass casino sequence -- one card to every hand of every seat
 * (in seat order; the player's own hands wherever they sit among them),
 * then the dealer's up-card; then the same seat sweep for card two, then
 * the dealer's hole card. Shared by startRound() and sitOut() so both a
 * staked round and a wong-out round burn the shoe/count in EXACTLY the same
 * order (R5, docs/BACKLOG.md) -- and now also so both populate `dealOrder`
 * (Table Realism, Request B) identically, rather than keeping two
 * hand-maintained copies of this loop in sync. Every card except the hole
 * is face-up, so runningCount updates immediately for bot cards too
 * (drawToHand does the counting). */
private dealTwoPassRound(): void {
  for (let s = 0; s < this.seats.length; s++) {
    const seat = this.seats[s];
    const isPlayerSeat = s === this.playerSeatIndex;
    for (let h = 0; h < seat.hands.length; h++) {
      this.drawToHand(seat.hands[h]);
      this.dealOrder.push(
        isPlayerSeat
          ? { kind: 'player', handIndex: h, cardIndex: 0 }
          : { kind: 'bot', seatIndex: s, handIndex: h, cardIndex: 0 },
      );
    }
  }
  const up = this.shoe.draw();
  this.dealerCards.push(up);
  this.runningCount += hiLoTag(up.rank);
  this.dealOrder.push({ kind: 'dealer', cardIndex: 0 });

  for (let s = 0; s < this.seats.length; s++) {
    const seat = this.seats[s];
    const isPlayerSeat = s === this.playerSeatIndex;
    for (let h = 0; h < seat.hands.length; h++) {
      this.drawToHand(seat.hands[h]);
      this.dealOrder.push(
        isPlayerSeat
          ? { kind: 'player', handIndex: h, cardIndex: 1 }
          : { kind: 'bot', seatIndex: s, handIndex: h, cardIndex: 1 },
      );
    }
  }
  const hole = this.shoe.draw();
  this.dealerCards.push(hole); // hidden: not counted yet
}
```

`startRound()` (`game.ts:391-424`) becomes:

```ts
this.dealTwoPassRound();

const upRank = this.dealerCards[0].rank;
if (upRank === 'A') {
  this.phase = 'insurance';
  return;
}

if (isTenValueUp(upRank) && isBlackjack(this.dealerCards)) {
  this.settleDealerBlackjack();
  return;
}

this.resolveAfterPeek();
```

`sitOut()` (`game.ts:470-497`) becomes:

```ts
this.dealTwoPassRound();

const upRank = this.dealerCards[0].rank;
// No player stake => no insurance step even on a dealer Ace. Peek for a
// dealer natural directly: settle the bots against it, otherwise play the
// round out.
if ((upRank === 'A' || isTenValueUp(upRank)) && isBlackjack(this.dealerCards)) {
  this.settleDealerBlackjack();
  return;
}
this.resolveAfterPeek();
```

This is a pure refactor of the deal mechanics (same draw order, same `runningCount`/`dealerCards` contents, same shoe consumption) plus the new logging -- no existing assertion on `game.hands`, `game.dealerCards`, `game.runningCount`, `game.bankroll`, or `game.events` can be affected by it, since none of those read the removed local `up`/`hole` variables (only `game.dealerCards[0].rank`, which is identical).

### Task 3 -- `src/engine/game.test.ts`: update pinned-buggy tests, add new coverage

**Update (was asserting the bug as correct behavior):**

```ts
// src/engine/game.test.ts:1408-1434 -- rename the describe block and its
// header comment (they currently document and defend the bug), then fix
// the one test whose expectations encode it.
describe('all-resolved round: the hole is still revealed/counted, even though nobody needs another dealer card', () => {
  // Previously (cycle-2, "v1 parity"): an all-naturals round short-circuited
  // straight to finishRound() and NEVER revealed the hole card, so its
  // Hi-Lo tag silently never entered runningCount even though the card had
  // already left the shoe -- a real counter's count would disagree with the
  // trainer's. Fixed by removing that shortcut (Task 1): playDealerAndSettle()
  // always reveals the hole, but its own `liveHands` guard still correctly
  // skips any FURTHER draw when nobody needs one.
  it('solo player natural: hole is revealed and counted, but the dealer still does not draw further', () => {
    const game = Game.withRiggedShoe(cfg(), rig('A', '9', 'K', '5', '6'));
    game.startRound();

    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('blackjack');
    expect(game.bankroll).toBe(101.5);

    // The hole IS revealed now...
    expect(game.holeRevealed).toBe(true);
    // ...but the dealer still never draws further: nobody needs a real
    // dealer total to settle against.
    expect(game.dealerCards).toHaveLength(2);

    // FOUR cards now count: A(-1) + 9(0) + K(-1) + hole 5(+1) = -1.
    // The would-be draw 6(+1) still must not appear -- that card was never
    // dealt, and remains in the shoe for a later round.
    expect(game.runningCount).toBe(-1);
    expect(game.shoe.cardsRemaining).toBe(1);
  });

  it('solo player BUST still reveals the hole (unaffected by this fix -- already went through playDealerAndSettle)', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '5', 'K'));
    game.startRound();
    game.act('hit');

    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('lose');
    expect(game.holeRevealed).toBe(true);
    expect(game.dealerCards).toHaveLength(2);
  });

  it('with bots at the table, a player natural still lets the dealer play for them (unaffected -- the bot leaves someHandUnresolved true)', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 1 };
    const game = Game.withRiggedShoe(cfg({ seats }), rig('10', 'A', '9', '7', 'K', '5', '6'));
    game.startRound();

    expect(game.phase).toBe('settled');
    expect(game.hands[0].result).toBe('blackjack');
    expect(game.holeRevealed).toBe(true);
    expect(game.dealerCards.length).toBeGreaterThan(2);
  });
});
```

```ts
// src/engine/game.test.ts:694-711 -- update the solo sit-out test the same way.
it('solo sit-out: no player hand, bankroll untouched, phase settled, hole revealed and counted', () => {
  const game = Game.withRiggedShoe(cfg(), rig('5', 'K'));
  const startBankroll = game.bankroll;
  game.sitOut();

  expect(game.hands).toHaveLength(0);
  expect(game.bankroll).toBe(startBankroll);
  expect(game.phase).toBe('settled');
  expect(game.roundNo).toBe(1);
  expect(game.dealerCards.map((c) => c.rank)).toEqual(['5', 'K']);
  // Both face-up-eventually dealer cards now count: 5(+1) + K(-1) = 0. With
  // no bots and no player stake, nobody needs a further dealer draw, so the
  // shoe still stops at exactly these two cards.
  expect(game.runningCount).toBe(hiLoTag('5') + hiLoTag('K'));
  expect(game.holeRevealed).toBe(true);
});
```

**New tests (genuinely new combinations, not covered today):**

```ts
it('two player hands BOTH natural, no bots (all-resolved via MULTIPLE hands, not just solo): hole is still revealed and counted', () => {
  const seats: SeatConfig = { playerHands: 2, bots: 0, botMistakePct: 0, playerPosition: 0 };
  // Deal order (2 player hands, no bots): hand0c0, hand1c0, dealerUp,
  // hand0c1, hand1c1, dealerHole.
  const game = Game.withRiggedShoe(cfg({ seats }), rig('A', 'A', '9', 'K', 'K', '5'));
  game.startRound([1, 1]);

  expect(game.phase).toBe('settled');
  expect(game.hands[0].result).toBe('blackjack');
  expect(game.hands[1].result).toBe('blackjack');
  expect(game.holeRevealed).toBe(true);
  expect(game.dealerCards).toHaveLength(2); // nobody needs a further dealer card
  expect(game.runningCount).toBe(
    hiLoTag('A') + hiLoTag('A') + hiLoTag('9') + hiLoTag('K') + hiLoTag('K') + hiLoTag('5'),
  );
});

it('dealer up Ace, insurance declined, no dealer blackjack, solo player natural: hole is still revealed and counted', () => {
  // Covers the operator's explicit "peek/insurance flow on an ace upcard"
  // subtlety: insuranceDecision()'s declined/no-BJ branch calls
  // resolveAfterPeek(), which funnels into the exact same
  // finishAfterPlayerDone() this fix touches.
  const game = Game.withRiggedShoe(cfg(), rig('K', 'A', 'A', '5'));
  game.startRound();
  expect(game.phase).toBe('insurance');

  game.insuranceDecision(false);

  expect(game.phase).toBe('settled');
  expect(game.hands[0].result).toBe('blackjack');
  expect(game.insuranceNet).toBeNull();
  expect(game.holeRevealed).toBe(true);
  expect(game.dealerCards).toHaveLength(2);
  expect(game.runningCount).toBe(hiLoTag('K') + hiLoTag('A') + hiLoTag('A') + hiLoTag('5'));
});
```

```ts
describe('dealOrder (Request B groundwork: presentation-only deal-order log)', () => {
  it('solo, no bots: pass1, dealer-up, pass2, dealer-hole, in that exact order', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8'));
    game.startRound();
    expect(game.dealOrder).toEqual([
      { kind: 'player', handIndex: 0, cardIndex: 0 },
      { kind: 'dealer', cardIndex: 0 },
      { kind: 'player', handIndex: 0, cardIndex: 1 },
      { kind: 'dealer', cardIndex: 1 },
    ]);
  });

  it('a bot seated before the player is logged before the player in EACH pass', () => {
    const seats: SeatConfig = { playerHands: 1, bots: 1, botMistakePct: 0, playerPosition: 1 };
    const game = Game.withRiggedShoe(
      cfg({ seats }),
      rig('10', '10', '2', '5', '10', '4', '9', '6'),
    );
    game.startRound();
    expect(game.dealOrder.slice(0, 6)).toEqual([
      { kind: 'bot', seatIndex: 0, handIndex: 0, cardIndex: 0 },
      { kind: 'player', handIndex: 0, cardIndex: 0 },
      { kind: 'dealer', cardIndex: 0 },
      { kind: 'bot', seatIndex: 0, handIndex: 0, cardIndex: 1 },
      { kind: 'player', handIndex: 0, cardIndex: 1 },
      { kind: 'dealer', cardIndex: 1 },
    ]);
  });

  it('a fresh round replaces dealOrder with a NEW array (reference change), not an append', () => {
    const game = Game.withRiggedShoe(cfg(), rig('10', '9', '6', '8', '5', '7', '4', '9'));
    game.startRound();
    const firstOrder = game.dealOrder;
    game.act('stand');
    game.startRound();
    expect(game.dealOrder).not.toBe(firstOrder);
    expect(game.dealOrder).toHaveLength(4);
  });
});
```

### Task 4 -- `src/ui/components/PlayingCard.tsx`: accept a `dealIndex` prop

```tsx
interface PlayingCardProps {
  card?: Card;
  faceDown?: boolean;
  size?: 'normal' | 'compact';
  /** Position of THIS card within the round's `game.dealOrder` (Table
   * Realism, Request B) -- undefined for any card dealt outside the opening
   * two-pass deal (a hit, a double, a split, a dealer settlement draw),
   * which always plays its entrance the instant it mounts, with no extra
   * delay. Feeds `--deal-i`, consumed by app.css's `card-deal-in` keyframe
   * via `animation-delay: calc(var(--deal-i, 0) * var(--deal-speed, 0ms))`. */
  dealIndex?: number;
}

...

export function PlayingCard({ card, faceDown, size = 'normal', dealIndex }: PlayingCardProps) {
  const sizeClass = size === 'compact' ? ' card-compact' : '';
  const style =
    dealIndex === undefined ? undefined : ({ '--deal-i': dealIndex } as React.CSSProperties);

  if (!card || faceDown) {
    return <div className={`card card-back${sizeClass}`} aria-label="face-down card" style={style} />;
  }

  const red = isRed(card.suit);
  return (
    <div
      className={`card ${red ? 'card-red' : 'card-black'}${sizeClass}`}
      data-card={`${card.rank}${card.suit}`}
      aria-label={`${card.rank} of ${SUIT_NAME[card.suit]}`}
      style={style}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}
```

`data-card`/`aria-label`/children are unchanged in both branches -- every existing e2e locator (`.card[data-card]`, `aria-label`) still matches identically.

### Task 5 -- `src/ui/useGame.ts`: `dealAnimating` + `skipDeal`

Mirrors the existing `botNarrationRevealed` effect immediately below it, but as a single duration timer (not a per-tick chain) since the stagger itself now lives entirely in CSS -- this state exists ONLY to know how long to keep offering a skip control, never to gate what's rendered:

```ts
/**
 * Table Realism (Request B): `dealAnimating` is true while the opening
 * deal's CSS entrance animation is still plausibly playing, purely so
 * Table.tsx knows how long to keep offering a skip control. It NEVER gates
 * which cards are in the DOM -- every card in `game.dealOrder` is already
 * rendered, with its real `data-card`/attributes, on the exact render
 * `game.startRound()`/`game.sitOut()` returns from; only its CSS
 * `animation-delay` (computed from `--deal-i`, see PlayingCard.tsx) is
 * staggered. A caller that ignores `dealAnimating`/`skipDeal` entirely sees
 * the identical DOM, at the identical moment, either way -- this is why
 * gating the skip control on it cannot desync grading, the running count,
 * or e2e/table-seats.spec.ts's fast-forward path.
 *
 * Skips the whole mechanism under prefers-reduced-motion: reduce -- under
 * that preference app.css's card-deal-in keyframe is never applied at all
 * (see app.css), so there is nothing playing to offer a skip control for.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// DEAL_ENTRANCE_MS must match app.css's `card-deal-in` keyframe duration --
// a comment there points back here.
const DEAL_ENTRANCE_MS = 220;

...

export function useGame(settings: Settings, profile: Profile, audio: AudioApi) {
  ...
  const [dealAnimating, setDealAnimating] = useState(false);
  const dealAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dealOrderRef = useRef<typeof game.dealOrder>(game.dealOrder);

  const clearDealAnimTimer = useCallback(() => {
    if (dealAnimTimerRef.current !== null) {
      clearTimeout(dealAnimTimerRef.current);
      dealAnimTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (game.dealOrder === dealOrderRef.current) return;
    dealOrderRef.current = game.dealOrder;
    clearDealAnimTimer();

    if (game.dealOrder.length === 0 || prefersReducedMotion()) {
      setDealAnimating(false);
      return;
    }
    setDealAnimating(true);
    // +40ms slack over the exact CSS timeline so the skip control never
    // disappears a frame before the LAST card has actually settled.
    const totalMs = (game.dealOrder.length - 1) * settings.dealSpeedMs + DEAL_ENTRANCE_MS + 40;
    dealAnimTimerRef.current = setTimeout(() => {
      dealAnimTimerRef.current = null;
      setDealAnimating(false);
    }, totalMs);
  }, [game, game.dealOrder, settings.dealSpeedMs, clearDealAnimTimer]);

  useEffect(() => clearDealAnimTimer, [clearDealAnimTimer]);

  const skipDeal = useCallback(() => {
    clearDealAnimTimer();
    setDealAnimating(false);
  }, [clearDealAnimTimer]);

  return {
    game,
    deal,
    sitOut,
    act,
    insure,
    submitCount,
    overlay,
    dismissOverlay,
    report,
    endSession,
    botNarrationRevealed,
    fastForwardNarration,
    dealAnimating, // NEW
    skipDeal, // NEW
  };
}
```

### Task 6 -- `src/ui/screens/Table.tsx`: wire `dealIndex` per card, extend skip affordances

```tsx
import type { Game, PlayerHand, Seat, DealSlot } from '../../engine/game';

/** Position of `slot` within the round's `game.dealOrder`, or `undefined` if
 * it never occupied one (any card past the opening two cards of a hand, or
 * past the dealer's first two, is a later hit/double/split/settlement draw
 * and always animates the instant it mounts -- see PlayingCard.tsx). */
function dealIndexOf(order: DealSlot[], slot: DealSlot): number | undefined {
  const idx = order.findIndex((s) => {
    if (s.kind !== slot.kind) return false;
    if (s.kind === 'dealer' && slot.kind === 'dealer') return s.cardIndex === slot.cardIndex;
    if (s.kind === 'player' && slot.kind === 'player') {
      return s.handIndex === slot.handIndex && s.cardIndex === slot.cardIndex;
    }
    if (s.kind === 'bot' && slot.kind === 'bot') {
      return s.seatIndex === slot.seatIndex && s.handIndex === slot.handIndex && s.cardIndex === slot.cardIndex;
    }
    return false;
  });
  return idx === -1 ? undefined : idx;
}
```

Destructure the two new values and derive the skip condition:

```tsx
const {
  game, deal, act, insure, submitCount, overlay, dismissOverlay, report, endSession,
  botNarrationRevealed, fastForwardNarration, sitOut,
  dealAnimating, skipDeal, // NEW
} = useGame(settings, activeProfile, audio);
...
const pacingPending = botNarrationRevealed < game.botActionLog.length;
// Once skipped or naturally settled, every card's --deal-i collapses to 0
// (see the dealIndex-zeroing below) -- dealAnimating alone is the single
// source of truth for "is there still an opening-deal animation to skip".
const skipEverything = () => {
  fastForwardNarration();
  skipDeal();
};
```

Root style + card wiring (dealer area, player hands, bot hands):

```tsx
return (
  <div
    className="table-screen"
    style={{ '--deal-speed': `${settings.dealSpeedMs}ms` } as React.CSSProperties}
  >
    ...
    <div className="dealer-area">
      {game.dealerCards.map((c, i) => (
        <PlayingCard
          key={i}
          card={c}
          faceDown={i === 1 && !game.holeRevealed}
          dealIndex={
            i < 2 && dealAnimating
              ? dealIndexOf(game.dealOrder, { kind: 'dealer', cardIndex: i as 0 | 1 })
              : undefined
          }
        />
      ))}
    </div>
    ...
```

```tsx
{seat.hands.map((hand, handIndex) => (
  <div key={handIndex} className="bot-hand">
    <div className="bot-hand-cards">
      {hand.cards.map((c, j) => (
        <PlayingCard
          key={j}
          card={c}
          size="compact"
          dealIndex={
            j < 2 && dealAnimating
              ? dealIndexOf(game.dealOrder, { kind: 'bot', seatIndex, handIndex, cardIndex: j as 0 | 1 })
              : undefined
          }
        />
      ))}
    </div>
    ...
```

```tsx
<div className="hand-cards">
  {hand.cards.map((c, j) => (
    <PlayingCard
      key={j}
      card={c}
      dealIndex={
        j < 2 && dealAnimating
          ? dealIndexOf(game.dealOrder, { kind: 'player', handIndex: i, cardIndex: j as 0 | 1 })
          : undefined
      }
    />
  ))}
</div>
```

(`dealAnimating` gates the whole expression, not just a fallback -- once it is `false`, EVERY initial-deal card's `dealIndex` becomes `undefined`, which `PlayingCard` treats identically to "no delay," i.e. exactly the zero-collapse described in Design Decision 2.4.)

Extend the two existing pacing affordances (message-strip tap, floating fast-forward button) to also cover a pending deal animation, and to fast-forward BOTH mechanisms together:

```tsx
<div
  className="message-strip"
  onClick={hasBots || dealAnimating ? skipEverything : undefined}
>
  ...
{(hasBots && pacingPending) || dealAnimating ? (
  <button
    type="button"
    className="fast-forward-btn"
    aria-label="Fast-forward bot actions and dealing"
    onClick={skipEverything}
  >
    ⏩
  </button>
) : null}
```

### Task 7 -- `src/ui/app.css`: the entrance keyframe

Add near the existing `.card`/`.card-back` rules (`app.css:248-291`):

```css
/* Table Realism, Request B: cards fly in from the dealer rather than simply
   appearing. `--deal-i` (set per-card by Table.tsx, from the round's
   `game.dealOrder`) staggers the opening two-pass deal in true casino
   order; a card with no `--deal-i` (a mid-round hit/double/split, or a
   dealer settlement draw) falls back to 0 -- no extra delay, it just plays
   the same entrance the instant it mounts. `--deal-speed` is
   settings.dealSpeedMs, set once on `.table-screen` -- "Deal speed" already
   means "how fast cards come out" to the player (Settings.tsx), so this is
   the SAME number, not a second, unrelated pacing knob.

   Scoped to `.card-back`/`.card-red`/`.card-black` specifically (never the
   constant shared `.card` base class, which never stops matching and so
   would never re-trigger) because those are exactly the classes that swap
   when PlayingCard's `faceDown` prop flips: the dealer's hole card mounts
   once as `.card-back` and later gains `.card-red`/`.card-black` when
   `game.holeRevealed` goes true, and a selector newly starting to match
   restarts its animation on that SAME element -- so this one rule doubles
   as the hole card's flip reveal, with no separate keyframe needed. */
@media (prefers-reduced-motion: no-preference) {
  .card-back,
  .card-red,
  .card-black {
    animation: card-deal-in 220ms ease-out both;
    animation-delay: calc(var(--deal-i, 0) * var(--deal-speed, 0ms));
  }
}

@keyframes card-deal-in {
  from {
    opacity: 0;
    transform: translateY(-18px) rotate(-6deg);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
```

Under `prefers-reduced-motion: reduce`, none of the above applies at all (no `animation` property is ever set), so every card renders in its final state instantly -- identical to today's behavior.

---

## 4. Test strategy

| Behavior | Proving test | How a regression would show up |
|---|---|---|
| Request A: solo player natural reveals + counts the hole, draws nothing further | `game.test.ts` "solo player natural: hole is revealed and counted..." (Task 3) | Reverting Task 1 (restoring the `someHandUnresolved` shortcut) makes `holeRevealed` false and `runningCount` -2 instead of -1 -- the test fails on both assertions, not just one, so a partial/wrong fix (e.g. only flipping `holeRevealed` without routing through `revealHole()`'s count update) is also caught. |
| Request A: a dealer-natural bust still reveals the hole (unaffected path) | `game.test.ts` "solo player BUST still reveals the hole..." (unchanged assertions) | Would fail if a broad, incorrect fix (e.g. deleting `playDealerAndSettle`'s `liveHands` guard rather than just the `finishAfterPlayerDone` shortcut) started making the dealer draw when it shouldn't (`dealerCards` would grow past 2). |
| Request A: a live bot hand still forces the dealer to play (unaffected path) | `game.test.ts` "with bots at the table, a player natural still lets the dealer play..." (unchanged) | Guards against accidentally suppressing the dealer's real play in the ALREADY-correct multi-hand-or-bot case while fixing the all-resolved case. |
| Request A: two player hands both natural (no bots) | New test, Task 3 | This is the one genuinely new combination (all-resolved via multiple hands, not solo) -- without it, a fix that only checks `this.hands.length === 1` (or similar solo-specific patch) would pass every other test yet still leave this case broken. |
| Request A: Ace-up, insurance declined, no dealer BJ, solo natural | New test, Task 3 | Exercises the fix through `insuranceDecision()`'s declined branch rather than `startRound()`'s direct peek branch -- would catch a fix applied only inside `resolveAfterPeek()`'s direct callers rather than at the true shared root (`finishAfterPlayerDone()`). |
| Request A: money/payout/win-lose-push markers are untouched | Every EXISTING `blackjack`/`bot naturals`/`player BJ vs dealer BJ`/insurance-settlement describe block in `game.test.ts` (unchanged, must stay green) | Any accidental double-settlement or bankroll drift from routing the all-resolved case through `playDealerAndSettle()` would show up as a bankroll or `net` mismatch in these pre-existing tests, especially "MONEY SAFETY: player natural ... pays 1.5x exactly ONCE" (`game.test.ts:136`). |
| Request B: `dealOrder` records the real casino order, solo | New test, Task 3 | A wrong loop order (e.g. logging the dealer before finishing a multi-hand player seat's pass) fails the exact-array `toEqual` immediately. |
| Request B: `dealOrder` records a bot seated before the player correctly | New test, Task 3 | Would catch an off-by-one in the `isPlayerSeat` branch (e.g. mislabeling the player's own seat as `kind: 'bot'`), which the UI's `dealIndexOf` lookup depends on to find the right card. |
| Request B: `dealOrder` resets (new reference) every round | New test, Task 3 | Directly protects `useGame.ts`'s round-boundary detection (`game.dealOrder === dealOrderRef.current`), which is how the skip-control timer knows a new round started; a bug here would leave the OLD round's timer running (or never re-arm a new one). |

**Non-discriminating test risk, flagged and avoided:** a test that only asserts `game.phase === 'settled'` after a natural, or only checks `hand.result === 'blackjack'`, would pass identically whether or not this fix is applied -- those facts were never in question. Every Request-A test above asserts specifically on `holeRevealed` and the exact numeric `runningCount`/`dealerCards.length` (the actual disputed behavior), so a reversion of Task 1 provably fails them, not just "a" test. Likewise, a `dealIndex`/`dealOrder` test that only checked `.length` (not exact order) would pass under a shuffled/wrong order -- all three `dealOrder` tests above assert the full ordered array or specific indices for exactly this reason.

**No unit test exists (or can exist) for the CSS animation or the skip control itself** -- `vitest` runs under `environment: 'node'` with no DOM, and `.test.tsx` is explicitly excluded by `vite.config.ts`'s `include: ['src/**/*.test.ts']`. This is why Task 6/7's actual visible behavior (does it look staggered, does skip actually snap it, does reduced-motion actually suppress it) has no automated proof in this plan and must be confirmed by eye in a real browser before considering Stage C (below) done -- consistent with Design Decision 2.4's "known verification step."

---

## 5. Risks

- **The single biggest risk this plan identifies is NOT one the operator named:** `e2e/profiles.spec.ts`'s "S17 profile: the dealer stands on a two-card soft 17" test (lines 60-110) clicks Stand and immediately does a one-shot (non-retrying) `dealerCards.count()` read, under the DEFAULT `dealSpeedMs` (300ms) -- it never calls `withSettings(page, { dealSpeedMs: 0 })`. A design that delays a card's DOM *mounting* (the initially-considered JS-gated-reveal approach, see Design Decision 2.1) would make this read 0 or 1 far more often than not, likely failing the test outright across its whole 250-seed hunt. **This plan's chosen design (CSS `animation-delay` only, DOM presence unchanged) verifiably does not have this problem** -- confirmed by inspection: `dealerCards.count()` counts `.dealer-area .card[data-card]` elements, and `PlayingCard`'s `data-card` attribute is set unconditionally on mount regardless of any CSS animation state. No file in this plan needs to change to keep this spec green, but it is the test most worth re-running first after Task 6/7 land, specifically because a subtly wrong implementation (e.g. someone "simplifying" Task 6 back toward conditional rendering) would silently reintroduce exactly this failure mode.
- **`e2e/table-seats.spec.ts`'s two fast-forward-adjacent tests, explicitly called out as must-keep-passing:**
  - `'full table: 3 bots deal, play, and settle...'` (`dealSpeedMs: 0`) checks `.bot-hand-cards .card` has count 2 immediately after Deal, via Playwright's auto-retrying `expect().toHaveCount()`. Since card DOM presence is unaffected by this plan and `dealSpeedMs: 0` collapses the CSS delay to `0ms` for every slot, this passes with no behavior change required, but is worth watching because it is the test most likely to catch a mistaken reversion to gated rendering (it would then flake under `toHaveCount`'s retry window rather than fail outright, which is a worse failure mode -- an intermittent CI flake -- so treat any new flakiness here as a signal, not noise).
  - `'fast-forward: bot narration reveals in full immediately...'` (`dealSpeedMs: 5000`) asserts `.fast-forward-btn` disappears (`toHaveCount(0)`) immediately after one click. This is exactly why `skipEverything()` (Task 6) must call BOTH `fastForwardNarration()` AND `skipDeal()` together, and why the button's visibility condition must be `(hasBots && pacingPending) || dealAnimating` -- if either mechanism were left out of either the click handler or the visibility condition, the button could keep rendering after being clicked (one mechanism "skipped," the other still pending), failing this exact assertion.
- **Split's second card does not get an entrance animation.** `performSplit()` (`game.ts:874-909`) rewrites `hand.cards = [hand.cards[0]]` then draws a NEW second card into the SAME array index -- since `Table.tsx` keys hand cards by array index (`key={j}`), React sees "same key, new `card` prop" and patches the existing DOM node's content rather than mounting a new one, so no CSS animation fires for that card. This is a pre-existing keying pattern (not introduced by this plan) and fixing it would mean re-keying every card list by a genuinely unique per-card id, a broader change with its own regression surface (e.g. verifying no two cards in a hand collide) not justified by this feature. Documented here as an accepted, known gap rather than silently shipped.
- **Bot mid-round hits and dealer settlement draws still appear as an un-staggered batch.** These are the Stage 3 items explicitly deferred below -- not a regression (today they are also un-staggered), but worth flagging so it isn't mistaken for an oversight: the operator's literal example (getting dealt a blackjack) is entirely an opening-deal scenario, which Stage B/C fully covers.
- **The `--deal-i` live-update-during-flight nuance (Design Decision 2.4)** is a real, if minor, cross-browser uncertainty that this plan cannot resolve from static analysis alone -- flagged explicitly rather than asserted away.

---

## 6. Staging (smallest, most valuable first)

**Stage A -- Request A fix (Tasks 1 + 3's Request-A tests).** Ships alone: a pure engine correctness fix, zero UI/CSS involvement, resolves the operator's literal complaint ("it instantly went to the next hand") for every player -- not just ones who ever notice the animation. Highest value-to-risk ratio in this whole plan; should land first and independently.

**Stage B -- generic card-entrance animation, no stagger (Task 7 alone, plus Task 4's prop plumbing unused/optional).** Ship the `card-deal-in` keyframe scoped to `.card-back`/`.card-red`/`.card-black` with NO `--deal-i` wiring anywhere yet (every card implicitly gets `var(--deal-i, 0)` = no delay). This alone gives every hit, double, split, and the (now-fixed, per Stage A) hole-card flip a small "arriving" flourish, entirely CSS, touching exactly one file, with zero interaction risk with any existing spec (nothing about DOM timing changes). The opening deal still appears as one simultaneous batch at this stage -- acceptable as an intermediate, still strictly better than today.

**Stage C -- staggered opening deal + skip (Task 2, Task 3's `dealOrder` tests, Task 4's `dealIndex` prop actually wired, Task 5, Task 6).** Upgrades the opening deal specifically from "batch fade-in" to a true one-card-at-a-time casino-order reveal, tied to the existing Deal Speed setting, skippable via the existing message-strip/fast-forward affordances. This is the most literal fulfillment of "a card coming from a deck and landing on the table," and the most involved slice -- ship it after Stage B is confirmed visually correct in a real browser (per Design Decision 2.4's verification note) and after Stage A/B have had a chance to be exercised in CI on their own.

**Deferred (not part of this plan's scope, listed for a future plan):** staggering bot mid-round hits (currently only their text narration is paced, per the existing `botNarrationRevealed`/`botActionLog` mechanism -- the cards themselves already mount instantly and would need their own `--deal-i`-style offset computed relative to the end of the opening deal) and staggering the dealer's own settlement draw-out loop (`playDealerAndSettle()`'s `while (this.dealerShouldHit())`, `game.ts:1016-1022` -- currently un-instrumented; the cards are unambiguously identifiable as `game.dealerCards.slice(2)` with no new engine state needed, unlike the opening deal). Both are real, smaller polish items but are secondary to the two literal requests and were deliberately left out to keep this plan's Stage C reviewable.
