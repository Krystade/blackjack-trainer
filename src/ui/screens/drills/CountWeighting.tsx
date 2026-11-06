import type { Settings } from '../../../store/types';
import type { CountDrillBias } from '../../../drills/countDrill';
import { Segmented } from '../Settings';

const NOTE: Record<CountDrillBias, string> = {
  none: 'As dealt: counts sit near zero most of the time, as at a table.',
  negative: 'Leans the count down.',
  positive: 'Leans the count up.',
  big: 'Big counts either way, where bets and deviations change.',
};

/**
 * Owner 2026-11-06: one weighting, shared by the Count drill, the True count
 * drill and Produce the true count (settings.drill.countBias).
 */
export function CountWeighting({
  settings,
  onSettingsChange,
}: {
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}) {
  const value = settings.drill.countBias;
  return (
    <>
      <div className="settings-row">
        <span className="settings-label">Weighting</span>
        <Segmented<CountDrillBias>
          options={[
            { value: 'none', label: 'Random' },
            { value: 'negative', label: 'Down' },
            { value: 'positive', label: 'Up' },
            { value: 'big', label: 'Big' },
          ]}
          value={value}
          onChange={(v) => onSettingsChange({ ...settings, drill: { ...settings.drill, countBias: v } })}
        />
      </div>
      <div className="settings-row settings-note-row" data-testid="count-weighting-note">
        {NOTE[value]}
      </div>
    </>
  );
}
