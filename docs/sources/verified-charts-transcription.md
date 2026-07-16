# Coordinator-verified base charts (Wizard of Odds images, read directly 2026-07-16)
# Columns: dealer 2 3 4 5 6 7 8 9 10 A. Actions: H S Dh Ds P Ph Rh Rs Rp.
# This file is dispatch-authority for cycle-1 Tasks 5-7. Do not "correct" from memory.

## 4-8D S17 (bj_4d_s17.gif)
HARD
4-8: H H H H H H H H H H
9:  H Dh Dh Dh Dh H H H H H
10: Dh Dh Dh Dh Dh Dh Dh Dh H H
11: Dh Dh Dh Dh Dh Dh Dh Dh Dh H
12: H H S S S H H H H H
13: S S S S S H H H H H
14: S S S S S H H H H H
15: S S S S S H H H Rh H
16: S S S S S H H Rh Rh Rh
17+: S S S S S S S S S S
SOFT
13: H H H Dh Dh H H H H H
14: H H H Dh Dh H H H H H
15: H H Dh Dh Dh H H H H H
16: H H Dh Dh Dh H H H H H
17: H Dh Dh Dh Dh H H H H H
18: S Ds Ds Ds Ds S S H H H
19+: S S S S S S S S S S
PAIRS
2,2: Ph Ph P P P P H H H H
3,3: Ph Ph P P P P H H H H
4,4: H H H Ph Ph H H H H H
6,6: Ph P P P P H H H H H
7,7: P P P P P P H H H H
8,8: P P P P P P P P P P
9,9: P P P P P S P P S S
A,A: P P P P P P P P P P
S17-vs-H17 deltas confirmed: 11vA H-not-Dh(*as Dh column: 11 row ends H); 15vA H (no Rh); 17vA S (no Rs); soft18v2 S (no Ds); soft19v6 S (no Ds); 8,8vA P (no Rp).

## 2D H17 (bj_2d_h17.gif)
HARD
4-8: H H H H H H H H H H
9:  Dh Dh Dh Dh Dh H H H H H
10: Dh Dh Dh Dh Dh Dh Dh Dh H H
11: Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh
12: H H S S S H H H H H
13: S S S S S H H H H H
14: S S S S S H H H H H
15: S S S S S H H H Rh Rh
16: S S S S S H H H Rh Rh
17: S S S S S S S S S Rs
18-21: S S S S S S S S S S
SOFT
A,2: H H H Dh Dh H H H H H
A,3: H H Dh Dh Dh H H H H H
A,4: H H Dh Dh Dh H H H H H
A,5: H H Dh Dh Dh H H H H H
A,6: H Dh Dh Dh Dh H H H H H
A,7: Ds Ds Ds Ds Ds S S H H H
A,8: S S S S Ds S S S S S
A,9-10: S S S S S S S S S S
PAIRS
2,2: Ph Ph P P P P H H H H
3,3: Ph Ph P P P P H H H H
4,4: H H H Ph Ph H H H H H
6,6: P P P P P Ph H H H H
7,7: P P P P P P Ph H H H
8,8: P P P P P P P P P Rp
9,9: P P P P P S P P S S
A,A: P P P P P P P P P P
2D notables: 9v2 Dh (basic double!); 16v9 H (no Rh); A,3v4 Dh; 6,6v2 P and 6,6v7 Ph; 7,7v8 Ph.
LEGEND DIFFERENCE (2D charts): Rp = "surrender if allowed AND double-after-split NOT allowed, otherwise split" — i.e. 8,8vA with DAS on → SPLIT; das:false + ls:true → surrender. getChart(rules) must resolve this at assembly (das transform rewrites 2D 8,8vA → P when das:true).

## 2D S17 (bj_2d_s17.gif)
HARD
4-8: H H H H H H H H H H
9:  Dh Dh Dh Dh Dh H H H H H
10: Dh Dh Dh Dh Dh Dh Dh Dh H H
11: Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh
12: H H S S S H H H H H
13: S S S S S H H H H H
14: S S S S S H H H H H
15: S S S S S H H H Rh H
16: S S S S S H H H Rh Rh
17-21: S S S S S S S S S S
SOFT
A,2: H H H Dh Dh H H H H H
A,3: H H H Dh Dh H H H H H
A,4: H H Dh Dh Dh H H H H H
A,5: H H Dh Dh Dh H H H H H
A,6: H Dh Dh Dh Dh H H H H H
A,7: S Ds Ds Ds Ds S S H H H
A,8-10: S S S S S S S S S S
PAIRS
2,2: Ph Ph P P P P H H H H
3,3: Ph Ph P P P P H H H H
4,4: H H H Ph Ph H H H H H
6,6: P P P P P Ph H H H H
7,7: P P P P P P Ph H H H
8,8: P P P P P P P P P P
9,9: P P P P P S P P S S
A,A: P P P P P P P P P P
2D S17 notables: 11vA stays Dh (unlike 4-8D S17!); A,3 back to H H H Dh Dh (unlike 2D H17); A,7v2 S; 15vA H; no 17vA Rs; 8,8vA plain P.

## 1D H17 (bj_1d_h17.gif) — introduces Pd, Ps cell types!
HARD
4-7: H H H H H H H H H H
8:  H H H Dh Dh H H H H H
9:  Dh Dh Dh Dh Dh H H H H H
10: Dh Dh Dh Dh Dh Dh Dh Dh H H
11: Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh
12: H H S S S H H H H H
13: S S S S S H H H H H
14: S S S S S H H H H H
15: S S S S S H H H H Rh
16: S S S S S H H H Rh Rh
17: S S S S S S S S S Rs
18+: S S S S S S S S S S
SOFT
13: H H Dh Dh Dh H H H H H
14: H H Dh Dh Dh H H H H H
15: H H Dh Dh Dh H H H H H
16: H H Dh Dh Dh H H H H H
17: Dh Dh Dh Dh Dh H H H H H
18: S Ds Ds Ds Ds S S H H H
19: S S S S Ds S S S S S
20+: S S S S S S S S S S
PAIRS
2,2: Ph P P P P P H H H H
3,3: Ph Ph P P P P Ph H H H
4,4: H H Ph Pd Pd H H H H H
6,6: P P P P P Ph H H H H
7,7: P P P P P P Ph H Rs Rh
8,8: P P P P P P P P P P
9,9: P P P P P S P P S Ps
A,A: P P P P P P P P P P
NEW LEGEND ENTRIES (1D): Pd = split if DAS allowed, otherwise DOUBLE; Ps = split if DAS allowed, otherwise STAND. ChartAction union must gain 'Pd'|'Ps'. Also note 7,7v10 = Rs INSIDE the pairs table (surrender-else-stand), 15v10 = H (only vA surrenders), 16v9 = H, hard 8 doubles v5-6, A,2..A,5 double v4, A,6 doubles v2.

## 1D S17 (bj_1d_s17.gif)
HARD
5-7: H H H H H H H H H H
8:  H H H Dh Dh H H H H H
9:  Dh Dh Dh Dh Dh H H H H H
10: Dh Dh Dh Dh Dh Dh Dh Dh H H
11: Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh
12: H H S S S H H H H H
13: S S S S S H H H H H
14: S S S S S H H H H H
15: S S S S S H H H H H
16: S S S S S H H H Rh Rh
17+: S S S S S S S S S S
SOFT
13: H H Dh Dh Dh H H H H H
14: H H Dh Dh Dh H H H H H
15: H H Dh Dh Dh H H H H H
16: H H Dh Dh Dh H H H H H
17: Dh Dh Dh Dh Dh H H H H H
18: S Ds Ds Ds Ds S S H H S
19: S S S S Ds S S S S S
20+: S S S S S S S S S S
PAIRS
2,2: Ph P P P P P H H H H
3,3: Ph Ph P P P P Ph H H H
4,4: H H Ph Pd Pd H H H H H
6,6: P P P P P Ph H H H H
7,7: P P P P P P Ph H Rs H
8,8: P P P P P P P P P P
9,9: P P P P P S P P S S
A,A: P P P P P P P P P P
1D S17 notables: soft 18 vA = S (stands!); hard 15 no surrender anywhere; 17vA plain S; 7,7vA = H (vs 1D H17's Rh); 9,9vA = S (no Ps); 16v10/A still Rh.
ALL FIVE CHARTS VERIFIED 2026-07-16 by coordinator direct image read. GIFs staged for docs/sources/.
