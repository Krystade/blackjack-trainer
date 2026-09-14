# Verified late-surrender indices (Hi-Lo)

Source transcription for RV3 (`docs/BACKLOG.md`). Condition (2) of that entry — *"source-verified
index values land in `docs/sources/`"* — is what this file exists to satisfy. Nothing here is from
memory; every row names where it came from and how strong that is.

Research date: 2026-09-13/14.

---

## 1. The notation trap, and why it looked backwards

`docs/sources/BJA_H17.pdf` (Blackjack Apprenticeship, 2018 H17 deviation chart) carries a LATE
SURRENDER section. Its key, verbatim from the PDF's first lines:

> Red Numbers indicate the index that the true count must meet to deviation from basic strategy
> `+` after the index number indicates the deviation happens at that true count and above
> `-` after the index number indicates the devation happens at the true count and below
> `0-` indicates the deviation happens at any negative running count
> `0+` indicates the deviation occurs at any positive running count

The cells, as extracted (`pdftotext -layout`, every token's left edge aligning exactly with its
column label — the `-table` mode was the noisy one and should not be used here):

|        | vs 8 | vs 9  | vs 10 | vs A  |
| ------ | ---- | ----- | ----- | ----- |
| **17** |      |       |       | SUR   |
| **16** | `4+` | `-1-` | SUR   | SUR   |
| **15** |      | `2+`  | `0-`  | `-1+` |
| **14** | —    | —     | —     | —     |

**This reads backwards until you supply each cell's basic-strategy action, which the chart does not
show.** The index is a deviation FROM basic strategy. On a hand where basic strategy already
surrenders, a `-` index means *stop* surrendering below that count — not *start*. Supply the basic
action and every cell resolves to a plain "surrender at TC ≥ X".

This is the single most important thing in this file. An implementation that transcribes the chart's
`-` cells literally as `lte` thresholds inverts them.

## 2. The basic-strategy surrender cells (6 deck)

Two independent sources agree cell-for-cell, so this is solid ground for step 1's resolution.

**Wizard of Odds**, six-deck late surrender, quoted:

> Player's Hand: 15, Dealer's Card 9: N … Dealer's Card 10: Y … A (S17): N … A (H17): Y.
> Player's Hand: 16, Dealer's Card 9: Y … Dealer's Card 10: Y … A (S17): Y … A (H17): Y.
> Player's Hand: 17, Dealer's Card 9: N … Dealer's Card 10: N … A (S17): N … A (H17): Y.

**This app's own chart** (`basicPlay`, 6 deck, `ls: true`, deviations off) returns:

| hand    | 6D H17      | 6D S17    |
| ------- | ----------- | --------- |
| 14 v 10 | hit         | hit       |
| 15 v 9  | hit         | hit       |
| 15 v 10 | `surrender` | `surrender` |
| 15 v A  | `surrender` | hit       |
| 16 v 8  | hit         | hit       |
| 16 v 9  | `surrender` | `surrender` |
| 16 v 10 | `surrender` | `surrender` |
| 16 v A  | `surrender` | `surrender` |
| 17 v A  | `surrender` | stand     |

Identical to Wizard of Odds in every cell. The app's basic chart is therefore usable as a
cross-check, and is used as one below.

## 3. The Fab 4 (Schlesinger), with direction

**Wizard of Odds**, Hi-Lo page, table labelled "Fab 4 Surrenders", quoted:

> "14 Vs. 10" at index +3 · "15 Vs. 10" at index +0 · "15 Vs. 9" at index +2 · "15 Vs. A" at index +1
>
> The player should surrender if the True Count equals or exceeds the Index Number.

Context on that page is a six-deck shoe with the dealer STANDING on soft 17, and the page itself
notes it carries no rule notation on the table. So treat these as **S17** values. For the wider set
(16 v 9, 16 v 10, 16 v A, 17 v A) that page defers to Stanford Wong's *Professional Blackjack* —
which this project does NOT have, and which the standing rule says not to work around.

`blackjackreview.com` (Schlesinger's own site) confirms the Fab 4 is the four plays 14 v 10,
15 v 10, 15 v 9, 15 v A and cites *Blackjack Attack* p. 70, but its encyclopedia entry carries no
index values — so it corroborates the SET, not the numbers.

## 4. Resolved H17 index set

Every entry is **surrender when TC ≥ index**. `dir: 'gte'` for all of them; there is no `lte`
surrender index in this set, and the chart's `-` cells are the reason it looks like there should be.

| Cell        | Index | Basic (H17) | Chart cell | How it resolves                          | Strength |
| ----------- | ----- | ----------- | ---------- | ---------------------------------------- | -------- |
| **15 v 9**  | +2    | hit         | `2+`       | start surrendering at +2                  | **Two sources** — BJA chart and WoO Fab 4 agree |
| **15 v 10** | 0     | surrender   | `0-`       | stop surrendering below 0 ⇒ surrender ≥ 0 | **Three sources** — BJA chart, WoO Fab 4 (+0), and an explicit 6D-H17 statement that you hit 15 v 10 in negative counts and surrender at 0 or more |
| **15 v A**  | −1    | surrender   | `-1+`      | surrender at −1 and above                 | **Two legs** — BJA chart, plus the basic charts: basic surrenders at TC 0, which is only consistent with `≥ −1`. A `≤ −1` reading would contradict basic strategy at TC 0 and is ruled out |
| **16 v 8**  | +4    | hit         | `4+`       | start surrendering at +4                  | ⚠ **Single source** (BJA chart only) |
| **16 v 9**  | 0     | surrender   | `-1-`      | stop surrendering at ≤ −1 ⇒ surrender ≥ 0 | ⚠ **Single source** (BJA chart only) |
| **14 v 10** | +3    | hit         | *(absent)* | start surrendering at +3                  | ⚠ **S17 source used for H17** — WoO Fab 4 only; the BJA H17 chart has no 14 row at all |

Always-surrender, no index (basic strategy, already implemented): **16 v 10, 16 v A, 17 v A (H17).**

### S17

WoO's Fab 4 **is** the S17 set: 14 v 10 ≥ +3, 15 v 10 ≥ 0, 15 v 9 ≥ +2, 15 v A ≥ +1. Note 15 v A
differs from H17 by two counts (+1 vs −1), which is what you would expect — H17 makes 15 v A worse,
so surrender starts sooner. No S17 source was found for 16 v 8 or 16 v 9.

## 5. Open questions — do NOT close these from memory

- **14 v 10 under H17.** The only index found is from an S17-context table. It is the single
  highest-value Fab 4 play, and it is the one this file is least sure of for H17.
- **16 v 8 and 16 v 9** rest on one chart each.
- **17 v A.** The BJA chart says always-surrender (matching basic). One search summary claimed a
  reverse index at +2 (stand at +3 and above). Unverified, and deliberately NOT implemented.
- A search-result summary claimed 15 v A H17 is "surrender at −1 **or lower**". That is ruled out by
  §2 — basic strategy surrenders 15 v A at TC 0 under H17, so a `≤ −1` rule would contradict the
  basic chart both sources agree on. Recorded here so it is not re-found and believed.
- The BJA chart's hard-totals section gives **13 v 2 = `-1-`** (hit at TC ≤ −1) where this app's
  verified Illustrious 18 has **≤ −2**. Unrelated to surrender, but found during this pass and worth
  chasing separately rather than silently reconciling.

## Sources

- `docs/sources/BJA_H17.pdf` — Blackjack Apprenticeship H17 deviation chart, 2018 (in-repo, primary
  for the H17 cells)
- Wizard of Odds, Hi-Lo card counting — https://wizardofodds.com/games/blackjack/card-counting/high-low/
- Wizard of Odds, surrender — https://wizardofodds.com/games/blackjack/surrender/
- Blackjack Review (Schlesinger), Encyclopedia "F is for the Fab 4" — https://www.blackjackreview.com/wp/encyclopedia/f/
- NOT consulted, and the gap in §5 is its shape: Stanford Wong, *Professional Blackjack* (the
  complete index tables both of the above defer to)
