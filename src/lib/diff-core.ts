/**
 * Myers O(ND) shortest-edit-script diff over arbitrary arrays, shared by the Text Diff Checker
 * (lines, then words) and the JSON Diff Checker (array elements, by deep equality). Verified
 * against the algorithm's own textbook example (A=ABCABBA, B=CBABAC → edit script length 5,
 * LCS length 4 "CABA") before being trusted here, along with insert-only/delete-only/repeated-
 * element cases. Pure, no DOM.
 */

export type DiffOp<T> = { type: 'equal'; value: T } | { type: 'delete'; value: T } | { type: 'insert'; value: T };

export function diffArrays<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): DiffOp<T>[] {
  const N = a.length;
  const M = b.length;
  const max = N + M;
  const trace: Map<number, number>[] = [];
  let v = new Map<number, number>([[1, 0]]);

  find: {
    for (let d = 0; d <= max; d++) {
      trace.push(new Map(v));
      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) x = v.get(k + 1) ?? 0;
        else x = (v.get(k - 1) ?? 0) + 1;
        let y = x - k;
        while (x < N && y < M && eq(a[x], b[y])) {
          x++;
          y++;
        }
        v.set(k, x);
        if (x >= N && y >= M) break find;
      }
    }
  }

  type RawOp = { type: 'equal' | 'delete' | 'insert'; ai?: number; bi?: number };
  const raw: RawOp[] = [];
  let x = N;
  let y = M;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = vd.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      raw.push({ type: 'equal', ai: x - 1, bi: y - 1 });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        raw.push({ type: 'insert', bi: y - 1 });
        y--;
      } else {
        raw.push({ type: 'delete', ai: x - 1 });
        x--;
      }
    }
  }
  raw.reverse();

  return raw.map((op) =>
    op.type === 'equal'
      ? { type: 'equal', value: a[op.ai!] }
      : op.type === 'delete'
        ? { type: 'delete', value: a[op.ai!] }
        : { type: 'insert', value: b[op.bi!] },
  );
}
