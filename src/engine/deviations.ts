import type { Rank } from './cards';

export type Action = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

export type DeviationId =
  | 'ins'
  | '16v10'
  | '15v10'
  | 'TTv5'
  | 'TTv6'
  | '10v10'
  | '12v3'
  | '12v2'
  | '11vA'
  | '9v2'
  | '10vA'
  | '9v7'
  | '16v9'
  | '13v2'
  | '12v4'
  | '12v5'
  | '12v6'
  | '13v3';

export interface Deviation {
  id: DeviationId;
  kind: 'insurance' | 'hard' | 'pair10';
  total?: number; // for kind 'hard'
  up?: Rank; // '2'..'10','A' ('10' covers J/Q/K via upIndex)
  action: Action | 'take-insurance';
  threshold: number;
  dir: 'gte' | 'lte'; // deviate when tc >= threshold (gte) or tc <= threshold (lte)
  active: boolean; // 11vA inactive: absorbed into H17 basic
  label: string; // e.g. "16 v 10: stand at TC ≥ 0"
}

// VERIFIED H17-ADJUSTED INDICES — transcribed verbatim from the task-6 brief.
// Do NOT adjust from S17 memory (10vA is +3 not +4, 16v9 is +4 not +5,
// 12v6 is -3 not -1, 11vA is inactive under H17).
export const ILLUSTRIOUS_18: Deviation[] = [
  { id: 'ins', kind: 'insurance', action: 'take-insurance', threshold: 3, dir: 'gte', active: true, label: 'Insurance: take at TC ≥ +3' },
  { id: '16v10', kind: 'hard', total: 16, up: '10', action: 'stand', threshold: 0, dir: 'gte', active: true, label: '16 v 10: stand at TC ≥ 0' },
  { id: '15v10', kind: 'hard', total: 15, up: '10', action: 'stand', threshold: 4, dir: 'gte', active: true, label: '15 v 10: stand at TC ≥ +4' },
  { id: 'TTv5', kind: 'pair10', up: '5', action: 'split', threshold: 5, dir: 'gte', active: true, label: '10,10 v 5: split at TC ≥ +5' },
  { id: 'TTv6', kind: 'pair10', up: '6', action: 'split', threshold: 4, dir: 'gte', active: true, label: '10,10 v 6: split at TC ≥ +4' },
  { id: '10v10', kind: 'hard', total: 10, up: '10', action: 'double', threshold: 4, dir: 'gte', active: true, label: '10 v 10: double at TC ≥ +4' },
  { id: '12v3', kind: 'hard', total: 12, up: '3', action: 'stand', threshold: 2, dir: 'gte', active: true, label: '12 v 3: stand at TC ≥ +2' },
  { id: '12v2', kind: 'hard', total: 12, up: '2', action: 'stand', threshold: 3, dir: 'gte', active: true, label: '12 v 2: stand at TC ≥ +3' },
  { id: '11vA', kind: 'hard', total: 11, up: 'A', action: 'double', threshold: 0, dir: 'gte', active: false, label: '11 v A: always double under H17 (S17-only index)' },
  { id: '9v2', kind: 'hard', total: 9, up: '2', action: 'double', threshold: 1, dir: 'gte', active: true, label: '9 v 2: double at TC ≥ +1' },
  { id: '10vA', kind: 'hard', total: 10, up: 'A', action: 'double', threshold: 3, dir: 'gte', active: true, label: '10 v A: double at TC ≥ +3 (H17)' },
  { id: '9v7', kind: 'hard', total: 9, up: '7', action: 'double', threshold: 3, dir: 'gte', active: true, label: '9 v 7: double at TC ≥ +3' },
  { id: '16v9', kind: 'hard', total: 16, up: '9', action: 'stand', threshold: 4, dir: 'gte', active: true, label: '16 v 9: stand at TC ≥ +4 (H17)' },
  { id: '13v2', kind: 'hard', total: 13, up: '2', action: 'hit', threshold: -1, dir: 'lte', active: true, label: '13 v 2: hit at TC ≤ −1' },
  { id: '12v4', kind: 'hard', total: 12, up: '4', action: 'hit', threshold: -1, dir: 'lte', active: true, label: '12 v 4: hit at any negative TC' },
  { id: '12v5', kind: 'hard', total: 12, up: '5', action: 'hit', threshold: -2, dir: 'lte', active: true, label: '12 v 5: hit at TC ≤ −2' },
  { id: '12v6', kind: 'hard', total: 12, up: '6', action: 'hit', threshold: -3, dir: 'lte', active: true, label: '12 v 6: hit at TC ≤ −3 (H17)' },
  { id: '13v3', kind: 'hard', total: 13, up: '3', action: 'hit', threshold: -2, dir: 'lte', active: true, label: '13 v 3: hit at TC ≤ −2' },
];
