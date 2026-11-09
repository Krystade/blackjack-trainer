import type { WorkedExample } from '../../../drills/workedExamples';
import { DiscardTray } from '../../components/DiscardTray';
import './drillIntro.css';

function ExampleBody({ example }: { example: WorkedExample }) {
  return (
    <>
      {example.lines.map((l) => (
        <p key={l} className="drill-intro-line">
          {l}
        </p>
      ))}
      {example.tray && (
        <div className="drill-intro-tray">
          <DiscardTray cardsDealt={example.tray.cardsDealt} decks={example.tray.decks} />
        </div>
      )}
      <div className="drill-intro-examples">
        {example.examples.map((e) => (
          <div key={e} className="drill-intro-example">
            {e}
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * The worked example on a drill's setup: a card the first time (with "Got
 * it"), then a "How it works" fold that keeps the same content findable.
 * Inline at the top of the setup, never a layer, so Start stays where it is.
 */
export function DrillIntroCard({
  example,
  open,
  onDismiss,
}: {
  example: WorkedExample;
  open: boolean;
  onDismiss: () => void;
}) {
  if (!open) {
    return (
      <details className="drill-intro-fold" data-testid="drill-intro-fold">
        <summary>How it works</summary>
        <ExampleBody example={example} />
      </details>
    );
  }
  return (
    <section className="drill-intro-card" data-testid="drill-intro" aria-label={example.title}>
      <h2 className="drill-intro-title">{example.title}</h2>
      <ExampleBody example={example} />
      <button type="button" className="drill-intro-ok" onClick={onDismiss}>
        Got it
      </button>
    </section>
  );
}
