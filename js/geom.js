/* 几何工具：空间索引、碰撞、支撑面、姿态枚举
   坐标：x = 柜长（0 = 柜头，L = 柜门），y = 柜宽，z = 柜高，单位 cm */

export const TOL = 1e-6;

/** 均匀网格空间哈希：快速找出某个区域附近的已放置货物 */
export class SpaceIndex {
  constructor(cell = 60) {
    this.cell = cell;
    this.map = new Map();
    this.stamp = 0;
    this.all = [];
  }
  _range(v, d) {
    const c = this.cell;
    return [Math.floor(v / c), Math.floor((v + Math.max(d, 0.01) - 0.001) / c)];
  }
  add(b) {
    b._mark = 0;
    this.all.push(b);
    const [i0, i1] = this._range(b.x, b.dx), [j0, j1] = this._range(b.y, b.dy), [k0, k1] = this._range(b.z, b.dz);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let k = k0; k <= k1; k++) {
          const key = i + ',' + j + ',' + k;
          let arr = this.map.get(key);
          if (!arr) this.map.set(key, arr = []);
          arr.push(b);
        }
  }
  remove(b) {
    const [i0, i1] = this._range(b.x, b.dx), [j0, j1] = this._range(b.y, b.dy), [k0, k1] = this._range(b.z, b.dz);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let k = k0; k <= k1; k++) {
          const arr = this.map.get(i + ',' + j + ',' + k);
          if (!arr) continue;
          const p = arr.indexOf(b);
          if (p >= 0) arr.splice(p, 1);
        }
    const q = this.all.indexOf(b);
    if (q >= 0) this.all.splice(q, 1);
  }
  /** 返回与区域 (可外扩 pad) 有交集网格里的货物（去重） */
  query(x, y, z, dx, dy, dz, pad = 0) {
    this.stamp++;
    const out = [];
    const [i0, i1] = this._range(x - pad, dx + 2 * pad), [j0, j1] = this._range(y - pad, dy + 2 * pad),
          [k0, k1] = this._range(z - pad, dz + 2 * pad);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let k = k0; k <= k1; k++) {
          const arr = this.map.get(i + ',' + j + ',' + k);
          if (!arr) continue;
          for (const b of arr) {
            if (b._mark === this.stamp) continue;
            b._mark = this.stamp;
            out.push(b);
          }
        }
    return out;
  }
}

export function overlap3(a, x, y, z, dx, dy, dz, tol = TOL) {
  return a.x < x + dx - tol && x < a.x + a.dx - tol &&
         a.y < y + dy - tol && y < a.y + a.dy - tol &&
         a.z < z + dz - tol && z < a.z + a.dz - tol;
}

export function collides(index, x, y, z, dx, dy, dz, tol = TOL) {
  const near = index.query(x, y, z, dx, dy, dz);
  for (const b of near) if (overlap3(b, x, y, z, dx, dy, dz, tol)) return true;
  return false;
}

/** 底面被托住的比例（地面 = 1）。不可堆叠的货物顶面不算托面 */
export function supportRatio(index, x, y, z, dx, dy) {
  if (z <= 0.01) return 1;
  const near = index.query(x, y, z - 1, dx, dy, 1.2);
  let cov = 0;
  for (const p of near) {
    if (p.noStackTop) continue;
    if (Math.abs(p.z + p.dz - z) > 0.05) continue;
    const ox = Math.min(x + dx, p.x + p.dx) - Math.max(x, p.x);
    if (ox <= TOL) continue;
    const oy = Math.min(y + dy, p.y + p.dy) - Math.max(y, p.y);
    if (oy <= TOL) continue;
    cov += ox * oy;
  }
  return cov / (dx * dy);
}

/** 重力落位：footprint 下方、不高于 zMax 的最高托面 */
export function dropZ(index, x, y, dx, dy, zMax) {
  const near = index.query(x, y, 0, dx, dy, zMax + 0.01);
  let best = 0;
  for (const p of near) {
    const top = p.z + p.dz;
    if (top > zMax + TOL) continue;
    const ox = Math.min(x + dx, p.x + p.dx) - Math.max(x, p.x);
    if (ox <= TOL) continue;
    const oy = Math.min(y + dy, p.y + p.dy) - Math.max(y, p.y);
    if (oy <= TOL) continue;
    if (top > best) best = top;
  }
  return best;
}

/* ---------- 形状与姿态 ---------- */
export function shapeOf(it) {
  return it.shape === 'cyl' ? 'cyl' : it.shape === 'sphere' ? 'sphere' : 'box';
}

/** 圆柱：len = 轴向长度（长），d = 直径（宽/高取大）；球：d = 三边最大 */
export function normDims(it) {
  const s = shapeOf(it);
  if (s === 'cyl') return { s, len: +it.l, d: Math.max(+it.w, +it.h) };
  if (s === 'sphere') return { s, d: Math.max(+it.l, +it.w, +it.h) };
  return { s, l: +it.l, w: +it.w, h: +it.h };
}

/** 允许的摆放 → [dx, dy, dz] 列表（已去重）
   pose：auto 自动 / flat 平放 / upright 竖放（最长边朝上）/ side 侧立（中间边朝上） */
export function orientations(it) {
  const n = normDims(it);
  const pose = it.pose || 'auto';
  if (n.s === 'sphere') return [[n.d, n.d, n.d]];
  if (n.s === 'cyl') {
    const a = n.len, d = n.d;
    if (a <= d + 1e-6 && pose !== 'flat' && pose !== 'side') return [[d, d, a]];
    if (pose === 'upright') return [[d, d, a]];
    if (pose === 'flat' || pose === 'side') return [[a, d, d], [d, a, d]];
    return [[a, d, d], [d, a, d], [d, d, a]];
  }
  const d = [n.l, n.w, n.h];
  const byVert = v => { const r = [0, 1, 2].filter(i => i !== v); return [[r[0], r[1], v], [r[1], r[0], v]]; };
  let perms;
  if (pose === 'upright') {
    let v = 0; for (let i = 1; i < 3; i++) if (d[i] > d[v]) v = i;
    perms = byVert(v);
  } else if (pose === 'side') {
    const ord = [0, 1, 2].sort((a, b) => d[b] - d[a]);
    perms = byVert(ord[1]);
  } else if (pose === 'flat') {
    perms = [[0, 1, 2], [1, 0, 2]];
  } else {
    perms = it.rotate !== false
      ? [[0, 1, 2], [1, 0, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0], [2, 1, 0]]
      : [[0, 1, 2], [1, 0, 2]];
  }
  const out = [], seen = new Set();
  for (const p of perms) {
    const v = [d[p[0]], d[p[1]], d[p[2]]];
    if (!(v[0] > 0 && v[1] > 0 && v[2] > 0)) continue;
    const k = v.join('x');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** 根据实际高度判断摆放方式的中文名 */
export function poseLabel(it, dx, dy, dz) {
  const s = shapeOf(it);
  if (s === 'sphere') return '任意';
  if (s === 'cyl') {
    const n = normDims(it);
    return Math.abs(dz - n.len) < 1e-6 && Math.abs(dx - n.d) < 1e-6 && Math.abs(dy - n.d) < 1e-6 ? '立放' : '横放';
  }
  const o = [+it.l, +it.w, +it.h];
  if (Math.abs(dz - o[2]) < 1e-6) return '平放';
  if (Math.abs(dz - Math.max(...o)) < 1e-6) return '竖放';
  return '侧立';
}

/** 圆柱轴所在世界轴：0 柜长 / 1 柜宽 / 2 竖直 */
export function cylAxisOf(it, dx, dy, dz) {
  const n = normDims(it);
  if (Math.abs(dz - n.len) < 1e-6 && Math.abs(dx - n.d) < 1e-6 && Math.abs(dy - n.d) < 1e-6) return 2;
  if (Math.abs(dx - n.len) < 1e-6) return 0;
  if (Math.abs(dy - n.len) < 1e-6) return 1;
  return 2;
}
