/**
 * The car check: everything the field test can answer without being asked.
 *
 * WHY IT EXISTS. The field test is a protocol a human follows, and every step
 * of it ends in tapping a stamp -- which is fine parked and is the reason the
 * driving run had to be kept to four steps. But most of what those steps
 * establish is not a judgement at all. Whether a sentence has a clip, whether
 * an element actually played, whether the media slot is held, how loud the
 * cabin is: the app can determine all of it by itself, exactly, and write the
 * answer down. The operator asked for that directly (2026-09-21): "I want the
 * test automated wherever it can be and then just tell me what next steps
 * are."
 *
 * So this is the field test's evidence-gathering half, run by the app. What
 * is left for a person is only what genuinely needs one: pressing a wheel
 * button, and listening. Neither needs a stamp -- a press is detected and
 * named by the app, and listening is reported once at the end.
 *
 * THE TWO PHASES, and why they cannot be one.
 *
 * Measuring ambient noise requires an open microphone. Opening the microphone
 * is what makes the car switch from A2DP to its hands-free call profile, and
 * while that profile is up the car owns the wheel completely -- the same flip
 * that routes phone-speaker audio to the earpiece rather than the loudspeaker
 * (operator, 2026-09-21: "it's playing from the phone call speaker at the top
 * not the louder speakerphone speakers on the bottom"). A single phase that
 * did both would test the wheel under the one condition known to break it and
 * report a dead wheel every time -- a test that cannot pass.
 *
 * So: SPEAKER phase with the microphone shut, then MICROPHONE phase with it
 * open, and the microphone is closed again between them. `runCarCheck`
 * enforces that rather than documenting it, because a phase order held only
 * by convention is one refactor from being wrong in a way nobody can see.
 *
 * THE THIRD PHASE, and why the microphone being shut is not enough to
 * describe it.
 *
 * HANDOFF runs with the microphone shut, exactly like SPEAKER -- but AFTER it
 * has been open. That difference is the whole question this app has been
 * stuck on. On iOS, opening the microphone moves output to the earpiece, and
 * nothing in a page could be found that moves it back; declaring
 * `navigator.audioSession.type = 'playback'` while capturing was tried on the
 * 2026-10-04 drive and held at `playback` end to end with the sound on the
 * earpiece anyway. The only remaining lever is the ORDER -- stop capturing,
 * declare playback, then make the sound -- and whether that works cannot be
 * determined anywhere but on the phone.
 *
 * So the handoff phase is the measurement: the microphone HAS been open, it
 * is now shut, playback has been declared, and a real clip plays. The app can
 * report which category the session is in and that the clip ran to the end.
 * Which speaker it came out of only an operator can answer, so that one asks.
 */

export type CheckPhase = 'speaker' | 'microphone' | 'handoff';

/**
 * 'warn' is not a soft 'fail'. A check warns when it could not reach a
 * verdict -- nobody pressed a button, the browser withheld a capability --
 * and fails only when it reached one and the answer was bad. Collapsing the
 * two would let "we did not find out" render as "it works".
 */
export type CheckOutcome = 'pass' | 'fail' | 'warn' | 'skipped';

export interface CheckResult {
  id: string;
  outcome: CheckOutcome;
  /** One line, written to be read at a roadside. */
  summary: string;
  /** Anything worth carrying into the diagnostic log. */
  detail?: Record<string, unknown>;
}

export interface CheckDefinition {
  id: string;
  label: string;
  phase: CheckPhase;
  /** What a person has to do, if anything. Absent means fully automatic. */
  askOperator?: string;
  run: () => Promise<CheckResult>;
}

export interface CarCheckDeps {
  checks: readonly CheckDefinition[];
  /** Open or close the microphone. Awaited, so a phase cannot race it. */
  setMicOpen: (open: boolean) => Promise<void>;
  /** Whether the microphone is open right now, asked rather than assumed. */
  isMicOpen: () => boolean;
  log: (event: string, detail?: Record<string, unknown>) => void;
  onProgress?: (done: CheckResult, remaining: number) => void;
}

/** The phases, in the only order that can work. */
export const PHASE_ORDER: readonly CheckPhase[] = ['speaker', 'microphone', 'handoff'];

export function checksForPhase(
  checks: readonly CheckDefinition[],
  phase: CheckPhase,
): readonly CheckDefinition[] {
  return checks.filter((c) => c.phase === phase);
}

export interface CarCheckRun {
  results: CheckResult[];
  /** True if every check that reached a verdict reached a good one. */
  ok: boolean;
}

/**
 * Run every check, in phase order, with the microphone open only where it has
 * to be.
 *
 * A check that throws becomes a `fail` carrying its message rather than
 * taking the run down: the operator is at a roadside and a half-finished run
 * that says which half finished is worth more than an exception.
 */
export async function runCarCheck(deps: CarCheckDeps): Promise<CarCheckRun> {
  const results: CheckResult[] = [];
  const total = deps.checks.length;

  for (const phase of PHASE_ORDER) {
    const phaseChecks = checksForPhase(deps.checks, phase);
    if (phaseChecks.length === 0) continue;

    // The invariant, enforced: only the MICROPHONE phase runs with the
    // microphone open, because an open one takes the wheel and the
    // loudspeaker with it. 'handoff' is shut on purpose and must stay that
    // way -- it is measuring what closing it gives back, so opening it would
    // destroy the thing being measured.
    const wantMic = phase === 'microphone';
    if (deps.isMicOpen() !== wantMic) await deps.setMicOpen(wantMic);
    deps.log('phase', { phase, micOpen: deps.isMicOpen() });

    for (const check of phaseChecks) {
      let result: CheckResult;
      try {
        result = await check.run();
      } catch (e) {
        result = {
          id: check.id,
          outcome: 'fail',
          summary: `The check itself failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      results.push(result);
      deps.log(result.id, { outcome: result.outcome, ...result.detail });
      deps.onProgress?.(result, total - results.length);
    }
  }

  // Never leave a microphone open behind a diagnostic. Same rule the field
  // test's End button follows, and for the same reason.
  if (deps.isMicOpen()) await deps.setMicOpen(false);
  deps.log('done', { ok: results.every((r) => r.outcome !== 'fail') });

  return { results, ok: results.every((r) => r.outcome !== 'fail') };
}

/**
 * What to do next, derived from the results rather than written by hand.
 *
 * The operator asked to be told the next steps ("then just tell me what next
 * steps are"), and a list of green ticks is not that. Each line here is tied
 * to a specific failing check, so the advice cannot drift away from what was
 * actually measured.
 */
export function nextSteps(results: readonly CheckResult[]): string[] {
  const by = new Map(results.map((r) => [r.id, r]));
  const steps: string[] = [];
  const failed = (id: string) => by.get(id)?.outcome === 'fail';
  const warned = (id: string) => by.get(id)?.outcome === 'warn';

  if (failed('audio-out')) {
    steps.push(
      'Nothing came out of the speakers, so no wheel result below means anything. Check the phone is not muted and that the car is on the right source.',
    );
  }
  if (failed('clip-voice')) {
    steps.push(
      'Some lines have no recorded clip and fall back to the phone voice. Those are the ones that vanish under road noise, because live speech cannot be boosted.',
    );
  }
  if (failed('media-slot')) {
    steps.push(
      'The app never became the phone’s active media app, which is why the wheel does nothing. It needs a tap on something that plays before the wheel can reach it.',
    );
  }
  if (warned('wheel-press')) {
    steps.push(
      'No wheel button arrived. Either the car sent nothing, or it sent it to the radio — run this again in the car with the app already speaking.',
    );
  }
  if (failed('ambient')) {
    steps.push(
      'The microphone produced no signal at all. In a moving car that means the app is listening to a different input than you think.',
    );
  }
  /* The capability and handoff checks (2026-10-04). Each one fails in a way
     that looks like the app being broken, so each needs the one sentence
     that says what to do instead. */
  if (failed('build')) {
    const detail = by.get('build')?.detail;
    steps.push(
      `This phone is running an older build than the one deployed${
        detail?.deployed ? ` (${String(detail.build)} here, ${String(detail.deployed)} there)` : ''
      }. Anything you are here to test may not be on the phone yet -- close every tab and reopen before trusting a result.`,
    );
  }
  if (failed('wake-lock')) {
    steps.push(
      'The screen cannot be kept awake, so a drill will stop when the screen locks. Keep the phone awake by hand, or expect the audio to die mid-shoe.',
    );
  }
  if (failed('offline-clips')) {
    steps.push(
      'The recorded voice is not stored on the phone, so it needs a signal. Open a drill once on Wi-Fi before driving anywhere with tunnels.',
    );
  }
  if (failed('storage')) {
    steps.push(
      'This phone will not keep a setting, so everything resets on the next launch. That usually means private browsing or a full disk.',
    );
  }
  if (failed('mic-restart')) {
    steps.push(
      'The microphone does not come back after being closed, which makes "Sound with the mic on: Switch" unusable -- it would leave the drill deaf. Set it to Speaker or Auto.',
    );
  }
  if (warned('mic-restart')) {
    const ms = by.get('mic-restart')?.detail?.ms;
    steps.push(
      `The microphone takes ${ms ? `${String(ms)}ms` : 'a long time'} to come back, and Switch pays that after every spoken line. If the drill feels deaf, that is why.`,
    );
  }
  if (warned('handoff-route') && warned('output-route')) {
    // Both are warns by design -- only ears can answer them -- so the step is
    // the comparison itself rather than a verdict.
    steps.push(
      'Two clips played: one with the microphone open, one with it shut. If the second was louder, "Switch" is worth its cost and should stay on. If they sounded the same, nothing in a web page can move the sound off the earpiece and the setting is only costing you deafness.',
    );
  }
  if (steps.length === 0) {
    steps.push('Everything measurable passed. What is left needs a drive: the wheel in the gaps, and recognition at speed.');
  }
  return steps;
}
