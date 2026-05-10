import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Toolpath } from '../cam/toolpath.ts';

export interface BlockDims {
  x: number;
  y: number;
  z: number;
}

export interface SceneRefs {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  group: THREE.Group;
  block: THREE.Object3D | null;
  rootTowerPath: THREE.Line | null;
  tipTowerPath: THREE.Line | null;
  wire: THREE.Line;
  wireGlow: THREE.Line;
  cutSurface: THREE.Mesh | null;
  rootMarker: THREE.Mesh;
  tipMarker: THREE.Mesh;
  toolpath: Toolpath | null;
  spanMm: number;
  blockDims: BlockDims;
  blockOffsetZ: number;
}

export function initScene(host: HTMLElement): SceneRefs {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06080b);

  const camera = new THREE.PerspectiveCamera(
    45,
    host.clientWidth / Math.max(host.clientHeight, 1),
    1,
    10000,
  );
  camera.position.set(700, 400, 900);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 300);

  // Lights
  const hemi = new THREE.HemisphereLight(0xc8d4ff, 0x202028, 0.7);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(400, 800, 400);
  scene.add(dir);

  // Ground grid (X-Z plane)
  const grid = new THREE.GridHelper(2000, 40, 0x2a313d, 0x1a1f28);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.y = -200;
  scene.add(grid);

  // Origin axes for orientation
  const axes = new THREE.AxesHelper(60);
  scene.add(axes);

  const group = new THREE.Group();
  scene.add(group);

  // Wire — bright orange, with a subtle outer glow line behind it.
  const wireGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 1),
  ]);
  const wireMat = new THREE.LineBasicMaterial({ color: 0xffb05a, linewidth: 2 });
  const wire = new THREE.Line(wireGeom, wireMat);
  scene.add(wire);

  const glowGeom = wireGeom.clone();
  const glowMat = new THREE.LineBasicMaterial({
    color: 0xff5a30,
    transparent: true,
    opacity: 0.35,
  });
  const wireGlow = new THREE.Line(glowGeom, glowMat);
  scene.add(wireGlow);

  // Wire-end markers
  const markerGeom = new THREE.SphereGeometry(4, 16, 12);
  const rootMarker = new THREE.Mesh(
    markerGeom,
    new THREE.MeshBasicMaterial({ color: 0xff7a45 }),
  );
  const tipMarker = new THREE.Mesh(
    markerGeom,
    new THREE.MeshBasicMaterial({ color: 0xff7a45 }),
  );
  scene.add(rootMarker);
  scene.add(tipMarker);

  return {
    scene,
    camera,
    renderer,
    controls,
    group,
    block: null,
    rootTowerPath: null,
    tipTowerPath: null,
    wire,
    wireGlow,
    cutSurface: null,
    rootMarker,
    tipMarker,
    toolpath: null,
    spanMm: 0,
    blockDims: { x: 0, y: 0, z: 0 },
    blockOffsetZ: 0,
  };
}

export function setBlock(refs: SceneRefs, dims: BlockDims, span: number): void {
  if (refs.block) {
    refs.group.remove(refs.block);
    disposeNode(refs.block);
  }
  refs.spanMm = span;
  refs.blockDims = dims;
  refs.blockOffsetZ = (span - dims.z) / 2;

  const blockGroup = new THREE.Group();
  const geom = new THREE.BoxGeometry(dims.x, dims.y, dims.z);
  const mat = new THREE.MeshPhongMaterial({
    color: 0xefe6d4,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(0, 0, refs.blockOffsetZ + dims.z / 2);
  blockGroup.add(mesh);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geom),
    new THREE.LineBasicMaterial({ color: 0xb5a98a, transparent: true, opacity: 0.7 }),
  );
  edges.position.copy(mesh.position);
  blockGroup.add(edges);

  // Tower planes — faint quads showing where each carriage operates.
  const towerSize = Math.max(dims.x, dims.y) * 1.6;
  const towerGeom = new THREE.PlaneGeometry(towerSize, towerSize);
  const towerMat = new THREE.MeshBasicMaterial({
    color: 0x2a3848,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const rootPlane = new THREE.Mesh(towerGeom, towerMat);
  rootPlane.rotation.y = Math.PI / 2;
  rootPlane.position.set(0, 0, 0);
  blockGroup.add(rootPlane);
  const tipPlane = new THREE.Mesh(towerGeom, towerMat.clone());
  tipPlane.rotation.y = Math.PI / 2;
  tipPlane.position.set(0, 0, span);
  blockGroup.add(tipPlane);

  refs.block = blockGroup;
  refs.group.add(blockGroup);
}

export function setToolpath(refs: SceneRefs, tp: Toolpath): void {
  refs.toolpath = tp;

  if (refs.rootTowerPath) {
    refs.group.remove(refs.rootTowerPath);
    disposeNode(refs.rootTowerPath);
  }
  if (refs.tipTowerPath) {
    refs.group.remove(refs.tipTowerPath);
    disposeNode(refs.tipTowerPath);
  }

  const rootPts = tp.rootCutPoints.map((p) => new THREE.Vector3(p.x, p.y, 0));
  const tipPts = tp.tipCutPoints.map(
    (p) => new THREE.Vector3(p.x, p.y, refs.spanMm),
  );

  const pathMat = new THREE.LineBasicMaterial({
    color: 0x9ad0c2,
    transparent: true,
    opacity: 0.85,
  });
  refs.rootTowerPath = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(rootPts),
    pathMat,
  );
  refs.tipTowerPath = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(tipPts),
    pathMat.clone(),
  );
  refs.group.add(refs.rootTowerPath);
  refs.group.add(refs.tipTowerPath);

  // Initialize the cut surface mesh empty; samplesUpTo will fill it.
  if (refs.cutSurface) {
    refs.group.remove(refs.cutSurface);
    disposeNode(refs.cutSurface);
  }
  const cutGeom = new THREE.BufferGeometry();
  const cutMat = new THREE.MeshPhongMaterial({
    color: 0xe07a5f,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
    flatShading: true,
  });
  refs.cutSurface = new THREE.Mesh(cutGeom, cutMat);
  refs.group.add(refs.cutSurface);

  // Frame the camera on the new geometry.
  fitCamera(refs);
  // Show the wire and markers at the start position.
  setWireAtSampleIndex(refs, 0);
  rebuildCutSurface(refs, 0);
}

export function setWireAtSampleIndex(refs: SceneRefs, idx: number): void {
  if (!refs.toolpath) return;
  const s = refs.toolpath.samples[Math.max(0, Math.min(idx, refs.toolpath.samples.length - 1))];
  const a = new THREE.Vector3(s.x1, s.y1, 0);
  const b = new THREE.Vector3(s.x2, s.y2, refs.spanMm);
  updateLineGeometry(refs.wire, [a, b]);
  updateLineGeometry(refs.wireGlow, [a, b]);
  refs.rootMarker.position.copy(a);
  refs.tipMarker.position.copy(b);
}

/**
 * Build a triangle strip representing the cut surface from sample 0 up to
 * (and including) `endIdx`. Each pair of adjacent samples adds a quad
 * (two triangles) connecting root-end to tip-end.
 */
export function rebuildCutSurface(refs: SceneRefs, endIdx: number): void {
  if (!refs.toolpath || !refs.cutSurface) return;
  const samples = refs.toolpath.samples;
  const n = Math.max(0, Math.min(endIdx, samples.length - 1));
  if (n < 1) {
    refs.cutSurface.geometry.dispose();
    refs.cutSurface.geometry = new THREE.BufferGeometry();
    return;
  }

  const positions = new Float32Array(n * 6 * 3); // 2 triangles per quad, 3 verts each, 3 coords
  let p = 0;
  for (let i = 0; i < n; i++) {
    const a0 = samples[i];
    const a1 = samples[i + 1];
    // Quad corners: a0-root, a0-tip, a1-tip, a1-root
    const r0x = a0.x1, r0y = a0.y1, r0z = 0;
    const t0x = a0.x2, t0y = a0.y2, t0z = refs.spanMm;
    const r1x = a1.x1, r1y = a1.y1, r1z = 0;
    const t1x = a1.x2, t1y = a1.y2, t1z = refs.spanMm;

    // Tri 1: r0, t0, r1
    positions[p++] = r0x; positions[p++] = r0y; positions[p++] = r0z;
    positions[p++] = t0x; positions[p++] = t0y; positions[p++] = t0z;
    positions[p++] = r1x; positions[p++] = r1y; positions[p++] = r1z;
    // Tri 2: t0, t1, r1
    positions[p++] = t0x; positions[p++] = t0y; positions[p++] = t0z;
    positions[p++] = t1x; positions[p++] = t1y; positions[p++] = t1z;
    positions[p++] = r1x; positions[p++] = r1y; positions[p++] = r1z;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  refs.cutSurface.geometry.dispose();
  refs.cutSurface.geometry = geom;
}

export function resize(refs: SceneRefs, host: HTMLElement): void {
  const w = host.clientWidth;
  const h = Math.max(host.clientHeight, 1);
  refs.camera.aspect = w / h;
  refs.camera.updateProjectionMatrix();
  refs.renderer.setSize(w, h);
}

export function startRenderLoop(refs: SceneRefs): void {
  const tick = (): void => {
    refs.controls.update();
    refs.renderer.render(refs.scene, refs.camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function fitCamera(refs: SceneRefs): void {
  const bbox = new THREE.Box3();
  refs.group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh || (obj as THREE.Line).isLine) {
      bbox.expandByObject(obj);
    }
  });
  if (bbox.isEmpty()) return;
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.9 + 100;
  refs.controls.target.copy(center);
  refs.camera.position.set(center.x + radius * 0.6, center.y + radius * 0.4, center.z + radius * 1.1);
  refs.camera.near = 1;
  refs.camera.far = radius * 20;
  refs.camera.updateProjectionMatrix();
}

function updateLineGeometry(line: THREE.Line, pts: THREE.Vector3[]): void {
  const arr = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    arr[i * 3 + 0] = pts[i].x;
    arr[i * 3 + 1] = pts[i].y;
    arr[i * 3 + 2] = pts[i].z;
  }
  line.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  line.geometry = g;
}

function disposeNode(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const m = child as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (mat) {
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat.dispose();
    }
  });
}
