# v2 Cycle 2 — Multi-Hand Play + Simulated Table Players

**Date:** 2026-07-16
**Status:** Approved (owner directive 2026-07-16: autonomous completion; table model
"bot players with realistic mistakes" chosen by owner in cycle-scoping Q&A)
**Builds on:** v1 spec + v2 cycle-1 spec (Profiles/RuleSet are prerequisites).

## Goal

The table plays like a real casino table: you play 1–3 hands; up to 5 simulated players
("bots") occupy other seats, bet flat, play the active ruleset's basic strategy with a
configurable mistake rate, and their cards are dealt face-up in true casino order — so
the shoe depletes and the count moves exactly like a live game. Only YOUR decisions are
graded.

## Seat model (engine)

```ts
export interface SeatConfig { playerHands: 1|2|3; bots: 0|1|2|3|4|5; botMistakePct: number /*0..20*/; playerPosition: number /*0..bots, seat index from first base*/ }
// Profile gains: seats: SeatConfig  (default {playerHands:1, bots:0, botMistakePct:0, playerPosition:0})
export interface Seat { kind: 'player'|'bot'; hands: PlayerHand[] }  // player seat holds playerHands initial hands
export class Game {
  seats: Seat[];              // dealing order: index 0 = first base
  // hands/active from v1 become views over the player's seat(s); events/grading unchanged in shape
}
```

- **Dealing:** two passes in seat order (each hand of each seat gets card 1, dealer up,
  then card 2 each, dealer hole). All bot and player cards face-up → runningCount
  updates on every one; hole card at reveal only (v1 rule).
- **Playout:** seats resolve in order. Bot hands auto-resolve in the engine the moment
  play reaches them (`resolveBotHands()` between player interactions); the UI paces the
  *display* of bot actions with dealSpeedMs, but engine state is authoritative and
  synchronous (v1 pattern: engine owns rules, UI paces).
- **Bot play:** action = `basicPlay(cards, up, ctx, rules)` (chart-perfect, count-blind
  — bots don't count). With probability `botMistakePct/100` per decision, substitute a
  uniformly-random OTHER legal action (uses the Game's seeded rng → deterministic in
  tests and replays). Bots bet 1 unit flat; their money never touches the player's
  bankroll; their results settle for realism display only.
- **Bots never take insurance** (flat-betting basic-strategy players decline; keeps the
  insurance prompt purely a player decision).
- **Multi-hand player:** `startRound(bets: number[])` (length = playerHands). Bet
  grading: each hand's bet graded against the ramp at pre-deal TC (one bet event per
  hand). Player hands play left-to-right; splits extend within the seat (cap 4 hands
  per original hand as v1). Insurance: one decision covering all player hands (standard
  practice; graded once).
- **Count checks / reshuffle / peek:** unchanged from v1, but shoe depletion now
  reflects all seats (penetration reached ~3× faster with a full table — realistic).

## UI

- Table screen renders bot seats as compact card rows (smaller `PlayingCard` size)
  above/beside the player area, each labeled (P1…P5) with a subtle result marker after
  settle; player hands render at v1 size, active hand highlighted (v1 pattern).
- Bot actions appear sequentially paced by dealSpeedMs ("P2 hits… P2 busts") in the
  message strip; a "fast-forward" tap skips pacing (engine already resolved).
- Profile editor gains a Seats section (playerHands, bots, mistake %, your seat
  position). Multi-hand bet entry: per-hand chip rows when betSpreadOn, else flat.

## Testing (engine-heavy, like v1)

- Dealing order: rigged shoe → exact card-to-seat mapping asserted for 3 bots + 2
  player hands.
- Bot fidelity: mistakePct 0 → every bot action equals `basicPlay` over a 500-round
  seeded soak; mistakePct 100 → never equals it when an alternative legal action exists.
- Determinism: same seed + same config → identical transcript (bot mistakes included).
- RC: after a full-table round, runningCount = sum of tags of all face-up cards.
- Grading isolation: bot decisions produce ZERO GradedEvents; player multi-hand rounds
  produce one action event per player decision and one bet event per hand.
- Insurance: single decision, graded once, settles per cycle-1 payout rules.
- Multi-hand settle: independent per-hand nets; bankroll delta = sum.
- E2e: full-table round with bots visible (screenshots reviewed); multi-hand round with
  two bets; fast-forward.

## Atomic decomposition (lowest-level pieces)

C2.1 Engine: SeatConfig/Seat types + Profile.seats + migration default (types + tests)
C2.2 Engine: multi-seat dealing order + RC visibility (game.ts + rigged-shoe tests)
C2.3 Engine: bot autoplay (basicPlay + seeded mistake substitution) + determinism/fidelity tests
C2.4 Engine: multi-hand player (startRound(bets[]), per-hand bet grading, split caps, settle) + tests
C2.5 Engine: single insurance decision across player hands + payout integration + tests
C2.6 UI: bot seat rendering + paced action narration strip + fast-forward
C2.7 UI: multi-hand bet entry + per-hand result display + active-hand flow
C2.8 UI: profile editor Seats section
C2.9 E2e specs + screenshots (full table, multi-hand, fast-forward) + coordinator screenshot review

Out of scope: bots that count/spread, player-vs-bot competition stats, seat-position
strategy effects, cycle-3 audio hooks (cycle 3 narrates seats via its own spec).
