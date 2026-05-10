import type { Vec2 } from '../geom/vec.ts';

export interface Profile {
  name: string;
  /**
   * Closed-loop polyline traversed TE → upper → LE → lower → TE
   * (Selig convention). Coordinates are normalized to chord = 1
   * with the leading edge at x ≈ 0 and trailing edge at x ≈ 1.
   */
  points: Vec2[];
}

export type DatFormat = 'selig' | 'lednicer';

const isNumberToken = (s: string): boolean => /^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(s);

const tokenize = (line: string): string[] =>
  line.trim().split(/[\s,]+/).filter((t) => t.length > 0);

const parseFloats = (line: string): number[] => {
  const toks = tokenize(line);
  if (toks.length === 0) return [];
  if (!toks.every(isNumberToken)) return [];
  return toks.map(Number);
};

/**
 * Parse a UIUC-style airfoil .dat file. Auto-detects Selig and Lednicer
 * formats. The first non-numeric line (if any) is treated as the airfoil
 * name; lines starting with '#' and blank lines are skipped.
 */
export function parseDat(text: string): Profile {
  const rawLines = text.split(/\r?\n/);

  // Strip blank/comment lines but remember positions for blank-line splits
  // (Lednicer occasionally separates upper/lower with a blank line).
  const cleaned: { line: string; blankAfter: boolean }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (trimmed.length === 0) {
      if (cleaned.length > 0) cleaned[cleaned.length - 1].blankAfter = true;
      continue;
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    cleaned.push({ line: trimmed, blankAfter: false });
  }

  if (cleaned.length < 4) {
    throw new Error('Airfoil file has too few lines to be a valid .dat');
  }

  // Pull off the name if first line is non-numeric.
  let idx = 0;
  let name = 'unnamed';
  if (parseFloats(cleaned[0].line).length === 0) {
    name = cleaned[0].line;
    idx = 1;
  }

  const dataRows = cleaned.slice(idx);

  // Heuristic: Lednicer's first data row is two integers > 1.5 (the upper
  // and lower point counts, e.g. "61. 61.").
  const first = parseFloats(dataRows[0].line);
  if (first.length === 2 && first[0] > 1.5 && first[1] > 1.5) {
    return parseLednicer(name, dataRows);
  }
  return parseSelig(name, dataRows);
}

function parseSelig(name: string, rows: { line: string; blankAfter: boolean }[]): Profile {
  const points: Vec2[] = [];
  for (const row of rows) {
    const nums = parseFloats(row.line);
    if (nums.length < 2) continue;
    points.push({ x: nums[0], y: nums[1] });
  }
  if (points.length < 10) {
    throw new Error(`Selig parser: only got ${points.length} points`);
  }
  return { name, points: closeLoop(points) };
}

function parseLednicer(name: string, rows: { line: string; blankAfter: boolean }[]): Profile {
  const counts = parseFloats(rows[0].line);
  const upperCount = Math.round(counts[0]);
  const lowerCount = Math.round(counts[1]);

  const dataRows = rows.slice(1);
  if (dataRows.length < upperCount + lowerCount) {
    throw new Error(
      `Lednicer parser: declared ${upperCount}+${lowerCount} points but file has ${dataRows.length}`,
    );
  }

  const upper: Vec2[] = [];
  const lower: Vec2[] = [];
  for (let i = 0; i < upperCount; i++) {
    const nums = parseFloats(dataRows[i].line);
    if (nums.length >= 2) upper.push({ x: nums[0], y: nums[1] });
  }
  for (let i = 0; i < lowerCount; i++) {
    const nums = parseFloats(dataRows[upperCount + i].line);
    if (nums.length >= 2) lower.push({ x: nums[0], y: nums[1] });
  }

  // Convert to Selig: TE → upper(reversed) → LE → lower → TE
  const reversed = [...upper].reverse();
  const merged: Vec2[] = [...reversed];
  // Skip the duplicate LE point at the boundary (lower[0] ≈ reversed[last]).
  const head = merged[merged.length - 1];
  const startLower = lower[0] && pointsClose(head, lower[0]) ? 1 : 0;
  for (let i = startLower; i < lower.length; i++) merged.push(lower[i]);

  return { name, points: closeLoop(merged) };
}

function pointsClose(a: Vec2, b: Vec2, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

function closeLoop(points: Vec2[]): Vec2[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!pointsClose(first, last, 1e-4)) {
    return [...points, { x: first.x, y: first.y }];
  }
  return points;
}

/** Diagnostic summary of a parsed profile. */
export function profileSummary(p: Profile): string {
  const xs = p.points.map((q) => q.x);
  const ys = p.points.map((q) => q.y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  return `${p.name}  (${p.points.length} pts, x ∈ [${xmin.toFixed(3)}, ${xmax.toFixed(3)}], y ∈ [${ymin.toFixed(3)}, ${ymax.toFixed(3)}])`;
}
