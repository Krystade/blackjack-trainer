import { useCallback, useState } from 'react';
import type { WorkedExample } from '../../../drills/workedExamples';
import { introAllowed, loadIntroSeen, saveIntroSeen } from '../../../drills/chartIntro';
import { isE2eAudioMode } from '../../../audio/speech';
import { DiscardTray } from '../../components/DiscardTray';
import './drillIntro.css';

/** T2-2B: the worked-example keys, one per drill (crossTab/persistHardening list them). */
export const TRUECOUNT_INTRO_KEY = 'bjtrainer.intro.truecount.v1';
export const DECKEST_INTRO_KEY = 'bjtrainer.intro.deckest.v1';
export const PRODUCETC_INTRO_KEY = 'bjtrainer.intro.producetc.v1';

/**
 * T2-2B: whether a drill's worked example opens as a card on this visit.
 * Decided once, at mount: unseen, the drill's history empty, and the shared
 * intro gate (no car session, no autoStart, `?intro` under e2e -- D6).
 *
 * `dismiss` marks it seen -- the card's "Got it", and the drill's Start. It
 * only ever writes when the card was actually shown, so a guided or Drive
 * run (where it never shows) never marks it seen (D6).
 */
export function useDrillIntro(
  key: string,
  /** Read once, at mount. */
  gate: () => { historyEmpty: boolean; eyesFree: boolean; voiceOn: boolean; autoStart: boolean },
): { open: boolean; dismiss: () => void } {
  const [open, setOpen] = useState(() => {
    const g = gate();
    return (
      g.historyEmpty &&
      !loadIntroSeen(key) &&
      introAllowed({
        eyesFree: g.eyesFree,
        voiceOn: g.voiceOn,
        autoStart: g.autoStart,
        search: window.location.search,
        e2e: isE2eAudioMode(),
      })
    );
  });
  const dismiss = useCallback(() => {
    setOpen((was) => {
      if (was) saveIntroSeen(key);
      return false;
    });
  }, [key]);
  return { open, dismiss };
}

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
