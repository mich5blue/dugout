/**
 * Exact minimum-cost bipartite assignment (Jonker-Volgenant / Hungarian with
 * potentials), O(n^2 * m). Used to fill one inning's defensive positions
 * optimally given a cost matrix of positions x players.
 *
 * Rows = positions that must be filled. Columns = candidate players.
 * Use Infinity for an assignment that is forbidden by a hard constraint.
 */

/** Finite stand-in for Infinity so the algorithm's arithmetic stays well-defined. */
const BIG = 1e9;

export interface AssignmentResult {
  /** cols[row] = assigned column index. */
  cols: number[];
  /** Sum of the chosen cells' original costs. */
  total: number;
}

export function minCostAssignment(costMatrix: number[][]): AssignmentResult | null {
  const n = costMatrix.length;
  if (n === 0) return { cols: [], total: 0 };
  const m = costMatrix[0].length;
  if (m < n) return null;

  // 1-indexed flat cost array with Infinity replaced by BIG.
  const stride = m + 1;
  const a = new Float64Array((n + 1) * stride);
  for (let i = 1; i <= n; i++) {
    const row = costMatrix[i - 1];
    for (let j = 1; j <= m; j++) {
      const c = row[j - 1];
      a[i * stride + j] = Number.isFinite(c) ? c : BIG;
    }
  }

  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1); // p[j] = row matched to column j (0 = unmatched)
  const way = new Int32Array(m + 1);
  const minv = new Float64Array(m + 1);
  const used = new Uint8Array(m + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    used.fill(0);

    do {
      used[j0] = 1;
      const i0 = p[j0];
      const rowBase = i0 * stride;
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a[rowBase + j] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      if (j1 === 0) return null; // no augmenting path exists

      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    // Walk the augmenting path back, flipping matches.
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const cols = new Array<number>(n).fill(-1);
  let total = 0;
  for (let j = 1; j <= m; j++) {
    const row = p[j];
    if (row !== 0) {
      const original = costMatrix[row - 1][j - 1];
      // A forbidden cell in the optimal solution means no feasible assignment.
      if (!Number.isFinite(original)) return null;
      cols[row - 1] = j - 1;
      total += original;
    }
  }
  if (cols.some((c) => c < 0)) return null;

  return { cols, total };
}
