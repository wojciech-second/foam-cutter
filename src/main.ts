import { parseDat, profileSummary, type Profile } from './airfoil/parser.ts';
import { buildToolpath, type Toolpath } from './cam/toolpath.ts';
import type { Alignment, PairingMode } from './airfoil/transform.ts';
import {
  initScene,
  setBlock,
  setToolpath,
  setWireAtSampleIndex,
  rebuildCutSurface,
  resize,
  startRenderLoop,
  type SceneRefs,
} from './viz/scene.ts';

interface AppState {
  rootProfile: Profile | null;
  tipProfile: Profile | null;
  toolpath: Toolpath | null;
  scene: SceneRefs;
  playing: boolean;
  curT: number;
  lastFrameMs: number;
  scrubMax: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const setStatus = (msg: string, kind: 'ok' | 'err' = 'ok'): void => {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('err', kind === 'err');
};

function readInputs(): {
  rootChord: number;
  tipChord: number;
  span: number;
  sweep: number;
  washoutDeg: number;
  alignment: Alignment;
  pairing: PairingMode;
  blockX: number;
  blockY: number;
  blockZ: number;
  resampleN: number;
  kerf: number;
  feed: number;
  leadIn: number;
} {
  const num = (id: string): number => Number(($(id) as HTMLInputElement).value);
  const sel = (id: string): string => ($(id) as HTMLSelectElement).value;
  return {
    rootChord: num('root-chord'),
    tipChord: num('tip-chord'),
    span: num('span'),
    sweep: num('sweep'),
    washoutDeg: num('washout'),
    alignment: sel('alignment') as Alignment,
    pairing: sel('pairing') as PairingMode,
    blockX: num('block-x'),
    blockY: num('block-y'),
    blockZ: num('block-z'),
    resampleN: Math.max(40, Math.floor(num('resample-n'))),
    kerf: num('kerf'),
    feed: num('feed'),
    leadIn: num('leadin'),
  };
}

function rebuild(state: AppState): void {
  if (!state.rootProfile || !state.tipProfile) {
    setStatus('Load both root and tip .dat to begin.');
    return;
  }
  const cfg = readInputs();
  if (cfg.span <= 0 || cfg.rootChord <= 0 || cfg.tipChord <= 0) {
    setStatus('Span, root chord, and tip chord must be > 0.', 'err');
    return;
  }
  let tp: Toolpath;
  try {
    tp = buildToolpath(state.rootProfile, state.tipProfile, {
      rootChord: cfg.rootChord,
      tipChord: cfg.tipChord,
      span: cfg.span,
      sweep: cfg.sweep,
      washoutDeg: cfg.washoutDeg,
      alignment: cfg.alignment,
      pairing: cfg.pairing,
      kerf: cfg.kerf,
      resampleN: cfg.resampleN,
      leadInMm: cfg.leadIn,
      feedMmPerS: cfg.feed,
    });
  } catch (e) {
    setStatus(`Toolpath error: ${(e as Error).message}`, 'err');
    return;
  }
  state.toolpath = tp;
  setBlock(state.scene, { x: cfg.blockX, y: cfg.blockY, z: cfg.blockZ }, cfg.span);
  setToolpath(state.scene, tp);

  state.curT = 0;
  state.scrubMax = Number(($('scrub') as HTMLInputElement).max);
  ($('scrub') as HTMLInputElement).value = '0';
  setWireAtSampleIndex(state.scene, 0);
  rebuildCutSurface(state.scene, 0);
  updateTimeReadout(state);

  const summary =
    `Root: ${profileSummary(state.rootProfile)}\n` +
    `Tip:  ${profileSummary(state.tipProfile)}\n` +
    `Path: ${tp.samples.length} samples, t = ${tp.totalTimeS.toFixed(2)} s\n` +
    `      root ${tp.totalRootMm.toFixed(0)} mm, tip ${tp.totalTipMm.toFixed(0)} mm`;
  setStatus(summary);
}

function indexAtTime(samples: Toolpath['samples'], t: number): number {
  // Binary search for the largest i with samples[i].t <= t.
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function setSimTime(state: AppState, t: number): void {
  if (!state.toolpath) return;
  const total = state.toolpath.totalTimeS;
  const clamped = Math.max(0, Math.min(t, total));
  state.curT = clamped;
  const idx = indexAtTime(state.toolpath.samples, clamped);
  setWireAtSampleIndex(state.scene, idx);
  rebuildCutSurface(state.scene, idx);
  // Reflect into scrub slider unless the user is dragging it (we don't
  // distinguish here; this is harmless because we only call setSimTime from
  // either the slider's own input handler or the play loop).
  const scrub = $('scrub') as HTMLInputElement;
  scrub.value = String(Math.round((clamped / Math.max(total, 1e-6)) * state.scrubMax));
  updateTimeReadout(state);
}

function updateTimeReadout(state: AppState): void {
  const total = state.toolpath?.totalTimeS ?? 0;
  $('time-readout').textContent = `${state.curT.toFixed(2)} s / ${total.toFixed(2)} s`;
}

async function loadDatFile(input: HTMLInputElement): Promise<Profile | null> {
  if (!input.files || input.files.length === 0) return null;
  const file = input.files[0];
  const text = await file.text();
  return parseDat(text);
}

function wireUI(state: AppState): void {
  // File inputs
  ($('root-file') as HTMLInputElement).addEventListener('change', async (e) => {
    try {
      const p = await loadDatFile(e.target as HTMLInputElement);
      if (p) {
        state.rootProfile = p;
        $('root-name').textContent = p.name;
        rebuild(state);
      }
    } catch (err) {
      setStatus(`Root parse error: ${(err as Error).message}`, 'err');
    }
  });
  ($('tip-file') as HTMLInputElement).addEventListener('change', async (e) => {
    try {
      const p = await loadDatFile(e.target as HTMLInputElement);
      if (p) {
        state.tipProfile = p;
        $('tip-name').textContent = p.name;
        rebuild(state);
      }
    } catch (err) {
      setStatus(`Tip parse error: ${(err as Error).message}`, 'err');
    }
  });

  // Numeric/select inputs trigger a rebuild on change.
  const reactiveIds = [
    'root-chord', 'tip-chord', 'span', 'sweep', 'washout', 'alignment', 'pairing',
    'block-x', 'block-y', 'block-z', 'resample-n', 'kerf', 'feed', 'leadin',
  ];
  for (const id of reactiveIds) {
    $(id).addEventListener('change', () => rebuild(state));
  }

  // Playback
  $('play-btn').addEventListener('click', () => {
    state.playing = !state.playing;
    state.lastFrameMs = performance.now();
    $('play-btn').textContent = state.playing ? '❚❚ Pause' : '▶ Play';
    if (state.playing && state.toolpath && state.curT >= state.toolpath.totalTimeS - 1e-6) {
      setSimTime(state, 0);
    }
  });
  $('reset-btn').addEventListener('click', () => {
    state.playing = false;
    $('play-btn').textContent = '▶ Play';
    setSimTime(state, 0);
  });

  // Scrub
  ($('scrub') as HTMLInputElement).addEventListener('input', (e) => {
    if (!state.toolpath) return;
    state.playing = false;
    $('play-btn').textContent = '▶ Play';
    const v = Number((e.target as HTMLInputElement).value);
    const t = (v / state.scrubMax) * state.toolpath.totalTimeS;
    setSimTime(state, t);
  });

  // Resize
  window.addEventListener('resize', () => resize(state.scene, $('canvas-host')));
}

function startPlaybackLoop(state: AppState): void {
  const tick = (): void => {
    requestAnimationFrame(tick);
    if (!state.playing || !state.toolpath) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - state.lastFrameMs) / 1000);
    state.lastFrameMs = now;
    const next = state.curT + dt;
    setSimTime(state, next);
    if (next >= state.toolpath.totalTimeS) {
      state.playing = false;
      $('play-btn').textContent = '▶ Play';
    }
  };
  requestAnimationFrame(tick);
}

function main(): void {
  const host = $('canvas-host');
  const scene = initScene(host);
  startRenderLoop(scene);

  const state: AppState = {
    rootProfile: null,
    tipProfile: null,
    toolpath: null,
    scene,
    playing: false,
    curT: 0,
    lastFrameMs: performance.now(),
    scrubMax: 1000,
  };

  // Place a placeholder block so the empty state isn't a blank viewport.
  const cfg = readInputs();
  setBlock(scene, { x: cfg.blockX, y: cfg.blockY, z: cfg.blockZ }, cfg.span);

  wireUI(state);
  startPlaybackLoop(state);

  setStatus('Load root and tip .dat to begin.');
}

main();
