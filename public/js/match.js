/* js/match.js */
/* Rectify — recognise register rows that are already in the system.
 * A row matches an existing defect by S/N; if the S/N differs, by near-identical location and description.
 * Matches where only one of the two lines up are flagged for STEL to confirm. */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U;
  const M = (DT.match = {});

  const SAME_SN_MIN = 0.45; /* below this, a shared S/N looks like a different defect */
  const MOVED_SN_MIN = 0.8; /* at or above this, a different S/N looks like the same defect */

  /* existing / rows: objects with `sn` and `fp` (fingerprint).
   * Returns { pairs: [{existing, row, doubtful, reason}], fresh: [rows with no match] } */
  M.run = (existing, rows) => {
    const bySn = new Map(existing.map((d) => [d.sn, d]));
    const tokens = new Map();
    const tok = (x) => tokens.get(x) || (tokens.set(x, U.tokens(x.fp)), tokens.get(x));
    const used = new Set();
    const pairs = [];
    const unmatched = [];
    rows.forEach((row) => {
      const d = bySn.get(row.sn);
      if (d && !used.has(d)) {
        used.add(d);
        const doubtful = U.jaccard(tok(d), tok(row)) < SAME_SN_MIN;
        pairs.push({ existing: d, row, doubtful, reason: doubtful ? 'Same S/N, but the location and description look different' : '' });
      } else unmatched.push(row);
    });
    const fresh = [];
    unmatched.forEach((row) => {
      let best = null,
        bestScore = 0;
      existing.forEach((d) => {
        if (used.has(d)) return;
        const s = U.jaccard(tok(d), tok(row));
        if (s > bestScore) (bestScore = s), (best = d);
      });
      if (best && bestScore >= MOVED_SN_MIN) {
        used.add(best);
        pairs.push({ existing: best, row, doubtful: true, reason: 'S/N changed from ' + best.sn + ' to ' + row.sn + ', but the location and description match' });
      } else fresh.push(row);
    });
    return { pairs, fresh };
  };
})();


