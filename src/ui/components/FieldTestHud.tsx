import { useEffect, useRef, useState } from 'react';
import {
  FIELD_TEST_CONDITIONS,
  applyFieldTestSetup,
  describeFieldTestSetup,
  stampFieldTest,
  stepsForCondition,
} from '../../diag/fieldTest';
import {
  goToFieldTestStep,
  markFieldTestStamped,
  readFieldTestRun,
  stopFieldTestRun,
  subscribeFieldTestRun,
  type FieldTestRun,
} from '../../diag/fieldTestRun';
import { saveSettings } from '../../store/persist';
import { setVoiceOn } from '../voiceSession';
import { setEyesFreeOn } from '../eyesFreeSession';
import type { Settings } from '../../store/types';
import type { Screen } from '../App';

/**
 * The field-test protocol, floating over whatever screen you are on.
 *
 * WHY IT FLOATS, and it is the same argument as the mute button's, only
 * sharper. Every step of this protocol has to be performed somewhere the
 * protocol is not: you cannot hear a drill speak from the Settings screen,
 * and you cannot press a wheel button at a drill that is not running. The
 * previous design put the steps in a Settings panel anyway, so following it
 * meant walking back and forth between two screens for every step -- in a
 * parked car, with the engine running -- and the run state, being ordinary
 * React state on the Settings screen, was destroyed by each trip.
 *
 * The operator got four steps in and stopped (2026-09-19): "I need it to set
 * the settings and maybe have a pop up that follows me into the testing.
 * Can't have to go back and forth and have it reset all progress." This is
 * that pop-up. The run itself lives in diag/fieldTestRun.ts, outside React,
 * so navigating -- or being reloaded mid-run by the update check -- costs
 * nothing.
 *
 * IT SETS THE STEP UP ITSELF. Each step declares the state it needs as data
 * (diag/fieldTest.ts) and this applies it on arrival: audio on, recorded
 * voice on, wheel mode, microphone open or shut. A protocol that only
 * DESCRIBES its preconditions gets run under the wrong ones, and a run under
 * the wrong preconditions is indistinguishable in the log from a run under
 * the right ones -- which would quietly waste the drive it took to produce.
 *
 * COLLAPSIBLE, because it covers the top of the screen and some steps need
 * to see what is under it. Collapsed it is one line: which step you are on,
 * and the stamp.
 */
export function FieldTestHud({
  settings,
  onSettingsChange,
  screen,
  onNavigate,
}: {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  screen: Screen;
  onNavigate: (screen: Screen) => void;
}) {
  const [run, setRun] = useState<FieldTestRun>(() => readFieldTestRun());
  const [open, setOpen] = useState(true);
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeFieldTestRun(() => setRun(readFieldTestRun())), []);

  /**
   * Make room for itself, rather than sitting on top of the screen.
   *
   * A fixed panel over a drill covers that drill's own controls -- which on
   * the flashcards screen is the whole options block, and on the table is the
   * running count. Rendering it revealed exactly that: the step "start any
   * drill" was printed over the toggle you would use to do it. So the height
   * is measured and published to CSS, and `#root` is padded by it. Measured
   * rather than assumed, because the panel's height depends on the step's
   * instruction, whether it is collapsed, and the safe-area inset.
   */
  useEffect(() => {
    const root = typeof document === 'undefined' ? null : document.documentElement;
    if (!root) return undefined;
    const el = panel.current;
    if (!run.active || !el) {
      root.removeAttribute('data-fieldtest');
      root.style.removeProperty('--fieldtest-h');
      return undefined;
    }
    const publish = () => {
      root.setAttribute('data-fieldtest', 'on');
      root.style.setProperty('--fieldtest-h', `${el.offsetHeight}px`);
    };
    publish();
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const observer = RO ? new RO(publish) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.removeAttribute('data-fieldtest');
      root.style.removeProperty('--fieldtest-h');
    };
  }, [run.active, run.stepIndex, open]);

  // The run's own steps, not all of them: a parked run and a driving run are
  // different lists (diag/fieldTest.ts), and the panel must count, index and
  // bound itself against the one actually being followed.
  const steps = stepsForCondition(run.condition);
  const step = steps[run.stepIndex] ?? steps[0]!;
  const condition = FIELD_TEST_CONDITIONS.find((c) => c.id === run.condition);

  /**
   * Put the app into the state this step needs, once per arrival at it.
   *
   * Guarded by a ref rather than by comparing settings: applying the setup
   * changes the settings, which re-renders this, which would re-apply it --
   * and re-applying would stamp on a change the operator made deliberately
   * mid-step (turning the mic off to check something, say).
   */
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!run.active) {
      appliedFor.current = null;
      return;
    }
    if (appliedFor.current === step.id) return;
    appliedFor.current = step.id;
    if (!step.setup) return;
    const next = applyFieldTestSetup(settings, step.setup);
    saveSettings(next);
    onSettingsChange(next);
    if (step.setup.eyesFree !== undefined) setEyesFreeOn(step.setup.eyesFree, 'field-test');
    if (step.setup.voice !== undefined) setVoiceOn(step.setup.voice, 'field-test');
    // `settings` is deliberately not a dependency: this runs on arrival at a
    // step, not whenever settings happen to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.active, step.id]);

  if (!run.active) return null;

  const stamps = run.stamps[step.id] ?? 0;
  const onDrill = screen === 'drills' || screen === 'table';
  const needsDrill = step.where === 'drill' && !onDrill;

  const stamp = () => {
    stampFieldTest(step.id, run.condition);
    markFieldTestStamped(step.id);
  };

  const finish = () => {
    // The microphone is the one thing a run must never leave open behind it:
    // an abandoned run that kept listening would be exactly the privacy
    // failure ui/voiceSession.ts's per-session rule exists to prevent.
    setVoiceOn(false, 'field-test');
    stopFieldTestRun();
  };

  return (
    <div
      ref={panel}
      className={`fieldtest-hud${open ? '' : ' fieldtest-hud-closed'}`}
      data-testid="fieldtest-hud"
    >
      <div className="fieldtest-hud-bar">
        <button
          type="button"
          className="fieldtest-hud-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="fieldtest-hud-toggle"
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> Field test {run.stepIndex + 1}/
          {steps.length}
        </button>
        <span className="fieldtest-hud-condition u-note">{condition?.label ?? run.condition}</span>
        <button type="button" className="fieldtest-hud-end" onClick={finish} data-testid="fieldtest-end">
          End
        </button>
      </div>

      {open && (
        <div className="fieldtest-hud-body">
          <p className="fieldtest-hud-instruction" data-testid="fieldtest-instruction">
            {step.instruction}
          </p>
          <p className="fieldtest-hud-setup u-note" data-testid="fieldtest-setup">
            {describeFieldTestSetup(step.setup)}
          </p>
          <p className="fieldtest-hud-expect u-note">Look for: {step.expect}</p>

          {needsDrill && (
            <button
              type="button"
              className="fieldtest-hud-go"
              onClick={() => onNavigate('drills')}
              data-testid="fieldtest-go-drill"
            >
              This step needs a drill running — go to Drills
            </button>
          )}
        </div>
      )}

      <div className="fieldtest-hud-actions">
        <button
          type="button"
          className="fieldtest-hud-nav"
          onClick={() => goToFieldTestStep(run.stepIndex - 1)}
          disabled={run.stepIndex === 0}
          data-testid="fieldtest-prev"
        >
          Back
        </button>
        <button
          type="button"
          className="fieldtest-hud-stamp"
          onClick={stamp}
          data-testid={`fieldtest-stamp-${step.id}`}
        >
          {step.stamp}
          {stamps ? (stamps > 1 ? ` ✓ ×${stamps}` : ' ✓') : ''}
        </button>
        <button
          type="button"
          className="fieldtest-hud-nav"
          onClick={() => goToFieldTestStep(run.stepIndex + 1)}
          disabled={run.stepIndex === steps.length - 1}
          data-testid="fieldtest-next"
        >
          Next
        </button>
      </div>
    </div>
  );
}
