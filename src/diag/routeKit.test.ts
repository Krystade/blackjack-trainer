import { describe, expect, it } from 'vitest';
import {
  ROUTE_ANSWERS,
  ROUTE_KITS,
  ROUTE_LINES,
  matchRouteAlternatives,
  matchRouteAnswer,
  routeKitSummary,
  describeRoute,
  expectedAnswer,
} from './routeKit';
import { classifyInputs } from '../audio/audioRoute';

describe('matchRouteAnswer', () => {
  it.each([
    ['car', 'Car speakers'],
    ['The car', 'Car speakers'],
    ['car speakers', 'Car speakers'],
    ['phone', 'Phone loud speaker'],
    ['loud speaker', 'Phone loud speaker'],
    ['speakerphone', 'Phone loud speaker'],
    ['speaker phone', 'Phone loud speaker'],
    ['headset', 'Headset'],
    ['AirPods', 'Headset'],
    ['headphones', 'Headset'],
    ['earpiece', 'Earpiece'],
    ['ear piece', 'Earpiece'],
    ['nothing', 'Heard nothing'],
    ["I didn't hear it", 'Heard nothing'],
    ['banana', null],
    ['', null],
  ])('%j -> %s', (said, want) => {
    expect(matchRouteAnswer(said)).toBe(want);
  });

  it('a word inside a longer phrase belongs to the phrase', () => {
    // "speaker" alone is the phone; inside "car speakers" it is the car.
    expect(matchRouteAnswer('car speakers')).toBe('Car speakers');
    expect(matchRouteAnswer('car speaker')).toBe('Car speakers');
    expect(matchRouteAnswer('the phone speaker')).toBe('Phone loud speaker');
  });

  it('the last answer wins, so a change of mind counts', () => {
    expect(matchRouteAnswer('phone, no, car')).toBe('Car speakers');
    expect(matchRouteAnswer('car, sorry, earpiece')).toBe('Earpiece');
  });

  it('the app’s own question can never be read as an answer', () => {
    expect(matchRouteAnswer(ROUTE_LINES.ask)).toBeNull();
    // The route clip itself either.
    expect(matchRouteAnswer('You have fourteen. Dealer shows ten.')).toBeNull();
  });

  it('takes the first reading that names an answer', () => {
    expect(matchRouteAlternatives(['far', 'car'])).toEqual({ answer: 'Car speakers', rank: 1 });
    expect(matchRouteAlternatives(['far'])).toEqual({ answer: null, rank: -1 });
  });
});

describe('A4: a negated destination is not an answer', () => {
  it.each([
    ['phone, not the car', 'Phone loud speaker'],
    ['it was the phone not the car', 'Phone loud speaker'],
    ['not the car', null],
    ['nothing from the car', 'Heard nothing'],
    ['no sound in the car', 'Heard nothing'],
    ["didn't hear the car", 'Heard nothing'],
    ['not the phone, the car', 'Car speakers'],
    ['top of the phone', 'Earpiece'],
    ['bottom of the phone', 'Phone loud speaker'],
    // The correction form is unchanged.
    ['phone, no, car', 'Car speakers'],
    ['car, sorry, earpiece', 'Earpiece'],
  ])('%j -> %s', (said, want) => {
    expect(matchRouteAnswer(said)).toBe(want);
  });

  it('takes a sound-alike only from the top reading', () => {
    expect(matchRouteAlternatives(['Fun', 'Fan', 'Card'])).toEqual({ answer: null, rank: -1 });
    expect(matchRouteAlternatives(['Card'])).toEqual({ answer: 'Car speakers', rank: 0 });
    expect(matchRouteAlternatives(['Fun', 'car'])).toEqual({ answer: 'Car speakers', rank: 1 });
  });
});

describe('ROUTE_KITS', () => {
  it('every kit starts with the snapshot and every step id is unique within it', () => {
    for (const kit of Object.values(ROUTE_KITS)) {
      expect(kit.steps[0]?.kind).toBe('route-snapshot');
      const ids = kit.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ROUTE_ANSWERS).toContain(kit.target);
    }
  });

  it('every voice step differs from the baseline in exactly what it is testing', () => {
    // A step that changes two things at once cannot say which one mattered.
    for (const kit of Object.values(ROUTE_KITS)) {
      const base = kit.steps.find((s) => s.id === 'auto-webaudio');
      expect(base?.kind).toBe('route-voice');
      if (base?.kind !== 'route-voice') continue;
      for (const s of kit.steps) {
        if (s.kind !== 'route-voice' || s === base) continue;
        const changed = (['strategy', 'hold', 'path', 'mic'] as const).filter((k) => s[k] !== base[k]);
        // play-and-record on the element changes strategy+path on purpose
        // (the element is the path that lands on the earpiece); everything
        // else changes one thing, and 'speaker-sink' only exists on the element.
        if (s.id === 'pr-element' || s.id === 'sink-element' || s.id === 'quiet-close') {
          expect(changed.length).toBeLessThanOrEqual(2);
        } else {
          expect(changed).toHaveLength(1);
        }
      }
    }
  });

  it('the car kit asks every car unknown the design names', () => {
    const ids = ROUTE_KITS['route-car'].steps.map((s) => s.id);
    expect(ids).toEqual(['snapshot', 'auto-webaudio', 'pr-webaudio', 'hold-bt', 'hold-phone', 'quiet-close']);
  });
});

describe('routeKitSummary', () => {
  it('counts hits against the kit target, skips apart, voice apart', () => {
    const s = routeKitSummary('route-car', [
      { step: 'auto-webaudio', answer: 'Earpiece', via: 'voice' },
      { step: 'pr-webaudio', answer: 'Car speakers', via: 'voice' },
      { step: 'hold-bt', answer: 'Car speakers', via: 'tap' },
      { step: 'hold-phone', answer: 'skipped', via: 'skip' },
    ]);
    expect(s).toEqual({
      hits: 2,
      answered: 3,
      byVoice: 2,
      byStep: 'auto-webaudio=Earpiece pr-webaudio=Car speakers hold-bt=Car speakers hold-phone=skipped',
      holdsFailed: 0,
    });
  });

  it('marks a hold step whose hold did not get a track as "hold failed" (review M4)', () => {
    const s = routeKitSummary('route-car', [
      { step: 'auto-webaudio', answer: 'Car speakers', via: 'voice' },
      { step: 'hold-bt', answer: 'Car speakers', via: 'voice', hold: 'unlabelled' },
      { step: 'hold-phone', answer: 'Earpiece', via: 'voice', hold: 'held' },
    ]);
    expect(s.byStep).toBe('auto-webaudio=Car speakers hold-bt=Car speakers(hold failed: unlabelled) hold-phone=Earpiece');
    expect(s.holdsFailed).toBe(1);
  });

  it('the phone kit target is the loud speaker, so the car answer is a miss there', () => {
    expect(routeKitSummary('route-phone', [{ step: 'x', answer: 'Car speakers', via: 'voice' }]).hits).toBe(0);
  });
});

describe('describeRoute / expectedAnswer', () => {
  const phone = classifyInputs([{ kind: 'audioinput', label: 'iPhone Microphone', deviceId: 'p' }]);
  const car = classifyInputs([
    { kind: 'audioinput', label: 'TOYOTA Corolla', deviceId: 'c' },
    { kind: 'audioinput', label: 'iPhone Microphone', deviceId: 'p' },
  ]);
  const pods = classifyInputs([
    { kind: 'audioinput', label: 'iPhone Microphone', deviceId: 'p' },
    { kind: 'audioinput', label: 'AirPods Pro', deviceId: 'a' },
  ]);

  it('names the route in words', () => {
    expect(describeRoute(phone)).toMatch(/^Phone only/);
    expect(describeRoute(car)).toBe('Car — TOYOTA Corolla.');
    expect(describeRoute(pods)).toBe('Headset — AirPods Pro.');
    expect(describeRoute(classifyInputs([]))).toMatch(/Not known/);
  });

  it('expects the speaker the route is supposed to use', () => {
    expect(expectedAnswer('auto', phone)).toBe('Phone loud speaker');
    expect(expectedAnswer('auto', car)).toBe('Car speakers');
    expect(expectedAnswer('bluetooth', pods)).toBe('Headset');
    // Phone speaker chosen with the car connected: the car is the miss.
    expect(expectedAnswer('phone', car)).toBe('Phone loud speaker');
  });
});
