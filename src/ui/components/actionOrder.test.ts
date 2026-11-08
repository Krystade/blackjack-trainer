import { describe, expect, it } from 'vitest';
import { actionButtons } from './actionOrder';
import table from '../screens/Table.tsx?raw';
import flashcards from '../screens/drills/FlashcardsView.tsx?raw';
import deviationQuiz from '../screens/drills/DeviationQuizView.tsx?raw';
import mastery from '../screens/drills/MasteryChallengeView.tsx?raw';
import mixed from '../screens/drills/MixedSessionView.tsx?raw';
import variant from '../screens/drills/VariantDrillView.tsx?raw';

const labels = (hand?: 'right' | 'left') => actionButtons(hand).map((b) => b.label);

describe('ActionBar answer order (owner 2026-11-07)', () => {
  it('right hand: Hit, Stand, then Surrender, Double, Split -- Split nearest the right thumb', () => {
    expect(labels('right')).toEqual(['Hit', 'Stand', 'Surrender', 'Double', 'Split']);
  });

  it('no hand given reads as right-handed', () => {
    expect(labels()).toEqual(labels('right'));
  });

  it('left hand mirrors only the bottom three; Hit and Stand stay put, Double stays central', () => {
    expect(labels('left')).toEqual(['Hit', 'Stand', 'Split', 'Double', 'Surrender']);
  });

  it('every label keeps its own action', () => {
    for (const hand of ['right', 'left'] as const) {
      for (const b of actionButtons(hand)) expect(b.label.toLowerCase()).toBe(b.key);
    }
  });

  // The order only mirrors where the screen passes the setting in.
  it.each([
    ['Table', table],
    ['FlashcardsView', flashcards],
    ['DeviationQuizView', deviationQuiz],
    ['MasteryChallengeView', mastery],
    ['MixedSessionView', mixed],
    ['VariantDrillView', variant],
  ])('%s passes Settings.handedness to its answer bar', (_name, src) => {
    const sites = src.split("kind: 'actions'").slice(1);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) expect(site.slice(0, 400)).toMatch(/hand: settings\.handedness/);
  });
});
