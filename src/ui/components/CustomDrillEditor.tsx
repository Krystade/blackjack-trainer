import { useEffect, useMemo, useRef, useState } from 'react';
import './customDrillEditor.css';
import './paintTiersPaper.css';
import type { CustomSelection, SelectionTier, Settings } from '../../store/types';
import type { RuleSet } from '../../engine/ruleset';
import { loadStats, saveSettings } from '../../store/persist';
import { getActiveProfile } from '../../store/profiles';
import {
  ALL_PAINT_CELL_IDS,
  TIERS,
  autoTiers,
  clearSelection,
  customWeights,
  defaultSelection,
  mixShare,
  paintCells,
  setMixShare,
  tierOf,
} from '../../drills/cellSelection';
import type { Brush } from '../../drills/cellSelection';
import { CellPaintGrid } from './CellPaintGrid';

/**
 * B2 (#9): the Custom drill editor -- paint tiers on the chart grid, set the
 * session mix, Auto-fill from accuracy, and start a hand drill on it.
 *
 * Everything persists into `settings.drill.custom`, saved on every change
 * and lifted through `onSettingsChange`. A drag paints into a local draft so the grid
 * follows the finger without a settings write per cell; the stroke is
 * committed once, when the finger lifts.
 *
 * With no saved selection the editor shows every cell Regular -- which draws
 * exactly like no selection at all -- and nothing is written until something
 * changes.
 */

type Mode = 'flashcards' | 'mastery' | 'mixed';

const BRUSHES: readonly { brush: Brush; label: string }[] = [
  { brush: 'off', label: 'Off' },
  { brush: 'rare', label: 'Rare' },
  { brush: 'regular', label: 'Regular' },
  { brush: 'focus', label: 'Focus' },
];

const TIER_LABEL: Record<SelectionTier, string> = { focus: 'Focus', regular: 'Regular', rare: 'Rare' };

/** The mix sliders' step; the rebalance rounds to it so each thumb shows its label's value. */
const MIX_STEP = 5;

const STARTS: readonly { mode: Mode; label: string }[] = [
  { mode: 'flashcards', label: 'Flashcards' },
  { mode: 'mastery', label: 'Mastery' },
  { mode: 'mixed', label: 'Mixed' },
];

export function CustomDrillEditor({
  settings,
  onSettingsChange,
  onStart,
  onBack,
  rules,
  autoOnOpen = false,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  onStart: (mode: Mode) => void;
  onBack: () => void;
  /** The chart the cells are coloured from; defaults to the active profile's. */
  rules?: RuleSet;
  /** #28: opened from Home's "Fix weak cells" -- apply Auto once on open. */
  autoOnOpen?: boolean;
}) {
  const saved = settings.drill.custom;
  const base = useMemo<CustomSelection>(
    // A saved selection is read defensively: it is persisted data, and a
    // hand-edited or half-written one must not take the editor down.
    () =>
      saved
        ? {
            ...saved,
            tiers: saved.tiers ?? {},
            painted: saved.painted ?? {},
            mix: { focus: mixShare(saved.mix, 'focus'), regular: mixShare(saved.mix, 'regular'), rare: mixShare(saved.mix, 'rare') },
            favourMissed: saved.favourMissed === true,
          }
        : defaultSelection(),
    [saved],
  );
  const [draft, setDraft] = useState<CustomSelection | null>(null);
  const draftRef = useRef<CustomSelection | null>(null);
  const selection = draft ?? base;

  const [brush, setBrush] = useState<Brush>('focus');
  const chartRules = useMemo(() => rules ?? getActiveProfile().rules, [rules]);

  const commit = (next: CustomSelection) => {
    const nextSettings = { ...settings, drill: { ...settings.drill, custom: next } };
    // s07: persisted on every change, not only on Start. App's settings
    // setter is memory only, so an edit left without starting a drill was
    // lost on the next relaunch (iOS evicting the PWA, say).
    saveSettings(nextSettings);
    onSettingsChange(nextSettings);
  };

  const onPaint = (ids: string[]) => {
    const next = paintCells(draftRef.current ?? base, ids, brush);
    draftRef.current = next;
    setDraft(next);
  };
  const onStrokeEnd = () => {
    const next = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (next) commit(next);
  };

  const counts = useMemo(() => {
    const c = { focus: 0, regular: 0, rare: 0, off: 0 };
    for (const id of ALL_PAINT_CELL_IDS) c[tierOf(selection, id)] += 1;
    return c;
  }, [selection]);
  const drawable = useMemo(() => customWeights(selection, ALL_PAINT_CELL_IDS).size > 0, [selection]);

  const auto = () => {
    const tiers = autoTiers(ALL_PAINT_CELL_IDS, loadStats().cellStats, selection.painted, selection.tiers);
    commit({ ...selection, tiers });
  };
  const autoApplied = useRef(false);
  useEffect(() => {
    if (!autoOnOpen || autoApplied.current) return;
    autoApplied.current = true;
    auto();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [autoOnOpen]);

  return (
    <div className="drill-screen cde">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">Custom drill</div>
      </div>

      <div className="cde-body">
        <section className="cde-panel" aria-label="Start">
          <div className="cde-starts">
            {STARTS.map((s) => (
              <button
                key={s.mode}
                type="button"
                className="u-btn u-btn-primary cde-start"
                disabled={!drawable}
                onClick={() => onStart(s.mode)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="u-note cde-counts" data-testid="cde-counts">
            {drawable
              ? `${counts.focus} Focus · ${counts.regular} Regular · ${counts.rare} Rare · ${counts.off} Off`
              : 'Every cell is Off. Paint some cells to start.'}
          </p>
        </section>

        <section className="cde-panel" aria-labelledby="cde-mix-title">
          <h2 className="u-section-title" id="cde-mix-title">
            Session mix
          </h2>
          {TIERS.map((tier) => (
            <label className="cde-slider" key={tier}>
              <span className="cde-slider-label">
                {TIER_LABEL[tier]}
                <span className="cde-slider-value">{selection.mix[tier]}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={MIX_STEP}
                value={selection.mix[tier]}
                aria-label={`${TIER_LABEL[tier]} share`}
                onChange={(e) => commit({ ...selection, mix: setMixShare(selection.mix, tier, Number(e.target.value), MIX_STEP) })}
              />
            </label>
          ))}
          <button
            type="button"
            className="u-btn cde-toggle"
            aria-pressed={selection.favourMissed}
            onClick={() => commit({ ...selection, favourMissed: !selection.favourMissed })}
          >
            <span>Favour missed cells</span>
            <span className="cde-toggle-state">{selection.favourMissed ? 'On' : 'Off'}</span>
          </button>
          <p className="u-note">
            A tier with no cells passes its share to the others. Favour missed draws a cell more the more often
            you miss it.
          </p>
        </section>

        <div className="cde-palette" role="radiogroup" aria-label="Brush">
          {BRUSHES.map((b) => (
            <button
              key={b.brush}
              type="button"
              role="radio"
              aria-checked={brush === b.brush}
              className="cde-brush"
              data-tier={b.brush}
              onClick={() => setBrush(b.brush)}
            >
              <span className="cde-swatch" data-tier={b.brush} aria-hidden="true" />
              {b.label}
            </button>
          ))}
        </div>
        <div className="cde-actions">
          <button type="button" className="u-btn" onClick={auto}>
            Auto
          </button>
          <button type="button" className="u-btn" onClick={() => commit(clearSelection(selection))}>
            Clear
          </button>
        </div>
        <p className="u-note">
          Drag across cells to paint them with the brush, or tap one. Tap a row or a dealer card to paint it all.
          Auto sets each cell from your accuracy (Focus below 78%, Regular below 92%) and leaves cells you
          painted, marked with a dot.
        </p>

        <CellPaintGrid selection={selection} rules={chartRules} onPaint={onPaint} onStrokeEnd={onStrokeEnd} />
      </div>
    </div>
  );
}
