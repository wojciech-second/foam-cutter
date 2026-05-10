import type { Profile } from './parser.ts';
import type { Vec2 } from '../geom/vec.ts';
import { v2rot } from '../geom/vec.ts';

export type Alignment = 'le' | 'qc' | 'te';

export interface PlacedProfile {
  /** 2D points in mm, already scaled, rotated for washout, and sweep-shifted. */
  points: Vec2[];
  /** Pivot point used for rotation/alignment, in mm (post-scale, pre-rotation). */
  pivot: Vec2;
  /** Source profile name, for status display. */
  name: string;
}

export interface PlacementOpts {
  /** Chord length in mm. */
  chord: number;
  /** Alignment used both for rotation pivot and for sweep reference. */
  alignment: Alignment;
  /** Geometric twist (washout) in radians. Positive = nose-up at this station. */
  washoutRad: number;
  /** Chord-direction shift (mm). Used for sweep on the tip station. */
  sweep: number;
  /** Vertical shift (mm). Usually 0. */
  rise?: number;
}

const pivotForAlignment = (chord: number, a: Alignment): number => {
  switch (a) {
    case 'le': return 0;
    case 'qc': return chord * 0.25;
    case 'te': return chord;
  }
};

/**
 * Take a normalized airfoil profile and produce a 2D placement in mm:
 *   1. Scale to chord length (about LE at origin).
 *   2. Translate so the alignment pivot sits at x=0.
 *   3. Rotate by washout about that pivot.
 *   4. Apply sweep (x-shift) and rise (y-shift).
 *
 * The pivot at x=0 means root and tip are aligned by the chosen reference
 * (LE/quarter-chord/TE) before any extra sweep is applied.
 */
export function placeProfile(p: Profile, opts: PlacementOpts): PlacedProfile {
  const pivotX0 = pivotForAlignment(opts.chord, opts.alignment);
  const pivot: Vec2 = { x: 0, y: 0 };
  const out: Vec2[] = new Array(p.points.length);
  const c = Math.cos(opts.washoutRad);
  const s = Math.sin(opts.washoutRad);
  const rise = opts.rise ?? 0;

  for (let i = 0; i < p.points.length; i++) {
    const np = p.points[i];
    // Step 1: scale.
    const x0 = np.x * opts.chord;
    const y0 = np.y * opts.chord;
    // Step 2: translate so alignment point sits at x=0.
    const x1 = x0 - pivotX0;
    const y1 = y0;
    // Step 3: rotate about origin (== pivot).
    const x2 = x1 * c - y1 * s;
    const y2 = x1 * s + y1 * c;
    // Step 4: sweep + rise.
    out[i] = { x: x2 + opts.sweep, y: y2 + rise };
  }

  return { points: out, pivot, name: p.name };
}

/** Cumulative arc length along a polyline. Returns array of length N+1 starting at 0. */
export function cumulativeArcLength(points: Vec2[]): number[] {
  const out = new Array<number>(points.length);
  out[0] = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    out[i] = out[i - 1] + Math.hypot(dx, dy);
  }
  return out;
}

/**
 * Resample a polyline to N points by uniform fraction of total arc length.
 * The output preserves direction and includes both endpoints.
 *
 * Crucially, two profiles resampled with the same N can be paired index-by-
 * index — point i on each is at fraction i/(N-1) of perimeter — which is
 * what the hot-wire CNC needs for synchronized (constant-time) cutting.
 */
export function resampleByArcLength(points: Vec2[], n: number): Vec2[] {
  if (points.length < 2) throw new Error('resample: need at least 2 points');
  if (n < 2) throw new Error('resample: n must be >= 2');

  const cum = cumulativeArcLength(points);
  const total = cum[cum.length - 1];
  if (total <= 0) throw new Error('resample: zero-length polyline');

  const out: Vec2[] = new Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const segLen = cum[j + 1] - cum[j];
    const t = segLen > 0 ? (target - cum[j]) / segLen : 0;
    const a = points[j];
    const b = points[j + 1];
    out[i] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return out;
}

/**
 * Outward kerf compensation: shift each point along the local outward normal
 * by `kerf` millimeters. For a closed polyline traversed clockwise (Selig
 * order looped TE → upper → LE → lower → TE traverses the airfoil clockwise
 * when y-up), the right-hand normal points outward from the airfoil.
 */
export function offsetOutward(points: Vec2[], kerf: number): Vec2[] {
  if (kerf === 0) return points.map((p) => ({ ...p }));
  const n = points.length;
  const out: Vec2[] = new Array(n);
  const closed =
    Math.hypot(points[0].x - points[n - 1].x, points[0].y - points[n - 1].y) < 1e-6;

  for (let i = 0; i < n; i++) {
    // Average the normals of the two adjacent segments.
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const cur = points[i];

    const useBack = closed || i > 0;
    const useFwd = closed || i < n - 1;

    let nx = 0;
    let ny = 0;

    if (useBack) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-9) {
        // Right-hand normal of (dx, dy) is (dy, -dx).
        nx += dy / len;
        ny += -dx / len;
      }
    }
    if (useFwd) {
      const dx = next.x - cur.x;
      const dy = next.y - cur.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-9) {
        nx += dy / len;
        ny += -dx / len;
      }
    }
    const nlen = Math.hypot(nx, ny);
    if (nlen > 1e-9) {
      nx /= nlen;
      ny /= nlen;
    }
    out[i] = { x: cur.x + nx * kerf, y: cur.y + ny * kerf };
  }
  return out;
}

/** Re-export for convenience. */
export { v2rot };
