import { useLayoutEffect, useRef } from 'react';
import type { VersionChoice } from '../../../store/casinoLog';
import type { VersionData } from '../../casinoVersions';
import './casinoVersions.css';

/**
 * Wave W (review S2): asked on Save when a rule changed on a game whose
 * current version holds sessions or figures. The owner: "When I do adjust
 * the rules I want a new 'version' of the casino made so previous data on it
 * is saved for the old versions." A new version is the default; "Fix this
 * version" is for a rule entered wrong. In place of the form's Save row, not
 * over the page.
 */

export interface VersionAsk {
  gameId: string;
  title: string;
  /** "Late surrender: Yes → No", one per rule changed. */
  changes: string[];
  data: VersionData;
}

const kept = (d: VersionData): string => {
  const s = d.sessions > 0 ? `${d.sessions} session${d.sessions === 1 ? '' : 's'}` : null;
  const f = d.figures ? 'figures' : null;
  return [s, f].filter(Boolean).join(' and ');
};

export function VersionPrompt({
  asks,
  choices,
  onChoice,
  onCancel,
  onSave,
}: {
  asks: VersionAsk[];
  choices: Readonly<Record<string, VersionChoice>>;
  onChoice: (gameId: string, c: VersionChoice) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const head = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    head.current?.scrollIntoView({ block: 'start' });
    head.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="cas-ver-prompt" role="group" aria-labelledby="cas-ver-prompt-title" data-testid="version-prompt">
      <h3 className="cas-ver-prompt-title" id="cas-ver-prompt-title" ref={head} tabIndex={-1}>
        Did the casino change {asks.length === 1 ? 'these rules' : 'the rules'}?
      </h3>
      {asks.map((a) => {
        const choice = choices[a.gameId] ?? 'new';
        const what = kept(a.data);
        return (
          <div key={a.gameId} className="cas-ver-ask" data-testid="version-ask" data-game={a.gameId}>
            <p className="cas-ver-ask-title">{a.title}</p>
            <ul className="cas-ver-changes">
              {a.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="cas-ver-options" role="group" aria-label={`${a.title}: how to save`}>
              <button
                type="button"
                className="cas-ver-option"
                aria-pressed={choice === 'new'}
                onClick={() => onChoice(a.gameId, 'new')}
                data-testid="version-new"
              >
                <span className="cas-ver-option-name">New version</span>
                <span className="cas-ver-option-hint">
                  The casino changed it. The old rules keep their {what}, under Earlier versions.
                </span>
              </button>
              <button
                type="button"
                className="cas-ver-option"
                aria-pressed={choice === 'fix'}
                onClick={() => onChoice(a.gameId, 'fix')}
                data-testid="version-fix"
              >
                <span className="cas-ver-option-name">Fix this version</span>
                <span className="cas-ver-option-hint">
                  I entered it wrong.{' '}
                  {a.data.sessions > 0
                    ? `The ${a.data.sessions === 1 ? 'session stays' : `${a.data.sessions} sessions stay`}, with the rules corrected.`
                    : 'The figures are worked out again for the corrected rules.'}
                </span>
              </button>
            </div>
          </div>
        );
      })}
      <div className="cas-btn-row">
        <button type="button" className="u-btn" onClick={onCancel}>
          Back to editing
        </button>
        <button type="button" className="u-btn u-btn-primary" onClick={onSave}>
          Save casino
        </button>
      </div>
    </div>
  );
}
