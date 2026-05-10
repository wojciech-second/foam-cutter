import type { Profile } from './parser.ts';
import type { Vec2 } from '../geom/vec.ts';
import { v2rot } from '../geom/vec.ts';

export type Alignment = 'le' | 'qc' | 'te';

/**
 * Strategy for pairing points across the two profiles. Both modes produce
 * exactly N points per profile, paired index-by-index.
 *
 * - `arc-length`: resamples by uniform fraction of total perimeter.
 *   Robust for any closed shape; pairing is "geometric" and may walk the
 *   surfaces at different rates if the airfoils have very different
 *   curvature distributions.
 *
 * - `chord-fraction`: resamples upper and lower surfaces independently
 *   at the same cosine-spaced x/c stations. Pairs corresponding chord
 *   positions on each station — closer to the textbook "lofted wing"
 *   treatment, and what tools like GMFC/DevFoam use by default.
 */
export type PairingMode = 'arc-length' | 'chord-fraction';

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
 * Take normalized airfoil points (chord = 1) and produce a 2D placement in mm:
 *   1. Scale to chord length (about LE at origin).
 *   2. Translate so the alignment pivot sits at x=0.
 *   3. Rotate by washout about that pivot.
 *   4. Apply sweep (x-shift) and rise (y-shift).
 *
 * The pivot at x=0 means root and tip are aligned by the chosen reference
 * (LE/quarter-chord/TE) before any extra sweep is applied.
 */
export function placePoints(points: Vec2[], opts: PlacementOpts): Vec2[] {
  const pivotX0 = pivotForAlignment(opts.chord, opts.alignment);
  const out: Vec2[] = new Array(points.length);
  const c = Math.cos(opts.washoutRad);
  const s = Math.sin(opts.washoutRad);
  const rise = opts.rise ?? 0;

  for (let i = 0; i < points.length; i++) {
    const np = points[i];
    const x0 = np.x * opts.chord;
    const y0 = np.y * opts.chord;
    const x1 = x0 - pivotX0;
    const y1 = y0;
    const x2 = x1 * c - y1 * s;
    const y2 = x1 * s + y1 * c;
    out[i] = { x: x2 + opts.sweep, y: y2 + rise };
  }
  return out;
}

/**
 * Convenience wrapper that preserves the source profile name on the output.
 */
export function placeProfile(p: Profile, opts: PlacementOpts): PlacedProfile {
  return {
    points: placePoints(p.points, opts),
    pivot: { x: 0, y: 0 },
    name: p.name,
  };
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
 * Dispatch resampling to either arc-length or chord-fraction.
 * Two profiles resampled with the same N and same mode produce paired
 * index-by-index sequences suitable for hot-wire constant-time sync.
 */
export function resampleProfile(points: Vec2[], n: number, mode: PairingMode): Vec2[] {
  return mode === 'chord-fraction'
    ? resampleByChordFraction(points, n)
    : resampleByArcLength(points, n);
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
 * Resample a Selig-ordered closed-loop airfoil at cosine-spaced chord
 * fractions on each surface independently. Output traversal order is
 * the same Selig convention (TE → upper → LE → lower → TE) and contains
 * exactly N points (the loop is closed by repeating the TE).
 *
 * Two profiles resampled this way pair point-i ↔ point-i at the same
 * x/c — i.e. wire stations that connect "the 60% chord point on root"
 * to "the 60% chord point on tip" regardless of how thick or cambered
 * each station happens to be.
 *
 * Cosine spacing is denser at LE and TE, sparser in the middle — the
 * standard distribution for airfoil panel methods (XFOIL, etc.).
 */
export function resampleByChordFraction(points: Vec2[], n: number): Vec2[] {
  if (points.length < 4) throw new Error('chord-fraction resample: too few points');
  if (n < 4) throw new Error('chord-fraction resample: n must be >= 4');

  const { upper, lower } = splitAtLE(points);

  const half = Math.max(2, Math.floor(n / 2));
  const fracs = new Array<number>(half);
  for (let i = 0; i < half; i++) {
    fracs[i] = 0.5 * (1 - Math.cos((i * Math.PI) / (half - 1)));
  }

  const out: Vec2[] = [];
  // Upper: TE (frac=1) → LE (frac=0). Walk fracs in reverse.
  for (let i = half - 1; i >= 0; i--) {
    const x = fracs[i];
    out.push({ x, y: interpolateYByX(upper, x) });
  }
  // Lower: skip frac=0 (LE, already added) → TE (frac=1).
  for (let i = 1; i < half; i++) {
    const x = fracs[i];
    out.push({ x, y: interpolateYByX(lower, x) });
  }
  // Close the loop with the TE point.
  out.push({ x: out[0].x, y: out[0].y });
  return out;
}

/** Split a Selig-ordered closed loop into upper (TE→LE) and lower (LE→TE). */
function splitAtLE(points: Vec2[]): { upper: Vec2[]; lower: Vec2[] } {
  let leIdx = 0;
  let minX = points[0].x;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x < minX) {
      minX = points[i].x;
      leIdx = i;
    }
  }
  const upper = points.slice(0, leIdx + 1);
  const lower = points.slice(leIdx);
  return { upper, lower };
}

/**
 * Linear-interpolate y at a given x along a surface that is monotonic in x
 * (not strictly enforced; tolerates small wobble). Falls back to nearest-x
 * if targetX lies just outside the surface range due to LE not sitting at
 * exactly x=0 in the source data.
 */
function interpolateYByX(surface: Vec2[], targetX: number): number {
  for (let i = 0; i < surface.length - 1; i++) {
    const a = surface[i];
    const b = surface[i + 1];
    const xLo = Math.min(a.x, b.x);
    const xHi = Math.max(a.x, b.x);
    if (targetX >= xLo - 1e-9 && targetX <= xHi + 1e-9) {
      const dx = b.x - a.x;
      if (Math.abs(dx) < 1e-12) return (a.y + b.y) * 0.5;
      const t = (targetX - a.x) / dx;
      return a.y + t * (b.y - a.y);
    }
  }
  // Outside range: return nearest by |Δx|.
  let bestIdx = 0;
  let bestDiff = Math.abs(surface[0].x - targetX);
  for (let i = 1; i < surface.length; i++) {
    const d = Math.abs(surface[i].x - targetX);
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  return surface[bestIdx].y;
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
