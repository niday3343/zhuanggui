/* =========================================================
   排柜算法：LAFF（大面优先）+ 极值点插入 + 重力落位
   - 多种排序策略各跑一遍，取装载体积最大的方案
   - 超长件自动斜放、横放圆柱加止挡木、左右/前后重心自动配平
   ========================================================= */
import {
  SpaceIndex, TOL, collides, supportRatio, dropZ,
  shapeOf, normDims, orientations, poseLabel, cylAxisOf
} from './geom.js';

const SORTS = {
  volume: (a, b) => (b.vol - a.vol) || (a.h - b.h),
  height: (a, b) => (b.maxH - a.maxH) || (b.foot - a.foot),
  weight: (a, b) => ((b.weight || 0) - (a.weight || 0)) || (b.vol - a.vol),
  maxdim: (a, b) => (b.maxD - a.maxD) || (b.vol - a.vol)
};

/** 把货物行展开成单件 */
export function expand(items) {
  const units = [];
  items.forEach((it, i) => {
    const n = Math.max(0, Math.min(3000, Math.round(it.qty) || 0));
    const ors = orientations(it);
    const sig = [it.l, it.w, it.h, it.rotate !== false ? 1 : 0, shapeOf(it), it.pose || 'auto'].join('_');
    for (let k = 0; k < n; k++) {
      units.push({
        src: i, item: it, name: it.name, color: it.color,
        weight: +it.weight || 0, noStack: !!it.noStack, diagOk: it.diagOk !== false,
        shape: shapeOf(it), ors, sig,
        vol: it.l * it.w * it.h, h: +it.h,
        maxH: Math.max(...ors.map(o => o[2])), foot: it.l * it.w,
        maxD: Math.max(it.l, it.w, it.h)
      });
    }
  });
  return units;
}

function makeBox(u, x, y, z, dx, dy, dz) {
  const b = {
    x, y, z, dx, dy, dz, name: u.name, src: u.src, weight: u.weight, color: u.color,
    noStackTop: u.noStack, shape: u.shape, cylAxis: -1, cylR: 0,
    pose: poseLabel(u.item, dx, dy, dz)
  };
  if (u.shape === 'cyl') { b.cylR = normDims(u.item).d / 2; b.cylAxis = cylAxisOf(u.item, dx, dy, dz); }
  else if (u.shape === 'sphere') b.cylR = normDims(u.item).d / 2;
  return b;
}

/* ---------- 斜放：超长件沿地面对角线摆放 ---------- */
function crossDims(u) {
  const n = normDims(u.item);
  return n.s === 'cyl' ? [n.len, n.d, n.d] : n.s === 'sphere' ? [n.d, n.d, n.d] : [n.l, n.w, n.h];
}

/** 枚举斜放方案：每个竖直边 × 角度，返回占地 fx/fy */
function diagOptions(u, L, W, H, step) {
  const base = crossDims(u), out = [], seen = {};
  for (let c = 0; c < 3; c++) {
    const lz = base[c];
    if (lz > H - 0.5) continue;
    const rest = base.filter((_, i) => i !== c).sort((a, b) => b - a);
    const a = rest[0], b = rest[1];
    if (b > W - 1) continue;
    const key = a + '_' + b + '_' + lz;
    if (seen[key]) continue;
    seen[key] = 1;
    for (let deg = step; deg < 90; deg += step) {
      const th = deg * Math.PI / 180;
      const fx = a * Math.cos(th) + b * Math.sin(th);
      const fy = a * Math.sin(th) + b * Math.cos(th);
      if (fx > L - 1 || fy > W - 1) continue;
      out.push({ a, b, lz, deg: Math.round(deg * 100) / 100, th, fx, fy, spacing: b / Math.cos(th) + 1 });
    }
  }
  return out;
}

function makeDiagBox(u, opt, x, y) {
  const n = normDims(u.item);
  return {
    x, y, z: 0, dx: opt.fx, dy: opt.fy, dz: opt.lz,
    name: u.name, src: u.src, weight: u.weight, color: u.color,
    noStackTop: true, shape: u.shape, pose: '斜放', cylAxis: -1, cylR: (n.d || 0) / 2,
    diag: { deg: opt.deg, th: opt.th, lx: opt.a, ly: opt.b, lz: opt.lz, shape: u.shape,
            cylVert: u.shape === 'cyl' && Math.abs(opt.lz - n.len) < 1e-6 }
  };
}

/* ---------- 单次排柜 ---------- */
export function packOnce(cfg, units, sortKey, prio, allowDiag) {
  const { L, W, H } = cfg;
  const payload = cfg.payload > 0 ? cfg.payload : Infinity;
  const minSup = cfg.minSupport == null ? 0.88 : cfg.minSupport;
  const list = units.slice().sort(SORTS[sortKey] || SORTS.volume);
  const idx = new SpaceIndex(60);
  const placed = [], unplaced = [];
  let totalW = 0;

  // 候选点按 (z, x, y) 或 (z, y, x) 排序：先铺底，再从柜头往柜门推进
  const key = prio === 'y'
    ? p => p.z * 1e8 + p.y * 1e4 + p.x
    : p => p.z * 1e8 + p.x * 1e4 + p.y;
  let points = [{ x: 0, y: 0, z: 0, fail: new Set() }];
  points[0].k = key(points[0]);
  const seenPt = new Set(['0|0|0']);

  function addPoint(x, y, z) {
    if (x > L - 0.5 || y > W - 0.5 || z > H - 0.5) return;
    const sk = Math.round(x * 20) + '|' + Math.round(y * 20) + '|' + Math.round(z * 20);
    if (seenPt.has(sk)) return;
    seenPt.add(sk);
    const p = { x, y, z, fail: new Set() };
    p.k = key(p);
    let lo = 0, hi = points.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (points[m].k < p.k) lo = m + 1; else hi = m; }
    points.splice(lo, 0, p);
  }

  function commit(b) {
    placed.push(b);
    idx.add(b);
    totalW += b.weight;
    // 落在新货顶面高度的点：可能新获得支撑，清除失败缓存
    const top = b.z + b.dz;
    for (const p of points) if (Math.abs(p.z - top) < 0.1) p.fail.clear();
    // 删除被新货吞没的点
    points = points.filter(p => !(p.x >= b.x - TOL && p.x < b.x + b.dx - TOL &&
                                  p.y >= b.y - TOL && p.y < b.y + b.dy - TOL &&
                                  p.z >= b.z - TOL && p.z < b.z + b.dz - TOL));
    addPoint(b.x + b.dx, b.y, b.z);
    addPoint(b.x, b.y + b.dy, b.z);
    if (!b.noStackTop) addPoint(b.x, b.y, top);
    // 向下投影：门侧点若悬空，同时补一个落到地/托面的点
    if (b.z > 0) {
      const z2 = dropZ(idx, b.x + b.dx, b.y, 1, 1, b.z);
      if (z2 < b.z - 0.5) addPoint(b.x + b.dx, b.y, z2);
      const z3 = dropZ(idx, b.x, b.y + b.dy, 1, 1, b.z);
      if (z3 < b.z - 0.5) addPoint(b.x, b.y + b.dy, z3);
    }
  }

  /** 0 = 成功，1 = 空间不足，2 = 超载 */
  function placeUnit(u) {
    if (totalW + u.weight > payload + 1e-6) return 2;
    for (const pt of points) {
      if (u.noStack && pt.z > TOL) break;          // 不可堆叠：只落地
      if (pt.fail.has(u.sig)) continue;
      let best = null;
      for (const [dx, dy, dz] of u.ors) {
        if (pt.x + dx > L + TOL || pt.y + dy > W + TOL) continue;
        const zs = [pt.z];
        if (pt.z > TOL) { const zd = dropZ(idx, pt.x, pt.y, dx, dy, pt.z); if (zd < pt.z - TOL) zs.push(zd); }
        for (const z of zs) {
          if (z + dz > H + TOL) continue;
          if (u.noStack && z > TOL) continue;
          if (collides(idx, pt.x, pt.y, z, dx, dy, dz)) continue;
          if (supportRatio(idx, pt.x, pt.y, z, dx, dy) < minSup) continue;
          const area = dx * dy;
          if (!best || area > best.area + TOL || (Math.abs(area - best.area) < TOL && z < best.z - TOL))
            best = { dx, dy, dz, z, area };
        }
      }
      if (best) {
        commit(makeBox(u, pt.x, pt.y, best.z, best.dx, best.dy, best.dz));
        return 0;
      }
      pt.fail.add(u.sig);
    }
    return 1;
  }

  // 1) 超长件：任何正交姿态都放不进柜子 → 先在地面斜放成一排
  const used = new Set();
  const groups = new Map();
  list.forEach((u, i) => { if (!groups.has(u.sig)) groups.set(u.sig, []); groups.get(u.sig).push(i); });
  let diagX = 0;
  const diagGroups = new Set();
  for (const [sig, ids] of groups) {
    const u0 = list[ids[0]];
    if (!u0.diagOk) continue;
    if (u0.ors.some(o => o[0] <= L + TOL && o[1] <= W + TOL && o[2] <= H + TOL)) continue;
    const opts = diagOptions(u0, L - diagX, W, H, 0.25);
    if (!opts.length) continue;
    diagGroups.add(sig);
    let bestO = null;
    for (const o of opts) {
      const n = 1 + Math.floor((W - o.fy - 1) / o.spacing);
      if (!bestO || n > bestO.n || (n === bestO.n && o.fx < bestO.fx)) bestO = Object.assign({ n }, o);
    }
    const n = Math.min(bestO.n, ids.length);
    const y0 = Math.max(0.5, (W - (bestO.fy + (n - 1) * bestO.spacing)) / 2);
    for (let k = 0; k < n; k++) {
      const u = list[ids[k]];
      if (totalW + u.weight > payload + 1e-6) break;
      const b = makeDiagBox(u, bestO, diagX, y0 + k * bestO.spacing);
      // 斜放件的包络盒相互重叠（平行嵌套），只登记第一件参与碰撞，其余直接加入
      placed.push(b); totalW += b.weight; used.add(ids[k]);
      if (k === 0) idx.add(Object.assign({}, b, { dy: Math.min(W - b.y, bestO.fy + (n - 1) * bestO.spacing), noStackTop: true, _ghost: true }));
    }
    diagX += bestO.fx + 2;
    addPoint(diagX, 0, 0);
  }
  if (diagX > 0) points = points.filter(p => p.x >= diagX - 2 - TOL || p.z > 0);

  // 2) 主循环
  let pending = [];
  list.forEach((u, i) => {
    if (used.has(i)) return;
    const st = placeUnit(u);
    if (st === 2) unplaced.push({ unit: u, reason: '超出载重' });
    else if (st === 1) pending.push(u);
  });
  // 3) 补位重试：后放的货产生了新托面
  for (let pass = 0; pass < 2 && pending.length; pass++) {
    for (const p of points) p.fail.clear();
    const still = pending.filter(u => placeUnit(u) !== 0);
    if (still.length === pending.length) { pending = still; break; }
    pending = still;
  }
  pending.forEach(u => unplaced.push({ unit: u, reason: diagGroups.has(u.sig) ? '超长件·斜装位已满' : '空间不足' }));

  // 4) 长条件斜塞空档
  if (allowDiag && unplaced.length) {
    let tries = 0;
    for (let q = 0; q < unplaced.length && tries < 24; q++) {
      const u = unplaced[q].unit;
      if (!u.diagOk || u.maxD < Math.max(L, W) * 0.3) continue;
      if (totalW + u.weight > payload + 1e-6) continue;
      tries++;
      const opts = diagOptions(u, L, W, H, 4);
      const stepX = Math.max(20, Math.min(50, L / 30)), stepY = Math.max(12, Math.min(30, W / 18));
      let done = null;
      for (const o of opts) {
        for (let x = 0; x + o.fx <= L + TOL && !done; x += stepX)
          for (let y = 0; y + o.fy <= W + TOL && !done; y += stepY)
            if (!collides(idx, x, y, 0, o.fx, o.fy, o.lz)) done = makeDiagBox(u, o, x, y);
        if (done) break;
      }
      if (!done) continue;
      placed.push(done); idx.add(done); totalW += done.weight;
      unplaced.splice(q, 1); q--;
    }
  }

  return finalize(cfg, units.length, placed, unplaced, sortKey + '/' + prio);
}

/* ---------- 止挡木：横放圆柱两侧加楔块防滚 ---------- */
export function addChocks(placed, L, W) {
  const CH = 8, TH = 7;
  let added = 0;
  const idx = new SpaceIndex(60);
  placed.forEach(b => idx.add(b));
  const base = placed.slice();
  for (const b of base) {
    if (added >= 60) break;
    if (!(b.cylR >= 5) || b.diag || b.cylAxis == null || b.cylAxis < 0 || b.cylAxis === 2 || b._chock) continue;
    if (b.z > 2 && supportRatio(idx, b.x, b.y, b.z, b.dx, b.dy) < 0.5) continue;
    const r = b.cylR;
    const inset = Math.sqrt(Math.max(0, 2 * r * CH - CH * CH)) - 1;   // 楔块在 CH 高度处贴住圆面
    const rollY = b.cylAxis === 0;
    const axisLen = rollY ? b.dx : b.dy;
    const cl = Math.min(axisLen, 24);
    const a0 = (rollY ? b.x : b.y) + (axisLen - cl) / 2;
    const cc = rollY ? b.y + b.dy / 2 : b.x + b.dx / 2;
    for (const s of [-1, 1]) {
      const face = cc + s * inset;
      let x, y, dx, dy;
      if (rollY) { y = s < 0 ? face - TH : face; if (y < 0.5 || y + TH > W - 0.5) continue; x = a0; dx = cl; dy = TH; }
      else { x = s < 0 ? face - TH : face; if (x < 0.5 || x + TH > L - 0.5) continue; y = a0; dy = cl; dx = TH; }
      let bad = false;
      for (const p of idx.query(x, y, b.z, dx, dy, CH)) {
        if (p === b) continue;
        let q = p;
        if (p.cylR > 0 && p.cylAxis >= 0)   // 邻近圆柱按收缩包络近似
          q = { x: p.x + p.dx * 0.12, y: p.y + p.dy * 0.12, z: p.z, dx: p.dx * 0.76, dy: p.dy * 0.76, dz: p.dz };
        if (Math.min(q.x + q.dx, x + dx) - Math.max(q.x, x) > 0.5 &&
            Math.min(q.y + q.dy, y + dy) - Math.max(q.y, y) > 0.5 &&
            Math.min(q.z + q.dz, b.z + CH) - Math.max(q.z, b.z) > 0.5) { bad = true; break; }
      }
      if (bad) continue;
      const c = { x, y, z: b.z, dx, dy, dz: CH, name: '止挡木', color: '#8a5a2b', weight: 2, shape: 'box',
                  cylAxis: -1, cylR: 0, noStackTop: true, _chock: true, _o: '止挡木', pose: '止挡木' };
      placed.push(c); idx.add(c); added++;
    }
  }
  return added;
}

/* ---------- 自动配平：同尺寸货物互换位置，把重心拉回中线 ---------- */
export function balancePlaced(placed, L, W) {
  const items = placed.filter(b => !b.diag && !b._chock && !b._ghost);
  if (items.length < 2) return null;
  const wOf = b => (b.weight > 0 ? b.weight : 1);
  let ws = 0, sx = 0, sy = 0;
  for (const b of placed) { const w = wOf(b); ws += w; sx += w * (b.x + b.dx / 2); sy += w * (b.y + b.dy / 2); }
  const off = () => ({ x: (sx / ws - L / 2) / L, y: (sy / ws - W / 2) / W });
  const from = off();
  let moves = 0;
  // 按尺寸分组，只有完全同尺寸的才互换（占用空间不变，几何上绝对安全）
  const groups = new Map();
  for (const b of items) {
    const k = [b.dx, b.dy, b.dz, b.shape, b.cylAxis].join('_');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const pairsOk = [...groups.values()].filter(g => g.length > 1 && new Set(g.map(wOf)).size > 1);
    for (let iter = 0; iter < 400; iter++) {
    const o = off();
    const needY = Math.abs(o.y) > 0.02, needX = Math.abs(o.x) > 0.03;
    if (!needY && !needX) break;
    let best = null;
    for (const g of pairsOk) {
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        const dw = wOf(a) - wOf(b);
        if (Math.abs(dw) < 1e-6) continue;
        // 互换位置后的重心增量
        const ddx = dw * ((b.x + b.dx / 2) - (a.x + a.dx / 2));
        const ddy = dw * ((b.y + b.dy / 2) - (a.y + a.dy / 2));
        const nx = ((sx + ddx) / ws - L / 2) / L, ny = ((sy + ddy) / ws - W / 2) / W;
        const gain = (Math.abs(o.y) * 2 + Math.abs(o.x)) - (Math.abs(ny) * 2 + Math.abs(nx));
        if (gain > 1e-5 && (!best || gain > best.gain)) best = { a, b, ddx, ddy, gain };
      }
      if (g.length > 80) break;   // 大批量时只取前几组，控制耗时
    }
    if (!best) break;
    const { a, b } = best;
    for (const k of ['x', 'y', 'z']) { const t = a[k]; a[k] = b[k]; b[k] = t; }
    sx += best.ddx; sy += best.ddy; moves++;
  }
  moves += mirrorMoves();
  return { moves, fromX: from.x, fromY: from.y };

  /* B. 单件移位：顶上没压货的件，挪到柜宽镜像位置，或向轻的一侧平移到贴住邻货/柜壁 */
  function mirrorMoves() {
    let n = 0;
    const idx = new SpaceIndex(60);
    placed.forEach(b => idx.add(b));
    const freeTop = b => !idx.query(b.x, b.y, b.z + b.dz, b.dx, b.dy, 1).some(p => p !== b &&
      Math.abs(p.z - (b.z + b.dz)) < 0.1 &&
      Math.min(p.x + p.dx, b.x + b.dx) > Math.max(p.x, b.x) + TOL &&
      Math.min(p.y + p.dy, b.y + b.dy) > Math.max(p.y, b.y) + TOL);
    /** 沿柜宽向 dir 方向最多能平移多少 */
    const slideLimit = (b, dir) => {
      let lim = dir > 0 ? W - (b.y + b.dy) : b.y;
      for (const p of idx.all) {
        if (p === b) continue;
        if (Math.min(p.x + p.dx, b.x + b.dx) - Math.max(p.x, b.x) <= TOL) continue;
        if (Math.min(p.z + p.dz, b.z + b.dz) - Math.max(p.z, b.z) <= TOL) continue;
        const gap = dir > 0 ? p.y - (b.y + b.dy) : b.y - (p.y + p.dy);
        if (gap > -TOL && gap < lim) lim = Math.max(0, gap);
      }
      return lim;
    };
    const tryAt = (b, ny) => {
      idx.remove(b);
      const nz = b.z > 0 ? dropZ(idx, b.x, ny, b.dx, b.dy, b.z) : 0;
      const ok = ny >= -TOL && ny + b.dy <= W + TOL && !collides(idx, b.x, ny, nz, b.dx, b.dy, b.dz) &&
                 (nz <= 0.01 || supportRatio(idx, b.x, ny, nz, b.dx, b.dy) >= 0.88);
      if (ok) { b.y = ny; b.z = nz; }
      idx.add(b);
      return ok;
    };
    for (let iter = 0; iter < 300; iter++) {
      const o = off();
      if (Math.abs(o.y) <= 0.02) break;
      const heavy = o.y > 0 ? 1 : -1;                    // 重的一侧
      const need = Math.abs(o.y) * W * ws;               // 需要的力矩
      const cands = items.filter(b => !b._ghost).sort((p, q) => wOf(q) - wOf(p));
      let moved = false;
      for (const b of cands) {
        if (!freeTop(b)) continue;
        const opts = [];
        const mirror = W - b.y - b.dy;
        if ((mirror - b.y) * heavy < -1) opts.push(mirror);
        const lim = slideLimit(b, -heavy);
        if (lim > 1) opts.push(b.y - heavy * Math.min(lim, need / wOf(b)));
        for (const ny of opts) {
          const d = wOf(b) * (ny - b.y);
          const after = ((sy + d) / ws - W / 2) / W;
          if (Math.abs(after) >= Math.abs(o.y) - 1e-4) continue;
          if (tryAt(b, ny)) { sy += d; n++; moved = true; break; }
        }
        if (moved) break;
      }
      if (!moved) break;
    }
    return n;
  }
}

/* ---------- 收尾：配平、止挡木、层号、装载顺序、统计 ---------- */
export function finalize(cfg, totalUnits, placed, unplaced, strategy, extra) {
  const { L, W, H } = cfg;
  let balance = null;
  if (!cfg.noBalance) balance = balancePlaced(placed, L, W);
  addChocks(placed, L, W);

  let usedVol = 0, diagCount = 0, realCnt = 0, totalWeight = 0, maxZ = 0;
  const zset = new Set();
  for (const b of placed) {
    usedVol += b.dx * b.dy * b.dz;
    if (b.diag) diagCount++;
    if (!b._chock) realCnt++;
    totalWeight += b.weight || 0;
    maxZ = Math.max(maxZ, b.z + b.dz);
    zset.add(Math.round(b.z * 10) / 10);
  }
  // 斜放件的包络盒互相重叠，按实物体积计
  usedVol = placed.reduce((s, b) => s + (b.diag ? b.diag.lx * b.diag.ly * b.diag.lz : b.dx * b.dy * b.dz), 0);
  const zs = [...zset].sort((a, b) => a - b);
  const zIdx = new Map(zs.map((z, i) => [z, i + 1]));
  placed.forEach(b => { b.layer = zIdx.get(Math.round(b.z * 10) / 10); });

  // 装载顺序：柜头 → 柜门；同一纵向位置自下而上；再按柜宽
  placed.sort((a, b) => (Math.abs(a.x - b.x) > 0.05 ? a.x - b.x : Math.abs(a.z - b.z) > 0.05 ? a.z - b.z : a.y - b.y));
  placed.forEach((b, i) => { b.seq = i + 1; b.index = i; });

  let wSum = 0, cx = 0, cy = 0;
  for (const b of placed) { const w = b.weight > 0 ? b.weight : 1; wSum += w; cx += w * (b.x + b.dx / 2); cy += w * (b.y + b.dy / 2); }
  const cogX = wSum ? cx / wSum : L / 2, cogY = wSum ? cy / wSum : W / 2;
  const cap = L * W * H;
  return {
    placed, unplaced,
    stats: Object.assign({
      totalUnits, placedCount: realCnt, unplacedCount: Math.max(0, totalUnits - realCnt),
      usedVolume: usedVol, capacity: cap, utilization: cap ? usedVol / cap : 0,
      totalWeight, payload: cfg.payload, layers: zs.length, diagCount, maxZ,
      cogX, cogY, cogOffX: (cogX - L / 2) / L, cogOffY: (cogY - W / 2) / W,
      strategy, balance
    }, extra || {})
  };
}

/** 对外入口：多策略择优 */
export function pack(cfg) {
  const units = expand(cfg.items || []);
  if (!units.length) return finalize(cfg, 0, [], [], '-');
  const plans = units.length > 300
    ? [['volume', 'x'], ['height', 'x']]
    : [['volume', 'x'], ['volume', 'y'], ['height', 'x'], ['weight', 'x'], ['maxdim', 'y']];
  let best = null;
  plans.forEach(([s, p], i) => {
    if (best && best.stats.placedCount === best.stats.totalUnits) return;
    const r = packOnce(cfg, units, s, p, i === 0);
    if (!best) { best = r; return; }
    const d = r.stats.usedVolume - best.stats.usedVolume;
    if (d > 1e-6 || (Math.abs(d) < 1e-6 && r.stats.placedCount > best.stats.placedCount)) best = r;
  });
  return best;
}
