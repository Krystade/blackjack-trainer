import { useEffect, useMemo, useRef, useState } from 'react';
import type { Settings } from '../../../store/types';
import type { Action } from '../../../engine/deviations';
import type { PresetId, VariantId } from '../../../engine/variants/rules';
import { DEFAULT_PRESET, PRESETS, PRESET_LABEL, VARIANT_LABEL, presetsOf } from '../../../engine/variants/rules';
import { upColumn } from '../../../engine/variants/strategy';
import {
  drawVariantItem,
  gradeVariantItem,
  loadVariantChoice,
  loadVariantTally,
  recordVariantAnswer,
  saveVariantChoice,
  variantItemLegal,
} from '../../../drills/variantDrill';
import type { VariantGrade, VariantItem, VariantTally } from '../../../drills/variantDrill';
import { narrateVariantCorrection, narrateVariantPrompt, variantOpener } from '../../../audio/narrateVariant';
import { narrateActionNotAsked } from '../../../audio/narrate';
import { autoAdvanceDelayMs, spokenPauseFor } from '../../../drills/answerPause';
import { useAudio } from '../../../audio/useAudio';
import { cancelSpeech, isE2eAudioMode, speak } from '../../../audio/speech';
import { speechOptsFrom } from '../../../audio/speechOpts';
import { useEyesFreeToggle } from '../../eyesFreeSession';
import { useWheelCommand } from '../../useWheelCommand';
import { answerTooSoon } from '../../answerBounce';
import { focusSwallowsKey } from '../../keyboardFocus';
import { PlayingCard } from '../../components/PlayingCard';
import { ActionBar } from '../../components/ActionBar';
import { ZonePad } from '../../components/ZonePad';
import { FloatingBackPill } from '../../components/FloatingBackPill';
import { NextBar } from './HandDrillParts';
import { EyesFreeCheckbox } from './EyesFreeCheckbox';
import { VariantCharts } from '../VariantCharts';
import type { VariantHighlight } from '../variantChartView';
import '../../components/studyChartOverlay.css';
import '../charts.css';
import '../chartsThemes.css';
import './drillActionBar.css';
import './speedDrill.css';
import './variantDrill.css';

/**
 * Wave L: Variant hands -- Free Bet, Spanish 21 and Switch, graded against
 * the variant charts (drills/variantDrill.ts holds the deal and the grade).
 *
 * The variant is the one picked on Charts (one shared key), so studying the
 * Spanish 21 chart and then opening this drill drills Spanish 21. Eyes-free
 * works as in Speed: the prompt is spoken, the five-zone pad answers, the
 * correction is spoken and the next hand follows once it has been said.
 */

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** ?vseed=N (e2e): a deterministic run, item k drawn from seed N + k. */
function seedBase(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('vseed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) ? n : null;
}

function initialPreset(): PresetId {
  const choice = loadVariantChoice();
  return choice === 'standard' ? DEFAULT_PRESET.freebet : choice;
}

const ACTION_WORD: Record<Action, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

function kindLine(item: VariantItem): string | null {
  if (item.kind === 'free') return 'Free hand (made by a free split)';
  if (item.kind === 'afterDouble') {
    return item.ctx.canDouble ? 'Doubled: stand, double again or rescue' : 'Doubled: stand or rescue';
  }
  if (item.kind === 'multi') return `${item.cards.length} cards`;
  return null;
}

interface Feedback {
  id: number;
  taken: Action;
  grade: VariantGrade;
}

export function VariantDrillView({
  settings,
  onSettingsChange,
  onBack,
}: {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onBack: () => void;
}) {
  const audio = useAudio(settings.audio);
  const [preset, setPreset] = useState<PresetId>(initialPreset);
  const [base] = useState(seedBase);
  // The item is a pure function of (preset, seed), so a re-render never deals
  // a different hand; ?vseed=N steps N, N+1, ...
  const [seed, setSeed] = useState(() => base ?? randomSeed());
  const item = useMemo<VariantItem>(() => drawVariantItem(preset, seed), [preset, seed]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [tally, setTally] = useState<VariantTally>(loadVariantTally);
  const [showChart, setShowChart] = useState(false);
  const [eyesFree, setEyesFree] = useEyesFreeToggle('variant');
  const shownAtRef = useRef(performance.now());
  const advanceRef = useRef<number | null>(null);
  const clearAdvance = () => {
    if (advanceRef.current !== null) window.clearTimeout(advanceRef.current);
    advanceRef.current = null;
  };
  useEffect(() => clearAdvance, []);
  // On a short phone the correction lands below the cards: bring it into view.
  const resultRef = useRef<HTMLDivElement | null>(null);

  const say = (text: string) => speak(text, speechOptsFrom(settings.audio, { interrupt: true }));

  const nextItem = () => {
    clearAdvance();
    setFeedback(null);
    setSeed((s) => (base === null ? randomSeed() : s + 1));
    shownAtRef.current = performance.now();
  };

  useEffect(() => {
    if (feedback) resultRef.current?.scrollIntoView({ block: 'nearest' });
  }, [feedback]);

  // Eyes-free: say each hand as it comes up (and on switching it on).
  useEffect(() => {
    if (eyesFree && !feedback) say(narrateVariantPrompt(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, eyesFree]);

  const choose = (p: PresetId) => {
    if (p === preset) return;
    setPreset(p);
    saveVariantChoice(p);
    nextItem();
  };

  const answer = (taken: Action) => {
    if (feedback || answerTooSoon(shownAtRef.current)) return;
    if (!variantItemLegal(item).includes(taken)) {
      if (eyesFree) say(narrateActionNotAsked(taken));
      return;
    }
    const grade = gradeVariantItem(item, taken);
    setTally((t) => recordVariantAnswer(t, preset, grade.correct));
    audio.ding(grade.correct ? 'good' : 'bad');
    setFeedback({ id: Date.now(), taken, grade });
    if (eyesFree) {
      const text = narrateVariantCorrection(grade.correct, grade.expected, grade.reason);
      say(text);
      clearAdvance();
      advanceRef.current = window.setTimeout(
        () => nextItem(),
        autoAdvanceDelayMs(settings.audio.answerPauseMs, spokenPauseFor(text, settings.audio.rate)),
      );
    }
  };

  const next = () => {
    if (answerTooSoon(shownAtRef.current)) return;
    nextItem();
  };

  // The wheel, eyes-free: forward goes on from a correction, back says the
  // hand (or the correction) again. It cannot state a five-way play.
  useWheelCommand((command) => {
    if (feedback) {
      if (command === 'forward') nextItem();
      else say(narrateVariantCorrection(feedback.grade.correct, feedback.grade.expected, feedback.grade.reason));
      return;
    }
    if (command === 'back') say(narrateVariantPrompt(item));
  }, eyesFree);

  // Keyboard: H S D P R answer, Enter / Space is Next.
  useEffect(() => {
    const KEYS: Record<string, Action> = { h: 'hit', s: 'stand', d: 'double', p: 'split', r: 'surrender' };
    const onKey = (e: KeyboardEvent) => {
      if (showChart || focusSwallowsKey(e.key)) return;
      if (feedback) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          next();
        }
        return;
      }
      const a = KEYS[e.key.toLowerCase()];
      if (a) {
        e.preventDefault();
        answer(a);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, feedback, showChart, eyesFree]);

  const leave = () => {
    clearAdvance();
    cancelSpeech();
    onBack();
  };

  const variant: VariantId = PRESETS[preset].variant;
  const siblings = presetsOf(variant);
  const score = tally[preset] ?? { right: 0, wrong: 0 };
  const legal = variantItemLegal(item);
  const highlight: VariantHighlight | undefined =
    item.kind === 'afterDouble'
      ? undefined
      : { table: item.table, section: item.advice.section, row: item.advice.row, col: upColumn(item.up) };
  const kind = kindLine(item);

  if (showChart) {
    return (
      <div className="study-chart-overlay">
        <div className="charts-screen">
          <div className="charts-topbar">
            <div className="charts-heading">{PRESET_LABEL[preset]}</div>
          </div>
          <FloatingBackPill label="Back to hand" onClick={() => setShowChart(false)} />
          <VariantCharts preset={preset} order="descending" highlight={highlight} />
        </div>
      </div>
    );
  }

  return (
    <div className="drill-screen variant-drill" data-testid="variant-drill" data-preset={preset}>
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={leave}>
          Back
        </button>
        <div className="drill-heading">Variant hands</div>
        <div className="variant-drill-score" data-testid="variant-drill-score">
          {score.right}/{score.right + score.wrong}
        </div>
      </div>

      <div className="drill-inline-controls">
        <div className="speed-modes variant-drill-games" role="group" aria-label="Game">
          {(['freebet', 'spanish21', 'switch'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`speed-mode-chip${v === variant ? ' speed-mode-chip-on' : ''}`}
              aria-pressed={v === variant}
              onClick={() => choose(v === variant ? preset : DEFAULT_PRESET[v])}
            >
              {VARIANT_LABEL[v]}
            </button>
          ))}
        </div>
        {siblings.length > 1 && (
          <div className="speed-modes variant-drill-games" role="group" aria-label="Rule set">
            {siblings.map((p) => (
              <button
                key={p}
                type="button"
                className={`speed-mode-chip${p === preset ? ' speed-mode-chip-on' : ''}`}
                aria-pressed={p === preset}
                onClick={() => choose(p)}
              >
                {PRESET_LABEL[p].replace('Spanish 21, ', '')}
              </button>
            ))}
          </div>
        )}
        <EyesFreeCheckbox
          settings={settings}
          onSettingsChange={onSettingsChange}
          eyesFree={eyesFree}
          onChange={(on) => {
            if (!on) clearAdvance();
            setEyesFree(on);
          }}
        />
      </div>

      <div
        className="variant-drill-hand"
        data-testid="variant-item"
        data-item-id={item.id}
        data-kind={item.kind}
        data-expected={isE2eAudioMode() ? item.advice.action : undefined}
      >
        {kind && <div className="variant-drill-kind">{kind}</div>}
        <div className="dealer-area">
          <PlayingCard card={{ rank: item.up, suit: 's' }} />
        </div>
        <div className="hands-row">
          <div className="player-hand">
            <div className="hand-cards">
              {item.cards.map((c, i) => (
                <PlayingCard key={i} card={c} />
              ))}
            </div>
          </div>
        </div>
        {variantOpener(item) === null && <div className="variant-drill-kind variant-drill-kind-quiet">Fresh hand</div>}
      </div>

      {feedback && (
        <div
          className="variant-drill-result"
          ref={resultRef}
          data-testid="variant-result"
          data-correct={feedback.grade.correct}
          role="status"
        >
          <div className="variant-drill-verdict">
            {feedback.grade.correct
              ? `Correct: ${ACTION_WORD[feedback.taken]}`
              : `${ACTION_WORD[feedback.taken]} is wrong. ${ACTION_WORD[feedback.grade.expected]} is right.`}
          </div>
          <div className="variant-drill-reason">
            {PRESET_LABEL[preset]} chart: <code>{item.advice.code}</code>
          </div>
          <button type="button" className="variant-drill-chart-btn" onClick={() => setShowChart(true)}>
            Show me the chart
          </button>
        </div>
      )}

      {!feedback ? (
        eyesFree ? (
          <ZonePad
            mode="action"
            onAnswer={(zone) => {
              if (zone !== 'take' && zone !== 'decline') answer(zone);
            }}
            onRepeat={() => say(narrateVariantPrompt(item))}
            visible={!settings.audio.dimZones}
            legal={legal}
          />
        ) : (
          <ActionBar
            mode={{
              kind: 'actions',
              legal,
              onAction: answer,
              ...(isE2eAudioMode() ? { advice: item.advice.action } : {}),
            }}
          />
        )
      ) : (
        <NextBar onNext={next} />
      )}
    </div>
  );
}
