/* =========================================================
   三维场景：柜体、货物、视角、装载动画
   three 坐标：X = 柜长（+X 为柜门），Y = 竖直，Z = 柜宽
   ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const view = {
  renderer: null, scene: null, camera: null, controls: null,
  containerGroup: null, cargoGroup: null, highlight: null,
  dims: { L: 1203.2, W: 235.2, H: 269.8 },
  meshes: [],          // 按装载序号索引：{ mesh, box, tx, ty, tz }
  current: 'iso',
  onFrame: null
};

const geoCache = new Map(), matCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) { const g = make(); g.__shared = true; geoCache.set(key, g); }
  return geoCache.get(key);
}
function mat(color) {
  if (!matCache.has(color)) {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.82, metalness: 0.02 });
    m.__shared = true;
    matCache.set(color, m);
  }
  return matCache.get(color);
}
const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 });
edgeMat.__shared = true;

export function init3D(canvas, stageEl) {
  const r = view.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = view.scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8ecf1);
  scene.fog = new THREE.Fog(0xe8ecf1, 2600, 5200);

  const cam = view.camera = new THREE.PerspectiveCamera(42, 1, 1, 20000);
  cam.position.set(900, 780, 1150);

  const ctl = view.controls = new OrbitControls(cam, r.domElement);
  ctl.enableDamping = true;
  ctl.dampingFactor = 0.075;
  ctl.minDistance = 120;
  ctl.maxDistance = 4200;
  ctl.maxPolarAngle = Math.PI * 0.495;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c2cc, 1.55));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(700, 1250, 820);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1000, right: 1000, top: 1000, bottom: -1000, near: 100, far: 3400 });
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.9;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdce8f5, 0.55);
  fill.position.set(-800, 600, -700);
  scene.add(fill);

  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.ShadowMaterial({ opacity: 0.16 }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = -0.4;
  shadowFloor.receiveShadow = true;
  scene.add(shadowFloor);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ color: 0xe3e8ee, roughness: 1, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.8;
  scene.add(floor);

  view.containerGroup = new THREE.Group();
  view.cargoGroup = new THREE.Group();
  scene.add(view.containerGroup, view.cargoGroup);

  const hl = view.highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0xff6b2c, transparent: true, opacity: 0.95, depthTest: false }));
  hl.renderOrder = 999;
  hl.visible = false;
  scene.add(hl);

  const resize = () => {
    const w = stageEl.clientWidth, h = stageEl.clientHeight;
    if (!w || !h) return;
    r.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stageEl);
  resize();

  const loop = now => {
    requestAnimationFrame(loop);
    ctl.update();
    if (view.onFrame) view.onFrame(now);
    r.render(scene, cam);
  };
  requestAnimationFrame(loop);
}

function clearGroup(g) {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const ch = g.children[i];
    g.remove(ch);
    ch.traverse(o => {
      if (o.geometry && !o.geometry.__shared) o.geometry.dispose();
      if (o.material && !o.material.__shared && o.material.dispose) o.material.dispose();
    });
  }
}

/* ---------- 柜体：底板、地网、半透明侧壁、框线、柜门 ---------- */
export function buildContainer(c) {
  const { L, W, H } = c;
  view.dims = { L, W, H };
  const g = view.containerGroup;
  clearGroup(g);

  const base = new THREE.Mesh(new THREE.BoxGeometry(L, 1.2, W),
    new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.92, metalness: 0.08 }));
  base.position.y = -0.6;
  base.receiveShadow = true;
  g.add(base);

  const grid = new THREE.GridHelper(Math.max(L, W) * 1.6, 30, 0xc3ccd6, 0xd8dfe7);
  grid.position.y = 0.05;
  g.add(grid);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xc3ccd6, transparent: true, opacity: 0.1,
    side: THREE.DoubleSide, roughness: 1, depthWrite: false });
  const left = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
  left.position.set(0, H / 2, -W / 2);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
  right.position.set(0, H / 2, W / 2);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
  back.position.set(-L / 2, H / 2, 0);
  back.rotation.y = Math.PI / 2;
  g.add(left, right, back);

  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)),
    new THREE.LineBasicMaterial({ color: 0x7d8b99, transparent: true, opacity: 0.85 }));
  frame.position.y = H / 2;
  g.add(frame);

  // 柜门：外框 + 中缝 + 上下横梁
  const hw = W / 2, t = 5;
  const pts = [0, 0, -hw, 0, 0, hw, 0, 0, hw, 0, H, hw, 0, H, hw, 0, H, -hw, 0, H, -hw, 0, 0, -hw,
               0, 0, 0, 0, H, 0, 0, t, -hw, 0, t, hw, 0, H - t, -hw, 0, H - t, hw];
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const door = new THREE.LineSegments(dg, new THREE.LineBasicMaterial({ color: 0x5b6b7a, transparent: true, opacity: 0.9 }));
  door.position.x = L / 2;
  g.add(door);
}

/* ---------- 货物网格 ---------- */
export function buildCargo(placed) {
  const { L, W } = view.dims;
  clearGroup(view.cargoGroup);
  view.meshes = [];
  const withEdge = placed.length <= 1400;
  for (const b of placed) {
    let mesh, edge = null;
    const d = b.diag;
    if (b.shape === 'cyl' && b.cylR > 0) {
      const r = b.cylR;
      const len = d ? (d.cylVert ? d.lz : d.lx) : (b.cylAxis === 0 ? b.dx : b.cylAxis === 1 ? b.dy : b.dz);
      mesh = new THREE.Mesh(cached('c' + r + '_' + len, () => new THREE.CylinderGeometry(r, r, len, 26, 1)), mat(b.color));
      if (withEdge) edge = cached('ce' + r + '_' + len, () => new THREE.EdgesGeometry(new THREE.CylinderGeometry(r, r, len, 26, 1), 40));
      if (d) { mesh.rotation.order = 'YXZ'; mesh.rotation.set(0, -d.th, d.cylVert ? 0 : Math.PI / 2); }
      else if (b.cylAxis === 0) mesh.rotation.z = Math.PI / 2;
      else if (b.cylAxis === 1) mesh.rotation.x = Math.PI / 2;
    } else if (b.shape === 'sphere' && b.cylR > 0) {
      const r = b.cylR;
      mesh = new THREE.Mesh(cached('s' + r, () => new THREE.SphereGeometry(r, 22, 16)), mat(b.color));
      if (withEdge) edge = cached('se' + r, () => new THREE.EdgesGeometry(new THREE.SphereGeometry(r, 12, 6), 1));
    } else {
      const sx = d ? d.lx : b.dx, sy = d ? d.ly : b.dy, sz = d ? d.lz : b.dz;
      const k = sx + '_' + sy + '_' + sz;
      mesh = new THREE.Mesh(cached('b' + k, () => new RoundedBoxGeometry(sx, sz, sy, 2, Math.min(3, Math.min(sx, sy, sz) * 0.06))), mat(b.color));
      if (withEdge) edge = cached('be' + k, () => new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sz, sy)));
      if (d) mesh.rotation.y = -d.th;
    }
    mesh.position.set(b.x + b.dx / 2 - L / 2, b.z + b.dz / 2, b.y + b.dy / 2 - W / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData = b;
    if (edge) mesh.add(new THREE.LineSegments(edge, edgeMat));
    view.cargoGroup.add(mesh);
    view.meshes[b.seq] = { mesh, box: b, tx: mesh.position.x, ty: mesh.position.y, tz: mesh.position.z };
  }
}

export function clearCargo() { clearGroup(view.cargoGroup); view.meshes = []; }

function fitFactor() {
  const ar = view.camera.aspect || 1.6;
  return ar >= 1.45 ? 1 : Math.min(2.15, Math.pow(1.45 / ar, 0.85));
}

/* ---------- 视角 ---------- */
export function setView(v) {
  const { L, W, H } = view.dims, f = fitFactor();
  const tgt = new THREE.Vector3(0, H * 0.36, 0);
  view.controls.target.copy(tgt);
  const cam = view.camera;
  if (v === 'door') cam.position.set(L * 1.15 * f, H * 0.72 * f, 0.1);
  else if (v === 'side') cam.position.set(0, H * 0.65 * f, W * 3.4 * f);
  else if (v === 'top') cam.position.set(0.1, Math.max(L, H) * 1.55 * f, 0.1);
  else cam.position.set(L * 0.95 * f, H * 2.1 * f, W * 2.6 * f);
  cam.lookAt(tgt);
  view.controls.update();
  view.current = v;
}

/** 播放动画时：站在柜门外斜看，能同时看到门口和正在推进的货 */
export function setPlayView() {
  const { L, W, H } = view.dims, f = fitFactor();
  const tgt = new THREE.Vector3(0, H * 0.34, 0);
  view.controls.target.copy(tgt);
  view.camera.position.set(L / 2 + 120 * f, H * 1.3 * f, W * 1.95 * f);
  view.camera.lookAt(tgt);
  view.controls.update();
}

/** 可见性：装载进度 + 分层过滤 */
export function applyVisibility(shown, layerMax) {
  for (const o of view.cargoGroup.children) {
    const b = o.userData || {};
    let vis = b.seq == null || b.seq <= shown;
    if (vis && layerMax != null && b.layer != null) vis = b.layer <= layerMax;
    o.visible = vis;
  }
}

/* ---------- 推入动画：柜门外 → 沿柜长推进 → 末端轻放 ---------- */
const PUSH_MS = 460;
const tweens = [];
export function pushIn(seq, now) {
  const it = view.meshes[seq];
  if (!it) return;
  it.mesh.position.set(view.dims.L / 2 + 230, it.ty + 8, it.tz);
  tweens.push({ it, t0: now });
}
export function resetPositions() {
  tweens.length = 0;
  for (const it of view.meshes) if (it) it.mesh.position.set(it.tx, it.ty, it.tz);
}
export function tickTweens(now) {
  const x0 = view.dims.L / 2 + 230;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const { it, t0 } = tweens[i], m = it.mesh;
    const p = Math.max(0, (now - t0) / PUSH_MS);
    if (p >= 1) { m.position.set(it.tx, it.ty, it.tz); tweens.splice(i, 1); continue; }
    const k = Math.min(1, p / 0.72);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const s = Math.max(0, (p - 0.72) / 0.28);
    m.position.set(x0 + (it.tx - x0) * e, it.ty + (1 - s) * (1 - s) * 8, it.tz);
  }
}

/** 当前装载件的橙色高亮框 */
export function setHighlight(seq, total) {
  const hl = view.highlight, it = view.meshes[seq];
  if (!it || seq <= 0 || seq >= total) { hl.visible = false; return; }
  const b = it.box, { L, W } = view.dims;
  hl.position.set(b.x + b.dx / 2 - L / 2, b.z + b.dz / 2, b.y + b.dy / 2 - W / 2);
  if (b.diag) { hl.rotation.y = -b.diag.th; hl.scale.set(b.diag.lx * 1.05, b.diag.lz * 1.05, b.diag.ly * 1.05); }
  else { hl.rotation.y = 0; hl.scale.set(b.dx * 1.05, b.dz * 1.05, b.dy * 1.05); }
  hl.visible = true;
}

export function setShellVisible(on) { view.containerGroup.visible = on; }
