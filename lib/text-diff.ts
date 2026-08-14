export interface DiffOp {
  type: "same" | "added" | "removed";
  text: string;
}

/**
 * Word-level diff via longest common subsequence, case-insensitive — used to
 * visualize how far a fresh transcription has drifted from a previously
 * stored one (see components/SttLabPanel.tsx). Turn transcripts are short
 * (a few sentences), so the O(n*m) DP table is cheap.
 */
export function diffWords(original: string, updated: string): DiffOp[] {
  const a = original.trim().split(/\s+/).filter(Boolean);
  const b = updated.trim().split(/\s+/).filter(Boolean);
  const n = a.length;
  const m = b.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i].toLowerCase() === b[j].toLowerCase()
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].toLowerCase() === b[j].toLowerCase()) {
      ops.push({ type: "same", text: b[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "removed", text: a[i] });
      i++;
    } else {
      ops.push({ type: "added", text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "removed", text: a[i++] });
  while (j < m) ops.push({ type: "added", text: b[j++] });
  return ops;
}

/** Fraction of the original transcript's words that survived unchanged — a single-number drift signal alongside the full diff. */
export function diffSimilarity(ops: DiffOp[]): number {
  const originalWordCount = ops.filter((o) => o.type !== "added").length;
  if (!originalWordCount) return 1;
  const same = ops.filter((o) => o.type === "same").length;
  return same / originalWordCount;
}
