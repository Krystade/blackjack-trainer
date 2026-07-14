# Blackjack Card-Counting Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phone-first static web app for practicing Hi-Lo card counting: full blackjack simulation + drills, graded against verified 6-deck H17 DAS LS basic strategy and the H17-adjusted Illustrious 18.

**Architecture:** Pure-TypeScript engine (`src/engine/`, `src/drills/`, `src/store/`) with zero React imports, exhaustively unit-tested with Vitest; thin React UI on top; Playwright e2e with seeded RNG and screenshot review. Static `dist/` deployed to GitHub Pages.

**Tech Stack:** Vite 6 + React 18 + TypeScript (strict), Vitest, @playwright/test. No other runtime dependencies (no router, no state library — YAGNI).

**Spec:** `docs/superpowers/specs/2026-07-13-blackjack-trainer-design.md` (in this repo). The strategy tables in this plan are transcribed from verified sources (`docs/sources/bj_4d_h17.gif`, `docs/sources/BJA_H17.pdf`) — **do not "correct" them from memory.** If a table here disagrees with the spec, STOP and flag it.

## Global Constraints

- Rules fixed: 6 decks, dealer hits soft 17, DAS, late surrender, 3:2 BJ, resplit to 4 hands, split aces one card (no resplit/hit), double any 2 cards incl. after split, peek game.
- Hi-Lo: 2–6 → +1, 7–9 → 0, 10/J/Q/K/A → −1. True count = floor(RC / decksRemaining) toward −∞; decksRemaining rounded to nearest half deck, min 0.5.
- `src/engine/`, `src/drills/`, `src/store/` MUST NOT import React or anything from `src/ui/`.
- TypeScript strict mode; every task ends with `npm test` green; commit after every task (commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).
- Repo: `C:\Users\jackp\projects\blackjack-trainer` (git identity already configured).
- UI: portrait phone-first, dark theme, touch targets ≥ 48px, no scrolling mid-hand.

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `src/ui/app.css`, `.gitignore`
- Test: `src/engine/smoke.test.ts` (temporary, deleted in Task 2)

**Interfaces:**
- Produces: working `npm run dev`, `npm test` (Vitest), `npm run build`. `vite.config.ts` uses `base: './'` (relative paths — required for GitHub Pages later) and `test` block for Vitest.

- [ ] **Step 1: Scaffold Vite app**

```bash
cd /c/Users/jackp/projects/blackjack-trainer
npm create vite@latest . -- --template react-ts   # accept "ignore existing files" if prompted; do NOT overwrite docs/
npm install
npm install -D vitest
```

If the scaffolder refuses a non-empty dir, scaffold into `tmp-scaffold/` and move everything except `docs/` and `.git/` up.

- [ ] **Step 2: Configure**

`vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

Add to `package.json` scripts: `"test": "vitest run"`. Move `App.tsx` under `src/ui/`, replace its body with a placeholder `<h1>Blackjack Trainer</h1>`, delete demo assets/CSS except one `src/ui/app.css` (empty for now). `index.html` title: `Blackjack Trainer`; add `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">`.

- [ ] **Step 3: Smoke test** — `src/engine/smoke.test.ts`: `import { expect, test } from 'vitest'; test('smoke', () => expect(1 + 1).toBe(2));`

- [ ] **Step 4: Verify** — Run `npm test` (1 pass) and `npm run build` (succeeds).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: scaffold vite+react+ts+vitest"`

---

### Task 2: Cards & shoe (`cards.ts`)

**Files:**
- Create: `src/engine/cards.ts`
- Test: `src/engine/cards.test.ts` (delete `smoke.test.ts`)

**Interfaces (Produces):**
```ts
export type Rank = 'A'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K';
export type Suit = 's'|'h'|'d'|'c';
export interface Card { rank: Rank; suit: Suit; }
export const RANKS: readonly Rank[];
export function rankValue(rank: Rank): number;        // A=11, J/Q/K/10=10, else face value
export function mulberry32(seed: number): () => number; // deterministic RNG in [0,1)
export class Shoe {
  constructor(opts: { decks?: number; penetration?: number; seed?: number }); // defaults 6, 0.75
  draw(): Card;                    // throws if empty
  get cardsRemaining(): number;
  get cardsDealt(): number;
  get decksRemaining(): number;    // nearest half deck, min 0.5: max(0.5, round(cardsRemaining/26)/2)
  get cutCardReached(): boolean;   // cardsDealt >= floor(decks*52*penetration)
  shuffle(): void;                 // rebuilds full shoe, reshuffles with same rng
}
```

- [ ] **Step 1: Write failing tests** — `cards.test.ts` asserting: fresh 6-deck shoe has 312 cards remaining; drawing all 312 yields exactly 24 of each rank; `rankValue` for all 13 ranks (A=11, '10'/J/Q/K=10, '7'=7 etc.); same seed ⇒ identical first 20 draws, different seed ⇒ differs; `decksRemaining`: 312 remaining → 6, 286 → 5.5, 13 → 0.5, 3 → 0.5; `cutCardReached` false at 233 dealt, true at 234 (6×52×0.75 = 234); `shuffle()` restores 312.
- [ ] **Step 2: Run to verify fail** — `npm test` → module not found.
- [ ] **Step 3: Implement** — mulberry32 (standard algorithm), Fisher-Yates shuffle using the rng, Shoe as specified.
- [ ] **Step 4: Verify pass** — `npm test`.
- [ ] **Step 5: Commit** — `feat: cards, seedable shoe`

---

### Task 3: Hand math (`hand.ts`)

**Files:** Create `src/engine/hand.ts`; Test `src/engine/hand.test.ts`

**Interfaces (Produces):**
```ts
import type { Card, Rank } from './cards';
export interface HandValue { total: number; soft: boolean; }
export function handValue(cards: Card[]): HandValue; // best total ≤21 if possible; soft = an ace counted as 11
export function isBust(cards: Card[]): boolean;
export function isBlackjack(cards: Card[]): boolean; // exactly 2 cards totaling 21
export function isPair(cards: Card[]): boolean;      // 2 cards in same rank GROUP: 10/J/Q/K all pair together
export function pairRank(cards: Card[]): Rank | null; // normalized: any ten-value pair → '10'
```

Note: 10-value pairs (K,Q etc.) ARE splittable pairs of tens (spec §4 pair table row `10,10`).

- [ ] **Step 1: Failing tests** — A+K = {21, soft} + blackjack; A+A = {12, soft}; A+A+9 = {21, soft}; A+9+9 = {19, hard}; 5+5 = {10, hard}, pairRank '5'; K+Q = pair '10'; A+A pair 'A'; 10+J+Q = bust; A+6+9 = {16, hard} (ace demoted, soft flag off); 7+8 isPair false.
- [ ] **Step 2: Fail** — `npm test`.
- [ ] **Step 3: Implement** — count aces as 11, demote one at a time while total > 21.
- [ ] **Step 4: Pass** — `npm test`.
- [ ] **Step 5: Commit** — `feat: hand evaluation`

---

### Task 4: Hi-Lo count (`count.ts`)

**Files:** Create `src/engine/count.ts`; Test `src/engine/count.test.ts`

**Interfaces (Produces):**
```ts
import type { Rank } from './cards';
export function hiLoTag(rank: Rank): -1 | 0 | 1;
export function trueCount(runningCount: number, decksRemaining: number): number; // Math.floor(rc/decks); decks min 0.5 enforced here too
```

- [ ] **Step 1: Failing tests** — all 13 tags (2..6→+1, 7..9→0, 10/J/Q/K/A→−1); a full 6-deck shoe's tags sum to 0; trueCount(6, 3) = 2; trueCount(−3, 2) = −2 (floor toward −∞: −1.5 → −2); trueCount(5, 2) = 2 (2.5 → 2); trueCount(3, 0.5) = 6; trueCount(0, 6) = 0.
- [ ] **Step 2: Fail.** **Step 3: Implement.** **Step 4: Pass.**
- [ ] **Step 5: Commit** — `feat: hi-lo running/true count`

---

### Task 5: Basic strategy tables (`basicStrategy.ts`)

**Files:** Create `src/engine/basicStrategy.ts`; Test `src/engine/basicStrategy.test.ts`

**THE DATA BELOW IS VERIFIED AGAINST SOURCE CHARTS. TRANSCRIBE EXACTLY. DO NOT ADJUST FROM MEMORY.**

**Interfaces (Produces):**
```ts
import type { Card, Rank } from './cards';
export type ChartAction = 'H'|'S'|'Dh'|'Ds'|'P'|'Ph'|'Rh'|'Rs'|'Rp';
export type UpIndex = 0|1|2|3|4|5|6|7|8|9; // dealer 2,3,4,5,6,7,8,9,10,A
export function upIndex(up: Rank): UpIndex; // '2'→0 ... '10'/'J'/'Q'/'K'→8, 'A'→9
export function chartLookup(cards: Card[], dealerUp: Rank): ChartAction;
// pairs first (5,5 and 10,10 excluded → hard-10 path / stand), then soft, then hard
export const HARD: Record<number, ChartAction[]>;   // totals 4..21
export const SOFT: Record<number, ChartAction[]>;   // totals 13..21
export const PAIRS: Partial<Record<Rank, ChartAction[]>>; // '2','3','4','6','7','8','9','A' ('5' & '10' intentionally absent)
```

Engine data (columns are dealer 2 3 4 5 6 7 8 9 10 A):

```ts
const H='H',S='S',Dh='Dh',Ds='Ds',P='P',Ph='Ph',Rh='Rh',Rs='Rs',Rp='Rp';
export const HARD: Record<number, ChartAction[]> = {
  4:[H,H,H,H,H,H,H,H,H,H], 5:[H,H,H,H,H,H,H,H,H,H], 6:[H,H,H,H,H,H,H,H,H,H],
  7:[H,H,H,H,H,H,H,H,H,H], 8:[H,H,H,H,H,H,H,H,H,H],
  9:[H,Dh,Dh,Dh,Dh,H,H,H,H,H],
  10:[Dh,Dh,Dh,Dh,Dh,Dh,Dh,Dh,H,H],
  11:[Dh,Dh,Dh,Dh,Dh,Dh,Dh,Dh,Dh,Dh],
  12:[H,H,S,S,S,H,H,H,H,H],
  13:[S,S,S,S,S,H,H,H,H,H],
  14:[S,S,S,S,S,H,H,H,H,H],
  15:[S,S,S,S,S,H,H,H,Rh,Rh],
  16:[S,S,S,S,S,H,H,Rh,Rh,Rh],
  17:[S,S,S,S,S,S,S,S,S,Rs],
  18:[S,S,S,S,S,S,S,S,S,S], 19:[S,S,S,S,S,S,S,S,S,S],
  20:[S,S,S,S,S,S,S,S,S,S], 21:[S,S,S,S,S,S,S,S,S,S],
};
export const SOFT: Record<number, ChartAction[]> = {
  13:[H,H,H,Dh,Dh,H,H,H,H,H],
  14:[H,H,H,Dh,Dh,H,H,H,H,H],
  15:[H,H,Dh,Dh,Dh,H,H,H,H,H],
  16:[H,H,Dh,Dh,Dh,H,H,H,H,H],
  17:[H,Dh,Dh,Dh,Dh,H,H,H,H,H],
  18:[Ds,Ds,Ds,Ds,Ds,S,S,H,H,H],
  19:[S,S,S,S,Ds,S,S,S,S,S],
  20:[S,S,S,S,S,S,S,S,S,S], 21:[S,S,S,S,S,S,S,S,S,S],
};
export const PAIRS: Partial<Record<Rank, ChartAction[]>> = {
  '2':[Ph,Ph,P,P,P,P,H,H,H,H],
  '3':[Ph,Ph,P,P,P,P,H,H,H,H],
  '4':[H,H,H,Ph,Ph,H,H,H,H,H],
  '6':[Ph,P,P,P,P,H,H,H,H,H],
  '7':[P,P,P,P,P,P,H,H,H,H],
  '8':[P,P,P,P,P,P,P,P,P,Rp],
  '9':[P,P,P,P,P,S,P,P,S,S],
  'A':[P,P,P,P,P,P,P,P,P,P],
};
```

`chartLookup`: if `isPair` and `pairRank` has a PAIRS row (pairRank normalizes ten-values to '10', which is absent → falls to hard 20; 5,5 absent → hard 10) → pair row; else SOFT if `handValue().soft` else HARD.

- [ ] **Step 1: Failing tests — INDEPENDENT transcription.** The test file encodes the same chart as compact strings (a second, independent transcription typed from THIS plan — do not import/derive from the engine tables):

```ts
const HARD_EXPECT = [
  '4:H H H H H H H H H H', '5:H H H H H H H H H H', '6:H H H H H H H H H H',
  '7:H H H H H H H H H H', '8:H H H H H H H H H H',
  '9:H Dh Dh Dh Dh H H H H H',
  '10:Dh Dh Dh Dh Dh Dh Dh Dh H H',
  '11:Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh',
  '12:H H S S S H H H H H',
  '13:S S S S S H H H H H', '14:S S S S S H H H H H',
  '15:S S S S S H H H Rh Rh',
  '16:S S S S S H H Rh Rh Rh',
  '17:S S S S S S S S S Rs',
  '18:S S S S S S S S S S', '19:S S S S S S S S S S',
  '20:S S S S S S S S S S', '21:S S S S S S S S S S',
];
const SOFT_EXPECT = [
  '13:H H H Dh Dh H H H H H', '14:H H H Dh Dh H H H H H',
  '15:H H Dh Dh Dh H H H H H', '16:H H Dh Dh Dh H H H H H',
  '17:H Dh Dh Dh Dh H H H H H',
  '18:Ds Ds Ds Ds Ds S S H H H',
  '19:S S S S Ds S S S S S',
  '20:S S S S S S S S S S', '21:S S S S S S S S S S',
];
const PAIRS_EXPECT = [
  '2:Ph Ph P P P P H H H H', '3:Ph Ph P P P P H H H H',
  '4:H H H Ph Ph H H H H H', '6:Ph P P P P H H H H H',
  '7:P P P P P P H H H H', '8:P P P P P P P P P Rp',
  '9:P P P P P S P P S S', 'A:P P P P P P P P P P',
];
```

Iterate every row × column against `HARD`/`SOFT`/`PAIRS` (170 + 90 + 80 = 340 cell assertions). Plus behavioral lookups via `chartLookup` with constructed card arrays: (K,6) v 9 → Rh; (A,7) v 2 → Ds; (8,8) v A → Rp; (K,Q) v 6 → S (ten-pair → hard 20); (5,5) v 6 → Dh (hard-10 path); (A,4) v 4 → Dh; (2,2) v 2 → Ph; 3-card (5,4,7)=16 v 10 → Rh (chart is card-count agnostic; legality handled in strategy.ts); `upIndex('J')===8`, `upIndex('Q')===8`, `upIndex('K')===8`.

- [ ] **Step 2: Fail.** **Step 3: Implement (paste engine data above).** **Step 4: Pass — all 340 cells + behavioral.**
- [ ] **Step 5: Commit** — `feat: verified 6D H17 DAS LS basic strategy tables`

---

### Task 6: Illustrious 18 + correctPlay (`deviations.ts`, `strategy.ts`)

**Files:** Create `src/engine/deviations.ts`, `src/engine/strategy.ts`; Test `src/engine/strategy.test.ts`

**VERIFIED H17-ADJUSTED INDICES — TRANSCRIBE EXACTLY.**

**Interfaces (Produces):**
```ts
// deviations.ts
import type { Rank } from './cards';
export type Action = 'hit'|'stand'|'double'|'split'|'surrender';
export type DeviationId = 'ins'|'16v10'|'15v10'|'TTv5'|'TTv6'|'10v10'|'12v3'|'12v2'|'11vA'
  |'9v2'|'10vA'|'9v7'|'16v9'|'13v2'|'12v4'|'12v5'|'12v6'|'13v3';
export interface Deviation {
  id: DeviationId;
  kind: 'insurance'|'hard'|'pair10';
  total?: number;            // for kind 'hard'
  up?: Rank;                 // '2'..'10','A' ('10' covers J/Q/K via upIndex)
  action: Action | 'take-insurance';
  threshold: number;
  dir: 'gte'|'lte';          // deviate when tc >= threshold (gte) or tc <= threshold (lte)
  active: boolean;           // 11vA inactive: absorbed into H17 basic
  label: string;             // e.g. "16 v 10: stand at TC ≥ 0"
}
export const ILLUSTRIOUS_18: Deviation[];

// strategy.ts
import type { Card, Rank } from './cards';
import type { Action, DeviationId } from './deviations';
export interface PlayContext { canDouble: boolean; canSplit: boolean; canSurrender: boolean; }
export interface Advice {
  action: Action;
  source: 'basic'|'illustrious18';
  deviationId?: DeviationId;
  reason: string;            // human string used by the training overlay
}
export function correctPlay(cards: Card[], dealerUp: Rank, tc: number, ctx: PlayContext): Advice;
export function insuranceCorrect(tc: number): boolean;  // tc >= 3
export function basicPlay(cards: Card[], dealerUp: Rank, ctx: PlayContext): Advice; // deviations OFF (used by grader)
```

```ts
export const ILLUSTRIOUS_18: Deviation[] = [
  { id:'ins',   kind:'insurance',            action:'take-insurance', threshold:3,  dir:'gte', active:true,  label:'Insurance: take at TC ≥ +3' },
  { id:'16v10', kind:'hard', total:16, up:'10', action:'stand',  threshold:0,  dir:'gte', active:true,  label:'16 v 10: stand at TC ≥ 0' },
  { id:'15v10', kind:'hard', total:15, up:'10', action:'stand',  threshold:4,  dir:'gte', active:true,  label:'15 v 10: stand at TC ≥ +4' },
  { id:'TTv5',  kind:'pair10',           up:'5',  action:'split',  threshold:5,  dir:'gte', active:true,  label:'10,10 v 5: split at TC ≥ +5' },
  { id:'TTv6',  kind:'pair10',           up:'6',  action:'split',  threshold:4,  dir:'gte', active:true,  label:'10,10 v 6: split at TC ≥ +4' },
  { id:'10v10', kind:'hard', total:10, up:'10', action:'double', threshold:4,  dir:'gte', active:true,  label:'10 v 10: double at TC ≥ +4' },
  { id:'12v3',  kind:'hard', total:12, up:'3',  action:'stand',  threshold:2,  dir:'gte', active:true,  label:'12 v 3: stand at TC ≥ +2' },
  { id:'12v2',  kind:'hard', total:12, up:'2',  action:'stand',  threshold:3,  dir:'gte', active:true,  label:'12 v 2: stand at TC ≥ +3' },
  { id:'11vA',  kind:'hard', total:11, up:'A',  action:'double', threshold:0,  dir:'gte', active:false, label:'11 v A: always double under H17 (S17-only index)' },
  { id:'9v2',   kind:'hard', total:9,  up:'2',  action:'double', threshold:1,  dir:'gte', active:true,  label:'9 v 2: double at TC ≥ +1' },
  { id:'10vA',  kind:'hard', total:10, up:'A',  action:'double', threshold:3,  dir:'gte', active:true,  label:'10 v A: double at TC ≥ +3 (H17)' },
  { id:'9v7',   kind:'hard', total:9,  up:'7',  action:'double', threshold:3,  dir:'gte', active:true,  label:'9 v 7: double at TC ≥ +3' },
  { id:'16v9',  kind:'hard', total:16, up:'9',  action:'stand',  threshold:4,  dir:'gte', active:true,  label:'16 v 9: stand at TC ≥ +4 (H17)' },
  { id:'13v2',  kind:'hard', total:13, up:'2',  action:'hit',    threshold:-1, dir:'lte', active:true,  label:'13 v 2: hit at TC ≤ −1' },
  { id:'12v4',  kind:'hard', total:12, up:'4',  action:'hit',    threshold:-1, dir:'lte', active:true,  label:'12 v 4: hit at any negative TC' },
  { id:'12v5',  kind:'hard', total:12, up:'5',  action:'hit',    threshold:-2, dir:'lte', active:true,  label:'12 v 5: hit at TC ≤ −2' },
  { id:'12v6',  kind:'hard', total:12, up:'6',  action:'hit',    threshold:-3, dir:'lte', active:true,  label:'12 v 6: hit at TC ≤ −3 (H17)' },
  { id:'13v3',  kind:'hard', total:13, up:'3',  action:'hit',    threshold:-2, dir:'lte', active:true,  label:'13 v 3: hit at TC ≤ −2' },
];
```

**`correctPlay` resolution order (spec §5 precedence):**
1. Pair path (if `isPair(cards)` && `ctx.canSplit`): ten-pair → check TTv5/TTv6 (split if triggered, else basic S). 8,8 v A (`Rp`): surrender if `ctx.canSurrender` else split. Other pairs → PAIRS row; `Ph`→split (DAS on); rows with H/S resolve like step 4.
2. Surrender: if `ctx.canSurrender` and the hand's chart action is Rh/Rs → surrender. Count never overrides basic surrender (Fab 4 out of scope).
3. Hard-total deviations (only when the hand is HARD — a soft 16 is never "16 v 10"): find active deviation matching (total, up via upIndex); if the `dir` condition is met by `tc`: 'double' deviations require `ctx.canDouble`, else fall through to step 4; 'stand'/'hit' deviations always apply.
4. Basic chart, resolving conditionals: Dh → double if canDouble else hit; Ds → double if canDouble else stand; Rh → hit / Rs → stand when !canSurrender; P/Ph when !canSplit → re-lookup as hard/soft total INCLUDING step-3 deviations (e.g. 4-hand-cap 8,8 v 10 at TC +1 → hard 16 → stand `16v10`).

`basicPlay` = same algorithm with an empty deviation list.

- [ ] **Step 1: Failing tests.** For every active index: below / at / above threshold (mirrored for `lte`), asserting action AND `deviationId`/`source`. Concrete cases to include verbatim (ctx defaults: canDouble true, canSplit true, canSurrender false unless stated):
  - (10,6) v 10, canSurrender:true → surrender (basic beats deviation); canSurrender:false: tc 0 → stand `16v10`; tc −1 → hit (basic).
  - (9,7) v 9: tc 3 → hit; tc 4 → stand `16v9`.
  - (K,5) v 10: tc 3 → hit; tc 4 → stand `15v10`.
  - (6,4) v 10: tc 3 → hit; tc 4 → double `10v10`; tc 4 + canDouble:false → hit.
  - (6,4) v A: tc 2 → hit; tc 3 → double `10vA`.
  - (5,4) v 2: tc 0 → hit; tc 1 → double `9v2`. (5,4) v 7: tc 2 → hit; tc 3 → double `9v7`.
  - (10,2) v 2: tc 2 → hit; tc 3 → stand `12v2`. v 3: tc 1 → hit; tc 2 → stand `12v3`. v 4: tc 0 → stand; tc −1 → hit `12v4`. v 5: tc −1 → stand; tc −2 → hit `12v5`. v 6: tc −2 → stand; tc −3 → hit `12v6`.
  - (10,3) v 2: tc −1 → hit `13v2`; tc 0 → stand. v 3: tc −1 → stand; tc −2 → hit `13v3`.
  - (K,Q) v 6: tc 3 → stand; tc 4 → split `TTv6`. v 5: tc 4 → stand; tc 5 → split `TTv5`.
  - (6,5) v A at tc −5, 0, +5 → double, source 'basic' (11vA absorbed into H17 basic).
  - (A,5) v 10 at tc 5 → hit (SOFT 16 must NOT trigger `16v10`).
  - (8,8) v 10: canSplit:true tc 5 → split (pair beats 16v10); canSplit:false tc 0 → stand `16v10` (hard-16 re-lookup); canSplit:false canSurrender:true → surrender.
  - (8,8) v A: canSurrender:true → surrender; canSurrender:false → split.
  - 3-card (5,4,7) v 10 (canDouble:false) tc 0 → stand `16v10`.
  - insuranceCorrect(2) → false; insuranceCorrect(3) → true.
  - basicPlay((10,6), '10', canSurrender:false) → hit even at tc 9.
- [ ] **Step 2: Fail.** **Step 3: Implement.** **Step 4: Pass.**
- [ ] **Step 5: Commit** — `feat: H17-adjusted Illustrious 18 + correctPlay precedence`

---

### Task 7: Grading (`grade.ts`)

**Files:** Create `src/engine/grade.ts`; Test `src/engine/grade.test.ts`

**Interfaces (Produces):**
```ts
import type { Card, Rank } from './cards';
import type { Action, DeviationId } from './deviations';
import type { Advice, PlayContext } from './strategy';
export type MistakeClass = 'correct'|'basic-error'|'missed-deviation'|'phantom-deviation'|'wrong-anyway';
export type EventKind = 'action'|'insurance'|'bet'|'countCheck';
export type Category = 'hard'|'soft'|'pairs'|'surrender'|'insurance'|'bet'|'countCheck';
export interface GradedEvent {
  kind: EventKind;
  category: Category;
  correct: boolean;
  classification: MistakeClass;
  taken: string;             // action taken / value entered
  expected: string;          // correct action / value
  reason: string;            // Advice.reason or index label
  deviationId?: DeviationId;
  tc: number;
  hand?: string;             // e.g. "10,6 v 9"
}
export function classifyAction(taken: Action, withCount: Advice, basicOnly: Advice,
  cards: Card[], up: Rank, tc: number): { classification: MistakeClass; correct: boolean };
export function actionCategory(cards: Card[], correct: Action): Category;
// 'surrender' if correct==='surrender'; else 'pairs' if isPair; else 'soft'/'hard' by handValue
```

Classification rules (each gets a test):
- taken === withCount.action → `correct`.
- withCount.source === 'illustrious18' && taken === basicOnly.action → `missed-deviation`.
- withCount.source === 'basic' && an ACTIVE I18 entry exists for this (hand,up) with action === taken (count didn't justify it) → `phantom-deviation`.
- withCount.source === 'basic' && anything else → `basic-error`.
- withCount.source === 'illustrious18' && taken ≠ both → `wrong-anyway`.

- [ ] **Step 1: Failing tests** — (10,6)v10 tc 2 (correct stand `16v10`): taken stand → correct; taken hit → missed-deviation; taken double → wrong-anyway. (10,6)v10 tc −2 (correct hit): taken stand → phantom-deviation; taken double → basic-error. (10,2)v4 tc −3 (correct hit `12v4`): taken stand → missed-deviation; taken double → wrong-anyway. Categories: (8,8)v9 correct split → 'pairs'; (10,6)v10 correct surrender → 'surrender'; (A,6)v3 → 'soft'; (10,9)v5 → 'hard'.
- [ ] **Step 2: Fail.** **Step 3: Implement.** **Step 4: Pass.** **Step 5: Commit** — `feat: mistake grading/classification`

---

### Task 8: Game state machine (`game.ts`)

**Files:** Create `src/engine/game.ts`; Test `src/engine/game.test.ts`

**Interfaces (Produces):**
```ts
import { Shoe, type Card, type Rank } from './cards';
import type { Action } from './deviations';
import type { GradedEvent } from './grade';
export interface SpreadRow { minTc: number; units: number; }  // sorted asc; bet = last row with minTc <= tc
export const DEFAULT_SPREAD: SpreadRow[];
// [{minTc:-99,units:1},{minTc:1,units:2},{minTc:2,units:4},{minTc:3,units:8},{minTc:4,units:10},{minTc:5,units:12}]
export interface GameConfig {
  penetration: number;        // 0.5..0.9
  betSpreadOn: boolean;
  spread: SpreadRow[];
  bankrollStart: number;      // units
  countCheckEvery: number;    // rounds; 0 = off
  seed?: number;
}
export type Phase = 'idle'|'insurance'|'player'|'settled';
export interface PlayerHand {
  cards: Card[]; bet: number; doubled: boolean; surrendered: boolean;
  fromSplit: boolean; splitAces: boolean; done: boolean;
  result?: 'win'|'lose'|'push'|'blackjack'|'surrender'; net?: number; // units
}
export class Game {
  constructor(cfg: GameConfig);
  static withRiggedShoe(cfg: GameConfig, cards: Card[]): Game; // test-only: stacked draw order
  readonly cfg: GameConfig;
  phase: Phase;
  shoe: Shoe;
  runningCount: number;        // updated ONLY as cards become visible to the player
  get trueCountNow(): number;
  dealerCards: Card[];         // [up, hole, ...hits]
  holeRevealed: boolean;
  hands: PlayerHand[];
  active: number;              // index of hand being played
  bankroll: number;
  roundNo: number;
  events: GradedEvent[];       // full session log (grading happens inside Game)
  countCheckDue: boolean;      // true between rounds when roundNo % countCheckEvery === 0
  askTcToo: boolean;           // every 2nd count check also asks TC
  shuffledLastRound: boolean;  // shoe reshuffled before this round (UI announces; RC reset)
  legalActions(): Action[];    // for the active hand
  startRound(betUnits?: number): void;  // grades bet if betSpreadOn (BEFORE dealing, at pre-deal tc); deals P,D,P,D(hole); peek; may settle on dealer BJ
  insuranceDecision(take: boolean): void; // grades vs insuranceCorrect(tc); resolves dealer BJ or continues to 'player'
  act(action: Action): void;   // grades vs correctPlay at decision-time tc, applies, advances (auto-plays dealer + settles when all hands done)
  submitCountCheck(rc: number, tcGuess?: number):
    { rcCorrect: boolean; actualRc: number; tcCorrect?: boolean; actualTc?: number }; // also appends countCheck event(s)
}
```

Rules to implement (each tested): double only on a 2-card unplayed hand (incl. after split — DAS); split only `isPair` hands, max 4 hands total, never on split aces; split aces get exactly one card each and are done (21 ≠ blackjack, pays 1×); surrender only as first action on a non-split 2-card hand; dealer hits soft 17 (A,6 draws; A,7 and hard 17 stand), draws until 17+ (soft 18+ or hard 17+); hole card added to `runningCount` only at reveal; settle: BJ +1.5 (non-split only), win +bet, lose −bet, push 0, double ±2×bet, surrender −0.5; peek game: A up → 'insurance' phase before player decisions, 10-value up → silent peek; dealer BJ → settle immediately (player BJ pushes, all else lose), hole revealed+counted; reshuffle between rounds when `cutCardReached` → RC=0, `shuffledLastRound=true`.

- [ ] **Step 1: Failing tests** using `withRiggedShoe` (deal order P,D,P,D-hole, then draws in order):
  - happy path: P(10,6) D(9 up, 8 hole) → phase 'player'; act('hit') → drew rigged 5 → 21; act('stand') → dealer plays, settle; bankroll delta matches results.
  - bust: P(10,6), hit into a K → result 'lose', net −1, phase 'settled'.
  - blackjack: P(A,K) vs D(9,8) → immediate settle, net +1.5, result 'blackjack'.
  - dealer BJ peek: D(A up, K hole), P(10,6) → phase 'insurance'; insuranceDecision(false) → settled, lose; RC counted A,K(at reveal),10,6 exactly once each.
  - player BJ vs dealer BJ → push, net 0.
  - insurance grading: rig cards so tc ≥ +3 at offer → take:true → insurance event correct:true; symmetric wrong case.
  - split: P(8,8) v 6 → act('split') → 2 hands each dealt a second card; resplit chain rig (8,8,8,8,...) reaches 4 hands, then legalActions() lacks 'split'.
  - split aces: P(A,A) → split → each hand 1 card, done, no 'hit' legal; A+K after split pays 1× (not 1.5×).
  - double: legal only on first two cards; doubled hand gets exactly 1 card then done; win pays +2.
  - surrender: legal first action only; gone after a hit; gone on split hands; nets −0.5.
  - dealer H17: D(A,6) must draw; D(10,7) stands; D(A,7) stands.
  - RC visibility: after a full rigged round, runningCount === sum of hiLoTags of all visible cards, hole included only post-reveal.
  - bet grading: betSpreadOn, pre-deal tc 0, startRound(4) → bet event wrong (expected '1'); startRound(1) → correct.
  - count check: countCheckEvery:2 → after 2nd round settles, countCheckDue true; submitCountCheck(actualRc) → rcCorrect:true, event appended; 2nd check has askTcToo true and grades tcGuess.
  - reshuffle: penetration 0.5 + play until cutCardReached → next startRound → shuffledLastRound true, runningCount 0.
  - grading wiring: rigged (10,6) v 10 at tc 0, act('hit') → last action event classification 'missed-deviation', deviationId '16v10'.
- [ ] **Step 2: Fail.** **Step 3: Implement** (plain mutable class; UI wraps it). **Step 4: Pass.**
- [ ] **Step 5: Commit** — `feat: game state machine (peek, splits, H17 dealer, grading, count checks)`

---

### Task 9: Persistence & stats (`src/store/`)

**Files:** Create `src/store/types.ts`, `src/store/persist.ts`, `src/store/stats.ts`; Test `src/store/store.test.ts`

**Interfaces (Produces):**
```ts
// types.ts
import type { SpreadRow } from '../engine/game';
import type { Category, MistakeClass } from '../engine/grade';
import type { DeviationId } from '../engine/deviations';
export interface Settings {
  version: 1; feedbackMode: 'training'|'test'; betSpreadOn: boolean; spread: SpreadRow[];
  bankrollStart: number; countCheckEvery: number; penetration: number;
  countPeek: boolean; dealSpeedMs: number;
  drill: { flashCategory: 'all'|'hard'|'soft'|'pairs'; countGroup: 1|2|3; countIntervalMs: number; countLengthCards: number; };
}
export const DEFAULT_SETTINGS: Settings;
// {version:1, feedbackMode:'training', betSpreadOn:false, spread:DEFAULT_SPREAD, bankrollStart:100,
//  countCheckEvery:5, penetration:0.75, countPeek:true, dealSpeedMs:300,
//  drill:{flashCategory:'all', countGroup:1, countIntervalMs:800, countLengthCards:52}}
export interface TallyRW { right: number; wrong: number; }
export interface Stats {
  version: 1;
  categories: Record<Category, TallyRW>;
  perIndex: Partial<Record<DeviationId, TallyRW>>;
  mistakes: Record<MistakeClass, number>;
  countDrill: { history: { date: string; cards: number; intervalMs: number; correct: boolean }[] };
  sessions: { date: string; rounds: number; graded: number; correct: number; bankrollDelta: number }[];
}
export const EMPTY_STATS: Stats;

// persist.ts
export function _setStorage(s: Pick<Storage,'getItem'|'setItem'>): void; // test injection; default guards missing localStorage
export function loadSettings(): Settings;      // key 'bjtrainer.settings.v1'; corrupt/missing/wrong-version → DEFAULT_SETTINGS
export function saveSettings(s: Settings): void;
export function loadStats(): Stats;            // key 'bjtrainer.stats.v1'
export function saveStats(s: Stats): void;
export function exportAll(): string;           // JSON {settings, stats}
export function importAll(json: string): { ok: boolean; error?: string };

// stats.ts
import type { GradedEvent } from '../engine/grade';
export function applyEvents(stats: Stats, events: GradedEvent[]): Stats; // pure; returns new object
```

- [ ] **Step 1: Failing tests** — settings/stats round-trip via injected in-memory storage; `'{oops'` → defaults without throwing; `{version: 99}` → defaults; applyEvents on a fixture list (correct stand hard, missed-deviation 16v10, wrong insurance, wrong bet, right countCheck) tallies categories/perIndex/mistakes exactly; export → import round-trip; importAll('garbage') → `{ok:false}` and storage untouched.
- [ ] **Step 2: Fail.** **Step 3: Implement.** **Step 4: Pass.** **Step 5: Commit** — `feat: versioned settings/stats persistence`

---

### Task 10: Drill logic (`src/drills/`)

**Files:** Create `src/drills/countDrill.ts`, `src/drills/flashcards.ts`, `src/drills/deviationQuiz.ts`; Test `src/drills/drills.test.ts`

**Interfaces (Produces):**
```ts
// countDrill.ts
import type { Card } from '../engine/cards';
export interface CountDrillRound { groups: Card[][]; finalRc: number; }
export function makeCountDrill(cards: number, groupSize: 1|2|3, seed?: number): CountDrillRound;
export interface CountdownRound { shown: Card[]; hidden: Card; } // full 52-card deck, last card hidden
export function makeCountdown(seed?: number): CountdownRound;

// flashcards.ts
import type { Card, Rank } from '../engine/cards';
import type { Action } from '../engine/deviations';
export interface Flashcard { cards: [Card, Card]; up: Rank; correct: Action; cellId: string; } // e.g. 'hard-16-v-9'
export function drawFlashcard(category: 'all'|'hard'|'soft'|'pairs',
  missWeights: Record<string, number>, seed?: number): Flashcard;
// correct = correctPlay at tc 0, ctx {canDouble:true, canSplit:true, canSurrender:true}
// sampling weight per cell = 1 + 2*(missWeights[cellId] ?? 0)

// deviationQuiz.ts
import type { Rank, Card } from '../engine/cards';
import type { Action, DeviationId } from '../engine/deviations';
export interface QuizItem {
  cards: [Card, Card] | null;  // null for insurance items
  up: Rank; tc: number; deviationId: DeviationId; isDeviationSide: boolean;
  correct: Action | 'take-insurance' | 'decline-insurance';
  label: string;               // the index label for feedback
}
export function drawQuizItem(seed?: number): QuizItem;
// random I18 entry (incl. inactive 11vA and 'ins'); tc = integer uniform in [threshold−2, threshold+2];
// correct = correctPlay(cards, up, tc, full ctx) / insuranceCorrect(tc) for 'ins'
```

- [ ] **Step 1: Failing tests** — makeCountDrill(52,1,seed): 52 cards, finalRc = sum of tags, deterministic per seed; groupSize 3 → 18 groups (last short); makeCountdown: 52 distinct cards, `sum(tags(shown)) === -hiLoTag(hidden)`; drawFlashcard('pairs') returns only pairs and `correct` matches correctPlay; weighting: with missWeights 50 on one cellId, ≥30% of 200 seeded draws hit it; drawQuizItem over 200 seeded draws: every tc within ±2 of its entry's threshold, both isDeviationSide values occur, `correct` always equals engine recomputation; 11vA items → correct 'double' at every sampled tc.
- [ ] **Step 2: Fail.** **Step 3: Implement.** **Step 4: Pass.** **Step 5: Commit** — `feat: drill generators`

---

### Task 11: UI foundation + Table screen

**Files:**
- Create: `src/ui/screens/Home.tsx`, `src/ui/screens/Table.tsx`, `src/ui/components/PlayingCard.tsx`, `src/ui/components/ActionBar.tsx`, `src/ui/components/Modal.tsx`, `src/ui/components/NumPad.tsx`, `src/ui/useGame.ts`
- Modify: `src/ui/App.tsx`, `src/ui/app.css`, `src/main.tsx`

**Interfaces:**
- Consumes: `Game`, `GameConfig`, `DEFAULT_SPREAD`, `legalActions`, `GradedEvent`, store functions, `applyEvents`.
- Produces: `type Screen = 'home'|'table'|'drills'|'stats'|'settings'` state in `App.tsx` (plain `useState`, no router; every screen gets `onNavigate(screen)`); `useGame(settings)` hook holding a `Game` in `useRef` + version counter re-render; exposes `{ game, deal, act, insure, submitCount, overlay, dismissOverlay, report, endSession }`. Seed hook for e2e: `new URLSearchParams(location.search).get('seed')` → `GameConfig.seed`; `?e2e=1` renders a `data-advice` attribute with the current correct action (used by e2e to click a deliberately wrong button).

Layout (portrait, dark felt `#0d2318`, `color-scheme: dark`): top bar (bankroll · round # · TC-peek button [tap-and-hold reveal RC/TC; hidden when `countPeek` off] · End); dealer area (hole card face-down until reveal); player hands row (active highlighted, splits side-by-side); message strip (results, "Shuffling…" on `shuffledLastRound`); bottom ActionBar: 5 action buttons ≥48px (disabled unless in `legalActions()`), or bet chips (1/2/4/8/10/12) + Deal when betting, or Deal when flat-betting. Insurance prompt as Modal (Take / Decline). Count-check Modal with `NumPad` (digits, minus, backspace, OK; asks RC, then TC when `askTcToo`). Training overlay Modal: "You: HIT — Correct: STAND" + reason + "(TC was +1)" + Continue; the hand continues with the action actually taken. Test mode: no overlay; End → `report` rendered full-screen (per-category accuracy + every non-correct event: hand, tc, taken, expected, reason). End Session always: `applyEvents` → save stats + session summary → back Home.

`PlayingCard`: CSS-only card, rank + suit glyph (♠♥♦♣, red for h/d), `data-card="10h"` attribute for e2e assertions, `aria-label`.

- [ ] **Step 1: Build it.** Keep components dumb; ALL rules live in the engine. TypeScript strict stays green.
- [ ] **Step 2: Verify** — `npm test` + `npm run build` green; `npm run dev` boots (curl HTTP 200).
- [ ] **Step 3: Commit** — `feat: app shell + table screen (game, overlays, count checks, bets)`

---

### Task 12: Drill screens

**Files:** Create `src/ui/screens/Drills.tsx` (picker + `CountDrillView`, `FlashcardsView`, `DeviationQuizView`); Modify `src/ui/App.tsx`.

**Interfaces:** Consumes Task 10 generators, `NumPad`, stats store. Count drill: interval/group/length from settings; cards flash on `setInterval`; then RC entry via NumPad; result view (right/wrong + actual); appends to `stats.countDrill.history`; "Countdown" toggle uses `makeCountdown`, asks the hidden card's tag (+1 / 0 / −1 buttons). Flashcards: two cards + upcard, 5 action buttons always enabled, instant feedback (correct action + cellId); per-cell miss weights persisted at `bjtrainer.flashweights.v1` (best-effort raw record). Deviation quiz: TC shown prominently; 'ins' items get Take/Decline buttons; feedback always shows `label`; results feed `perIndex` stats via GradedEvents + `applyEvents`.

- [ ] **Step 1: Build.** **Step 2: `npm run build` + `npm test` green; dev-server HTTP 200.** **Step 3: Commit** — `feat: drill screens`

---

### Task 13: Stats & Settings screens

**Files:** Create `src/ui/screens/Stats.tsx`, `src/ui/screens/Settings.tsx`; Modify `src/ui/App.tsx`.

**Interfaces:** Stats: per-category accuracy rows (right/total + %), per-index table for all 18 I18 entries (em-dash when unseen), mistake-class tallies, count-drill recent history + best clean speed, session list (date, rounds, accuracy, bankroll Δ); buttons: Export (Blob download `bjtrainer-export.json` via `exportAll()`), Import (`<input type=file>` → `importAll`, `confirm()` first), Reset (confirm + `saveStats(EMPTY_STATS)`). Settings: segmented control feedbackMode; toggles betSpreadOn/countPeek; numeric steppers bankrollStart, countCheckEvery (0=off), penetration (0.5–0.9 step 0.05), dealSpeedMs, drill fields; spread editor (rows minTc/units, add/remove); each change → `saveSettings` immediately.

- [ ] **Step 1: Build.** **Step 2: Build + tests green; dev smoke.** **Step 3: Commit** — `feat: stats + settings screens`

---

### Task 14: Playwright e2e + screenshot review

**Files:**
- Create: `playwright.config.ts`, `e2e/helpers.ts`, `e2e/game.spec.ts`, `e2e/drills.spec.ts`, `e2e/settings-stats.spec.ts`, `e2e/screenshots-reviewed/README.md`
- Modify: `package.json` (`"e2e": "playwright test"`), `.gitignore` (`test-results/`, `playwright-report/`, `e2e/screenshots/`)

**Setup:**
```bash
npm install -D @playwright/test
npx playwright install chromium
```
`playwright.config.ts`: viewport `{ width: 390, height: 844 }`; `webServer: { command: 'npm run dev -- --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true }`. `e2e/helpers.ts`: `shot(page, name)` → `page.screenshot({ path: 'e2e/screenshots/' + name + '.png' })`.

**Specs (screenshot every distinct state; fixed `?seed=` values):**
- `game.spec.ts`: home renders → table; full round via clicks; training-mode wrong play (read `data-advice`, click a different legal action) → overlay shows "Correct:" + reason matching /basic strategy|TC/; test-mode 3-round session → End → report lists ≥1 category and the misses; count-check modal (bootstrap settings in localStorage before load: countCheckEvery=1) → NumPad RC entry → graded; bet chips when spread on → deliberately bad bet → shows in report; split flow: hunt a seed once with `node e2e/find-seed.mjs` (iterate seeds until first deal is a pair; commit the script) and hardcode the found seed with a comment.
- `drills.spec.ts`: count drill 4 cards fast interval → RC entry → result; flashcard answer → feedback visible; quiz answer → index label visible.
- `settings-stats.spec.ts`: change a setting → `page.reload()` → persisted; play a short session → stats screen shows it; export downloads `bjtrainer-export.json`; import garbage → error message, app still navigable.

- [ ] **Step 1: Write specs; iterate `npm run e2e` until green.**
- [ ] **Step 2: SCREENSHOT REVIEW (MAIN AGENT, not a subagent):** Read EVERY PNG in `e2e/screenshots/` with the Read tool; check against spec §10 — dark theme, layout, ≥48px buttons, no clipped/overlapping elements, correct overlay/report/keypad content; fix UI and re-run until they look right; copy the final set to `e2e/screenshots-reviewed/` and write `README.md` (review date, what was checked, seeds used).
- [ ] **Step 3: Commit** — `test: playwright e2e + reviewed screenshots`

---

### Task 15: Deploy + README + final verification

**Files:** Create `README.md`, `.github/workflows/deploy.yml`

- [ ] **Step 1: README** — what it is; rules implemented (6D H17 DAS LS, peek, resplit-4, split-aces-1); H17 I18 table (link to spec §5); dev/test/e2e/deploy commands; localStorage note (stats per-device; use Export/Import to move).
- [ ] **Step 2: Deploy** — `gh auth status`; if authenticated: `gh repo create blackjack-trainer --public --source . --push`; workflow on push to main: `npm ci && npm test && npm run build` → `actions/configure-pages` + `actions/upload-pages-artifact` (path `dist/`) + `actions/deploy-pages`; enable via `gh api -X POST repos/{owner}/blackjack-trainer/pages -f build_type=workflow` (409 = already enabled, fine); push, `gh run watch`, then fetch the Pages URL: expect HTTP 200 + `<title>Blackjack Trainer</title>`. If NOT authenticated: skip publishing, add a "Deploy" section to README, flag in the final report.
- [ ] **Step 3: Final verification** — superpowers:verification-before-completion: capture full `npm test`, `npm run e2e`, `npm run build` outputs; live-URL check if deployed.
- [ ] **Step 4: Commit** — `docs: readme + pages deploy` (+ push if repo created)

---

## Self-Review (done at write time)

1. **Spec coverage:** §3 layout→T1; §4 charts→T5; §5 I18+precedence→T6; §6 game (bets/peek/insurance/count checks/reshuffle/feedback modes)→T8+T11; §7 grading→T7; §8 drills→T10+T12; §9 store→T9+T13; §10 UI→T11–T13; §11 testing→every task + T14; §12 hosting→T15; §13 milestones map 1:1. No gaps.
2. **Placeholder scan:** clean — UI "build" steps carry concrete component/interaction specs; all data tables fully transcribed.
3. **Type consistency:** `Action`/`DeviationId` (T6) consumed by T7/T8/T10; `GradedEvent` (T7) by T8/T9/T11/T12; `SpreadRow` (T8) by T9/T13; `pairRank` ten-normalization (T3) relied on by T5/T6/T8; `Phase` (T8) by T11. Consistent.
