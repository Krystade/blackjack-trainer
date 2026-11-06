# Settings audit and reorganisation proposal (2026-11-06)

Owner's ask (C): "re-assess all the different settings we support and where
they're found and how they're displayed. We need a full UI/UX / code-review and
organization overhaul." This is the first pass: where everything lives today,
what is wrong with that, and a proposed shape. Nothing here is built.

## Where settings live today (seven places)

| Surface | How you reach it | What is in it |
|---|---|---|
| **Settings screen** | Home, gear (top right since 2026-11-06; was at the bottom of Home) | Theme, handedness, audio on/volume/chime/speech rate, car (wheel buttons, clip voice, verbosity, voice, answer pause), tests, teach-it-your-words, diagnostic log |
| **Profile editor** | Home, profile pill | Name; table rules (decks, S17, DAS, LS, RSA, 6:5, hole card); seats (your hands, bot players, bot mistakes, your seat); bet ramp; true count rounding; Fab 4; BJA extras; hot shoe; bankroll, $/unit, cover bets; sim figures |
| **Play sheet** | Play, gear | Feedback mode, deal speed, dealer pace clock, dealer mistakes; then profile items: players with you, deck estimation, bet ramp on/off, wong in/out, start shoe out, grade deviations, count checks, cut card, losing shoe, bankroll reset |
| **Drills sheet** | Drills menu, gear | Shot clock and similar drill-wide items |
| **Charts sheet** | Charts, gear | Rules shown: decks, S17, DAS, LS (the profile's rules again) |
| **In-drill Options** | inside each drill | Count drill alone has 22 controls; Side count 7, True count 6, Produce TC 4, Rules diff 3, Quiz 3; most hand drills share DrillModeControls (eyes-free, voice) and DealToggles |
| **Test kit / audio routes** | Home | Route kits, audio route settings |

## What is wrong with it

1. **The same setting in two or three places**, each drawn by its own code:
   - decks / S17 / DAS / LS: profile editor and Charts sheet;
   - "vary bets with the count": profile editor and Play sheet;
   - bot players: profile editor and (new) Play sheet;
   - cut card, count checks, wong points: profile editor and Play sheet.

   Two copies of a control can drift in wording, limits and validation, and it is not obvious they are one setting.
2. **No rule for which home a setting gets.** True-count rounding changes how every counting drill grades, but it lives only in the profile editor. Count weighting is per drill but shared. Deck estimation now has one setting for the drill and a separate one for Play.
3. **The global Settings screen was unreachable in practice**: under the fold on Home (fixed 2026-11-06, item B).
4. **Drill options are uneven.** The Count drill's setup is a long scroll of 22 controls; other drills have none. The "Options" fold is not in the same place on every drill.
5. **Three kinds of thing are mixed together**:
   - the app: theme, sound, car;
   - your counting system: rounding, indices, ramp, wong points, deck estimation;
   - the table you are practising at: rules, seats, cut, dealer.

## Proposed shape

- **Settings (Home gear) = the app.** Theme, handedness, sound and voice, car and wheel, diagnostics, backup, tests. Nothing about blackjack strategy.
- **Profile = your system and your table**, as two clear halves:
  - **My system:** TC rounding, index sets (Fab 4, extras), bet ramp and cover, wong in/out, deck estimation in Play, bankroll.
  - **The table:** rules, seats/players, cut card, dealer pace and mistakes.
- **Each tab's gear = shortcuts only.** The few things you change mid-session, rendered by the same component the profile uses, with a "where this lives" line. No setting exists only in a gear sheet.
- **Drill Options = drill-specific only**, always the same collapsed "Options" row in the same place. The Count drill's 22 controls are grouped:
  - **Pace:** speed, manual, group size, length;
  - **Shoe:** weighting, table mode;
  - **Interruptions:** distractions, checkpoints;
  - **Audio:** eyes-free, voice.
- **Code:** one settings registry (id, label, storage key, home surface, shortcut surfaces, control kind, limits). Every surface renders from it, and a unit test asserts every setting has exactly one home and every shortcut points at it. That makes duplicates impossible to drift and gives the overhaul a checklist.

## Questions for the owner (my recommendation first)

1. **Is the split app / system / table the right one?** Rec: yes, as above.
2. **Mid-session shortcuts in the Play gear:** keep feedback mode, deal speed, players, deck estimation and count checks; move everything else to the profile only? Rec: yes.
3. **Should the Count drill's long setup become grouped folds** (Pace, Shoe, Interruptions, Audio)? Rec: yes.
4. **Order of work:**
   - first the registry and its test, with no visible change;
   - then the Settings/Profile split;
   - then the drill options;
   - each deployed separately.

   Rec: that order.
