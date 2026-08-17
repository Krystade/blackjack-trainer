import { describe, it, expect } from 'vitest';
import type { Card } from '../engine/cards';
import { DEFAULT_RULES } from '../engine/ruleset';
import { gateDrillAnswer } from './answerGate';

const c = (rank: Card['rank'], suit: Card['suit'] = 's'): Card => ({ rank, suit });

const NON_PAIR = [c('10', 's'), c('6', 'h')];
const PAIR = [c('8', 's'), c('8', 'h')];
const NO_SURRENDER = { ...DEFAULT_RULES, ls: false };

describe('gateDrillAnswer', () => {
  it('accepts an action the hand actually allows', () => {
    expect(gateDrillAnswer('hit', NON_PAIR, DEFAULT_RULES).accepted).toBe(true);
  });

  it('refuses a split on a non-pair', () => {
    expect(gateDrillAnswer('split', NON_PAIR, DEFAULT_RULES).accepted).toBe(false);
  });

  it('accepts a split on a pair', () => {
    expect(gateDrillAnswer('split', PAIR, DEFAULT_RULES).accepted).toBe(true);
  });

  it('refuses surrender when the ruleset has none', () => {
    expect(gateDrillAnswer('surrender', NON_PAIR, NO_SURRENDER).accepted).toBe(false);
  });

  it('says WHY it refused, so an eyes-free tap is never silent', () => {
    // The whole point of A1: the zone pad has no disabled affordance, so a
    // refusal that produces no sound is indistinguishable from a dead app.
    const gate = gateDrillAnswer('split', NON_PAIR, DEFAULT_RULES);
    expect(gate.announcement).toBe("Split isn't available on this hand.");
  });

  it('names the refused action, not a generic error', () => {
    expect(gateDrillAnswer('surrender', NON_PAIR, NO_SURRENDER).announcement).toBe(
      "Surrender isn't available on this hand.",
    );
  });

  it('announces nothing when the action is accepted', () => {
    expect(gateDrillAnswer('hit', NON_PAIR, DEFAULT_RULES).announcement).toBeNull();
  });

  it('uses only clip-friendly words — no symbols the voice cannot say', () => {
    // Corrections fall back to robot-voice live TTS whenever a string cannot
    // match the clip cascade (see narrateReason); a refusal spoken mid-drive
    // deserves the same care.
    const gate = gateDrillAnswer('split', NON_PAIR, DEFAULT_RULES);
    expect(gate.announcement).not.toMatch(/[^a-zA-Z'. ]/);
  });

  it('accepts insurance answers, which have no hand to gate against', () => {
    // The deviation quiz's insurance items pass no cards at all; gating them
    // as "illegal" would make the insurance prompt unanswerable.
    expect(gateDrillAnswer('take-insurance', null, DEFAULT_RULES).accepted).toBe(true);
    expect(gateDrillAnswer('decline-insurance', null, DEFAULT_RULES).accepted).toBe(true);
  });

  it('accepts any action when there is no hand to judge against', () => {
    expect(gateDrillAnswer('split', null, DEFAULT_RULES).accepted).toBe(true);
  });
});
