/**
 * Pure logic for the 'bt-phone-mic' kit ("Bluetooth: phone mic?"): picking
 * inputs, and turning measurements into plain-language verdicts. The I/O is in
 * testKitIO.ts, the screen in ui/screens/TestKit.tsx.
 *
 * THE QUESTION. With Bluetooth connected to the car, can the app listen through
 * the iPhone's own wideband microphone while the car keeps playing the sound?
 * Opening a mic normally moves iOS to the car's hands-free profile (narrowband,
 * call mode, wheel buttons captured). A page cannot set AVAudioSession options,
 * but getUserMedia with an exact deviceId might make WebKit prefer the built-in
 * mic, and the speech recogniser captures from whatever the route input is.
 */

import { PHONE_CALL_STEP_ID, type CalibrationSummary } from './testKit';

export interface InputDevice {
  deviceId: string;
  label: string;
}

export interface ChosenInput extends InputDevice {
  /** True when a label matched /iphone/i; false when we fell back to 'default'. */
  matched: boolean;
}

/** The iPhone's own input by label; 'default' if no label says iPhone. */
export function pickPhoneInput(devices: readonly InputDevice[]): ChosenInput {
  const hit = devices.find((d) => /iphone/i.test(d.label) && d.deviceId !== '');
  if (hit) return { ...hit, matched: true };
  const def = devices.find((d) => d.deviceId === 'default');
  return { deviceId: 'default', label: def?.label ?? 'default', matched: false };
}

/** Any listed input that is neither the chosen phone input nor a "default" alias. */
export function pickCarInput(devices: readonly InputDevice[], phone: ChosenInput): InputDevice | null {
  return (
    devices.find(
      (d) =>
        d.deviceId !== '' &&
        d.deviceId !== 'default' &&
        d.deviceId !== 'communications' &&
        d.deviceId !== phone.deviceId &&
        !/iphone/i.test(d.label),
    ) ?? null
  );
}

/** Level below which a window counts as no signal (linear RMS, full scale 1). */
export const FINGER_MIN_RMS = 0.002;
/** Covered at or below this share of uncovered: the mic that heard you is the one covered. */
export const FINGER_DROP_RATIO = 0.5;
/** Covered above this share of uncovered: covering made no real difference. */
export const FINGER_SAME_RATIO = 0.8;

export type FingerVerdict = 'phone-mic' | 'not-phone-mic' | 'unclear' | 'no-signal';

/** Covered window against uncovered window. A big drop is the phone mic. */
export function fingerVerdict(coveredRms: number, openRms: number): { verdict: FingerVerdict; ratio: number; db: number } {
  if (!(openRms >= FINGER_MIN_RMS)) return { verdict: 'no-signal', ratio: 0, db: 0 };
  const ratio = coveredRms / openRms;
  const db = ratio > 0 ? 20 * Math.log10(ratio) : -120;
  const verdict: FingerVerdict =
    ratio <= FINGER_DROP_RATIO ? 'phone-mic' : ratio > FINGER_SAME_RATIO ? 'not-phone-mic' : 'unclear';
  return { verdict, ratio, db };
}

export type RouteAnswerVerdict = 'car-speakers' | 'phone-speaker' | 'earpiece' | 'nothing' | 'mixed' | 'none';

export interface RouteRow {
  path: string;
  answer: string;
}

/** The majority answer of a set of plays: 'mixed' unless more than half agree. */
export function routeVerdict(rows: readonly RouteRow[]): RouteAnswerVerdict {
  if (rows.length === 0) return 'none';
  const count = (a: string) => rows.filter((r) => r.answer === a).length;
  const need = rows.length / 2;
  if (count('Car speakers') > need) return 'car-speakers';
  if (count('Phone loud speaker') > need) return 'phone-speaker';
  if (count('Earpiece') > need) return 'earpiece';
  if (count('Heard nothing') > need) return 'nothing';
  return 'mixed';
}

export function accuracyOf(s: CalibrationSummary): number {
  const total = s.oneWord.total + s.twoWord.total;
  return total === 0 ? 0 : (s.oneWord.right + s.twoWord.right) / total;
}

export type RecogniseVerdict = 'follows-phone-mic' | 'not-following' | 'partial' | 'inconclusive';

/** Uncovered accuracy below this means the test itself failed, not the hypothesis. */
export const RECOGNISE_MIN_UNCOVERED = 0.5;
/** Covered accuracy at or below this share of uncovered, AND this many points lower, is a collapse. */
export const RECOGNISE_COLLAPSE_SHARE = 0.5;
export const RECOGNISE_COLLAPSE_DROP = 0.3;

export function recogniseVerdict(coveredAcc: number, uncoveredAcc: number): RecogniseVerdict {
  if (uncoveredAcc < RECOGNISE_MIN_UNCOVERED) return 'inconclusive';
  if (coveredAcc <= uncoveredAcc * RECOGNISE_COLLAPSE_SHARE && uncoveredAcc - coveredAcc >= RECOGNISE_COLLAPSE_DROP) {
    return 'follows-phone-mic';
  }
  if (uncoveredAcc - coveredAcc < 0.2) return 'not-following';
  return 'partial';
}

/** Skip-forward is `nexttrack`; some head units send `seekforward` for the same button. */
export const WHEEL_FORWARD_ACTIONS: readonly string[] = ['nexttrack', 'seekforward'];

export function wheelArrived(actions: readonly string[]): boolean {
  return actions.some((a) => WHEEL_FORWARD_ACTIONS.includes(a));
}

interface ProbeSummary {
  verdict: string;
  highRatio: number;
  error?: string;
}

/** Everything the kit measures. Any step can be skipped, so every measurement is optional. */
export interface PhoneRun {
  phone?: ChosenInput;
  car?: InputDevice | null;
  inputCount?: number;
  phoneProbe?: ProbeSummary;
  carProbe?: ProbeSummary | null;
  finger?: { coveredRms: number; openRms: number };
  route?: RouteRow[];
  recognise?: { covered: number; uncovered: number };
  wheel?: { actions: string[] };
  /** The operator's tapped answer to each plain question, by step id. */
  answers: Record<string, string>;
}

export type Tri = 'yes' | 'no' | 'unclear' | 'skipped';

export interface SummaryLine {
  id: string;
  question: string;
  verdict: Tri;
  text: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** One plain-language line per check, plus an overall reading. */
export function phoneMicSummary(run: PhoneRun): { lines: SummaryLine[]; overall: Tri; overallText: string } {
  const lines: SummaryLine[] = [];

  if (!run.phone) {
    lines.push({ id: 'inputs', question: 'iPhone microphone listed', verdict: 'skipped', text: 'Not run.' });
  } else {
    lines.push({
      id: 'inputs',
      question: 'iPhone microphone listed',
      verdict: run.phone.matched ? 'yes' : 'unclear',
      text: run.phone.matched
        ? `Found "${run.phone.label}" among ${run.inputCount ?? '?'} inputs.`
        : 'No input is labelled iPhone, so "default" was used and the later checks cannot tell phone from car by label.',
    });
  }

  const q2 = 'Phone input carries high frequencies';
  const p = run.phoneProbe;
  if (!p) lines.push({ id: 'probe', question: q2, verdict: 'skipped', text: 'Not run.' });
  else if (p.error) lines.push({ id: 'probe', question: q2, verdict: 'unclear', text: `Could not open it (${p.error}).` });
  else if (p.verdict === 'wideband') {
    lines.push({ id: 'probe', question: q2, verdict: 'yes', text: `Energy above 4kHz (share ${p.highRatio.toFixed(3)}). The hands-free link cannot carry that.` });
  } else if (p.verdict === 'narrowband') {
    lines.push({ id: 'probe', question: q2, verdict: 'no', text: 'Nothing above 4kHz: this input is going through the hands-free link.' });
  } else {
    lines.push({ id: 'probe', question: q2, verdict: 'unclear', text: `Reading was "${p.verdict}". Talk louder while it measures.` });
  }

  const q3 = 'Covering the phone mic silences the input';
  if (!run.finger) lines.push({ id: 'finger', question: q3, verdict: 'skipped', text: 'Not run.' });
  else {
    const f = fingerVerdict(run.finger.coveredRms, run.finger.openRms);
    const t = f.verdict;
    lines.push({
      id: 'finger',
      question: q3,
      verdict: t === 'phone-mic' ? 'yes' : t === 'not-phone-mic' ? 'no' : 'unclear',
      text:
        t === 'no-signal'
          ? 'Nothing was heard even uncovered.'
          : `Covered was ${pct(f.ratio)} of uncovered (${f.db.toFixed(1)} dB). ${
              t === 'phone-mic' ? 'A big drop: the phone mic.' : t === 'not-phone-mic' ? 'No real drop: not the phone mic.' : 'A small drop: not clear.'
            }`,
    });
  }

  const q4 = 'Sound stays on the car speakers with the mic open';
  const rv = routeVerdict(run.route ?? []);
  lines.push({
    id: 'route',
    question: q4,
    verdict: rv === 'none' ? 'skipped' : rv === 'car-speakers' ? 'yes' : rv === 'mixed' ? 'unclear' : 'no',
    text:
      rv === 'none'
        ? 'Not run.'
        : rv === 'car-speakers'
          ? 'Most plays came out of the car speakers.'
          : rv === 'mixed'
            ? 'The answers disagreed.'
            : `Most plays came from: ${rv.replace('-', ' ')}.`,
  });

  const call = run.answers[PHONE_CALL_STEP_ID];
  lines.push({
    id: 'call',
    question: 'Car did not switch to a phone call',
    verdict: call === 'No' ? 'yes' : call === 'Yes' ? 'no' : call === 'Not sure' ? 'unclear' : 'skipped',
    text: call === 'No' ? 'No call shown.' : call === 'Yes' ? 'The car showed a call.' : call ? 'Not sure.' : 'Not asked.',
  });

  const q6 = 'Voice recognition listens through the phone mic';
  if (!run.recognise) lines.push({ id: 'recognise', question: q6, verdict: 'skipped', text: 'Not run.' });
  else {
    const r = recogniseVerdict(run.recognise.covered, run.recognise.uncovered);
    lines.push({
      id: 'recognise',
      question: q6,
      verdict: r === 'follows-phone-mic' ? 'yes' : r === 'not-following' ? 'no' : 'unclear',
      text: `Covered ${pct(run.recognise.covered)}, uncovered ${pct(run.recognise.uncovered)}. ${
        r === 'follows-phone-mic'
          ? 'Covering the phone mic broke it.'
          : r === 'not-following'
            ? 'Covering it made little difference: it hears through another input.'
            : r === 'partial'
              ? 'Some drop, not decisive.'
              : 'It did not work uncovered either, so this says nothing.'
      }`,
    });
  }

  const q7 = 'Wheel buttons still reach the app';
  if (!run.wheel) lines.push({ id: 'wheel', question: q7, verdict: 'skipped', text: 'Not run.' });
  else {
    const ok = wheelArrived(run.wheel.actions);
    lines.push({
      id: 'wheel',
      question: q7,
      verdict: ok ? 'yes' : 'no',
      text: ok
        ? 'Skip-forward arrived: the car is not in call mode.'
        : 'Nothing arrived in 8 seconds: likely call mode (or the button was not pressed).',
    });
  }

  const by = (id: string) => lines.find((l) => l.id === id)?.verdict;
  const phoneMic = by('probe') === 'yes' || by('finger') === 'yes';
  let overall: Tri;
  let overallText: string;
  if (phoneMic && by('route') === 'yes' && by('call') !== 'no' && by('wheel') !== 'no' && (by('call') === 'yes' || by('wheel') === 'yes')) {
    overall = 'yes';
    overallText = 'Yes: the phone mic is in use while the car plays the sound, and the car is not in call mode.';
  } else if (by('probe') === 'no' || by('call') === 'no' || by('wheel') === 'no') {
    overall = 'no';
    overallText = 'No: the car still switched to its hands-free link.';
  } else {
    overall = 'unclear';
    overallText = 'Not settled. Read the lines above, or send the log.';
  }
  return { lines, overall, overallText };
}
