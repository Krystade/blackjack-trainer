import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Screen } from '../App';
import type { Settings, Stats as StatsData } from '../../store/types';
import { EMPTY_STATS } from '../../store/types';
import { loadStats, saveStats, loadSettings, exportAll, importAll } from '../../store/persist';
import type { Category, MistakeClass } from '../../engine/grade';
import { ILLUSTRIOUS_18 } from '../../engine/deviations';

interface StatsProps {
  onNavigate: (screen: Screen) => void;
  onSettingsChange: (settings: Settings) => void;
}

const CATEGORY_ORDER: Category[] = ['hard', 'soft', 'pairs', 'surrender', 'insurance', 'bet', 'countCheck'];

const CATEGORY_LABELS: Record<Category, string> = {
  hard: 'Hard totals',
  soft: 'Soft totals',
  pairs: 'Pairs',
  surrender: 'Surrender',
  insurance: 'Insurance',
  bet: 'Bet sizing',
  countCheck: 'Count checks',
};

const MISTAKE_ORDER: Exclude<MistakeClass, 'correct'>[] = [
  'basic-error',
  'missed-deviation',
  'phantom-deviation',
  'wrong-anyway',
];

const MISTAKE_LABELS: Record<Exclude<MistakeClass, 'correct'>, string> = {
  'basic-error': 'Basic-strategy errors',
  'missed-deviation': 'Missed deviations',
  'phantom-deviation': 'Phantom deviations',
  'wrong-anyway': 'Wrong either way',
};

function pct(right: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((right / total) * 100)}%`;
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function Stats({ onNavigate, onSettingsChange }: StatsProps) {
  const [stats, setStats] = useState<StatsData>(() => loadStats());
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => setStats(loadStats());

  const handleExport = () => {
    const json = exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bjtrainer-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMessage('Exported.');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      if (!window.confirm('Import will overwrite current stats and settings. Continue?')) return;
      const result = importAll(text);
      if (result.ok) {
        refresh();
        onSettingsChange(loadSettings());
        setMessage('Import successful.');
      } else {
        setMessage(`Import failed: ${result.error ?? 'unknown error'}`);
      }
    };
    reader.onerror = () => setMessage('Import failed: could not read file');
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (!window.confirm('Reset all stats? This cannot be undone.')) return;
    saveStats(structuredClone(EMPTY_STATS));
    refresh();
    setMessage('Stats reset.');
  };

  const correctHistory = stats.countDrill.history.filter((h) => h.correct);
  const bestCleanRun =
    correctHistory.length === 0
      ? null
      : correctHistory.reduce((best, cur) => (cur.intervalMs < best.intervalMs ? cur : best));
  const recentRuns = stats.countDrill.history.slice(-5).reverse();
  const sessions = [...stats.sessions].reverse();

  return (
    <div className="stats-screen">
      <div className="stats-topbar">
        <button type="button" className="stats-back-btn" onClick={() => onNavigate('home')}>
          Back to Home
        </button>
        <div className="stats-heading">Stats</div>
      </div>

      <section className="stats-section">
        <h2 className="stats-section-title">Accuracy by category</h2>
        <div className="category-list">
          {CATEGORY_ORDER.map((cat) => {
            const tally = stats.categories[cat];
            const total = tally.right + tally.wrong;
            const pctNum = total === 0 ? 0 : (tally.right / total) * 100;
            return (
              <div className="category-row" key={cat}>
                <div className="category-row-top">
                  <span className="category-label">{CATEGORY_LABELS[cat]}</span>
                  <span className="category-fraction">
                    {tally.right}/{total} ({pct(tally.right, total)})
                  </span>
                </div>
                <div className="category-bar-track">
                  <div className="category-bar-fill" style={{ width: `${pctNum}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Illustrious 18</h2>
        <table className="index-table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Right</th>
              <th>Wrong</th>
            </tr>
          </thead>
          <tbody>
            {ILLUSTRIOUS_18.map((dev) => {
              const tally = stats.perIndex[dev.id];
              return (
                <tr key={dev.id}>
                  <td>{dev.label}</td>
                  <td>{tally ? tally.right : '—'}</td>
                  <td>{tally ? tally.wrong : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Mistake types</h2>
        <ul className="mistake-list">
          {MISTAKE_ORDER.map((cls) => (
            <li className="mistake-row" key={cls}>
              <span>{MISTAKE_LABELS[cls]}</span>
              <span>{stats.mistakes[cls]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Count drill</h2>
        <p className="stats-detail">
          Best clean run:{' '}
          {bestCleanRun === null ? '—' : `${bestCleanRun.cards} cards @ ${bestCleanRun.intervalMs}ms`}
        </p>
        {recentRuns.length === 0 ? (
          <p className="stats-detail">No count-drill runs yet.</p>
        ) : (
          <ul className="count-history-list">
            {recentRuns.map((run, i) => (
              <li className="count-history-row" key={i}>
                <span>{formatDate(run.date)}</span>
                <span>{run.cards} cards</span>
                <span>{run.intervalMs}ms</span>
                <span className={run.correct ? 'result-correct' : 'result-wrong'}>
                  {run.correct ? 'correct' : 'wrong'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stats-section">
        <h2 className="stats-section-title">Sessions</h2>
        {sessions.length === 0 ? (
          <p className="stats-detail">No sessions yet.</p>
        ) : (
          <ul className="session-list">
            {sessions.map((s, i) => (
              <li className="session-row" key={i}>
                <span>{formatDate(s.date)}</span>
                <span>{s.rounds} rounds</span>
                <span>{pct(s.correct, s.graded)}</span>
                <span className={s.bankrollDelta >= 0 ? 'result-correct' : 'result-wrong'}>
                  {formatSigned(s.bankrollDelta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stats-section stats-actions">
        <div className="stats-action-row">
          <button type="button" className="stats-action-btn" onClick={handleExport}>
            Export
          </button>
          <button type="button" className="stats-action-btn" onClick={handleImportClick}>
            Import
          </button>
          <button type="button" className="stats-action-btn stats-danger-btn" onClick={handleReset}>
            Reset stats
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="stats-file-input"
          onChange={handleFileChange}
        />
        {message && <p className="stats-message">{message}</p>}
      </section>
    </div>
  );
}
