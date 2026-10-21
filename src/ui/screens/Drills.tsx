import { startTransition, useEffect, useRef, useState, type ReactNode } from 'react';
import { takeDrillLaunch, takeFlashHandOver, takeReviewIndexes } from '../drillLaunch';
import { SpeedDrillView } from './drills/SpeedDrillView';
import { TabSettingsButton } from '../components/TabSettingsButton';
import { strategyRulesFor } from '../../store/profiles';
import type { Screen } from '../App';
import type { Profile, Settings } from '../../store/types';
import { askedIndexSet } from '../../drills/deviationQuiz';
// W2-25: the hand drills' stylesheets, at the point this file used to pull
// them in (DealToggles, HandResultStrip, RulesChip, MissHistoryLine), so the
// bundle's cascade order is unchanged now the views import them from below.
import './drills/dealToggles.css';
import '../components/handResultStrip.css';
import '../components/wrongTap.css';
import '../components/handResultIndex.css';
import '../components/rulesChip.css';
import './drills/missHistory.css';
import { saveSettings, loadStats } from '../../store/persist';
import { isCountFluent } from '../../drills/fluencyGate';
import { IndexTestView } from './drills/IndexTestView';
import { isE2eAudioMode } from '../../audio/speech';
import { CountDrillView } from './drills/CountDrillView';
import { TrueCountDrillView } from './drills/TrueCountDrillView';
import { ProduceTcDrillView } from './drills/ProduceTcDrillView';
import { PairCancelView } from './drills/PairCancelView';
import { BetSizingView } from './drills/BetSizingView';
import { BET_SIZING_DRILL, BET_SIZING_PICKER } from './drills/betSizingCopy';
import { RulesDiffView } from './drills/RulesDiffView';
import { DeckEstimationView } from './drills/DeckEstimationView';
import { MasteryChallengeView } from './drills/MasteryChallengeView';
import { HandDeckGate } from './drills/HandDeckGate';
import { settingsForCustomStart } from '../../drills/deckSource';
import { defaultSelection } from '../../drills/cellSelection';
import { CustomDrillEditor } from '../components/CustomDrillEditor';
import { useVoiceToggle, isVoiceOn } from '../voiceSession';
import { useEyesFreeToggle, isEyesFreeOn } from '../eyesFreeSession';
import { recordDrive, takeDriveAutoStart } from '../driveLaunch';
import { ChartIntro } from './drills/ChartIntro';
import { chartIntroDue, loadChartIntroSeen, saveChartIntroSeen } from '../../drills/chartIntro';
// W2-25: the three hand drills live in their own files, sharing one answer
// hook (drills/useAnswerSession.ts).
import { FlashcardsView } from './drills/FlashcardsView';
import { DeviationQuizView } from './drills/DeviationQuizView';
import { MixedSessionView } from './drills/MixedSessionView';
import { lazyScreen, preloadWhenIdle } from '../lazyScreen';
// Wave O: these two carry the generated side-bet and variant-chart tables
// (~240KB), so they load when first opened (precached for offline).
const SideCountDrillView = lazyScreen('sidecountdrill', () => import('./drills/SideCountDrillView').then((m) => m.SideCountDrillView));
const LAZY_DRILLS: ReadonlySet<string> = new Set(['sidecount', 'variant']);
const VariantDrillView = lazyScreen('variantdrill', () => import('./drills/VariantDrillView').then((m) => m.VariantDrillView));

interface DrillsProps {
  settings: Settings;
  activeProfile: Profile;
  onNavigate: (screen: Screen) => void;
  onSettingsChange: (settings: Settings) => void;
}

/* ---------------------------------------------------------------- */
/* Picker                                                             */
/* ---------------------------------------------------------------- */

type DrillMode =
  | 'count'
  | 'truecount'
  | 'deckest'
  | 'flash'
  | 'quiz'
  | 'mixed'
  | 'paircancel'
  | 'betsizing'
  | 'rulesdiff'
  | 'producetc'
  | 'mastery'
  | 'custom'
  | 'speed'
  | 'sidecount'
  | 'variant';

/** The painted tiers, order-free, with an unsaved selection read as the editor shows it. */
function tiersKey(settings: Settings): string {
  const tiers = settings.drill.custom?.tiers ?? defaultSelection().tiers;
  return JSON.stringify(Object.entries(tiers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function Drills({ settings, activeProfile, onNavigate, onSettingsChange }: DrillsProps) {
  // #28: Home's Next step can hand over the drill to open.
  const [launch] = useState(() => takeDrillLaunch());
  const [mode, setMode] = useState<'picker' | DrillMode>(() => launch ?? 'picker');
  const [customReturn, setCustomReturn] = useState<'flash' | 'mastery' | null>(null);
  // Wave O: the two lazy drills' chunks, fetched once the picker is idle.
  useEffect(() => preloadWhenIdle([SideCountDrillView, VariantDrillView]), []);
  // The custom tiers as they were when Customize opened from a drill, so Back
  // can tell a look from an edit (only an edit switches the deck to Custom).
  const customTiersAtOpen = useRef<string>('');
  // C-R3: Home's Drive tap starts the drill it opens; taken once, on mount.
  const [driveStart] = useState(() => takeDriveAutoStart());
  const autoStartFor = (m: DrillMode) => driveStart && launch === m;
  // C-R3: a drill run eyes-free or by voice becomes Home's Drive button.
  const [eyesFreeAny] = useEyesFreeToggle('drills');
  const [voiceAny] = useVoiceToggle('drills');
  useEffect(() => {
    if (mode === 'picker' || (!eyesFreeAny && !voiceAny)) return;
    const next = recordDrive(settings, mode, voiceAny, eyesFreeAny);
    if (next === settings) return;
    saveSettings(next);
    onSettingsChange(next);
    // Keyed on what is being recorded; `settings` is read fresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, eyesFreeAny, voiceAny]);
  // R7 / R5: a review or session deck rides along with the launch, in memory.
  // Taken (and so cleared) on every mount; kept only for the drill it was
  // handed to, and dropped once that drill is left.
  const [flashHandOver, setFlashHandOver] = useState(() => {
    const h = takeFlashHandOver();
    return launch === 'flash' && h && h.ids.length > 0 ? h : null;
  });
  const [reviewIndexes, setReviewIndexes] = useState(() => {
    const ids = takeReviewIndexes();
    if (launch !== 'quiz' || !ids) return null;
    // Only indexes the quiz can ask under this profile (drawQuizItem throws on others).
    const askable = new Set(askedIndexSet(strategyRulesFor(activeProfile)).map((d) => d.id as string));
    const kept = ids.filter((id) => askable.has(id));
    return kept.length > 0 ? kept : null;
  });
  const leaveHandOver = () => {
    setFlashHandOver(null);
    setReviewIndexes(null);
    setMode('picker');
  };
  // Every mode is a new screen: start it at the top, not at the picker's
  // scroll offset (the Custom editor opened mid-grid with its header hidden).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode]);

  if (mode === 'count') {
    return (
      <CountDrillView
        settings={settings}
        autoStart={autoStartFor('count')}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'truecount') {
    return (
      <TrueCountDrillView
        settings={settings}
        activeProfile={activeProfile}
        autoStart={autoStartFor('truecount')}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'producetc') {
    return (
      <ProduceTcDrillView
        settings={settings}
        activeProfile={activeProfile}
        autoStart={autoStartFor('producetc')}
        onBack={() => setMode('picker')}
      onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'deckest') {
    return (
      <DeckEstimationView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  // B2: the hand drills mount only on a deck with something in it.
  /**
   * Wave M: the Custom editor opened FROM a drill's Deck picker returns to
   * that drill instead of the picker. Start, or Back after painting, lands on
   * the Custom deck; Back after only looking leaves the deck and scopes he
   * had (a Missed / Soft-only session must not be silently replaced, and the
   * scopes are shared with Speed and Mastery). Null when opened from the
   * picker or Home.
   */
  const openCustomize = (from: 'flash' | 'mastery') => {
    customTiersAtOpen.current = tiersKey(settings);
    setCustomReturn(from);
    setMode('custom');
  };
  const gate = (title: string, view: ReactNode, from?: 'flash' | 'mastery') => (
    <HandDeckGate
      title={title}
      settings={settings}
      activeProfile={activeProfile}
      onSettingsChange={onSettingsChange}
      onBack={() => setMode('picker')}
      onCustomize={from ? () => openCustomize(from) : undefined}
    >
      {view}
    </HandDeckGate>
  );
  if (mode === 'flash' && flashHandOver) {
    // R7 / R5: the handed-over cells, whatever the saved deck holds -- so no
    // empty-deck gate, and no first-run chart intro in front of a review.
    return (
      <FlashcardsView
        settings={settings}
        activeProfile={activeProfile}
        onBack={leaveHandOver}
        onSettingsChange={onSettingsChange}
        handOver={flashHandOver}
        onHome={() => onNavigate('home')}
      />
    );
  }
  if (mode === 'flash') {
    return (
      <FlashEntry
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        flashcards={gate(
          'Flashcards',
          <FlashcardsView
            settings={settings}
            activeProfile={activeProfile}
            onBack={() => setMode('picker')}
            onSettingsChange={onSettingsChange}
            onCustomize={() => openCustomize('flash')}
          />,
          'flash',
        )}
      />
    );
  }
  if (mode === 'quiz' && reviewIndexes) {
    // Wave B2 #38 / R7: an index review is the Deviation quiz on exactly the
    // due indexes, whatever the saved Ask and Index choices are.
    return (
      <DeviationQuizView
        settings={settings}
        activeProfile={activeProfile}
        onBack={leaveHandOver}
        onSettingsChange={onSettingsChange}
        reviewIds={reviewIndexes}
        onHome={() => onNavigate('home')}
      />
    );
  }
  if (mode === 'quiz') {
    // B3: the quiz asks either the play (as ever) or the index.
    if (settings.drill.quizAsk === 'index') {
      return (
        <IndexTestView
          settings={settings}
          activeProfile={activeProfile}
          onBack={() => setMode('picker')}
          onSettingsChange={onSettingsChange}
        />
      );
    }
    return (
      <DeviationQuizView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'mixed') {
    return gate(
      'Mixed',
      <MixedSessionView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />,
    );
  }
  if (mode === 'mastery') {
    return gate(
      'Mastery challenge',
      <MasteryChallengeView
        settings={settings}
        activeProfile={activeProfile}
        onSettingsChange={onSettingsChange}
        onBack={() => setMode('picker')}
        onCustomize={() => openCustomize('mastery')}
      />,
      'mastery',
    );
  }
  if (mode === 'speed') {
    return (
      <SpeedDrillView
        settings={settings}
        activeProfile={activeProfile}
        onSettingsChange={onSettingsChange}
        onBack={() => setMode('picker')}
      />
    );
  }

  if (mode === 'custom') {
    // #9 / B2: paint a selection, then run a hand drill on it.
    return (
      <CustomDrillEditor
        settings={settings}
        autoOnOpen={launch === 'custom'}
        onSettingsChange={onSettingsChange}
        onStart={(drill) => {
          const next = settingsForCustomStart(settings);
          saveSettings(next);
          onSettingsChange(next);
          setCustomReturn(null);
          setMode(drill === 'flashcards' ? 'flash' : drill);
        }}
        backLabel={customReturn ? (customReturn === 'flash' ? 'Flashcards' : 'Mastery') : undefined}
        onBack={() => {
          if (!customReturn) return setMode('picker');
          if (tiersKey(settings) !== customTiersAtOpen.current) {
            const next = settingsForCustomStart(settings);
            saveSettings(next);
            onSettingsChange(next);
          }
          setCustomReturn(null);
          setMode(customReturn);
        }}
      />
    );
  }
  if (mode === 'sidecount') {
    return (
      <SideCountDrillView
        settings={settings}
        activeProfile={activeProfile}
        onBack={() => setMode('picker')}
        onSettingsChange={onSettingsChange}
      />
    );
  }
  if (mode === 'paircancel') {
    return <PairCancelView settings={settings} onBack={() => setMode('picker')} />;
  }
  if (mode === 'betsizing')
    return (
      <BetSizingView
        settings={settings}
        activeProfile={activeProfile}
        onSettingsChange={onSettingsChange}
        onBack={() => setMode('picker')}
      />
    );
  if (mode === 'variant') {
    return <VariantDrillView settings={settings} onSettingsChange={onSettingsChange} onBack={() => setMode('picker')} />;
  }
  if (mode === 'rulesdiff') return <RulesDiffView settings={settings} activeProfile={activeProfile} onBack={() => setMode('picker')} />;

  // V3-4: SOFT competence gating — advanced pressure modes still work, but show
  // a "get fluent first" nudge until the learner has demonstrated basic
  // count-drill competence. Read once here (only the picker branch reaches this).
  const fluent = isCountFluent(loadStats().countDrill.history);

  // One line per drill: what you practise, and why it matters at the table.
  // The name stays the button's accessible name (aria-label) so a screen
  // reader -- and every spec that clicks a drill by name -- hears the drill,
  // with the line attached as its description.
  const entry = (
    target: DrillMode,
    name: string,
    description: string,
    advanced = false,
  ) => {
    const descId = `drill-desc-${target}`;
    const gated = advanced && !fluent;
    return (
      <button
        key={target}
        type="button"
        className={`drills-nav-btn${gated ? ' drills-nav-btn-advanced' : ''}`}
        aria-label={name}
        aria-describedby={descId}
        // Wave O: a lazy drill opens in a transition, so the picker stays up
        // while its chunk loads instead of the screen going blank. The eager
        // drills open synchronously, as before (a transition there let a
        // test's first clicks land on the picker).
        onClick={() => (LAZY_DRILLS.has(target) ? startTransition(() => setMode(target)) : setMode(target))}
      >
        <span className="drills-nav-name">{name}</span>
        <span className="drills-nav-desc" id={descId}>
          {description}
        </span>
        {gated && <span className="drills-nav-note">Advanced — get fluent at the count drill first</span>}
      </button>
    );
  };

  return (
    <div className="drills-picker">
      <h1 className="drills-title">Drills</h1>
      <TabSettingsButton tab="drills" />
      {/* Grouped by the SKILL each drill trains (C8). Ten identical buttons in
          one list said nothing about what to do next, or about the fact that
          keeping the count, knowing the plays, and holding up under pressure
          are three different abilities you build in roughly that order. */}
      <div className="drills-nav">
        <h2 className="drills-group-title">Keeping the count</h2>
        {entry('count', 'Count drill', 'Keep the running count as cards are dealt. Every bet and play starts from it.')}
        {entry('paircancel', 'Pair cancellation', 'Read two cards as one net value and skip pairs that cancel, to keep up with a fast dealer.')}
        {entry('deckest', 'Deck estimation', 'Judge decks remaining from the discard tray. It is what you divide by.')}
        {entry('truecount', 'True count drill', 'Turn a running count and decks remaining into the true count, which sets your bet.')}
        {entry('producetc', 'Produce the true count', 'Count the cards, read the tray, give the true count: the whole job, as at the table.')}
        {entry('sidecount', 'Side count', 'Keep a side bet’s own count, then say whether the bet is worth making.')}

        <h2 className="drills-group-title">Knowing the plays</h2>
        {entry('flash', 'Flashcards', 'Basic strategy, one hand at a time. It decides most of your hands.')}
        {entry('quiz', 'Deviation quiz', 'Index plays: when the true count says to leave basic strategy.')}
        {/* R2/R4: interleaving is a DESIRABLE difficulty -- it helps once the
            base skill is there and costs accuracy before it. Soft, like every
            other gate here (V3-4, operator's explicit choice): the mode still
            works, it just says what it is. */}
        {entry('mixed', 'Mixed', 'Basic-strategy and index hands shuffled together, so you learn when the count matters.', true)}
        {entry('mastery', 'Mastery challenge', 'Every basic-strategy hand once, with no mistakes. One miss starts the sweep over.')}
        {entry('custom', 'Custom', 'Paint the chart cells you want, then drill just those in Flashcards, Mastery or Mixed.')}
        {entry('speed', 'Speed', 'Yes or no, against the clock: Surrender? Deviation here? Double? Split?')}
        {entry('rulesdiff', 'Rules differences', 'Only the plays that change between H17 and S17, 6 and 8 decks, or another game.')}
        {entry('variant', 'Variant hands', 'Free Bet, Spanish 21 and Blackjack Switch hands, graded on their own charts.')}

        <h2 className="drills-group-title">Under pressure</h2>
        {entry('betsizing', BET_SIZING_DRILL, BET_SIZING_PICKER, true)}
      </div>
      {/* Wave B2 #11 (B1): Drills is a tab-bar screen; Home is the tab bar's. */}
    </div>
  );
}

/**
 * B7: the Flashcards entry. Decides once, on mount, whether this launch is
 * the first-run "How to read the chart" screen; FlashcardsView is untouched.
 */
function FlashEntry({
  activeProfile,
  onBack,
  flashcards,
}: {
  activeProfile: Profile;
  onBack: () => void;
  flashcards: ReactNode;
}) {
  const [intro, setIntro] = useState(() =>
    chartIntroDue({
      stats: loadStats(),
      seen: loadChartIntroSeen(),
      eyesFree: isEyesFreeOn(),
      voiceOn: isVoiceOn(),
      search: window.location.search,
      e2e: isE2eAudioMode(),
    }),
  );
  if (intro) {
    return (
      <ChartIntro
        activeProfile={activeProfile}
        onBack={onBack}
        onStart={() => {
          saveChartIntroSeen();
          setIntro(false);
        }}
      />
    );
  }
  return <>{flashcards}</>;
}
