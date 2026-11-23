/* =========================================================
   智装柜 · 自定义装载（拖拽装柜）· 界面与交互
   基于原站 app.js：同一套 packer.js / smart.js / scene.js / geom.js / importer.js
   ========================================================= */
import * as Packer from './packer.js';
import { smartPackPlan } from './smart.js';
import { finalize } from './packer.js';
import * as V from './scene.js';
import { parseDelimited, rowsToItems, readFileRows, templateRows } from './importer.js';
import * as THREE from 'three';
import { SpaceIndex, collides, supportRatio, dropZ, orientations, poseLabel, cylAxisOf, normDims, shapeOf } from './geom.js';

/* ---------- 柜型（内尺寸 cm / 限重 kg） ---------- */
const CONTAINERS = {
  '20GP': { name: '20GP', L: 589.8, W: 235.2, H: 239.3, payload: 28200, label: '20尺普柜' },
  '40GP': { name: '40GP', L: 1203.2, W: 235.2, H: 239.3, payload: 26500, label: '40尺普柜' },
  '40HQ': { name: '40HQ', L: 1203.2, W: 235.2, H: 269.8, payload: 26500, label: '40尺高柜' },
  '45HQ': { name: '45HQ', L: 1355.6, W: 235.2, H: 269.8, payload: 27600, label: '45尺高柜' },
  'CUSTOM': { name: '自定义', L: 1203.2, W: 235.2, H: 269.8, payload: 26500, label: '自定义柜', custom: true }
};
const PALETTE = ['#c98a4b', '#4b8bc9', '#5aa87a', '#b06a9e', '#c9a34b', '#7a7ac9', '#c96b5a', '#4ba3a8', '#9a8a6a', '#8a9ac9'];

const PRESETS = {
  daily: { label: '日用品纸箱', items: [
    { name: '纸箱 A 60×40×50', l: 60, w: 40, h: 50, qty: 150, weight: 12 },
    { name: '纸箱 B 50×35×40', l: 50, w: 35, h: 40, qty: 90, weight: 8 }] },
  odd: { label: '异形混装（方·圆·圆柱）', items: [
    { name: '纸箱 60×40×40', l: 60, w: 40, h: 40, qty: 90, weight: 10 },
    { name: '圆桶 ⌀60×90', l: 90, w: 60, h: 60, qty: 40, weight: 25, shape: 'cyl' },
    { name: '卷材 ⌀80×120', l: 120, w: 80, h: 80, qty: 16, weight: 180, shape: 'cyl', pose: 'flat' },
    { name: '圆盘件 ⌀70×25', l: 25, w: 70, h: 70, qty: 30, weight: 35, shape: 'cyl', pose: 'flat' },
    { name: '长条件 320×30×30', l: 320, w: 30, h: 30, qty: 26, weight: 22 }] },
  furniture: { label: '家具大件', items: [
    { name: '沙发 200×90×85', l: 200, w: 90, h: 85, qty: 12, weight: 45, rotate: false, pose: 'flat' },
    { name: '衣柜 180×60×200', l: 180, w: 60, h: 200, qty: 8, weight: 70, rotate: false, pose: 'upright' },
    { name: '茶几 120×70×45', l: 120, w: 70, h: 45, qty: 14, weight: 25 }] },
  machinery: { label: '机械重货（超重演示）', items: [
    { name: '木箱机械 120×100×110', l: 120, w: 100, h: 110, qty: 30, weight: 900, rotate: false },
    { name: '配件箱 80×60×60', l: 80, w: 60, h: 60, qty: 30, weight: 95 }] },
  user180: { label: '默认货物 180件', items: [
    { name: '木箱 120×100×110', l: 120, w: 100, h: 110, qty: 30, weight: 65, rotate: false },
    { name: '纸箱 60×40×40', l: 60, w: 40, h: 40, qty: 120, weight: 10 },
    { name: '长条件 200×30×30', l: 200, w: 30, h: 30, qty: 30, weight: 18 }] },
  mixed: { label: '原站默认 166件', items: [
    { name: '纸箱 60×40×40', l: 60, w: 40, h: 40, qty: 120, weight: 10 },
    { name: '托盘货 110×110×120', l: 110, w: 110, h: 120, qty: 16, weight: 380, rotate: false },
    { name: '长条件 200×30×30', l: 200, w: 30, h: 30, qty: 30, weight: 18 }] }
};

const SHAPES = [['box', '方箱'], ['cyl', '圆柱/卷'], ['sphere', '圆形件']];
const POSES = [['auto', '自动·装最多'], ['flat', '平放'], ['upright', '竖放'], ['side', '侧立']];
const SHAPE_CN = { box: '方箱', cyl: '圆柱', sphere: '圆形件' };

const PLAN_KEY = 'zhuanggui.custom.plan.v1';  // 自定义页单独存档，不与首页互串
const CUST_KEY = 'zhuanggui.custombox.v1';

const state = { container: '40HQ', items: [], result: null, seq: 0 };
const ui = { layerMode: false, layerShown: 1, totalLayers: 1, orderOpen: false, shellOn: true, exporting: false };
const anim = { playing: false, shown: 0, total: 0, speed: 1, perBox: 260, acc: 0, last: 0 };
/* 拖拽装柜 + 逐件上柜的状态 */
const drag = { enabled: true, active: false, box: null, mesh: null, orig: null, nx: null, ny: null, moved: false };
const history = [];  // 撤销栈：每次改动前存一份 placed 快照（最多 30 步）

/* ---------- 小工具 ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n1 = v => Math.round(v * 10) / 10;
const dimTxt = c => n1(c.L) + '×' + n1(c.W) + '×' + n1(c.H);
const cbmTxt = c => (c.L * c.W * c.H / 1e6).toFixed(1);
const fmt = n => n.toLocaleString('zh-CN');
const pctTxt = v => Math.abs(v * 100).toFixed(1) + '%';
const today = () => new Date().toISOString().slice(0, 10);
const box = () => CONTAINERS[state.container];

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('on'), 3200);
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
function csvBlob(rows) {
  const text = '\ufeff' + rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  return new Blob([text], { type: 'text/csv;charset=utf-8' });
}

function newItem(patch) {
  state.seq++;
  return Object.assign({
    id: 'i' + state.seq, name: '货物 ' + state.seq,
    l: 60, w: 40, h: 40, qty: 10, weight: 10,
    rotate: true, noStack: false, shape: 'box', pose: 'auto', diagOk: true,
    color: PALETTE[(state.seq - 1) % PALETTE.length]
  }, patch || {});
}

/* =========================================================
   柜型 & 自定义柜
   ========================================================= */
function renderTypes() {
  const cu = CONTAINERS.CUSTOM;
  $('#types').innerHTML = Object.keys(CONTAINERS).filter(k => !CONTAINERS[k].custom).map(k => {
    const c = CONTAINERS[k];
    return `<button class="type ${k === state.container ? 'on' : ''}" data-k="${k}" title="${c.label} · 内尺寸 ${dimTxt(c)} cm"><b>${c.name}</b><span>${cbmTxt(c)} m³</span></button>`;
  }).join('') +
  `<button class="type custom ${state.container === 'CUSTOM' ? 'on' : ''}" data-k="CUSTOM" title="输入柜内长宽高，模拟开顶柜 / 框架柜 / 铁路箱 / 特种柜"><b>自定义</b><span>${dimTxt(cu)} cm · ${cbmTxt(cu)} m³</span><i class="gear">⚙</i></button>`;
}

function switchContainer(k) {
  state.container = k;
  renderTypes();
  V.buildContainer(box());
  setLayerMode(false);
  repack(true);
}

function loadCustomBox() {
  try {
    const o = JSON.parse(localStorage.getItem(CUST_KEY) || 'null');
    if (o && +o.L > 0) Object.assign(CONTAINERS.CUSTOM, { L: +o.L, W: +o.W, H: +o.H, payload: +o.payload >= 0 ? +o.payload : 26500 });
  } catch (e) { /* 忽略 */ }
}
function saveCustomBox() {
  const c = CONTAINERS.CUSTOM;
  try { localStorage.setItem(CUST_KEY, JSON.stringify({ L: c.L, W: c.W, H: c.H, payload: c.payload })); } catch (e) { /* 忽略 */ }
}

function openCust() {
  const c = CONTAINERS.CUSTOM;
  $('#custL').value = n1(c.L); $('#custW').value = n1(c.W); $('#custH').value = n1(c.H); $('#custP').value = c.payload;
  setMsg('#custMsg', '');
  $('#custModal').classList.add('show');
  setTimeout(() => $('#custL').focus(), 60);
}
const closeCust = () => $('#custModal').classList.remove('show');

function applyCust() {
  const L = parseFloat($('#custL').value), W = parseFloat($('#custW').value),
        H = parseFloat($('#custH').value), P = parseFloat($('#custP').value);
  const bad = [];
  if (!(L >= 100 && L <= 2000)) bad.push('内长需 100–2000cm');
  if (!(W >= 100 && W <= 400)) bad.push('内宽需 100–400cm');
  if (!(H >= 100 && H <= 450)) bad.push('内高需 100–450cm');
  if (!(P >= 0 && P <= 60000)) bad.push('限重需 0–60000kg');
  if (bad.length) { setMsg('#custMsg', bad.join('；'), 'bad'); return; }
  Object.assign(CONTAINERS.CUSTOM, { L: n1(L), W: n1(W), H: n1(H), payload: Math.round(P || 0) });
  saveCustomBox();
  closeCust();
  switchContainer('CUSTOM');
  toast('已应用自定义柜 ' + dimTxt(CONTAINERS.CUSTOM) + 'cm · ' + cbmTxt(CONTAINERS.CUSTOM) + ' m³');
}

function setMsg(sel, text, cls) {
  const el = $(sel);
  el.textContent = text || '';
  el.className = 'imp-msg' + (cls ? ' ' + cls : '');
}

/* =========================================================
   货物清单
   ========================================================= */
function itemCard(it) {
  const sh = it.shape || 'box';
  const lLbl = sh === 'sphere' ? '直径 cm' : sh === 'cyl' ? '长度 cm' : '长 cm';
  const wLbl = sh === 'box' ? '宽 cm' : '直径 cm';
  const opt = (list, cur) => list.map(([v, t]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${t}</option>`).join('');
  return `<div class="item" data-id="${it.id}">
    <div class="item-head">
      <span class="swatch" style="background:${it.color}"></span>
      <input class="nm" data-f="name" value="${esc(it.name)}">
      <button class="del" title="删除">×</button>
    </div>
    <div class="grid3">
      <div class="fld"><label>${lLbl}</label><input type="number" data-f="l" value="${it.l}" min="1" step="1"></div>
      <div class="fld"><label>${wLbl}</label><input type="number" data-f="w" value="${it.w}" min="1" step="1"${sh === 'sphere' ? ' disabled' : ''}></div>
      <div class="fld"><label>高 cm</label><input type="number" data-f="h" value="${it.h}" min="1" step="1"${sh !== 'box' ? ' disabled' : ''}></div>
    </div>
    <div class="grid3 two">
      <div class="fld"><label>件数</label><input type="number" data-f="qty" value="${it.qty}" min="1" step="1"></div>
      <div class="fld"><label>单重 kg</label><input type="number" data-f="weight" value="${it.weight}" min="0" step="0.5"></div>
    </div>
    <div class="row2">
      <div class="fld"><label>形状</label><select data-f="shape">${opt(SHAPES, sh)}</select></div>
      <div class="fld"><label>摆放</label><select data-f="pose">${opt(POSES, it.pose || 'auto')}</select></div>
    </div>
    <div class="chips">
      <div class="chip${it.rotate ? ' on' : ''}" data-t="rotate">可翻转</div>
      <div class="chip${it.noStack ? ' on neg' : ''}" data-t="noStack">不可堆叠</div>
      <div class="chip${it.diagOk !== false ? ' on' : ''}" data-t="diagOk">允许斜放</div>
    </div>
  </div>`;
}

function renderItems() { $('#items').innerHTML = state.items.map(itemCard).join(''); }

function bindItems() {
  const el = $('#items');
  const itemOf = node => { const row = node.closest('.item'); return row && state.items.find(x => x.id === row.dataset.id); };
  const onField = e => {
    const f = e.target.dataset.f, it = itemOf(e.target);
    if (!f || !it) return;
    if (f === 'name') it.name = e.target.value;
    else if (f === 'shape' || f === 'pose') {
      if (it[f] === e.target.value) return;
      it[f] = e.target.value;
      if (f === 'shape') renderItems();          // 标签（长/直径）随形状变
    } else it[f] = Math.max(0, Number(e.target.value) || 0);
    schedulePack();
  };
  el.addEventListener('input', onField);
  el.addEventListener('change', onField);
  el.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip) {
      const it = itemOf(chip), f = chip.dataset.t;
      it[f] = f === 'diagOk' ? it.diagOk === false : !it[f];
      chip.classList.toggle('on', !!it[f]);
      if (f === 'noStack') chip.classList.toggle('neg', !!it[f]);
      schedulePack();
      return;
    }
    const del = e.target.closest('.del');
    if (del) {
      const it = itemOf(del);
      state.items = state.items.filter(x => x !== it);
      renderItems();
      repack(true);
    }
  });
}

function renderPresets() {
  $('#presets').innerHTML = Object.keys(PRESETS).map(k => `<button class="preset" data-p="${k}">${PRESETS[k].label}</button>`).join('');
}
function loadPreset(k) {
  state.items = PRESETS[k].items.map(x => newItem(x));
  renderItems();
}

/* =========================================================
   排柜
   ========================================================= */
let packTimer = 0;
function schedulePack() {
  clearTimeout(packTimer);
  packTimer = setTimeout(() => repack(false), 320);
}

function validItems() {
  return state.items.filter(it => it.qty > 0 && it.l > 0 && it.w > 0 && it.h > 0).map(it => ({
    id: it.id, name: it.name, l: +it.l, w: +it.w, h: +it.h, qty: +it.qty, weight: +it.weight || 0,
    rotate: it.rotate !== false, noStack: !!it.noStack, color: it.color,
    shape: it.shape || 'box', pose: it.pose || 'auto', diagOk: it.diagOk !== false
  }));
}

function showResult(res, autoplay, perBoxMin) {
  state.result = res;
  $('#empty3d').style.display = res.placed.length ? 'none' : 'flex';
  V.buildCargo(res.placed);
  ui.totalLayers = Math.max(1, res.stats.layers);
  ui.layerShown = ui.totalLayers;
  const rg = $('#layerRange');
  rg.max = ui.totalLayers; rg.value = ui.totalLayers;
  $('#layerTxt').textContent = '全部（' + ui.totalLayers + ' 层）';

  anim.total = res.placed.length;
  anim.perBox = Math.max(perBoxMin, Math.min(260, 9000 / Math.max(1, anim.total)));
  anim.playing = false; anim.acc = 0; anim.last = 0;
  anim.shown = autoplay ? 0 : anim.total;
  V.resetPositions();
  refreshVisibility();
  updateStats(res);
  saveLocal();
  renderOrderPanel();
  renderPending();
  if (autoplay && anim.total) anim.playing = true;
  updatePlayUI();
}

function repack(fit, autoplay) {
  const items = validItems();
  if (!items.length) {
    state.result = null;
    V.clearCargo();
    Object.assign(anim, { total: 0, shown: 0, playing: false });
    $('#empty3d').style.display = 'flex';
    updateStats(null);
    updatePlayUI();
    renderOrderPanel();
    renderPending();
    saveLocal();
    return;
  }
  const c = box();
  const t0 = performance.now();
  const res = Packer.pack({ L: c.L, W: c.W, H: c.H, payload: c.payload, items, minSupport: 0.88 });
  res.stats.ms = Math.round(performance.now() - t0);
  showResult(res, autoplay, 110);
  if (fit) V.setView(V.view.current);
}

/* ---------- 智能满载 ---------- */
function runSmartLoad() {
  const items = validItems();
  if (!items.length) { toast('先在左侧添加货物'); return; }
  pushHistory();
  const btn = $('#smartBtn');
  btn.disabled = true; btn.style.opacity = '.65';
  setTimeout(() => {
    const c = box();
    const t0 = performance.now();
    let plan = null;
    try { plan = smartPackPlan(items, c); } catch (e) { console.error(e); }
    const ms = Math.round(performance.now() - t0);
    btn.disabled = false; btn.style.opacity = '';
    if (!plan || !plan.placed.length) { toast('这款柜型装不下这批货，换个柜型或改包装尺寸'); return; }

    // 统计：哪些真实货物没装进去
    const got = {};
    plan.placed.forEach(b => { if (b._fill !== 'dummy') got[b.name] = (got[b.name] || 0) + 1; });
    const unplaced = [];
    let total = 0;
    items.forEach(it => {
      total += it.qty;
      for (let k = Math.max(0, it.qty - (got[it.name] || 0)); k > 0; k--) unplaced.push({ unit: { name: it.name }, reason: '空间不足（智能满载）' });
    });
    const res = finalize(c, total, plan.placed, unplaced, 'smart/3d', { ms });
    const dummy = plan.placed.filter(b => b._fill === 'dummy').length;
    res.stats.placedCount -= dummy;                  // 补位箱不算真实货物
    res.stats.unplacedCount = unplaced.length;
    res.stats.dummyCount = dummy;

    showResult(res, true, 9);
    V.setPlayView();
    showSmartCard(res, ms, plan.estWeight);
  }, 30);
}

function showSmartCard(res, ms, estWeight) {
  const s = res.stats;
  const dirs = {};
  res.placed.forEach(b => { const o = b._o || '平放'; dirs[o] = (dirs[o] || 0) + 1; });
  const nDum = s.dummyCount || 0, nChock = res.placed.filter(b => b._chock).length;
  $('#scRate').textContent = (s.utilization * 100).toFixed(1) + '%' + (nDum ? '（含补位）' : '');
  $('#scCount').textContent = s.placedCount + ' / ' + s.totalUnits + ' 件' + (nDum ? ' + 补位 ' + nDum + ' 件' : '') + (nChock ? ' + 止挡木 ' + nChock + ' 处' : '');
  $('#scMix').textContent = Object.keys(dirs).map(k => k + ' ' + dirs[k]).join(' · ');
  let cog = (s.cogOffX >= 0 ? '后 ' : '前 ') + pctTxt(s.cogOffX) + ' / ' + (s.cogOffY >= 0 ? '右 ' : '左 ') + pctTxt(s.cogOffY);
  if (s.balance && s.balance.moves) cog += ' · 智能配平 ' + s.balance.moves + ' 处';
  $('#scCog').textContent = cog;
  $('#scMs').textContent = ms + ' ms' + (estWeight ? ' · 重量按体积估' : '');
  $('#scBar').style.width = '0%';
  const card = $('#smartCard');
  card.classList.add('on');
  requestAnimationFrame(() => { $('#scBar').style.width = Math.min(100, s.utilization * 100) + '%'; });
  clearTimeout(showSmartCard.t);
  showSmartCard.t = setTimeout(() => card.classList.remove('on'), 9000);
}

/* =========================================================
   统计 & 现场提醒
   ========================================================= */
function updateStats(res) {
  const c = box(), cap = c.L * c.W * c.H;
  const ids = ['#mCount', '#mVol', '#mWeight', '#mLayer', '#mCog', '#mLeft'];
  if (!res) {
    $('#utilVal').textContent = '0%';
    $('#ring').style.background = 'conic-gradient(#d3dae2 0deg, #d3dae2 360deg)';
    $('#utilBig').textContent = '—';
    ids.forEach(s => { $(s).textContent = '—'; $(s).className = ''; });
    $('#warnBox').classList.remove('show');
    $('#mChipPct').textContent = '—';
    $('#mChipCnt').textContent = '—';
    return;
  }
  const s = res.stats;
  const pct = (Math.round(s.utilization * 1000) / 10).toFixed(1) + '%';
  const deg = Math.min(360, s.utilization * 360);
  const color = s.utilization > 0.82 ? '#0d8f6f' : s.utilization > 0.62 ? '#1a6dd4' : s.utilization > 0.4 ? '#c4790a' : '#d13b3b';
  $('#utilVal').textContent = pct;
  $('#ring').style.background = `conic-gradient(${color} ${deg}deg, #dfe4ea ${deg}deg 360deg)`;
  $('#utilBig').textContent = (s.usedVolume / 1e6).toFixed(2) + ' m³ / ' + (cap / 1e6).toFixed(1) + ' m³';

  const set = (sel, text, cls) => { $(sel).textContent = text; $(sel).className = cls || ''; };
  set('#mCount', s.placedCount + ' / ' + s.totalUnits + ' 件', s.unplacedCount > 0 ? 'warn' : 'ok');
  set('#mVol', (s.usedVolume / 1e6).toFixed(2) + ' m³');
  set('#mWeight', fmt(Math.round(s.totalWeight)) + ' / ' + fmt(s.payload) + ' kg', s.totalWeight > s.payload * 0.95 ? 'warn' : '');
  set('#mLayer', s.layers + ' 层');
  const ox = s.cogOffX || 0, oy = s.cogOffY || 0;
  set('#mCog', (ox >= 0 ? '后 ' : '前 ') + pctTxt(ox) + ' / ' + (oy >= 0 ? '右 ' : '左 ') + pctTxt(oy),
      Math.abs(ox) > 0.06 || Math.abs(oy) > 0.05 ? 'warn' : 'ok');
  set('#mLeft', (Math.max(0, cap - s.usedVolume) / 1e6).toFixed(2) + ' m³');

  $('#mChipPct').textContent = pct;
  $('#mChipPct').style.color = color;
  $('#mChipCnt').textContent = s.placedCount + '/' + s.totalUnits + ' 件' + (s.unplacedCount > 0 ? ' · 缺' + s.unplacedCount : '');

  // 现场提醒：未装入 / 偏载 / 斜放 / 圆柱防滚 / 箱压弧顶
  const tips = [];
  if (s.unplacedCount > 0) {
    const by = {};
    res.unplaced.forEach(u => { by[u.reason] = (by[u.reason] || 0) + 1; });
    tips.push('未装入：' + Object.keys(by).map(k => k + ' ' + by[k] + ' 件').join(' · ') + '<br>建议换更大柜型、改包装尺寸，或分柜出运。');
  }
  const bal = s.balance;
  if (Math.abs(oy) > 0.05) {
    tips.push('左右偏载 ' + pctTxt(oy) + '（' + (oy > 0 ? '右侧重' : '左侧重') + '）' + (bal && bal.moves
      ? '：已自动换位 ' + bal.moves + ' 处仍超限，建议把重货往' + (oy > 0 ? '左' : '右') + '侧调整，或减少单侧重货。'
      : '，过收费站易侧翻，建议配重或换位。'));
  } else if (bal && bal.moves && Math.abs(bal.fromY) > 0.05) {
    tips.push('左右偏载已自动配平：' + pctTxt(bal.fromY) + ' → ' + pctTxt(oy) + '（智能换位 ' + bal.moves + ' 处），无需人工调整。');
  }
  if (Math.abs(ox) > 0.06) {
    tips.push('前后重心偏' + (ox > 0 ? '后' : '前') + ' ' + pctTxt(ox) + (bal && bal.moves ? '：已尽力自动换位，仍需注意拖车轴荷分配。' : '，注意拖车轴荷分配。'));
  }
  if (s.diagCount > 0) tips.push('其中 ' + s.diagCount + ' 件为斜放补位（长条件），需垫木塞实、绑带固定，防止行车中滑动。');
  const horiz = res.placed.filter(b => !b._chock && b.shape === 'cyl' && (b.cylAxis === 0 || b.cylAxis === 1));
  const chocks = res.placed.filter(b => b._chock).length;
  if (horiz.length && chocks) tips.push('横放圆柱/卷材已自动加止挡木 ' + chocks + ' 处顶住，防止行车滚动；发车前请再确认楔块钉牢。');
  else if (horiz.length) tips.push('圆柱/卷材为横放，须加止挡木或楔块防滚。');
  if (horiz.length) {
    let onArc = 0;
    for (const b of res.placed) {
      if (b._chock || b.shape === 'cyl' || b.z <= 1) continue;
      if (horiz.some(q => Math.abs(q.z + q.dz - b.z) <= 1.5 &&
          Math.min(b.x + b.dx, q.x + q.dx) > Math.max(b.x, q.x) &&
          Math.min(b.y + b.dy, q.y + q.dy) > Math.max(b.y, q.y))) onArc++;
    }
    if (onArc) tips.push('有 ' + onArc + ' 件箱货压在卷材/圆桶的圆弧顶上（线接触，颠簸会晃）：装柜时在弧顶两侧垫木方找平后再压紧。');
  }
  if (tips.length) {
    $('#warnTitle').textContent = s.unplacedCount > 0 ? '有 ' + s.unplacedCount + ' 件未装入' : '现场装柜提醒';
    $('#warnDetail').innerHTML = tips.join('<br>');
    $('#warnBox').classList.add('show');
  } else $('#warnBox').classList.remove('show');
}

/* =========================================================
   装载动画 / 播放条 / 装载顺序 / 分层
   ========================================================= */
function refreshVisibility() { V.applyVisibility(anim.shown, ui.layerMode ? ui.layerShown : null); }

V.view.onFrame = now => {
  if (anim.playing) {
    if (!anim.last) anim.last = now;
    const dt = Math.min(220, now - anim.last);
    anim.last = now;
    anim.acc += dt * anim.speed;
    let changed = false;
    while (anim.acc >= anim.perBox && anim.shown < anim.total) {
      anim.acc -= anim.perBox;
      anim.shown++;
      V.pushIn(anim.shown, now);
      changed = true;
    }
    if (anim.shown >= anim.total) { anim.playing = false; updatePlayUI(true); }
    if (changed) { refreshVisibility(); updatePlayUI(); }
  } else anim.last = 0;
  V.tickTweens(now);
  V.setHighlight(anim.shown, anim.total);
};

function updatePlayUI(done) {
  const bar = $('#playBar');
  if (!state.result || !anim.total) { bar.classList.add('hide'); return; }
  bar.classList.remove('hide');
  $('#playBtn').textContent = anim.playing ? '❚❚' : anim.shown >= anim.total ? '↻' : '▶';
  const rg = $('#playRange');
  rg.max = anim.total; rg.value = anim.shown;
  const cur = V.view.meshes[anim.shown];
  let info = '<b>' + anim.shown + '</b> / ' + anim.total + ' 件';
  if (anim.shown <= 0) info += ' · 待开始';
  else if (cur) {
    const b = cur.box;
    info += ' · 距柜头 ' + Math.round(b.x) + 'cm · L' + b.layer + (b.diag ? ' · 斜' + b.diag.deg + '°' : '');
  }
  $('#playInfo').innerHTML = info;
  if (ui.orderOpen) highlightOrderRow(anim.shown, !done);
}

function jumpTo(seq) {
  anim.playing = false;
  V.resetPositions();
  anim.shown = Math.max(0, Math.min(anim.total, seq));
  refreshVisibility();
  updatePlayUI();
}

function togglePlay() {
  if (!state.result || !anim.total) return;
  if (ui.exporting) { toast('正在导出动画，请等录制结束'); return; }
  if (anim.playing) { anim.playing = false; updatePlayUI(); return; }
  if (anim.shown >= anim.total) { anim.shown = 0; V.resetPositions(); refreshVisibility(); }
  if (anim.shown === 0) V.setPlayView();
  Object.assign(anim, { playing: true, last: 0, acc: 0 });
  updatePlayUI();
}

function renderOrderPanel() {
  const list = $('#orderList');
  if (!state.result || !state.result.placed.length) { list.innerHTML = ''; $('#orderSub').textContent = ''; return; }
  const arr = state.result.placed.slice().sort((a, b) => a.seq - b.seq);
  $('#orderSub').textContent = '共 ' + arr.length + ' 件 · 柜头→柜门';
  list.innerHTML = arr.map(b => `<div class="orow" data-seq="${b.seq}"><span class="no">${b.seq}</span><span class="sw2" style="background:${b.color}"></span><span class="nm">${esc(b.name)}${b.diag ? ' <i>斜' + b.diag.deg + '°</i>' : ''}</span><span class="pos">${Math.round(b.x)} · L${b.layer}</span></div>`).join('');
}

function highlightOrderRow(seq, scroll) {
  const list = $('#orderList');
  const prev = list.querySelector('.orow.cur');
  if (prev) prev.classList.remove('cur');
  const row = list.querySelector('.orow[data-seq="' + seq + '"]');
  if (!row) return;
  row.classList.add('cur');
  if (scroll) {
    const top = list.scrollTop, bottom = top + list.clientHeight;
    if (row.offsetTop < top || row.offsetTop + row.offsetHeight > bottom)
      list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
  }
}

function setOrderOpen(on) {
  ui.orderOpen = on;
  $('#orderToggle').classList.toggle('on', on);
  $('#orderBox').classList.toggle('show', on);
  if (on) { setLayerMode(false); highlightOrderRow(anim.shown, true); }
}
function setLayerMode(on) {
  ui.layerMode = on;
  $('#layerToggle').classList.toggle('on', on);
  $('#layerBox').classList.toggle('show', on);
  if (on && ui.orderOpen) setOrderOpen(false);
  refreshVisibility();
}

/* ---------- 导出动画：从空柜录制，保存为视频 ---------- */
function exportAnim() {
  if (ui.exporting) { toast('正在导出动画，请等录制结束'); return; }
  if (!state.result || !anim.total) { toast('先装几件货，再导出动画'); return; }
  const canvas = V.view.renderer.domElement;
  if (!canvas.captureStream || typeof MediaRecorder === 'undefined') { toast('当前浏览器不支持录屏导出，请用 Chrome / Edge 打开'); return; }
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) { toast('该浏览器没有支持的视频编码格式'); return; }

  ui.exporting = true;
  $('#exportBtn').disabled = true;
  anim.playing = false;
  V.resetPositions();
  anim.shown = 0;
  refreshVisibility();
  updatePlayUI();
  V.setPlayView();

  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    ui.exporting = false;
    $('#exportBtn').disabled = false;
    stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const name = '装载动画-' + state.container + '-' + today() + '.' + (mime.includes('mp4') ? 'mp4' : 'webm');
    download(name, blob);
    toast('动画已导出：' + name + '（' + (blob.size / 1048576).toFixed(1) + ' MB）');
    updatePlayUI(true);
  };
  rec.start(200);
  toast('开始录制装载动画，播完自动保存视频…');
  anim.speed = Math.max(1, anim.speed);
  setTimeout(() => {
    Object.assign(anim, { playing: true, last: 0, acc: 0 });
    updatePlayUI();
    const watch = setInterval(() => {
      if (!ui.exporting) { clearInterval(watch); return; }
      if (!anim.playing && anim.shown >= anim.total) {
        clearInterval(watch);
        setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 1400);
      }
    }, 120);
  }, 900);
}

/* ---------- 导出装载清单 CSV ---------- */
function exportCSV() {
  if (!state.result || !state.result.placed.length) { alert('还没有装载方案'); return; }
  const c = box(), s = state.result.stats;
  const rows = [['装载顺序', '品名', '形状', '摆放', '尺寸 长×宽×高(cm)', '距柜头 x', '柜宽方向 y', '离地 z', '层', '倾斜角度', '单重(kg)', '毛重小计(kg)']];
  state.result.placed.slice().sort((a, b) => a.seq - b.seq).forEach(b => rows.push([
    b.seq, b.name, SHAPE_CN[b.shape || 'box'], b.pose || '',
    b.diag ? `${n1(b.diag.lx)}×${n1(b.diag.ly)}×${n1(b.diag.lz)}` : `${n1(b.dx)}×${n1(b.dy)}×${n1(b.dz)}`,
    b.x.toFixed(1), b.y.toFixed(1), b.z.toFixed(1), b.layer, b.diag ? b.diag.deg + '°' : '',
    b.weight, (b.weight || 0).toFixed(1)
  ]));
  rows.push([]);
  rows.push(['柜型', c.custom ? '自定义 ' + dimTxt(c) + 'cm' : c.name, '内尺寸', dimTxt(c) + ' cm', '装载率', (s.utilization * 100).toFixed(1) + '%']);
  rows.push(['已装', s.placedCount + ' 件', '未装', s.unplacedCount + ' 件']);
  rows.push(['总毛重', Math.round(s.totalWeight) + ' kg', '层数', s.layers]);
  rows.push(['重心偏移', '前后 ' + ((s.cogOffX || 0) * 100).toFixed(1) + '% / 左右 ' + ((s.cogOffY || 0) * 100).toFixed(1) + '%']);
  download('装柜清单_' + (c.custom ? '自定义' + dimTxt(c) : c.name) + '_' + today() + '.csv', csvBlob(rows));
}

/* =========================================================
   表格导入
   ========================================================= */
let impRows = null;
function openImport() {
  impRows = null;
  setMsg('#impMsg', '');
  $('#impFileName').textContent = '未选择文件';
  $('#impPaste').value = '';
  $('#impFile').value = '';
  $('#importModal').classList.add('show');
}
async function onImportFile(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  $('#impFileName').textContent = f.name;
  try {
    if (/\.xlsx?$/i.test(f.name)) setMsg('#impMsg', '正在加载 Excel 解析库…');
    impRows = await readFileRows(f);
    setMsg('#impMsg', '已读取 ' + impRows.length + ' 行，点「导入」继续', 'ok');
  } catch (err) {
    impRows = null;
    setMsg('#impMsg', '读取失败：' + (err && err.message ? err.message : err), 'bad');
  }
}
function doImport() {
  const paste = $('#impPaste').value.trim();
  const rows = paste ? parseDelimited(paste) : impRows;
  if (!rows) { setMsg('#impMsg', '先选一个文件，或把表格内容粘贴到上面的框里', 'bad'); return; }
  const r = rowsToItems(rows, $('#impUnit').value);
  if (r.error) { setMsg('#impMsg', r.error, 'bad'); return; }
  if (state.items.length && !confirm('导入会替换当前清单里的 ' + state.items.length + ' 种货物，继续吗？')) return;
  state.items = r.items.map(x => newItem(x));
  renderItems();
  $('#importModal').classList.remove('show');
  repack(true, true);
  const unit = r.unit === 'mm' ? '毫米' : r.unit === 'm' ? '米' : '厘米';
  toast('已导入 ' + r.items.length + ' 种货物 / 共 ' + r.totalQty + ' 件（按' + unit + '换算）' + (r.skipped ? '，跳过 ' + r.skipped + ' 行无效数据' : ''));
}

/* =========================================================
   分享链接 / 本地存档
   ========================================================= */
function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64dec(str) {
  let t = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return new TextDecoder().decode(Uint8Array.from(atob(t), ch => ch.charCodeAt(0)));
}
function planObject() {
  const cu = CONTAINERS.CUSTOM;
  return {
    b: state.container,
    c: state.container === 'CUSTOM' ? { L: cu.L, W: cu.W, H: cu.H, payload: cu.payload } : null,
    i: state.items.map(it => [String(it.name), +it.l, +it.w, +it.h, +it.qty, +it.weight, it.rotate ? 1 : 0, it.noStack ? 1 : 0,
                              it.shape || 'box', it.pose || 'auto', it.diagOk === false ? 0 : 1])
  };
}
function applyPlanObject(o) {
  if (!o) return false;
  if (o.c && +o.c.L > 0) Object.assign(CONTAINERS.CUSTOM, { L: +o.c.L, W: +o.c.W, H: +o.c.H, payload: +o.c.payload || 0 });
  if (o.b && CONTAINERS[o.b]) state.container = o.b;
  if (Array.isArray(o.i) && o.i.length) {
    state.items = o.i.map(r => newItem({ name: String(r[0]), l: +r[1], w: +r[2], h: +r[3], qty: +r[4], weight: +r[5],
      rotate: !!r[6], noStack: !!r[7], shape: r[8] || 'box', pose: r[9] || 'auto', diagOk: r[10] !== 0 }));
  }
  renderTypes();
  renderItems();
  return true;
}
function saveLocal() { try { localStorage.setItem(PLAN_KEY, JSON.stringify(planObject())); } catch (e) { /* 忽略 */ } }
function restoreLocal() {
  try {
    const o = JSON.parse(localStorage.getItem(PLAN_KEY) || 'null');
    if (!o || !Array.isArray(o.i) || !o.i.length) return false;
    return applyPlanObject(o);
  } catch (e) { return false; }
}

function copyText(txt) {
  const done = () => toast('链接已复制，粘贴到微信/邮件发给对方即可');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { prompt('复制下面的链接：', txt); }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, fallback);
  else fallback();
}
async function sharePlan() {
  const url = location.origin + location.pathname + '?s=' + b64enc(JSON.stringify(planObject()));
  const st = state.result && state.result.stats;
  const text = '装柜方案 ' + state.container + (st ? ' · ' + st.placedCount + ' 件 · 装载率 ' + (st.utilization * 100).toFixed(1) + '%' : '');
  if (navigator.share) {
    try { await navigator.share({ title: '智装柜装柜方案', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  copyText(url);
}

/* ---------- 手机底部抽屉 ---------- */
function openSheet() { document.body.classList.add('sheet'); $('#scrim').classList.add('show'); }
function closeSheet() { document.body.classList.remove('sheet'); $('#scrim').classList.remove('show'); }
const isSmall = () => window.matchMedia('(max-width:760px)').matches;

/* =========================================================
   拖拽装柜：射线拾取箱子 → 在柜底平面上拖动 → 5cm 对齐 →
   用 geom.js 碰撞 + 支撑校验，通过才落位，否则放回原位。
   点空白处不拦截，照常交给 OrbitControls 旋转 / 双指缩放。
   ========================================================= */
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const hitPoint = new THREE.Vector3();

function pickBox(e) {
  const cv = V.view.renderer.domElement, r = cv.getBoundingClientRect();
  pointerNDC.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointerNDC, V.view.camera);
  const hits = raycaster.intersectObjects(V.view.cargoGroup.children.filter(m => m.visible), false);
  return hits.length ? hits[0] : null;
}

/** 拖拽落点校验（geom.js）：越界 / 碰撞 / 支撑不足都算无效 */
function checkDragPlacement(b, x, y, z) {
  const c = box();
  if (x < -0.01 || y < -0.01 || x + b.dx > c.L + 0.01 || y + b.dy > c.W + 0.01 || z + b.dz > c.H + 0.01)
    return { ok: false, reason: '超出柜体范围' };
  const idx = new SpaceIndex(60);
  for (const p of state.result.placed) if (p !== b) idx.add(p);
  if (collides(idx, x, y, z, b.dx, b.dy, b.dz)) return { ok: false, reason: '会撞到旁边的货' };
  const sup = z <= 0.01 ? 1 : supportRatio(idx, x, y, z, b.dx, b.dy);
  if (sup < 0.62) return { ok: false, reason: '下面没有足够支撑（支撑面仅 ' + Math.round(sup * 100) + '%）' };
  return { ok: true, sup };
}

function bindDrag() {
  const cv = V.view.renderer.domElement;
  const stage = document.querySelector('.stage');
  // 捕获阶段挂在 .stage 上：点中箱子时 stopPropagation，OrbitControls 就收不到这次按下；
  // 点空白处不拦截，照常旋转 / 缩放。
  stage.addEventListener('pointerdown', e => {
    if (e.target !== cv) return;
    if (!drag.enabled || anim.playing || ui.exporting || !state.result || !state.result.placed.length) return;
    const hit = pickBox(e);
    if (!hit) return;
    const mesh = hit.object, b = mesh.userData;
    if (!b || b._chock) return;
    drag.active = true; drag.box = b; drag.mesh = mesh;
    drag.orig = { x: b.x, y: b.y, z: b.z };
    drag.nx = null; drag.ny = null; drag.moved = false;
    dragPlane.set(new THREE.Vector3(0, 1, 0), -mesh.position.y);
    V.view.controls.enabled = false;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    e.stopPropagation();
    e.preventDefault();
  }, true);
  cv.addEventListener('pointermove', e => {
    if (!drag.active) return;
    const r = cv.getBoundingClientRect();
    pointerNDC.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointerNDC, V.view.camera);
    if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return;
    const c = box(), b = drag.box;
    let nx = Math.round((hitPoint.x + c.L / 2 - b.dx / 2) / 5) * 5;   // 5cm 对齐
    let ny = Math.round((hitPoint.z + c.W / 2 - b.dy / 2) / 5) * 5;
    nx = Math.max(0, Math.min(c.L - b.dx, nx));
    ny = Math.max(0, Math.min(c.W - b.dy, ny));
    if (nx !== b.x || ny !== b.y) drag.moved = true;
    drag.nx = nx; drag.ny = ny;
    drag.mesh.position.set(nx + b.dx / 2 - c.L / 2, drag.mesh.position.y, ny + b.dy / 2 - c.W / 2);
    e.preventDefault();
  });
  const revertMesh = () => {
    const c = box(), b = drag.box;
    drag.mesh.position.set(drag.orig.x + b.dx / 2 - c.L / 2, drag.mesh.position.y, drag.orig.y + b.dy / 2 - c.W / 2);
  };
  const endDrag = () => {
    if (!drag.active) return;
    drag.active = false;
    V.view.controls.enabled = true;
    const b = drag.box;
    if (!drag.moved || drag.nx == null) { drag.box = null; return; }
    const chk = checkDragPlacement(b, drag.nx, drag.ny, b.z);
    if (!chk.ok) {
      revertMesh();
      toast('放不下，已放回原位：' + chk.reason);
      drag.box = null;
      return;
    }
    pushHistory();
    b.x = drag.nx; b.y = drag.ny;
    const idx = new SpaceIndex(60);
    state.result.placed.forEach(p => { if (p !== b) idx.add(p); });
    if (b.z > 0.01) {
      const nz = dropZ(idx, b.x, b.y, b.dx, b.dy, b.z);
      if (nz < b.z - 0.01 && supportRatio(idx, b.x, b.y, nz, b.dx, b.dy) >= 0.62) b.z = nz;
    }
    refreshAfterManual(state.result.placed, '拖拽');
    toast('已移动「' + b.name + '」到距柜头 ' + Math.round(b.x) + 'cm 处');
    drag.box = null;
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', () => {
    if (!drag.active) return;
    drag.active = false;
    V.view.controls.enabled = true;
    if (drag.mesh && drag.orig) revertMesh();
    drag.box = null;
  });
}

function updateDragUI() {
  const btn = $('#dragBtn');
  if (btn) {
    btn.classList.toggle('on', drag.enabled);
    btn.setAttribute('aria-pressed', drag.enabled ? 'true' : 'false');
  }
  const hint = $('#dragHint');
  if (hint) hint.classList.toggle('show', drag.enabled);
}
function setDragEnabled(on) {
  drag.enabled = !!on;
  updateDragUI();
  toast(drag.enabled ? '拖拽装柜已开启：按住箱子拖动，拖空白处旋转' : '拖拽已关闭：拖动画面为旋转视角');
}

/* =========================================================
   待装货物 · 逐件上柜：放一件 / 铺一层 / 撤销 / 清空柜内
   单件落位复用 geom.js 的 orientations + 碰撞 + 支撑校验，
   不用简化网格扫描；落位后走 packer.js finalize 重算统计。
   ========================================================= */
function placedCountByName(name) {
  if (!state.result) return 0;
  let n = 0;
  for (const b of state.result.placed) if (b.name === name && !b._chock && b._fill !== 'dummy') n++;
  return n;
}
function computeUnplaced(placed) {
  const got = {};
  placed.forEach(b => { if (!b._chock && b._fill !== 'dummy') got[b.name] = (got[b.name] || 0) + 1; });
  const out = [];
  validItems().forEach(it => {
    const miss = it.qty - (got[it.name] || 0);
    for (let k = 0; k < miss; k++) out.push({ unit: { name: it.name }, reason: '待装' });
  });
  return out;
}
function refreshAfterManual(placed, strategy) {
  const c = box();
  const res = Packer.finalize(Object.assign({}, c, { noBalance: true }),
    validItems().reduce((s, it) => s + it.qty, 0), placed, computeUnplaced(placed), strategy || 'drag/手动');
  showResult(res, false, 110);
  return res;
}
function renderPending() {
  const el = $('#pendingList');
  if (!el) return;
  if (!state.items.length) {
    el.innerHTML = '<div class="pend-tip">还没有货物，先在上方添加货物或导入表格。</div>';
    return;
  }
  el.innerHTML = state.items.map(it => {
    const left = Math.max(0, it.qty - placedCountByName(it.name));
    return `<div class="pend-row" data-id="${it.id}">
      <span class="swatch" style="background:${it.color}"></span>
      <div class="pend-info"><div class="nm">${esc(it.name)}</div><div class="meta">${it.l}×${it.w}×${it.h} cm · 单重 ${it.weight} kg · 余 <b>${left}</b> / 共 ${it.qty} 件</div></div>
      <div class="pend-btns"><button data-act="one"${left <= 0 ? ' disabled' : ''}>放一件</button><button data-act="layer"${left <= 0 ? ' disabled' : ''}>铺一层</button></div>
    </div>`;
  }).join('');
}

/** 在现有布局里找一个能放下单件的位置（极值点候选 + 碰撞/支撑校验） */
function tryPlaceOne(item) {
  if (!state.result) return null;
  const placed = state.result.placed;
  const idx = new SpaceIndex(60);
  placed.forEach(b => idx.add(b));
  const c = box();
  const pts = [[0, 0, 0]];
  const seen = new Set(['0|0|0']);
  for (const b of placed) {
    [[b.x + b.dx, b.y, b.z], [b.x, b.y + b.dy, b.z], [b.x, b.y, b.z + b.dz]].forEach(p => {
      const k = Math.round(p[0]) + '|' + Math.round(p[1]) + '|' + Math.round(p[2]);
      if (!seen.has(k)) { seen.add(k); pts.push(p); }
    });
  }
  pts.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  const src = state.items.indexOf(item);
  for (const minSup of [0.88, 0.62]) {
    for (const p of pts) {
      for (const o of orientations(item)) {
        const dx = o[0], dy = o[1], dz = o[2];
        if (p[0] + dx > c.L + 1e-6 || p[1] + dy > c.W + 1e-6) continue;
        const zs = [p[2]];
        if (p[2] > 0.01) { const zd = dropZ(idx, p[0], p[1], dx, dy, p[2]); if (zd < p[2] - 0.01) zs.push(zd); }
        for (const z of zs) {
          if (z + dz > c.H + 1e-6) continue;
          if (item.noStack && z > 0.01) continue;
          if (collides(idx, p[0], p[1], z, dx, dy, dz)) continue;
          if (supportRatio(idx, p[0], p[1], z, dx, dy) < minSup) continue;
          const n = normDims(item);
          const b = { x: p[0], y: p[1], z, dx, dy, dz, name: item.name, src, weight: +item.weight || 0,
            color: item.color, noStackTop: !!item.noStack, shape: shapeOf(item), cylAxis: -1, cylR: 0,
            pose: poseLabel(item, dx, dy, dz) };
          if (b.shape === 'cyl') { b.cylR = n.d / 2; b.cylAxis = cylAxisOf(item, dx, dy, dz); }
          else if (b.shape === 'sphere') b.cylR = n.d / 2;
          return b;
        }
      }
    }
  }
  return null;
}
function placeOne(item) {
  const left = Math.max(0, item.qty - placedCountByName(item.name));
  if (left <= 0) { toast('「' + item.name + '」已全部装入'); return null; }
  const b = tryPlaceOne(item);
  if (!b) { toast('「' + item.name + '」放不下了：柜内没有合适的空位'); return null; }
  pushHistory();
  state.result.placed.push(b);
  refreshAfterManual(state.result.placed, '手动/放一件');
  return b;
}
function placeLayer(item) {
  const left0 = Math.max(0, item.qty - placedCountByName(item.name));
  if (left0 <= 0) { toast('「' + item.name + '」已全部装入'); return; }
  pushHistory();
  let n = 0, firstZ = null;
  for (let k = 0; k < left0; k++) {
    const b = tryPlaceOne(item);
    if (!b) break;
    if (firstZ === null) firstZ = b.z;
    else if (b.z > firstZ + 0.5) break;   // 上一层了，这一层已铺满
    state.result.placed.push(b);
    refreshAfterManual(state.result.placed, '手动/铺一层');
    n++;
  }
  if (!n) { history.pop(); toast('铺不下一层：没有合适的空位'); }
  else toast('已铺一层「' + item.name + '」' + n + ' 件');
}
function pushHistory() {
  if (!state.result || !state.result.placed) return;
  try {
    history.push(JSON.stringify(state.result.placed));
    if (history.length > 30) history.shift();
  } catch (e) { /* 忽略 */ }
}
function undoLast() {
  const snap = history.pop();
  if (!snap) { toast('没有可撤销的操作'); return; }
  let placed = [];
  try { placed = JSON.parse(snap); } catch (e) { toast('撤销失败'); return; }
  refreshAfterManual(placed, '撤销');
  toast('已撤销');
}
function clearCabinet() {
  if (!state.result || !state.result.placed.length) { toast('柜内已经是空的'); return; }
  pushHistory();
  refreshAfterManual([], '清空柜内');
  toast('已清空柜内，待装货物可逐件放回');
}

/* =========================================================
   事件绑定
   ========================================================= */
function bindUI() {
  $('#types').addEventListener('click', e => {
    const b = e.target.closest('.type');
    if (!b) return;
    if (b.dataset.k === 'CUSTOM') { openCust(); return; }
    if (b.dataset.k !== state.container) switchContainer(b.dataset.k);
  });
  $('#presets').addEventListener('click', e => {
    const b = e.target.closest('.preset');
    if (!b) return;
    pushHistory();
    loadPreset(b.dataset.p);
    repack(true, true);
  });
  $('#addItem').onclick = () => { state.items.push(newItem()); renderItems(); repack(false); };
  $('#importBtn').onclick = openImport;
  $('#packBtn').onclick = () => { pushHistory(); repack(true); };
  $('#smartBtn').onclick = runSmartLoad;
  $('#smartCardX').onclick = () => $('#smartCard').classList.remove('on');
  $('#csvBtn').onclick = exportCSV;
  $('#csvBtnM').onclick = exportCSV;
  $('#shareBtn').onclick = sharePlan;
  $('#sheetBtn').onclick = openSheet;
  $('#dragBtn').onclick = () => setDragEnabled(!drag.enabled);
  $('#autoBtn').onclick = () => { pushHistory(); repack(true, true); };
  $('#undoBtn').onclick = undoLast;
  $('#clearBtn').onclick = clearCabinet;
  $('#pendingList').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const row = e.target.closest('.pend-row');
    const it = row && state.items.find(x => x.id === row.dataset.id);
    if (!it) return;
    if (btn.dataset.act === 'one') placeOne(it);
    else placeLayer(it);
  });
  $('#sheetClose').onclick = closeSheet;
  $('#scrim').onclick = closeSheet;
  $('#mChip').onclick = openSheet;

  // 播放条
  $('#playBtn').onclick = togglePlay;
  $('#playRange').oninput = e => { if (!ui.exporting) jumpTo(Number(e.target.value)); };
  $('#playSpeed').onchange = e => { anim.speed = Number(e.target.value) || 1; };
  $('#exportBtn').onclick = e => { e.preventDefault(); exportAnim(); };

  // 视角工具
  document.querySelectorAll('.tool[data-view]').forEach(b => { b.onclick = () => V.setView(b.dataset.view); });
  $('#orderToggle').onclick = () => setOrderOpen(!ui.orderOpen);
  $('#layerToggle').onclick = () => setLayerMode(!ui.layerMode);
  $('#layerRange').oninput = e => {
    ui.layerShown = Number(e.target.value);
    $('#layerTxt').textContent = ui.layerShown >= ui.totalLayers ? '全部（' + ui.totalLayers + ' 层）' : '第 1–' + ui.layerShown + ' 层';
    refreshVisibility();
  };
  $('#shellToggle').onclick = e => {
    ui.shellOn = !ui.shellOn;
    V.setShellVisible(ui.shellOn);
    e.currentTarget.classList.toggle('on', !ui.shellOn);
    e.currentTarget.textContent = ui.shellOn ? '显示柜体' : '已隐藏柜体';
  };
  $('#orderList').addEventListener('click', e => {
    const r = e.target.closest('.orow');
    if (r) jumpTo(Number(r.dataset.seq));
  });

  // 自定义柜
  $('#custApply').onclick = applyCust;
  $('#custCancel').onclick = closeCust;
  $('#custModal').addEventListener('click', e => { if (e.target.id === 'custModal') closeCust(); });
  document.querySelectorAll('.cust-quick button').forEach(b => {
    b.onclick = () => {
      const q = b.dataset.q;
      const src = q === 'TRUCK' ? { L: 1300, W: 240, H: 270, payload: 30000 } : CONTAINERS[q];
      $('#custL').value = n1(src.L); $('#custW').value = n1(src.W); $('#custH').value = n1(src.H); $('#custP').value = src.payload;
      setMsg('#custMsg', q === 'TRUCK' ? '已填入 13 米平板车参考内尺寸，可按实际车厢修改' : '已填入 ' + q + ' 标准内尺寸，可微调');
    };
  });

  // 导入
  $('#impCancel').onclick = () => $('#importModal').classList.remove('show');
  $('#importModal').addEventListener('click', e => { if (e.target.id === 'importModal') $('#importModal').classList.remove('show'); });
  $('#impFile').onchange = onImportFile;
  $('#impOk').onclick = doImport;
  $('#tplBtn').onclick = () => download('装柜货物清单_模板.csv', csvBlob(templateRows()));

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeCust();
    $('#importModal').classList.remove('show');
    closeSheet();
  });
}

/* =========================================================
   启动
   ========================================================= */
function boot() {
  try {
    loadCustomBox();
    V.init3D($('#cv'), $('.stage'));
    bindItems();
    bindUI();
    bindDrag();
    updateDragUI();
    renderTypes();
    renderPresets();
    loadPreset('user180');  // 默认货物 180 件：木箱 30 + 纸箱 120 + 长条件 30

    // URL 直达：?s=<方案> / ?box=40HQ&preset=machinery / ?step=50 / ?panel=order|import|items
    const qp = new URLSearchParams(location.search);
    let fromLink = false;
    if (qp.get('s')) {
      try { fromLink = applyPlanObject(JSON.parse(b64dec(qp.get('s')))); } catch (e) { console.warn('方案链接解析失败', e); }
    }
    const bx = (qp.get('box') || '').toUpperCase();
    if (CONTAINERS[bx]) { state.container = bx; renderTypes(); }
    const pre = qp.get('preset');
    if (PRESETS[pre]) loadPreset(pre);
    // 自定义页不恢复首页存档：每次打开都用默认 180 件自动铺满，避免旧方案覆盖默认值。

    V.buildContainer(box());
    V.setView('iso');
    repack(true, true);

    const step = qp.get('step'), panel = qp.get('panel');
    if (step) setTimeout(() => jumpTo(Number(step)), 260);
    if (panel === 'order') setTimeout(() => setOrderOpen(true), 260);
    if (panel === 'import') setTimeout(openImport, 260);
    if (panel === 'items') setTimeout(openSheet, 260);

    try {
      if (isSmall() && !localStorage.getItem('zhuanggui.tip')) {
        setTimeout(() => toast('已自动铺满：按住箱子可拖动，拖空白处旋转，双指缩放'), 1200);
        localStorage.setItem('zhuanggui.tip', '1');
      }
    } catch (e) { /* 忽略 */ }

    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    window.__ZG_READY = true;
    $('#boot').style.display = 'none';
  } catch (err) {
    console.error(err);
    const b = $('#boot');
    b.classList.add('err');
    b.innerHTML = '<div class="msg"><b>初始化失败</b><br>' + esc(err && err.message || err) + '<br><br>可能是 3D 引擎（three.js）加载失败，请检查网络后刷新。</div>';
  }
}

boot();

// 调试 / 自动化入口
window.__ZG = { state, anim, drag, repack, runSmartLoad, jumpTo, placeOne, placeLayer, undoLast, clearCabinet, setDragEnabled, CONTAINERS, Packer, view: V.view };
