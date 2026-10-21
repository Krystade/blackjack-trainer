/**
 * Wave L: an independent finite-shoe hand evaluator, for checking the
 * disagreement grades in engine/variants/published.ts. Test tooling only;
 * nothing in the app imports it.
 *
 * Composition-dependent: the player's cards and the dealer's up card leave the
 * shoe, and every later card is drawn without replacement. After the first
 * decision the player plays the best of stand / hit / (Spanish 21) double,
 * without surrender. A port of the review probe finite.py; at a huge deck
 * count it reproduces the app's infinite-deck margins (variantFinite.test.ts
 * checks that too, so the two cannot drift silently).
 */

export interface FiniteGame {
  h17: boolean;
  push22: boolean;
  spanish: boolean;
  bonuses: boolean;
  p21wins: boolean;
  doubleAny: boolean;
  rescue: boolean;
}

/** Card values 1 (ace) .. 10 (ten-value). */
type Counts = number[];

function shoe(decks: number, spanish: boolean): Counts {
  const per = 4 * decks;
  return [per, per, per, per, per, per, per, per, per, (spanish ? 12 : 16) * decks];
}

function add(total: number, soft: boolean, v: number): [number, boolean] {
  if (v === 1) {
    if (total + 11 <= 21) return [total + 11, true];
    total += 1;
  } else {
    total += v;
  }
  if (total > 21 && soft) return [total - 10, false];
  return [total, soft];
}

function take(c: Counts, v: number): Counts {
  const out = c.slice();
  out[v - 1]! -= 1;
  if (out[v - 1]! < 0) throw new Error('card not in shoe');
  return out;
}

export class FiniteShoe {
  private dcache = new Map<string, number[]>();
  private pcache = new Map<string, number>();
  private readonly full: Counts;

  private readonly g: FiniteGame;

  constructor(g: FiniteGame, decks: number) {
    this.g = g;
    this.full = shoe(decks, g.spanish);
  }

  /** Dealer finals [17,18,19,20,21,22,23+]. */
  private dealer(c: Counts, total: number, soft: boolean): number[] {
    if (total > 21) {
      const out = [0, 0, 0, 0, 0, 0, 0];
      out[total === 22 ? 5 : 6] = 1;
      return out;
    }
    if (total >= 17 && !(this.g.h17 && soft && total === 17)) {
      const out = [0, 0, 0, 0, 0, 0, 0];
      out[total - 17] = 1;
      return out;
    }
    const key = `${c.join(',')}|${total}|${soft}`;
    const hit = this.dcache.get(key);
    if (hit) return hit;
    const n = c.reduce((a, b) => a + b, 0);
    const out = [0, 0, 0, 0, 0, 0, 0];
    c.forEach((k, i) => {
      if (k === 0) return;
      const [t2, s2] = add(total, soft, i + 1);
      const sub = this.dealer(take(c, i + 1), t2, s2);
      for (let j = 0; j < 7; j++) out[j]! += (k / n) * sub[j]!;
    });
    this.dcache.set(key, out);
    return out;
  }

  /** Given the up card, after the peek (no dealer natural). */
  private dealerFromUp(c: Counts, up: number): number[] {
    const n = c.reduce((a, b) => a + b, 0);
    const out = [0, 0, 0, 0, 0, 0, 0];
    let live = 0;
    c.forEach((k, i) => {
      const v = i + 1;
      if (k === 0 || (up === 1 && v === 10) || (up === 10 && v === 1)) return;
      const p = k / n;
      const [t, s] = add(...add(0, false, up), v);
      const sub = this.dealer(take(c, v), t, s);
      for (let j = 0; j < 7; j++) out[j]! += p * sub[j]!;
      live += p;
    });
    return out.map((x) => x / live);
  }

  private stand(c: Counts, up: number, total: number, n: number, W: number, L: number, bonusOk: boolean): number {
    if (total > 21) return -L;
    if (this.g.p21wins && total === 21) {
      let mult = 1;
      if (this.g.bonuses && bonusOk) mult = n >= 7 ? 3 : n === 6 ? 2 : n === 5 ? 1.5 : 1;
      return W * mult;
    }
    const d = this.dealerFromUp(c, up);
    let win = d[6]! + (this.g.push22 ? 0 : d[5]!);
    let lose = 0;
    for (let i = 0; i < 5; i++) {
      if (total > 17 + i) win += d[i]!;
      else if (total < 17 + i) lose += d[i]!;
    }
    return W * win - L * lose;
  }

  private *draws(c: Counts): Generator<[number, number]> {
    const n = c.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 10; i++) if (c[i]) yield [i + 1, c[i]! / n];
  }

  private double(c: Counts, up: number, total: number, soft: boolean): number {
    let ev = 0;
    for (const [v, p] of this.draws(c)) {
      const [t2] = add(total, soft, v);
      let r: number;
      if (t2 > 21) r = -2;
      else {
        const s = this.stand(take(c, v), up, t2, 0, 2, 2, false);
        r = this.g.rescue ? Math.max(s, -1) : s;
      }
      ev += p * r;
    }
    return ev;
  }

  private hit(c: Counts, up: number, total: number, soft: boolean, n: number): number {
    let ev = 0;
    for (const [v, p] of this.draws(c)) {
      const [t2, s2] = add(total, soft, v);
      ev += p * this.best(take(c, v), up, t2, s2, n + 1);
    }
    return ev;
  }

  private best(c: Counts, up: number, total: number, soft: boolean, n: number): number {
    if (total > 21) return -1;
    const key = `${c.join(',')}|${up}|${total}|${soft}|${n}`;
    const hit = this.pcache.get(key);
    if (hit !== undefined) return hit;
    let v = this.stand(c, up, total, n, 1, 1, true);
    if (total < 21) {
      v = Math.max(v, this.hit(c, up, total, soft, n));
      if (this.g.doubleAny) v = Math.max(v, this.double(c, up, total, soft));
    }
    this.pcache.set(key, v);
    return v;
  }

  /** Stand / hit / double values for `cards` (values 1-10) against `up`. */
  options(cards: number[], up: number): { S: number; H: number; D?: number } {
    let c = this.full;
    for (const x of [...cards, up]) c = take(c, x);
    let total = 0;
    let soft = false;
    for (const x of cards) [total, soft] = add(total, soft, x);
    const n = cards.length;
    const out: { S: number; H: number; D?: number } = {
      S: this.stand(c, up, total, n, 1, 1, true),
      H: this.hit(c, up, total, soft, n),
    };
    if (n === 2 || this.g.doubleAny) out.D = this.double(c, up, total, soft);
    return out;
  }
}

export const FREE_BET_GAME: FiniteGame = {
  h17: true,
  push22: true,
  spanish: false,
  bonuses: false,
  p21wins: false,
  doubleAny: false,
  rescue: false,
};
export const S21_GAME = (h17: boolean): FiniteGame => ({
  h17,
  push22: false,
  spanish: true,
  bonuses: true,
  p21wins: true,
  doubleAny: true,
  rescue: true,
});
