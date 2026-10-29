import { useLayoutEffect, useRef } from 'react';
import type { ImportRuleChoice, NameChoice } from '../../../store/casinoLog';
import { ruleChanges } from '../../casinoVersions';
import type { ImportPlan } from './casinoExport';
import './casinoVersions.css';
import './casinoImport.css';

/**
 * Wave W (review S3): what an import or a paste would do, before anything is
 * saved -- each casino added, updated or already here, the sessions, and
 * every casino the file names as one here under another record, with the
 * choice to merge it into that one or add it beside it. Import saves it;
 * Cancel leaves the log as it was.
 */

const names = (list: { name: string }[]) => list.map((c) => c.name).join(', ');
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ImportPreview({
  plan,
  onName,
  onRule,
  onCancel,
  onImport,
}: {
  plan: ImportPlan;
  onName: (id: string, choice: NameChoice) => void;
  onRule: (key: string, choice: ImportRuleChoice) => void;
  onCancel: () => void;
  onImport: () => void;
}) {
  const head = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    head.current?.scrollIntoView({ block: 'start' });
    head.current?.focus({ preventScroll: true });
  }, []);
  const r = plan.report;
  const added = r.casinos.filter((c) => c.outcome === 'added');
  const updated = r.casinos.filter((c) => c.outcome === 'updated');
  const unchanged = r.casinos.filter((c) => c.outcome === 'unchanged');
  const nothing = added.length === 0 && updated.length === 0 && r.sessionsAdded === 0 && r.sessionsUpdated === 0 && r.ruleChanges.length === 0;
  return (
    <div className="cas-imp" role="group" aria-labelledby="cas-imp-title" data-testid="import-preview">
      <h3 className="cas-imp-title" id="cas-imp-title" ref={head} tabIndex={-1}>
        {nothing ? 'Nothing new in it' : 'Import this?'}
      </h3>
      <ul className="cas-imp-lines">
        {added.length > 0 && (
          <li data-testid="import-added">
            <strong>Adds {count(added.length, 'casino')}:</strong> {names(added)}
          </li>
        )}
        {updated.length > 0 && (
          <li data-testid="import-updated">
            <strong>Updates {updated.length}:</strong> {names(updated)}
          </li>
        )}
        {unchanged.length > 0 && (
          <li data-testid="import-unchanged">
            <strong>Already here:</strong> {count(unchanged.length, 'casino')}
          </li>
        )}
        <li data-testid="import-sessions">
          <strong>Sessions:</strong> {r.sessionsAdded} added, {r.sessionsUpdated} updated
        </li>
        {r.skipped > 0 && <li data-testid="import-skipped">{count(r.skipped, 'entry', 'entries')} in it could not be read and would be skipped.</li>}
      </ul>
      {r.nameMatches.map((m) => (
        <div key={m.id} className="cas-imp-match" data-testid="import-name-match" data-id={m.id}>
          <p className="cas-imp-match-text">
            <span className="cas-badge" data-tone="warn">
              Same name
            </span>{' '}
            &ldquo;{m.name}&rdquo; in the file is a different record from the one here of that name.
          </p>
          <div className="cas-imp-options" role="group" aria-label={`${m.name}: merge or add`}>
            <button type="button" className="cas-ver-option" aria-pressed={m.choice === 'merge'} onClick={() => onName(m.id, 'merge')} data-testid="import-merge">
              <span className="cas-ver-option-name">Merge into the one here</span>
              <span className="cas-ver-option-hint">One casino: its games, sessions and notes join the ones here.</span>
            </button>
            <button type="button" className="cas-ver-option" aria-pressed={m.choice === 'add'} onClick={() => onName(m.id, 'add')} data-testid="import-add">
              <span className="cas-ver-option-name">Add as another casino</span>
              <span className="cas-ver-option-hint">Two casinos of that name, each with its own games and sessions.</span>
            </button>
          </div>
        </div>
      ))}
      {r.ruleChanges.map((c) => (
        <RuleChangeCard key={c.key} change={c} onRule={onRule} />
      ))}
      <p className="cas-imp-note">Nothing here is deleted: games, versions and notes from both copies are kept.</p>
      <div className="cas-btn-row">
        <button type="button" className="u-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="u-btn u-btn-primary" onClick={onImport} data-testid="import-confirm">
          Import
        </button>
      </div>
    </div>
  );
}

/**
 * Re-review R2: a game the file gives other rules: the changes, and the
 * form's own question -- a new version (the old rules keep their sessions),
 * a fix -- or keep the rules here.
 */
function RuleChangeCard({ change: c, onRule }: { change: ImportPlan['report']['ruleChanges'][number]; onRule: (key: string, choice: ImportRuleChoice) => void }) {
  const title = c.prev.label?.trim() ? `${c.casinoName} · ${c.prev.label.trim()}` : c.casinoName;
  const kept = c.sessions === 1 ? 'its session' : c.sessions > 1 ? `its ${c.sessions} sessions` : 'its figures';
  const option = (choice: ImportRuleChoice, name: string, hint: string) => (
    <button type="button" className="cas-ver-option" aria-pressed={c.choice === choice} onClick={() => onRule(c.key, choice)} data-testid={`import-rule-${choice}`}>
      <span className="cas-ver-option-name">{name}</span>
      <span className="cas-ver-option-hint">{hint}</span>
    </button>
  );
  return (
    <div className="cas-imp-match" data-testid="import-rule-change" data-key={c.key}>
      <p className="cas-imp-match-text">
        <span className="cas-badge" data-tone="warn">
          Rules
        </span>{' '}
        <strong>{title}</strong>: the file has other rules.
      </p>
      <ul className="cas-imp-lines" data-testid="import-rule-lines">
        {ruleChanges(c.prev, c.next).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="cas-imp-options" role="group" aria-label={`${title}: new version, fix, or keep`}>
        {option('new', 'New version', `The casino changed it. The rules here keep ${kept}, under Earlier versions.`)}
        {option('fix', 'Fix this version', c.sessions > 0 ? `The rules here were wrong. ${c.sessions === 1 ? 'Its session stays' : `Its ${c.sessions} sessions stay`}, with the rules corrected.` : 'The rules here were wrong: corrected in place.')}
        {option('keep', 'Keep the rules here', 'The file is out of date: its rules are not taken.')}
      </div>
    </div>
  );
}
