/**
 * Attribute wrapped description lines to transactions when the bank centres the description
 * vertically on the date line (ICICI savings): some lines sit ABOVE their date line, some BELOW.
 *
 * Between two consecutive date lines the continuation lines are split: the first `u` belong to the
 * earlier transaction (below it), the rest to the later one (above it). We choose the splits that
 * make every transaction's text block best centred on its date line (the symmetric layout), by
 * dynamic programming over a page, and report which splits were nearly tied.
 */

export interface BlockDateLine {
  y: number;
  /** The date line itself carries description text (so it is one of the block's lines). */
  hasText: boolean;
}

export interface BlockResult {
  /** For each date line, how many continuation lines sit above / below it. */
  above: number[];
  below: number[];
  /** Per date line: true when its attribution could have gone another way almost as well. */
  uncertain: boolean[];
  /** Per gap g (1..n-1): extra cost of the best alternative split (Infinity when the gap is empty). */
  gapMargin: number[];
  cost: number;
}

const ASYM_WEIGHT = 3;
const EMPTY_PENALTY = 10;

/**
 * @param dates   date lines of one page, top to bottom
 * @param gaps    gaps[g] = y of each continuation line between date g-1 and date g (g = 0 .. n);
 *                gaps[0] precedes the first date line, gaps[n] follows the last one
 * @param margin  a split is "uncertain" when the best alternative costs less than this much more
 */
export function attributeBlocks(dates: BlockDateLine[], gaps: number[][], margin = 2): BlockResult {
  const n = dates.length;
  if (n === 0) return { above: [], below: [], uncertain: [], gapMargin: [], cost: 0 };

  // cost of date line i given `a` lines above (last a of gaps[i]) and `b` lines below (first b of gaps[i+1])
  const rowCost = (i: number, a: number, b: number): number => {
    const d = dates[i];
    const up = gaps[i];
    const down = gaps[i + 1];
    const ys: number[] = [];
    for (let k = up.length - a; k < up.length; k++) ys.push(up[k]);
    for (let k = 0; k < b; k++) ys.push(down[k]);
    if (d.hasText) ys.push(d.y);
    // A transaction with no description text at all is implausible: don't let a row "opt out".
    let geometry = ys.length === 0 ? EMPTY_PENALTY : 0;
    if (ys.length > 0) {
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      geometry = Math.abs((lo + hi) / 2 - d.y);
    }
    const asym = Math.max(0, Math.abs(a - b) - (d.hasText ? 1 : 0));
    return geometry + asym * ASYM_WEIGHT;
  };

  // u[g] for g = 1..n-1 : lines of gaps[g] given to the row above (as its "below"). u[0] = 0, u[n] = gaps[n].length.
  const m = gaps.map((g) => g.length);
  // forward[i][u] : best cost of rows 0..i-1 given u_i = u (rows before gap i)
  const INF = Number.POSITIVE_INFINITY;
  const forward: number[][] = Array.from({ length: n + 1 }, (_, g) => new Array<number>(m[g] + 1).fill(INF));
  const back: number[][] = Array.from({ length: n + 1 }, (_, g) => new Array<number>(m[g] + 1).fill(-1));
  forward[0][0] = 0;
  for (let i = 0; i < n; i++) {
    for (let u0 = 0; u0 <= m[i]; u0++) {
      if (forward[i][u0] === INF) continue;
      const a = i === 0 ? m[0] : m[i] - u0;
      const lastGap = i === n - 1;
      const range = lastGap ? [m[n]] : Array.from({ length: m[i + 1] + 1 }, (_, k) => k);
      for (const u1 of range) {
        const c = forward[i][u0] + rowCost(i, a, u1);
        if (c < forward[i + 1][u1]) {
          forward[i + 1][u1] = c;
          back[i + 1][u1] = u0;
        }
      }
    }
  }
  // backward[i][u] : best cost of rows i..n-1 given u_i = u
  const backward: number[][] = Array.from({ length: n + 1 }, (_, g) => new Array<number>(m[g] + 1).fill(INF));
  backward[n][m[n]] = 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let u0 = 0; u0 <= m[i]; u0++) {
      if (i === 0 && u0 !== 0) continue;
      const a = i === 0 ? m[0] : m[i] - u0;
      const range = i === n - 1 ? [m[n]] : Array.from({ length: m[i + 1] + 1 }, (_, k) => k);
      let best = INF;
      for (const u1 of range) {
        if (backward[i + 1][u1] === INF) continue;
        best = Math.min(best, rowCost(i, a, u1) + backward[i + 1][u1]);
      }
      backward[i][u0] = best;
    }
  }

  const total = forward[n][m[n]];
  const u: number[] = new Array<number>(n + 1).fill(0);
  u[n] = m[n];
  for (let g = n; g >= 1; g--) u[g - 1] = back[g][u[g]];

  const above = new Array<number>(n).fill(0);
  const below = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    above[i] = i === 0 ? m[0] : m[i] - u[i];
    below[i] = u[i + 1];
  }

  const uncertain = new Array<boolean>(n).fill(false);
  const gapMargin = new Array<number>(n + 1).fill(INF);
  for (let g = 1; g < n; g++) {
    if (m[g] === 0) continue;
    let alt = INF;
    for (let v = 0; v <= m[g]; v++) {
      if (v === u[g]) continue;
      alt = Math.min(alt, forward[g][v] + backward[g][v]);
    }
    gapMargin[g] = alt - total;
    if (alt - total < margin) {
      uncertain[g - 1] = true;
      uncertain[g] = true;
    }
  }
  return { above, below, uncertain, gapMargin, cost: total };
}
