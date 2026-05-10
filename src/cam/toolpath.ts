import type { Vec2 } from '../geom/vec.ts';
import type { Profile } from '../airfoil/parser.ts';
import type {
  Alignment,
  PairingMode,
  PlacedProfile,
} from '../airfoil/transform.ts';
import {
  placePoints,
  resampleProfile,
  offsetOutward,
} from '../airfoil/transform.ts';

export interface ToolpathOpts {
  rootChord: number;
  tipChord: number;
  span: number;
  sweep: number;
  washoutDeg: number;
  alignment: Alignment;
  /** How root and tip are paired across the wire. */
  pairing: PairingMode;
  /** Outward kerf compensation per side (mm). */
  kerf: number;
  /** How many points per profile after resampling. */
  resampleN: number;
  /** Lead-in / lead-out length in chord (+X) direction (mm). */
  leadInMm: number;
  /** Cut feed rate in mm/s. */
  feedMmPerS: number;
}

export interface PathSample {
  /** Root tower X (mm). */
  x1: number;
  /** Root tower Y (mm). */
  y1: number;
  /** Tip tower X (mm). */
  x2: number;
  /** Tip tower Y (mm). */
  y2: number;
  /** Cumulative time in seconds (constant-time sync). */
  t: number;
}

export interface Toolpath {
  samples: PathSample[];
  rootPlaced: PlacedProfile;
  tipPlaced: PlacedProfile;
  /** Resampled and kerf-offset tower-plane points, for static preview. */
  rootCutPoints: Vec2[];
  tipCutPoints: Vec2[];
  totalTimeS: number;
  totalRootMm: number;
  totalTipMm: number;
}

const DEG2RAD = Math.PI / 180;

export function buildToolpath(
  root: Profile,
  tip: Profile,
  opts: ToolpathOpts,
): Toolpath {
  const washoutRad = opts.washoutDeg * DEG2RAD;

  // 1) Resample each NORMALIZED profile to a common N using the chosen
  //    pairing mode. Doing this in normalized space (chord = 1) makes
  //    chord-fraction pairing meaningful: it stays meaningful even after
  //    washout rotates the placed coordinates.
  const rootNorm = resampleProfile(root.points, opts.resampleN, opts.pairing);
  const tipNorm = resampleProfile(tip.points, opts.resampleN, opts.pairing);

  // 2) Place each station: scale → align → washout → sweep.
  const rootPts = placePoints(rootNorm, {
    chord: opts.rootChord,
    alignment: opts.alignment,
    washoutRad: 0,
    sweep: 0,
  });
  const tipPts = placePoints(tipNorm, {
    chord: opts.tipChord,
    alignment: opts.alignment,
    washoutRad,
    sweep: opts.sweep,
  });

  // PlacedProfile wrappers for status/diagnostics.
  const rootPlaced: PlacedProfile = {
    points: rootPts, pivot: { x: 0, y: 0 }, name: root.name,
  };
  const tipPlaced: PlacedProfile = {
    points: tipPts, pivot: { x: 0, y: 0 }, name: tip.name,
  };

  // 3) Outward kerf offset on each tower path.
  const rootK = offsetOutward(rootPts, opts.kerf);
  const tipK = offsetOutward(tipPts, opts.kerf);

  // Lead-in / lead-out: straight horizontal entry/exit from +X side at the
  // first profile point (which is TE for Selig-ordered .dat files).
  const rootSeq: Vec2[] = withLeads(rootK, opts.leadInMm);
  const tipSeq: Vec2[] = withLeads(tipK, opts.leadInMm);

  // Both sequences must have identical length to pair index-by-index.
  if (rootSeq.length !== tipSeq.length) {
    throw new Error(
      `Internal: paired sequences differ in length (${rootSeq.length} vs ${tipSeq.length})`,
    );
  }

  // Constant-time sync: each segment takes max(rootLen, tipLen) / feed.
  const samples: PathSample[] = new Array(rootSeq.length);
  let t = 0;
  let totalRoot = 0;
  let totalTip = 0;
  samples[0] = { x1: rootSeq[0].x, y1: rootSeq[0].y, x2: tipSeq[0].x, y2: tipSeq[0].y, t: 0 };

  for (let i = 1; i < rootSeq.length; i++) {
    const dRoot = Math.hypot(
      rootSeq[i].x - rootSeq[i - 1].x,
      rootSeq[i].y - rootSeq[i - 1].y,
    );
    const dTip = Math.hypot(
      tipSeq[i].x - tipSeq[i - 1].x,
      tipSeq[i].y - tipSeq[i - 1].y,
    );
    totalRoot += dRoot;
    totalTip += dTip;
    const dt = Math.max(dRoot, dTip) / Math.max(opts.feedMmPerS, 1e-3);
    t += dt;
    samples[i] = {
      x1: rootSeq[i].x,
      y1: rootSeq[i].y,
      x2: tipSeq[i].x,
      y2: tipSeq[i].y,
      t,
    };
  }

  return {
    samples,
    rootPlaced,
    tipPlaced,
    rootCutPoints: rootSeq,
    tipCutPoints: tipSeq,
    totalTimeS: t,
    totalRootMm: totalRoot,
    totalTipMm: totalTip,
  };
}

function withLeads(profile: Vec2[], leadInMm: number): Vec2[] {
  if (leadInMm <= 0) return profile;
  const start = profile[0];
  const end = profile[profile.length - 1];
  const leadStart: Vec2 = { x: start.x + leadInMm, y: start.y };
  const leadEnd: Vec2 = { x: end.x + leadInMm, y: end.y };
  return [leadStart, ...profile, leadEnd];
}
