/* =========================================================
   智能满载：横 / 竖 / 侧立多姿态混排 + 沿柜长分段配重 + 左右均衡
   之后再用剩余货物和小补位箱把零碎空档补满
   ========================================================= */
import { SpaceIndex, collides, supportRatio, dropZ } from './geom.js';

const PERMS = [[0, 1, 2], [1, 0, 2], [1, 2, 0], [0, 2, 1], [2, 0, 1], [2, 1, 0]];

const FILLERS = [
  { name: '补位箱 80×50×40', d: [80, 50, 40], weight: 20, color: '#93a9c0' },
  { name: '补位箱 60×40×40', d: [60, 40, 40], weight: 16, color: '#a2b7cb' },
  { name: '补位箱 50×40×30', d: [50, 40, 30], weight: 12, color: '#b0c1d2' },
  { name: '补位箱 40×30×30', d: [40, 30, 30], weight: 9, color: '#bccbd9' },
  { name: '补位箱 25×20×15', d: [25, 20, 15], weight: 3, color: '#cad5e0' }
];

/** 自然尺寸 [长, 宽, 高]：圆柱 = [轴长, 直径, 直径]，球 = 直径³ */
function baseDims(it) {
  const s = it.shape || 'box';
  if (s === 'cyl') { const d = Math.max(1, it.w, it.h); return [Math.max(1, it.l), d, d]; }
  if (s === 'sphere') { const d = Math.max(1, it.l, it.w, it.h); return [d, d, d]; }
  return [Math.max(1, it.l), Math.max(1, it.w), Math.max(1, it.h)];
}

function posesOf(bd) {
  const out = [], seen = new Set();
  for (const p of PERMS) {
    const dx = bd[p[0]], dy = bd[p[1]], dz = bd[p[2]];
    const k = Math.round(dx * 10) + 'x' + Math.round(dy * 10) + 'x' + Math.round(dz * 10);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ perm: p, dx, dy, dz });
  }
  return out;
}

/** 用户指定的姿态对应的 perm（评分时加分） */
function preferredPerm(it) {
  const s = it.shape || 'box';
  if (s === 'cyl') return it.pose === 'upright' ? [1, 2, 0] : [0, 1, 2];
  if (it.pose === 'side') {
    const bd = baseDims(it), ord = [0, 1, 2].sort((a, b) => bd[b] - bd[a]);
    return [ord[0], ord[2], ord[1]];
  }
  if (it.pose === 'upright') {
    const bd = baseDims(it), ord = [0, 1, 2].sort((a, b) => bd[b] - bd[a]);
    return [ord[1], ord[2], ord[0]];
  }
  return [0, 1, 2];
}

function orientName(shape, bd, ps) {
  if (shape === 'sphere') return '任意';
  if (shape === 'cyl') return ps.perm[2] === 0 ? '立放' : '横放';
  if (Math.abs(ps.dz - bd[2]) < 0.6) return '平放';
  if (Math.abs(ps.dz - Math.max(...bd)) < 0.6) return '竖放';
  return '侧立';
}

function decorate(b, shape, bd, ps) {
  b.shape = shape;
  b.cylAxis = -1; b.cylR = 0;
  if (shape === 'cyl') { b.cylR = bd[1] / 2; b.cylAxis = ps.perm.indexOf(0); }
  else if (shape === 'sphere') b.cylR = bd[0] / 2;
  b._o = orientName(shape, bd, ps);
  b.pose = b._o;
  return b;
}

export function smartPackPlan(items, c, opts = {}) {
  const { L, W, H } = c;
  const CAPW = c.payload > 0 ? c.payload : 1e12;
  const idx = new SpaceIndex(70);
  const placed = [];

  /* ---- 货物类型 ---- */
  let hasWeight = false;
  const types = [];
  for (const it of items) {
    const q = Math.max(0, Math.round(it.qty) || 0);
    if (!q || !(it.l > 0 && it.w > 0 && it.h > 0)) continue;
    const bd = baseDims(it);
    const w = Math.max(0, +it.weight || 0);
    if (w > 0) hasWeight = true;
    const vol = it.l * it.w * it.h;
    types.push({ it, bd, left: q, total: q, w, wEff: w > 0 ? w : Math.max(1, vol / 2600), vol,
                 shape: it.shape || 'box', poses: posesOf(bd), pref: preferredPerm(it) });
  }
  if (!types.length) return null;
  const volMax = Math.max(...types.map(t => t.vol));

  /* ---- 沿柜长分段的重量配额 ---- */
  const nseg = Math.max(1, Math.round(L / 220));
  const segLen = L / nseg;
  const segW = new Array(nseg).fill(0);
  const totalWEff = types.reduce((s, t) => s + t.wEff * t.total, 0);
  const segTarget = Math.max(1, totalWEff / nseg);
  const segOf = x => Math.max(0, Math.min(nseg - 1, Math.floor(x / segLen)));
  // 重货（总重占比高、单件也重）按件数平摊到各段，避免全挤在柜头
  const quota = types.map(t => {
    if (t.wEff * t.total < totalWEff * 0.06 || t.wEff < totalWEff * 0.02) return null;
    const per = new Array(nseg).fill(Math.floor(t.total / nseg));
    for (let s = 0, extra = t.total - per[0] * nseg; extra > 0; s++, extra--) per[s]++;
    return per;
  });

  let placedW = 0, cogYAcc = 0;

  /* ---- 评分：少留缝 > 大件先占 > 压底 > 分段配重 > 左右均衡 ---- */
  function score(t, ps, x, y, z) {
    let contact = 0;
    if (x < 0.6) contact += ps.dy * ps.dz;
    if (Math.abs(x + ps.dx - L) < 0.6) contact += ps.dy * ps.dz;
    if (y < 0.6) contact += ps.dx * ps.dz;
    if (Math.abs(y + ps.dy - W) < 0.6) contact += ps.dx * ps.dz;
    if (z < 0.6) contact += ps.dx * ps.dy;
    for (const b of idx.query(x, y, z, ps.dx, ps.dy, ps.dz, 1.5)) {
      const ox = Math.max(0, Math.min(x + ps.dx, b.x + b.dx) - Math.max(x, b.x));
      const oy = Math.max(0, Math.min(y + ps.dy, b.y + b.dy) - Math.max(y, b.y));
      const oz = Math.max(0, Math.min(z + ps.dz, b.z + b.dz) - Math.max(z, b.z));
      if (Math.abs(b.x + b.dx - x) < 1.2 || Math.abs(b.x - x - ps.dx) < 1.2) contact += oy * oz;
      if (Math.abs(b.y + b.dy - y) < 1.2 || Math.abs(b.y - y - ps.dy) < 1.2) contact += ox * oz;
      if (Math.abs(b.z + b.dz - z) < 1.2) contact += ox * oy;
    }
    const surf = 2 * (ps.dx * ps.dy + ps.dx * ps.dz + ps.dy * ps.dz);
    let s = 32 * Math.min(1, contact / surf);
    s += 15 * (t.vol / volMax);
    s += 13 * (1 - z / H);
    if (Math.abs(ps.dz - t.bd[2]) < 0.6) s += 5;
    if (ps.perm.join() === t.pref.join()) s += 12;
    const sg = segOf(x + ps.dx / 2);
    const over = segW[sg] + t.wEff - segTarget;
    let ws = over <= 0 ? 1 : Math.max(0, 1 - over / (segTarget * 0.7));
    if (t.wEff > segTarget * 0.1 && segW[sg] > segTarget * 0.9) ws *= 0.12;
    s += 22 * ws;
    const nw = placedW + t.wEff;
    const cy = (cogYAcc + t.wEff * (y + ps.dy / 2)) / nw;
    s += 24 * (1 - Math.min(1, Math.abs(cy - W / 2) / (W / 2)));
    s += 9 * Math.min(1, ps.dz / Math.max(1, H - z));
    return s;
  }

  /* ---- 极值点推进 ---- */
  const eps = [{ x: 0, y: 0, z: 0 }];
  const seen = new Set(['0:0:0']);
  const addEP = (x, y, z) => {
    if (x < -0.1 || y < -0.1 || z < -0.1 || x > L - 0.5 || y > W - 0.5 || z > H - 0.5) return;
    const k = Math.round(x * 2) + ':' + Math.round(y * 2) + ':' + Math.round(z * 2);
    if (seen.has(k)) return;
    seen.add(k);
    eps.push({ x, y, z });
  };

  let guard = 0;
  while (eps.length && guard++ < 20000) {
    // 先低处、再柜头、再靠一侧：一层层往上码，先里后外
    let bi = 0;
    for (let i = 1; i < eps.length; i++) {
      const p = eps[i], q = eps[bi];
      if (p.z < q.z - 0.6 || (Math.abs(p.z - q.z) <= 0.6 && (p.x < q.x - 0.6 ||
          (Math.abs(p.x - q.x) <= 0.6 && p.y < q.y - 0.6)))) bi = i;
    }
    const bp = eps[bi];
    let best = null;
    types.forEach((t, ti) => {
      if (t.left <= 0 || placedW + t.wEff > CAPW + 0.5) return;
      if (t.it.noStack && bp.z > 0.5) return;
      for (const ps of t.poses) {
        if (bp.x + ps.dx > L + 0.05 || bp.y + ps.dy > W + 0.05 || bp.z + ps.dz > H + 0.05) continue;
        if (quota[ti] && quota[ti][segOf(bp.x + ps.dx / 2)] <= 0) continue;
        if (collides(idx, bp.x, bp.y, bp.z, ps.dx, ps.dy, ps.dz, 0.01)) continue;
        if (supportRatio(idx, bp.x, bp.y, bp.z, ps.dx, ps.dy) < 0.62) continue;
        const sc = score(t, ps, bp.x, bp.y, bp.z);
        if (!best || sc > best.sc + 1e-9) best = { t, ti, ps, sc };
      }
    });
    if (!best) { eps.splice(bi, 1); continue; }
    const { t, ti, ps } = best;
    const b = decorate({
      x: bp.x, y: bp.y, z: bp.z, dx: ps.dx, dy: ps.dy, dz: ps.dz,
      name: t.it.name, src: t.it.id, color: t.it.color,
      weight: hasWeight ? t.w : Math.round(t.wEff), noStackTop: !!t.it.noStack
    }, t.shape, t.bd, ps);
    placed.push(b); idx.add(b);
    t.left--;
    placedW += t.wEff;
    const sg = segOf(b.x + b.dx / 2);
    segW[sg] += t.wEff;
    if (quota[ti]) quota[ti][sg]--;
    cogYAcc += t.wEff * (b.y + b.dy / 2);
    eps.splice(bi, 1);
    addEP(b.x + b.dx, b.y, b.z);
    addEP(b.x, b.y + b.dy, b.z);
    if (!b.noStackTop) addEP(b.x, b.y, b.z + b.dz);
    addEP(b.x, W - b.y - b.dy, b.z);               // 左右镜像点：沿柜宽对称码放
  }

  /* ---- 左右居中：整体平移，让重心回到柜宽中线 ---- */
  if (placed.length) {
    let ws = 0, cy = 0, minY = Infinity, maxY = 0;
    for (const b of placed) { const w = b.weight || 1; ws += w; cy += w * (b.y + b.dy / 2); minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + b.dy); }
    let shift = W / 2 - cy / ws;
    shift = Math.max(-minY, Math.min(W - maxY, shift));
    if (Math.abs(shift) > 0.3) {
      for (const b of placed) { idx.remove(b); b.y += shift; idx.add(b); }
    }
  }

  /* ---- 补满：剩余真实货物 → 补位箱，塞进零碎空档 ---- */
  let fillW = placedW;
  const cands = types.filter(t => t.left > 0).sort((a, b) => b.vol - a.vol)
    .map(t => ({ t, real: true }));
  if (opts.dummyFill !== false) {
    for (const f of FILLERS) {
      cands.push({ real: false, t: { it: { name: f.name, color: f.color, noStack: false }, bd: f.d, shape: 'box',
        left: Infinity, wEff: f.weight, w: f.weight, vol: f.d[0] * f.d[1] * f.d[2], poses: posesOf(f.d) } });
    }
  }
  // 补位箱只填已装货区域内的空档（不向柜门方向扩展货堆）
  const realMaxX = placed.reduce((m, b) => Math.max(m, b.x + b.dx), 0);
  if (cands.length && placed.length) {
    for (let round = 0; round < 3; round++) {
      const pts = [{ x: 0, y: 0, z: 0 }];
      for (const b of placed) {
        pts.push({ x: b.x + b.dx, y: b.y, z: b.z }, { x: b.x, y: b.y + b.dy, z: b.z },
                 { x: b.x + b.dx, y: 0, z: b.z }, { x: b.x, y: 0, z: b.z + b.dz });
        if (!b.noStackTop) pts.push({ x: b.x, y: b.y, z: b.z + b.dz });
      }
      pts.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
      let added = 0;
      for (const p of pts) {
        if (p.x > L - 10 || p.y > W - 10 || p.z > H - 10) continue;
        let done = false;
        for (const cd of cands) {
          const t = cd.t;
          if (t.left <= 0 || fillW + t.wEff > CAPW) continue;
          for (const ps of t.poses) {
            if (p.x + ps.dx > L + 0.05 || p.y + ps.dy > W + 0.05) continue;
            if (!cd.real && p.x + ps.dx > realMaxX + 0.05) continue;
            const z = p.z > 0 ? dropZ(idx, p.x, p.y, ps.dx, ps.dy, p.z) : 0;
            if (z + ps.dz > H + 0.05) continue;
            if (collides(idx, p.x, p.y, z, ps.dx, ps.dy, ps.dz, 0.01)) continue;
            if (supportRatio(idx, p.x, p.y, z, ps.dx, ps.dy) < 0.5) continue;
            const b = decorate({
              x: p.x, y: p.y, z, dx: ps.dx, dy: ps.dy, dz: ps.dz,
              name: t.it.name, src: t.it.id, color: t.it.color,
              weight: cd.real ? (hasWeight ? t.w : Math.round(t.wEff)) : t.w,
              noStackTop: !!t.it.noStack, _fill: cd.real ? 'real' : 'dummy'
            }, t.shape, t.bd, ps);
            placed.push(b); idx.add(b);
            t.left--; fillW += t.wEff; added++;
            done = true;
            break;
          }
          if (done) break;
        }
      }
      if (!added) break;
    }
  }

  return { placed, estWeight: !hasWeight };
}
