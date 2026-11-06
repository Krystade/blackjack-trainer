import { describe, expect, it } from 'vitest';
import { groupByIndex, isLearned, learningOrder, pathState, pickPathId } from './indexPath';
import { askedIndexSet } from './deviationQuiz';
import { DEFAULT_RULES } from '../engine/ruleset';
import { mulberry32 } from '../engine/cards';
import { publishedIndex } from './indexDisplay';

const devs = askedIndexSet(DEFAULT_RULES);

describe('index learning path (owner 2026-11-06)', () => {
  it('groups by published index, highest first, every index once', () => {
    const groups = groupByIndex(devs);
    const values = groups.map((g) => g.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(groups.flatMap((g) => g.ids).sort()).toEqual(devs.map((d) => d.id).sort());
    for (const g of groups) for (const id of g.ids) expect(publishedIndex(devs.find((d) => d.id === id)!)).toBe(g.value);
  });

  it('learns the insurance group (+3) first: the most valuable index', () => {
    const first = learningOrder(devs)[0]!;
    expect(first.value).toBe(3);
    expect(first.ids).toContain(devs[0]!.id);
  });

  it('a group is learned at three right in a row, and the next one opens', () => {
    expect(isLearned({ recent: '0111', days: [] })).toBe(true);
    expect(isLearned({ recent: '1101', days: [] })).toBe(false);
    expect(isLearned({ recent: '11', days: [] })).toBe(false);
    const first = learningOrder(devs)[0]!;
    const recent = Object.fromEntries(first.ids.map((id) => [id, { recent: '111', days: [] }]));
    expect(pathState(devs, {}).current).toBe(0);
    expect(pathState(devs, recent).current).toBe(1);
  });

  it('asks mostly the group being learned, and some review', () => {
    const recent = Object.fromEntries(learningOrder(devs)[0]!.ids.map((id) => [id, { recent: '111', days: [] }]));
    const state = pathState(devs, recent);
    const current = new Set(state.order[1]!.ids);
    const earlier = new Set(state.order[0]!.ids);
    const rng = mulberry32(3);
    let cur = 0;
    let rev = 0;
    for (let i = 0; i < 1000; i++) {
      const id = pickPathId(state, rng);
      if (current.has(id)) cur++;
      else if (earlier.has(id)) rev++;
      else throw new Error(`asked ${id}, from a group not open yet`);
    }
    expect(cur / 1000).toBeGreaterThan(0.6);
    expect(rev).toBeGreaterThan(200);
  });
});
