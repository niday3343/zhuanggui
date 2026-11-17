/* =========================================================
   表格导入：CSV / TSV / Excel / 粘贴；中英文表头自动识别；单位换算
   ========================================================= */
const HEADER_KEYS = {
  name: ['品名', '名称', '货名', '产品名称', '商品名称', '货物名称', '产品', '品项', 'description', 'name', 'item', 'goods', 'product'],
  l: ['长', '长度', '外箱长', '箱长', 'length', 'long', 'l'],
  w: ['宽', '宽度', '外箱宽', '箱宽', '直径', '外径', 'width', 'wide', 'dia', 'diameter', 'w'],
  h: ['高', '高度', '外箱高', '箱高', 'height', 'high', 'h'],
  qty: ['数量', '件数', '箱数', '总箱数', '箱量', 'quantity', 'qty', 'pcs', 'ctns', 'cartons'],
  weight: ['单重', '单件毛重', '单箱毛重', '单件重量', '单箱重量', '毛重', '重量', 'weight', 'kgs'],
  rotate: ['可翻转', '可旋转', '可倒置', 'rotate', 'flip', 'turnable'],
  noStack: ['不可堆叠', '不可压', '不可承压', '不可叠放', 'nostack', 'fragile'],
  shape: ['形状', '货物形状', '包装形状', 'shape'],
  pose: ['摆放', '摆放方式', '姿态', '放置方式', 'pose', 'orientation']
};

/** 表头归一：去空格/括号/标点，剥掉汉字后面的单位（长(cm) → 长） */
function normHeader(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[\s\u3000]/g, '')
    .replace(/[()（）\[\]【】{}:：_\-，,。.、*/]/g, '')
    .replace(/([\u4e00-\u9fa5])(cm|mm|kgs|kg|g|m|厘米|毫米|公分|米)$/, '$1');
}

/** 尺寸列（长宽高）只认精确名，其余列允许包含匹配 */
function findCol(headers, keys, exact) {
  let i = headers.findIndex(h => keys.includes(h));
  if (i >= 0 || exact) return i;
  return headers.findIndex(h => keys.some(k => k.length > 1 && h.includes(k)));
}

const num = v => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
};

function bool(v, dflt) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return dflt;
  if (/^(是|可|可以|允许|能|y|yes|true|1|√|✓|对|o)$/.test(s)) return true;
  if (/^(否|不可|不允许|不能|不|n|no|false|0|×|✗|错)$/.test(s)) return false;
  return dflt;
}

export function shapeFromText(v) {
  const s = String(v == null ? '' : v).toLowerCase();
  if (/球|圆盘|轮胎|圆形|sphere|ball/.test(s)) return 'sphere';
  if (/圆柱|圆桶|桶|卷|管|盘条|cyl|drum|roll|tube/.test(s)) return 'cyl';
  return 'box';
}
export function poseFromText(v) {
  const s = String(v == null ? '' : v).toLowerCase();
  if (/竖|立|upright|stand/.test(s)) return 'upright';
  if (/侧|side/.test(s)) return 'side';
  if (/平|躺|flat|lay/.test(s)) return 'flat';
  return 'auto';
}

/** 解析带分隔符的文本（自动判断 Tab / 逗号 / 分号，支持引号转义） */
export function parseDelimited(text) {
  text = String(text).replace(/\r\n?/g, '\n');
  const head = text.split('\n').slice(0, 6).join('\n');
  const cnt = ch => head.split(ch).length - 1;
  const tab = cnt('\t'), comma = cnt(','), semi = cnt(';');
  const d = tab > 0 && tab >= comma && tab >= semi ? '\t' : semi > comma && semi > tab ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function detectUnit(headerRow) {
  const t = headerRow.map(h => String(h).toLowerCase()).join(' ');
  if (/mm|毫米/.test(t)) return 'mm';
  if (/cm|厘米|公分/.test(t)) return 'cm';
  if (/米|\(m\)|（m）|\bm\b/.test(t)) return 'm';
  return 'cm';
}

/** 行数组 → 货物列表 */
export function rowsToItems(rows, unitMode) {
  if (!rows || !rows.length) return { error: '没有读到任何数据' };
  let hi = -1, headers = null;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const hs = (rows[i] || []).map(normHeader);
    if (findCol(hs, HEADER_KEYS.l, true) >= 0 && findCol(hs, HEADER_KEYS.w, true) >= 0 &&
        findCol(hs, HEADER_KEYS.h, true) >= 0 && findCol(hs, HEADER_KEYS.qty, false) >= 0) { hi = i; headers = hs; break; }
  }
  if (hi < 0) return { error: '没找到表头行。表格里需要同时有「长」「宽」「高」「数量」这四列。' };

  const col = {};
  for (const k of Object.keys(HEADER_KEYS)) col[k] = findCol(headers, HEADER_KEYS[k], ['l', 'w', 'h'].includes(k));
  const hasDia = headers.some(h => /直径|外径|diameter|^dia$/.test(h));
  const unit = unitMode === 'auto' ? detectUnit(rows[hi]) : unitMode;
  const k = unit === 'mm' ? 0.1 : unit === 'm' ? 100 : 1;

  const items = [];
  let skipped = 0, totalQty = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.every(v => String(v).trim() === '')) continue;
    const l = num(r[col.l]) * k, w = num(r[col.w]) * k, h = num(r[col.h]) * k;
    const q = Math.round(num(r[col.qty]));
    if (!(l > 0 && w > 0 && h > 0 && q > 0)) { skipped++; continue; }
    const name = col.name >= 0 && String(r[col.name] || '').trim() ? String(r[col.name]).trim() : '货物 ' + (items.length + 1);
    items.push({
      name,
      l: Math.round(l * 10) / 10, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10,
      qty: q,
      weight: col.weight >= 0 ? Math.max(0, num(r[col.weight])) : 0,
      rotate: col.rotate >= 0 ? bool(r[col.rotate], true) : true,
      noStack: col.noStack >= 0 ? bool(r[col.noStack], false) : false,
      shape: col.shape >= 0 ? shapeFromText(r[col.shape]) : (hasDia ? 'cyl' : 'box'),
      pose: col.pose >= 0 ? poseFromText(r[col.pose]) : 'auto'
    });
    totalQty += q;
  }
  if (!items.length) return { error: '表头认出来了，但数据行没有一行是有效的（长/宽/高/数量都要大于 0）。' };
  return { items, unit, skipped, totalQty, headerRow: hi + 1 };
}

/* ---------- Excel：优先本地 vendor，失败再走 CDN ---------- */
let xlsxReady = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (!xlsxReady) {
    xlsxReady = loadScript('vendor/xlsx.full.min.js')
      .catch(() => loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'))
      .catch(() => { xlsxReady = null; throw new Error('Excel 解析库加载失败，请改用 CSV 或直接粘贴'); });
  }
  return xlsxReady;
}

/** 文本文件：先按 UTF-8，出现乱码再按 GBK（国内 Excel 导出的 CSV 常见） */
export async function readTextSmart(file) {
  const buf = await file.arrayBuffer();
  let txt = new TextDecoder('utf-8').decode(buf);
  if (txt.includes('\uFFFD')) { try { txt = new TextDecoder('gbk').decode(buf); } catch (e) { /* 保持 UTF-8 */ } }
  return txt;
}

export async function readFileRows(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    await loadXLSX();
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  }
  return parseDelimited(await readTextSmart(file));
}

export function templateRows() {
  return [
    ['品名', '长(cm)', '宽(cm)', '高(cm)', '数量', '单重(kg)', '形状', '摆放', '可翻转', '不可堆叠'],
    ['纸箱 A', 60, 40, 50, 100, 12, '方箱', '自动', '是', '否'],
    ['纸箱 B', 50, 35, 40, 80, 8, '方箱', '自动', '是', '否'],
    ['圆桶 ⌀60×90', 90, 60, 60, 20, 25, '圆柱', '自动', '否', '否'],
    ['卷材 ⌀80×120', 120, 80, 80, 10, 180, '圆柱', '平放', '否', '是'],
    ['木箱机械', 120, 100, 110, 10, 620, '方箱', '平放', '否', '是'],
    [],
    ['说明：形状填「方箱 / 圆柱 / 圆形件」，摆放填「自动 / 平放 / 竖放 / 侧立」。'],
    ['圆柱：长=轴向长度，宽/高填直径；圆形件（球、轮胎）：长填直径即可。']
  ];
}
