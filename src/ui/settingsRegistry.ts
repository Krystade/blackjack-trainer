/**
 * Owner 2026-11-06 (settings overhaul, step 1): every setting the app stores,
 * with its ONE home and the shortcut sheets that may also show it. Nothing
 * renders from this yet; settingsRegistry.test.ts holds the surfaces to it
 * so a setting cannot quietly gain a second home or drift between copies.
 *
 * Homes:
 *  - 'app'          the Settings screen (Home gear): the app itself.
 *  - 'system'       the profile, "My system": how you count and bet.
 *  - 'table'        the profile, "The table": the game you practise at.
 *  - 'drill'        a drill's own Options.
 *  - 'play'         Play's gear: what the table checks (T1-1B, ui/whatToCheck.ts).
 * Shortcuts: the tab gear sheets ('play', 'charts', 'drills').
 */
export type SettingHome = 'app' | 'system' | 'table' | 'drill' | 'play';
export type SettingShortcut = 'play' | 'charts' | 'drills';

export interface SettingEntry {
  /** Storage path: 'profile.<field>' or 'settings.<field>'. */
  path: string;
  /** The control's label, the same on every surface. Null: no single control (a list, a picker). */
  label: string | null;
  home: SettingHome;
  shortcuts?: SettingShortcut[];
}

const p = (path: string, label: string | null, home: SettingHome, shortcuts?: SettingShortcut[]): SettingEntry => ({
  path,
  label,
  home,
  shortcuts,
});

export const SETTINGS_REGISTRY: readonly SettingEntry[] = [
  // ---- The app ----
  p('settings.theme', null, 'app'),
  p('settings.handedness', null, 'app'),
  p('settings.audio.enabled', 'Audio enabled', 'app'),
  p('settings.audio.volume', 'Volume', 'app'),
  p('settings.audio.chimeVolume', 'Chime volume', 'app'),
  p('settings.audio.rate', 'Speech rate', 'app'),
  p('settings.audio.muted', null, 'app'),
  p('settings.audio.verbosity', null, 'app'),
  p('settings.audio.voiceURI', null, 'app'),
  p('settings.audio.useClips', null, 'app'),
  p('settings.audio.clipVoice', null, 'app'),
  p('settings.audio.answerPauseMs', 'Answer pause', 'app'),
  p('settings.audio.dimZones', null, 'app'),
  p('settings.audio.voiceAliases', null, 'app'),
  p('settings.audio.audioRoute', null, 'app'),
  p('settings.audio.routeStrategy', null, 'app'),
  p('settings.habits.goal', null, 'app'),

  // ---- My system ----
  p('profile.tcRounding', null, 'system'),
  p('profile.surrenderIndices', 'Surrender indices (Fab 4)', 'system'),
  p('profile.bjaExtras', 'BJA H17 extra indices', 'system'),
  p('profile.betSpreadOn', 'Vary bets with the count', 'system'),
  p('profile.spread', null, 'system'),
  p('profile.coverBets', 'Cover bets: allow one step off the ramp', 'system'),
  p('profile.bankrollStart', 'Starting bankroll', 'system'),
  p('profile.unitDollars', '$ per unit', 'system'),
  p('profile.wongExitTc', 'Get out at TC', 'system'),
  p('profile.wongInTc', 'Get in at TC ≥', 'system'),
  p('profile.startShoeOut', 'Start each shoe out', 'system'),
  p('profile.playDepth', null, 'system', ['play']),
  // T1-1B: the cadence and the ask left Play's gear for the What-to-check switch.
  p('profile.countCheckEvery', 'Count check every', 'system'),
  p('profile.countCheckAsk', null, 'system'),
  p('profile.gradeDeviations', 'Grade with deviations', 'system'),
  p('profile.cvcx', null, 'system'),
  p('profile.sideBet', null, 'system'),

  // ---- The table ----
  p('profile.name', 'Profile name', 'table'),
  p('profile.rules.decks', null, 'table', ['charts']),
  p('profile.rules.s17', null, 'table', ['charts']),
  p('profile.rules.das', 'Double after split (DAS)', 'table', ['charts']),
  p('profile.rules.ls', 'Late surrender (LS)', 'table', ['charts']),
  p('profile.rules.rsa', 'Resplit aces (RSA)', 'table'),
  p('profile.rules.bj65', '6:5 blackjack payout', 'table'),
  p('profile.dealerAlwaysPlaysOut', 'Dealer always shows the hole card', 'table'),
  p('profile.seats.playerHands', null, 'table'),
  p('profile.seats.bots', 'Players with you', 'table', ['play']),
  p('profile.seats.botMistakePct', 'Bot mistakes', 'table'),
  p('profile.seats.playerPosition', 'Your seat', 'table'),
  p('profile.penetration', 'Cut card', 'table'),
  p('profile.cutDecks', null, 'table'),
  p('profile.cutVary', 'Vary ±0.5 decks', 'table'),
  p('profile.hotShoe', 'Hot shoe (practice)', 'table'),
  p('settings.feedbackMode', null, 'table', ['play']),
  p('settings.dealSpeedMs', 'Deal speed', 'table', ['play']),
  p('settings.dealerPaceOn', 'Dealer pace clock', 'table'),
  p('settings.dealerPaceSec', 'Dealer pace', 'table'),
  p('settings.dealerMistakesMode', null, 'table'),
  p('settings.losingShoe', 'Losing shoe', 'table', ['play']),

  // ---- Play's gear: What to check (T1-1B) ----
  p('profile.playChecks.count', 'Count checks', 'play'),
  p('profile.playChecks.deviations', 'Deviations', 'play'),
  p('profile.playChecks.bets', 'Bet checks', 'play'),
  p('settings.tableChecks.dealerMistakes', 'Dealer mistakes', 'play'),
  p('settings.tableChecks.distractions', 'Distractions', 'play'),
  // Owner 2026-11-09: under the Distractions switch, while it is on.
  p('settings.playDistractionFreq', 'How often', 'play'),
  p('settings.playDistractionDifficulty', 'Difficulty', 'play'),
  // Owner 2026-11-10: Sums, Other table or Mix, with the two above.
  p('settings.playDistractionType', 'Kind', 'play'),

  // ---- Drill options (each drill's own Options fold) ----
  ...[
    'flashCategory', 'scopes', 'deck', 'custom', 'customListId', 'markers', 'fallbacks', 'withCount', 'speedMode',
    'countTableMode', 'countTableRounds', 'countTableDeal', 'countShowHiLo', 'countGroup', 'countIntervalMs',
    'countLengthCards', 'countManual', 'quizIndex', 'quizAsk', 'countTimedStartMs', 'quizDistractorPct', 'timedAdaptive',
    'distractionFreq', 'distractionMode', 'distractionDifficulty', 'countBias', 'countCheckpoints', 'flashByConfusability',
    'depthResolution', 'messyCards', 'pacePressure', 'wheelMode',
    'countPaceRamp',
  ].map((k) => p(`settings.drill.${k}`, null, 'drill')),
  p('settings.drill.shotClockMs', null, 'drill', ['drills']),

  // ---- Added 2026-11-07 (appended, D10) ----
  // Track 3: My system > Bankroll, beside $ per unit; Track 1 adds the Play-gear shortcut.
  // D11: a live shortcut in Play's gear too.
  p('settings.showChips', 'Show chips', 'system', ['play']),
];

/**
 * Stored but not settings: identity, versioning, bookkeeping, and the legacy
 * copies that predate profiles (migrated into the profile on load).
 */
export const NOT_SETTINGS: readonly string[] = [
  'profile.id',
  'settings.version',
  'settings.lastDrive',
  'settings.betSpreadOn',
  'settings.spread',
  'settings.bankrollStart',
  'settings.countCheckEvery',
  'settings.penetration',
  'settings.dealerMistakes',
  'profile.backCount',
  'profile.bankrollNow',
];

export function settingEntry(path: string): SettingEntry | undefined {
  return SETTINGS_REGISTRY.find((e) => e.path === path);
}
