'use strict';
/* ================= 关系图 =================
   卡片变成一张可以缩放、拖动的地图，卡片之间可以连线、写上关系。
   位置和连线存在 私密原件/关系图.json（不上传）。记录用「分类/标题」对应，同一分类里重名的依次加 #2、#3；
   改名、移动分类后会马上按新名字重新保存。相同邮箱 / 手机 / 账号的记录自动经过一个小圆点连在一起（虚线）。 */

const mapEl = $('#map'), worldEl = $('#mapWorld'), linkSvg = $('#mapLinks'), labelsEl = $('#mapLabels'), nodesEl = $('#mapNodes'), miniEl = $('#mapMini');
const K_MIN = 0.15, K_MAX = 2.5, FAR = 0.5;
const G = {
  ready: false,
  pos: new Map(),     // 节点 id → 中心点 {x, y}（世界坐标）
  size: new Map(),    // 节点 id → {w, h}（已经乘上这张卡片的缩放）
  scale: new Map(),   // 节点 id → 这张卡片单独的缩放（右上角拖出来的），没有就是 1
  links: [],          // 手动连线 {a, b, label}，a → b
  zones: [],          // 自动理图分出来的组 [[id, …], …]：每组画一块淡淡的底色
  hubs: [], hubLinks: [],
  cam: { x: 0, y: 0, k: 1 }, camSaved: false,
  auto: true,
  orphan: { nodes: {}, links: [] },  // 文件里有、但现在对不上记录的，原样保留
  sel: null,          // {type: 'node', id} | {type: 'link', l}
  entered: false, shownView: null, newLink: null,
};
const nodeEls = new Map();
const entryById = id => S.entries.find(e => e.id === id);
const hubById = id => G.hubs.find(h => h.id === id);

/* ---------- 保存 / 读取 ---------- */
function entryKeys() {
  const n = new Map(), idToKey = new Map(), keyToId = new Map();
  for (const e of S.entries) {
    const base = e.cat + '/' + e.title, c = (n.get(base) || 0) + 1;
    n.set(base, c);
    const k = c > 1 ? base + '#' + c : base;
    idToKey.set(e.id, k);
    keyToId.set(k, e.id);
  }
  return { idToKey, keyToId };
}

function graphFromData(g = {}) {
  const { keyToId } = entryKeys();
  G.pos.clear();
  G.scale.clear();
  G.links = [];
  G.orphan = { nodes: {}, links: [] };
  G.sel = null;
  G.auto = g.auto !== false;
  const v = g.view || {};
  G.camSaved = Number.isFinite(v.k) && !(v.x === 0 && v.y === 0 && v.k === 1);
  G.cam = { x: +v.x || 0, y: +v.y || 0, k: clamp(+v.k || 1, K_MIN, K_MAX) };
  for (const [k, p] of Object.entries(g.nodes || {})) {
    const id = k.startsWith('@') ? k : keyToId.get(k);
    if (id) { G.pos.set(id, { x: p[0], y: p[1] }); if (p[2]) G.scale.set(id, p[2]); } else G.orphan.nodes[k] = p;
  }
  for (const l of g.links || []) {
    const a = keyToId.get(l.a), b = keyToId.get(l.b);
    if (a && b) G.links.push({ a, b, label: l.label || '' }); else G.orphan.links.push(l);
  }
  G.zones = (g.zones || []).map(z => z.map(k => k.startsWith('@') ? k : keyToId.get(k)).filter(Boolean)).filter(z => z.length > 1);
  G.ready = true;
  G.entered = false;
  nodeEls.forEach(el => el.remove());
  nodeEls.clear();
}

function graphToData() {
  const { idToKey } = entryKeys();
  const hubIds = new Set(G.hubs.map(h => h.id));
  const nodes = { ...G.orphan.nodes }, links = [], seen = new Set();
  for (const [id, p] of G.pos) {
    const k = id.startsWith('@') ? (hubIds.has(id) ? id : null) : idToKey.get(id);
    if (!k) continue;
    nodes[k] = [Math.round(p.x), Math.round(p.y)];
    const s = G.scale.get(id);
    if (s && s !== 1) nodes[k].push(Math.round(s * 100) / 100);
  }
  for (const l of G.links) {
    const a = idToKey.get(l.a), b = idToKey.get(l.b);
    if (a && b && !seen.has(a + '\n' + b)) { seen.add(a + '\n' + b); links.push({ a, b, label: l.label }); }
  }
  for (const l of G.orphan.links) if (!seen.has(l.a + '\n' + l.b)) links.push(l);
  const zones = G.zones.map(z => z.map(id => id.startsWith('@') ? id : idToKey.get(id)).filter(Boolean)).filter(z => z.length > 1);
  return { version: 1, auto: G.auto, view: G.cam, nodes, links, zones };
}

let gTimer = 0, gSaving = Promise.resolve();
function graphSave(delay = 400) {
  if (!G.ready) return;
  clearTimeout(gTimer);
  gTimer = setTimeout(graphFlush, delay);
}
function graphFlush() {
  clearTimeout(gTimer);
  gTimer = 0;
  const body = graphToData();
  gSaving = gSaving.then(() => api('graph', body).catch(err => toastErr('关系图保存失败：' + err.message)));
  return gSaving;
}
/* 重新读数据前，把还没写出去的先写掉 */
function graphFlushPending() { return gTimer ? graphFlush() : gSaving; }
/* 记录改名、换分类、删除后：按新名字重新保存（用过关系图才保存） */
function graphTouch() {
  if (G.ready && (G.pos.size || G.links.length)) graphSave(0);
}

/* ---------- 自动关联：相同邮箱 / 手机 / 账号 ---------- */
const HUB = {
  mail: { ic: 'mail', name: '同一邮箱' },
  phone: { ic: 'phone', name: '同一手机号' },
  user: { ic: 'user', name: '同一账号' },
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function idKind(label, value) {
  const v = value.trim();
  if (!v || isSecret(label) || isUrl(label)) return null;
  if (EMAIL_RE.test(v)) return { k: 'mail', norm: v.toLowerCase() };
  if (/手机|电话|phone|tel/i.test(label) || /^(\+?86)?1\d{10}$/.test(v.replace(/[\s()-]/g, ''))) {
    const d = v.replace(/\D/g, '').replace(/^86(?=1\d{10}$)/, '');
    return d.length >= 5 ? { k: 'phone', norm: d } : null;
  }
  if (/邮箱|mail/i.test(label)) return null; // 邮箱栏里不是邮箱（比如「同上」）不算
  if (/账户|账号|帳號|帐号|用户名|用户ID|Apple ?ID|QQ号|^ID$|UID/i.test(label)) return { k: 'user', norm: v.toLowerCase() };
  return null;
}
/* 文件里只存哈希，不存邮箱、手机号本身 */
function hash53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function computeHubs() {
  const m = new Map();
  for (const e of S.entries) {
    for (const f of e.fields) {
      const t = idKind(f.label || '', f.value || '');
      if (!t) continue;
      const id = '@' + t.k + ':' + hash53(t.norm);
      let h = m.get(id);
      if (!h) m.set(id, h = { id, kind: t.k, value: f.value.trim(), members: [] });
      if (!h.members.includes(e.id)) h.members.push(e.id);
    }
  }
  G.hubs = [...m.values()].filter(h => h.members.length > 1);
  G.hubLinks = G.hubs.flatMap(h => h.members.map(a => ({ a, b: h.id, auto: h.kind })));
}

/* ---------- 节点 ---------- */
function entryNodeHTML(e) {
  const url = entryUrl(e);
  const rows = e.fields.map((f, idx) => [f, idx]).filter(([f]) => !isUrl(f.label) && f.value);
  const show = rows.slice(0, 4);
  return `<div class="node-head">
      <div class="avatar">${avatarInner(e.title, e.icon)}</div>
      <div class="node-title"><h4>${hl(e.title)}</h4><span>${esc(e.cat)}${url ? ' · ' + esc(prettyUrl(url)) : ''}</span></div>
      <button class="icon-btn node-edit" data-act="edit" title="编辑（双击卡片也可以）">${icon('edit')}</button>
    </div>
    ${show.length ? `<div class="node-rows">${show.map(([f, idx]) => {
      const secret = isSecret(f.label), shown = secret && S.revealed.has(e.id + ':' + idx);
      return `<div class="nrow${secret ? ' secret' : ''}${shown ? ' shown' : ''}" data-idx="${idx}"><span>${esc(f.label || '备注')}</span>` +
        `<b>${secret && !shown ? mask(f.value) : secret ? esc(f.value) : hl(f.value)}</b>` +
        `<span class="nact">${secret ? `<button class="icon-btn" data-act="reveal" title="显示 / 隐藏">${icon(shown ? 'eyeOff' : 'eye')}</button>` : ''}` +
        `<button class="icon-btn" data-act="copy" title="复制">${icon('copy')}${icon('check', 'ok')}</button></span></div>`;
    }).join('')}${rows.length > show.length ? `<div class="nmore">还有 ${rows.length - show.length} 项</div>` : ''}</div>` : ''}
    <span class="port" title="按住拖到另一张卡片上，连一条线"></span>${GRIP}`;
}
const GRIP = `<span class="grip" title="拖动放大、缩小这张卡片（双击恢复原来大小）">${icon('resize')}</span>`;
function hubNodeHTML(h) {
  return `<span class="hub-ic">${icon(HUB[h.kind].ic)}</span><span class="hub-v">${esc(h.value)}</span><span class="hub-n" title="${h.members.length} 条记录用了它">${h.members.length}</span>${GRIP}`;
}

function measure() {
  nodeEls.forEach((el, id) => { const s = G.scale.get(id) || 1; G.size.set(id, { w: el.offsetWidth * s, h: el.offsetHeight * s }); });
}
function placeNode(id) {
  const el = nodeEls.get(id), p = G.pos.get(id), s = G.scale.get(id) || 1;
  if (!el || !p) return;
  el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)${s !== 1 ? ` scale(${s})` : ''}`;
  el.style.setProperty('--nk', s);  // 右上角的把手、小圆点不跟着一起变大
}
/* 单独放大缩小一张卡片：以左下角为准，右上角跟着手走 */
const NODE_SCALE = [0.4, 3];
function setNodeScale(id, s, anchor) {
  const el = nodeEls.get(id), p = G.pos.get(id);
  if (!el || !p) return;
  const bw = el.offsetWidth, bh = el.offsetHeight, old = G.scale.get(id) || 1;
  s = clamp(Math.round(s * 100) / 100, NODE_SCALE[0], NODE_SCALE[1]);
  const bl = anchor || { x: p.x - bw * old / 2, y: p.y + bh * old / 2 };
  if (Math.abs(s - 1) < 0.04) s = 1;  // 靠近原大小时吸附到 100%
  s === 1 ? G.scale.delete(id) : G.scale.set(id, s);
  p.x = bl.x + bw * s / 2;
  p.y = bl.y - bh * s / 2;
  G.size.set(id, { w: bw * s, h: bh * s });
  el.dataset.pct = Math.round(s * 100) + '%';
  placeNode(id);
  drawLinks();
}
const mapItems = () => [...S.entries.map(e => ({ id: e.id, e })), ...(G.auto ? G.hubs.map(h => ({ id: h.id, h })) : [])];

function renderMap(fresh) {
  if (!G.ready) return;
  computeHubs();
  const items = mapItems();
  const keep = new Set(items.map(x => x.id));
  nodeEls.forEach((el, id) => { if (!keep.has(id)) { el.remove(); nodeEls.delete(id); } });
  if (G.sel?.type === 'node' && !keep.has(G.sel.id)) G.sel = null;
  if (G.sel?.type === 'link' && !G.links.includes(G.sel.l)) G.sel = null;
  const q = S.q.trim();
  for (const it of items) {
    const v = it.e ? JSON.stringify([it.e.title, it.e.cat, iconKey(it.e.icon), it.e.fields, q]) : JSON.stringify([it.h.value, it.h.members.length]);
    const old = nodeEls.get(it.id);
    if (old && old.dataset.v === v) continue;
    const n = document.createElement('div');
    n.className = it.e ? 'node' : 'node hub ' + it.h.kind;
    n.dataset.id = it.id;
    n.dataset.v = v;
    if (it.e) { setAvatarVars(n, it.e.title, it.e.icon); n.innerHTML = entryNodeHTML(it.e); } else {
      n.innerHTML = hubNodeHTML(it.h);
      n.title = `${HUB[it.h.kind].name}：${it.h.value}（${it.h.members.length} 条记录）`;
    }
    if (old) old.replaceWith(n); else nodesEl.appendChild(n);
    nodeEls.set(it.id, n);
  }
  measure();

  const missing = items.filter(x => !G.pos.has(x.id));
  let fitAll = false;
  if (missing.length) {
    const fixed = new Set(items.filter(x => G.pos.has(x.id)).map(x => x.id));
    if (!fixed.size) fitAll = true;
    layoutPositions(items.map(x => x.id), fixed).forEach((p, id) => G.pos.set(id, p));
    graphSave();
  }
  items.forEach(x => placeNode(x.id));
  applyDim();
  drawLinks();

  const first = !G.entered;
  const viewChanged = G.shownView !== S.view;
  G.entered = true;
  G.shownView = S.view;
  if (first) {
    if (fitAll || !G.camSaved || S.view !== 'all') fitTo(visibleIds(), false); else applyCam();
    if (fresh) enterAnim();
    spreadSoon();  // 在卡片视图里改过图标大小的话，这里可能有叠在一起的
  } else if (viewChanged) fitTo(visibleIds(), true);
  renderEmpty(!S.entries.length, 'entries');
  mapEl.hidden = !S.entries.length;
  syncTip();
  $('#mapAuto').classList.toggle('on', G.auto);
  updateSub();
}

function enterAnim() {
  if (REDUCED) return;
  const W = mapEl.clientWidth, H = mapEl.clientHeight;
  nodeEls.forEach((el, id) => {
    const p = G.pos.get(id), c = G.cam;
    const d = Math.hypot(p.x * c.k + c.x - W / 2, p.y * c.k + c.y - H / 2);
    el.style.setProperty('--d', Math.min(600, d * 0.6) + 'ms');
  });
  mapEl.classList.remove('enter');
  void mapEl.offsetWidth;
  mapEl.classList.add('enter');
  clearTimeout(enterAnim.t);
  enterAnim.t = setTimeout(() => mapEl.classList.remove('enter'), 1400);
}

/* 分类筛选、搜索：不在当前范围里的卡片变淡；选中卡片或连线时，其他的也变淡 */
const visibleIds = () => {
  const vis = new Set(visibleEntries().map(e => e.id));
  const ids = [...vis];
  if (G.auto) G.hubs.forEach(h => { if (h.members.some(m => vis.has(m))) ids.push(h.id); });
  return ids.filter(id => nodeEls.has(id));
};
function hotSet() {
  const s = G.sel;
  if (!s) return null;
  if (s.type === 'link') return new Set([s.l.a, s.l.b]);
  const hot = new Set([s.id]);
  for (const l of [...G.links, ...(G.auto ? G.hubLinks : [])]) {
    if (l.a === s.id) hot.add(l.b);
    if (l.b === s.id) hot.add(l.a);
  }
  return hot;
}
function applyDim() {
  const filtering = S.view !== 'all' || !!S.q.trim();
  const vis = new Set(visibleIds()), hot = hotSet();
  nodeEls.forEach((el, id) => {
    el.classList.toggle('dim', filtering && !vis.has(id));
    el.classList.toggle('hot', !!hot?.has(id));
    el.classList.toggle('sel', G.sel?.type === 'node' && G.sel.id === id);
  });
  mapEl.classList.toggle('focus', !!hot);
  syncFocusBar();
}

/* 左上角说明为什么有的卡片变淡了，旁边一个按钮一键恢复 */
function syncFocusBar() {
  const bar = $('#mapFocus'), q = S.q.trim();
  const n = visibleEntries().length, sel = G.sel?.type === 'node' && G.sel.id;
  let text = '', btn = '', kind = '';
  if (sel) {
    const e = entryById(sel), h = hubById(sel);
    text = `已选中「${e?.title || h?.value || ''}」，只亮着它和跟它连着的`;
    btn = '取消选中'; kind = 'sel';
  } else if (q) {
    text = `搜索「${q}」${S.view !== 'all' ? `（在「${S.view.slice(4)}」里）` : ''}：找到 ${n} 条，其他的变淡了`;
    btn = '清除搜索'; kind = 'q';
  } else if (S.view !== 'all') {
    text = `正在看「${S.view.slice(4)}」分类（${n} 条），其他分类变淡了`;
    btn = '看全部'; kind = 'cat';
  }
  bar.hidden = !kind;
  syncTip();  // 顶上位置不够，和操作提示两个只留一个
  if (!kind) return;
  $('#mapFocusText').textContent = text;
  $('#mapFocusBtn').textContent = btn;
  bar.dataset.kind = kind;
}
$('#mapFocusBtn').addEventListener('click', () => {
  const kind = $('#mapFocus').dataset.kind;
  if (kind === 'sel') { G.sel = null; applyDim(); drawLinks(); }
  if (kind === 'q') { searchIn.value = ''; S.q = ''; renderGrid(); }
  if (kind === 'cat') setView('all');
});

/* ---------- 连线 ---------- */
function rectOf(id) {
  const p = G.pos.get(id), s = G.size.get(id);
  return p && s && nodeEls.has(id) ? { x: p.x, y: p.y, w: s.w, h: s.h } : null;
}
/* 从矩形中心朝 (tx, ty) 出发，和矩形边框（外扩 pad）的交点 */
function edgePoint(r, tx, ty, pad = 6) {
  const dx = tx - r.x, dy = ty - r.y;
  if (!dx && !dy) return { x: r.x, y: r.y };
  const t = Math.min(1, Math.min((r.w / 2 + pad) / (Math.abs(dx) || 1e-9), (r.h / 2 + pad) / (Math.abs(dy) || 1e-9)));
  return { x: r.x + dx * t, y: r.y + dy * t };
}
const f1 = n => Math.round(n * 10) / 10;
function linkGeom(ra, rb, off) {
  const dx = rb.x - ra.x, dy = rb.y - ra.y, len = Math.hypot(dx, dy) || 1;
  const c = { x: (ra.x + rb.x) / 2 - dy / len * off, y: (ra.y + rb.y) / 2 + dx / len * off };
  const p0 = edgePoint(ra, c.x, c.y), p2 = edgePoint(rb, c.x, c.y, 8);
  const tx = p2.x - c.x, ty = p2.y - c.y, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl;
  const end = { x: p2.x - ux * 9, y: p2.y - uy * 9 };   // 线停在箭头底部，别戳出箭头尖
  const head = `M${f1(p2.x)} ${f1(p2.y)}L${f1(end.x - uy * 5.5)} ${f1(end.y + ux * 5.5)}L${f1(end.x + uy * 5.5)} ${f1(end.y - ux * 5.5)}Z`;
  return {
    d: `M${f1(p0.x)} ${f1(p0.y)}Q${f1(c.x)} ${f1(c.y)} ${f1(end.x)} ${f1(end.y)}`, head,
    mid: { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * end.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * end.y },
  };
}

function drawLinks() {
  const dimOf = id => nodeEls.get(id)?.classList.contains('dim');
  const hot = hotSet();
  const pairs = new Set(G.links.map(l => l.a + '\n' + l.b));
  let svg = '', labels = '';
  // 自动理图分出来的组：每组一块淡淡的圆角底色，卡片挪了也跟着变
  G.zones.forEach((z, zi) => {
    const rs = z.map(rectOf).filter(Boolean);
    if (rs.length < 2) return;
    const pad = 40, x0 = Math.min(...rs.map(r => r.x - r.w / 2)) - pad, y0 = Math.min(...rs.map(r => r.y - r.h / 2)) - pad;
    const x1 = Math.max(...rs.map(r => r.x + r.w / 2)) + pad, y1 = Math.max(...rs.map(r => r.y + r.h / 2)) + pad;
    svg += `<rect class="zone" x="${f1(x0)}" y="${f1(y0)}" width="${f1(x1 - x0)}" height="${f1(y1 - y0)}" rx="36" style="--zh:${(zi * 67 + 220) % 360}"/>`;
  });
  if (G.auto) {
    for (const l of G.hubLinks) {
      const ra = rectOf(l.a), rb = rectOf(l.b);
      if (!ra || !rb) continue;
      const p0 = edgePoint(ra, rb.x, rb.y, 2), p2 = edgePoint(rb, ra.x, ra.y, 2);
      const cls = ['lk', 'auto', l.auto, dimOf(l.a) || dimOf(l.b) ? 'dim' : '', hot?.has(l.a) && hot?.has(l.b) ? 'hot' : ''].join(' ');
      svg += `<g class="${cls}"><path class="ln" d="M${f1(p0.x)} ${f1(p0.y)}L${f1(p2.x)} ${f1(p2.y)}"/></g>`;
    }
  }
  G.links.forEach((l, i) => {
    const ra = rectOf(l.a), rb = rectOf(l.b);
    if (!ra || !rb) return;
    const g = linkGeom(ra, rb, pairs.has(l.b + '\n' + l.a) ? 34 : 0);
    const sel = G.sel?.type === 'link' && G.sel.l === l;
    const isHot = sel || (G.sel?.type === 'node' && (l.a === G.sel.id || l.b === G.sel.id));
    const cls = ['lk', sel ? 'sel' : '', isHot ? 'hot' : '', dimOf(l.a) || dimOf(l.b) ? 'dim' : '', G.newLink === l || l.fresh ? 'new' : ''].join(' ');
    svg += `<g class="${cls}" data-i="${i}"><path class="hit" d="${g.d}"/><path class="ln" d="${g.d}" pathLength="100"/><path class="hd" d="${g.head}"/></g>`;
    if (l.label) labels += `<button class="map-label ${cls}" data-i="${i}" style="left:${f1(g.mid.x)}px;top:${f1(g.mid.y)}px">${esc(l.label)}</button>`;
  });
  if (drag?.type === 'connect') {
    const ra = rectOf(drag.from), t = drag.target && rectOf(drag.target);
    const end = t ? edgePoint(t, ra.x, ra.y, 8) : { x: drag.x, y: drag.y };
    const p0 = edgePoint(ra, end.x, end.y);
    svg += `<path class="tmp${t ? ' ok' : ''}" d="M${f1(p0.x)} ${f1(p0.y)}L${f1(end.x)} ${f1(end.y)}"/><circle class="tmp-dot" cx="${f1(end.x)}" cy="${f1(end.y)}" r="5"/>`;
  }
  // SVG 的范围跟着内容走，超出范围的部分点不到
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  G.pos.forEach((p, id) => {
    const s = G.size.get(id);
    if (!s || !nodeEls.has(id)) return;
    x0 = Math.min(x0, p.x - s.w / 2); y0 = Math.min(y0, p.y - s.h / 2);
    x1 = Math.max(x1, p.x + s.w / 2); y1 = Math.max(y1, p.y + s.h / 2);
  });
  if (drag?.type === 'connect') { x0 = Math.min(x0, drag.x); y0 = Math.min(y0, drag.y); x1 = Math.max(x1, drag.x); y1 = Math.max(y1, drag.y); }
  if (x0 === Infinity) { x0 = y0 = 0; x1 = y1 = 1; }
  x0 -= 400; y0 -= 400; x1 += 400; y1 += 400;
  Object.assign(linkSvg.style, { left: x0 + 'px', top: y0 + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px' });
  linkSvg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  linkSvg.innerHTML = svg;
  labelsEl.innerHTML = labels;
  drawMini();
}

function addLink(a, b) {
  const had = G.links.find(l => l.a === a && l.b === b);
  if (had) { G.sel = { type: 'link', l: had }; applyDim(); drawLinks(); return toast('这两张卡片已经连过了', { icon: 'link' }); }
  const l = { a, b, label: '' };
  G.links.push(l);
  G.newLink = l;
  setTimeout(() => { if (G.newLink === l) { G.newLink = null; drawLinks(); } }, 800);
  applyDim();
  drawLinks();
  graphSave(0);
  $('#mapTip').hidden = true;
  const g = linkGeom(rectOf(a), rectOf(b), G.links.some(x => x.a === b && x.b === a) ? 34 : 0);
  openLinkPop(l, worldToClient(g.mid.x, g.mid.y), true);
}

function deleteLink(l) {
  const i = G.links.indexOf(l);
  if (i < 0) return;
  G.links.splice(i, 1);
  if (G.sel?.l === l) G.sel = null;
  closeLinkPop();
  applyDim();
  drawLinks();
  graphSave(0);
  const na = entryById(l.a)?.title, nb = entryById(l.b)?.title;
  toast(`已删除「${na}」和「${nb}」之间的连线`, {
    icon: 'trash', action: '撤销', duration: 5000,
    onAction: () => { G.links.splice(Math.min(i, G.links.length), 0, l); renderMap(); graphSave(0); },
  });
}

/* ---------- 连线说明的小窗 ---------- */
const LINK_WORDS = ['注册邮箱', '绑定手机', '第三方登录', '找回密码', '同一账号', '子账号', '付款'];
const linkWords = () => S.settings?.linkWords || LINK_WORDS;  // 点一下就能填上的快捷词，可以在「修改」里改
const lkPop = document.createElement('div');
lkPop.className = 'lk-pop';
lkPop.hidden = true;
lkPop.innerHTML = `
  <div class="lk-ends"><span class="lk-a"></span>${icon('chev')}<span class="lk-b"></span></div>
  <input class="lk-in" maxlength="40" placeholder="写上关系，例如：注册邮箱（可以不填）" autocomplete="off" spellcheck="false">
  <div class="lk-chips"></div>
  <div class="lk-foot">
    <button class="btn ghost sm" data-k="swap">${icon('swap')}反转方向</button>
    <span class="grow"></span>
    <button class="btn danger-ghost sm" data-k="del">${icon('trash')}删除连线</button>
  </div>`;
document.body.appendChild(lkPop);
const lkIn = $('.lk-in', lkPop);
let lkCur = null;

function openLinkPop(l, at, focus) {
  lkCur = l;
  $('.lk-a', lkPop).textContent = entryById(l.a)?.title || '?';
  $('.lk-b', lkPop).textContent = entryById(l.b)?.title || '?';
  lkIn.value = l.label;
  syncLinkChips();
  lkPop.hidden = false;
  lkPop.style.animation = 'none'; void lkPop.offsetWidth; lkPop.style.animation = '';
  const w = lkPop.offsetWidth, h = lkPop.offsetHeight;
  lkPop.style.left = clamp(at.x - w / 2, 12, innerWidth - w - 12) + 'px';
  lkPop.style.top = clamp(at.y + 18, 12, innerHeight - h - 12) + 'px';
  if (focus) setTimeout(() => lkIn.focus(), 40);
}
function closeLinkPop() {
  if (lkPop.hidden) return;
  lkPop.hidden = true;
  lkCur = null;
  if (lkPop.contains(document.activeElement)) document.activeElement.blur();
  if (G.sel?.type === 'link') { G.sel = null; applyDim(); drawLinks(); }  // 选中连线只是为了编辑它
}
function syncLinkChips() {
  const cur = (lkCur?.label || '').trim(), words = linkWords();
  $('.lk-chips', lkPop).innerHTML = words.map(s => `<button class="chip-btn${s === cur ? ' on' : ''}" data-s="${esc(s)}" title="右键可以去掉">${esc(s)}</button>`).join('') +
    (cur && cur.length <= 20 && !words.includes(cur) ? `<button class="chip-btn chip-edit" data-k="keep" title="以后点一下就能填上">${icon('plus')}存为快捷词</button>` : '') +
    `<button class="chip-btn chip-edit" data-k="words" title="增删、改名、排序这些快捷词">${icon('edit')}修改</button>`;
}
async function saveLinkWords(words, msg) {
  try { S.settings = (await api('settings', { linkWords: words })).settings; } catch (err) { toastErr('保存设置失败：' + err.message); return false; }
  if (!lkPop.hidden) syncLinkChips();
  if (msg) toast(msg, { icon: 'check' });
  return true;
}
lkPop.addEventListener('contextmenu', ev => {
  const b = ev.target.closest('[data-s]'), s = b?.dataset.s;
  ev.preventDefault();
  if (s == null) return;
  menu(b, [
    { icon: 'x', label: `去掉快捷词「${s}」`, run: () => saveLinkWords(linkWords().filter(x => x !== s), `已去掉「${s}」`) },
    { icon: 'edit', label: '修改快捷词…', run: () => { closeLinkPop(); openLinkWords(); } },
  ]);
});

/* 改快捷词：增删、排序、双击改名；改了名的词，已经画好的连线上也可以一起换掉 */
function openLinkWords() {
  const lists = { linkWords: [...linkWords()] }, renamed = new Map();  // 原来的词 → 现在改成的词
  const { wrap, close } = modal(`
    <div class="up-hero"><div class="up-cloud">${icon('link')}</div><div><h2>连线快捷词</h2><p>写连线关系时点一下就能填上，只保存在这台电脑上</p></div></div>
    <div class="fp" data-k="linkWords"></div>
    <label class="lw-sync" hidden><input type="checkbox" checked><span></span></label>
    <p class="fp-hint">拖动调整顺序，双击改名，点 × 去掉，在虚线框里输入新词按回车添加，每个最多 20 个字。</p>
    <div class="modal-foot"><button class="btn ghost sm" data-k="reset">${icon('refresh')}恢复默认</button><span class="grow"></span><button class="btn ghost" data-close>取消</button><button class="btn primary" data-k="save">${icon('check')}保存</button></div>`, 'wide');
  const sync = $('.lw-sync', wrap);
  // 已有连线里用了改名前那个词的，改完后一起换成新词
  const changes = () => [...renamed].filter(([a, b]) => a !== b && lists.linkWords.includes(b)).map(([a, b]) => ({ a, b, n: G.links.filter(l => l.label.trim() === a).length })).filter(x => x.n);
  const syncHint = () => {
    const c = changes();
    sync.hidden = !c.length;
    $('span', sync).textContent = `已有的连线也一起改：${c.map(x => `「${x.a}」→「${x.b}」${x.n} 条`).join('，')}`;
  };
  const ed = chipLists(wrap, lists, {
    clean: v => v.replace(/[\r\n]/g, ' ').trim().slice(0, 20),
    placeholder: '＋ 新快捷词，回车添加',
    onRename: (k, old, v) => {
      const from = [...renamed].find(([, b]) => b === old)?.[0] ?? old;  // 连着改了几次，按最早的词算
      renamed.set(from, v);
      syncHint();
    },
  });
  $('[data-k="reset"]', wrap).addEventListener('click', () => { lists.linkWords = [...LINK_WORDS]; renamed.clear(); ed.render('linkWords'); syncHint(); });
  wrap.addEventListener('click', ev => { if (ev.target.closest('.fp-x')) syncHint(); });
  $('[data-close]', wrap).addEventListener('click', close);
  $('[data-k="save"]', wrap).addEventListener('click', async () => {
    if (!ed.flush()) return;  // 输入框里还没回车的也加上
    const c = $('input', sync).checked ? changes() : [];
    if (!await saveLinkWords(lists.linkWords, c.length ? '' : '快捷词已保存')) return;
    close();
    if (!c.length) return;
    const map = new Map(c.map(x => [x.a, x.b])), old = [];
    G.links.forEach(l => { const to = map.get(l.label.trim()); if (to) { old.push([l, l.label]); l.label = to; } });
    drawLinks();
    graphSave(0);
    toast(`快捷词已保存，${old.length} 条连线上的关系也换成了新词`, {
      icon: 'check', action: '撤销连线的改动', duration: 6000,
      onAction: () => { old.forEach(([l, v]) => { l.label = v; }); drawLinks(); graphSave(0); },
    });
  });
}
function setLinkLabel(v) {
  if (!lkCur) return;
  lkCur.label = v.replace(/[\r\n]/g, ' ').slice(0, 40);
  syncLinkChips();
  drawLinks();
  graphSave();
}
lkIn.addEventListener('input', () => setLinkLabel(lkIn.value));
lkIn.addEventListener('keydown', ev => {
  if (ev.isComposing) return;
  if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setLinkLabel(lkIn.value.trim()); closeLinkPop(); }
});
lkPop.addEventListener('click', ev => {
  const s = ev.target.closest('[data-s]')?.dataset.s, k = ev.target.closest('[data-k]')?.dataset.k;
  if (s != null) { setLinkLabel(lkCur.label === s ? '' : s); lkIn.value = lkCur.label; closeLinkPop(); }
  if (k === 'keep' && lkCur) { const w = lkCur.label.trim(); saveLinkWords([...linkWords(), w], `已把「${w}」存为快捷词`); }
  if (k === 'words') { setLinkLabel(lkIn.value.trim()); closeLinkPop(); openLinkWords(); }
  if (k === 'del') deleteLink(lkCur);
  if (k === 'swap' && lkCur) {
    const l = lkCur;
    if (G.links.some(x => x.a === l.b && x.b === l.a)) return toast('反方向已经有一条连线了', { icon: 'link' });
    [l.a, l.b] = [l.b, l.a];
    $('.lk-a', lkPop).textContent = entryById(l.a)?.title || '?';
    $('.lk-b', lkPop).textContent = entryById(l.b)?.title || '?';
    drawLinks();
    graphSave(0);
  }
});
document.addEventListener('pointerdown', ev => {
  if (!lkPop.hidden && !lkPop.contains(ev.target) && !ev.target.closest('.map-label, .lk .hit')) {
    setLinkLabel(lkIn.value.trim());
    closeLinkPop();
  }
}, true);

/* ---------- 一键连线：按卡片内容补连线，按连线补卡片 ----------
   全在本机算：比对各记录里相同的邮箱、手机号、账号，认出「谁提供、谁在用」（比如 QQ 邮箱归 QQ、手机号归运营商、
   身份证号归身份证），从提供的一方连到用的一方；反过来，已经画好、写了关系的连线，用的一方那一栏还空着的，
   从提供的一方抄过去。先预览，勾选的才改，改完可以撤销。 */
const BIND_RE = /绑定|注册|辅助|备用|关联|认证|实名|找回|登录|登陆|授权|联系|安全|恢复|邀请|第三方|付款|支付/;
const FILLER_RE = /^(同上|无|暂无|没有|未绑定|未设置|未填|未知|不详|否|是|空|-+|\/|\.+|…+|n\/?a|none|null)$/i;
const ID_LABEL_RE = /账|帐|號|号|ID|用户|名|实名|认证|身份|证|绑定|注册|登录|关联/i;
const USER_LABEL_RE = /账户|账号|帐号|帳號|用户名|用户ID|Apple ?ID|QQ号|^ID$|UID/i;
const CARRIER_RE = /联通|移动|电信|广电|unicom|mobile|telecom|手机卡|电话卡|SIM/i;
const IDDOC_RE = /身份证|证件|护照|户口|驾照|驾驶证|社保|通行证/;
const MAIL_OWNER = [
  [/^(vip\.)?(qq|foxmail)\.com$/, /qq|腾讯|foxmail/i],
  [/^(gmail|googlemail)\.com$/, /谷歌|google|gmail/i],
  [/^(outlook|hotmail|live|msn)\./, /outlook|hotmail|微软|microsoft|live/i],
  [/^(163|126|yeah|188)\.(com|net)$/, /网易|163|126|netease/i],
  [/^(icloud|me|mac)\.com$/, /icloud|apple|苹果/i],
  [/^sina\.(com|cn)$/, /新浪|sina|微博/i],
  [/^sohu\.com$/, /搜狐|sohu/i],
  [/^aliyun\.com$/, /阿里|aliyun/i],
  [/^(proton\.me|protonmail\.com)$/, /proton/i],
  [/^yahoo\./, /yahoo|雅虎/i],
  [/^139\.com$/, /移动|139/],
  [/^wo\.cn$/, /联通/],
  [/^189\.cn$/, /电信|189/],
];
const baseTitle = t => String(t || '').replace(/[（(][^）)]*[）)]/g, '').trim().toLowerCase();
const hostOf = u => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'http://' + u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/* 能拿来比对的一栏：邮箱、手机号，或者像账号、证件号的短文字 */
function idValue(label, value) {
  const v = (value || '').trim();
  if (!v || v.length > 80 || /\n/.test(v) || isSecret(label) || isUrl(label) || /备注|说明|注释|note/i.test(label) || FILLER_RE.test(v)) return null;
  if (EMAIL_RE.test(v)) return { k: 'mail', norm: v.toLowerCase(), v };
  if (/手机|电话|phone|tel/i.test(label) || /^(\+?86)?1\d{10}$/.test(v.replace(/[\s()-]/g, ''))) {
    const d = v.replace(/\D/g, '').replace(/^86(?=1\d{10}$)/, '');
    return d.length >= 5 ? { k: 'phone', norm: d, v } : null;
  }
  return { k: 'id', norm: v.replace(/\s+/g, '').toLowerCase(), v };
}
/* 这一栏的值是不是这条记录「自己的」：分越高越像提供方 */
function ownScore(e, label, t) {
  let s = BIND_RE.test(label) ? -10 : 2;
  if (t.k === 'mail') {
    const dom = t.norm.split('@')[1], host = hostOf(entryUrl(e)), own = MAIL_OWNER.find(([d]) => d.test(dom));
    if ((own && own[1].test(e.title)) || (host && (host === dom || host.endsWith('.' + dom))) || baseTitle(e.title) === dom.split('.')[0]) s += 10;
    if (/邮箱|mail/i.test(e.title)) s += 1;
  }
  if (t.k === 'phone' && CARRIER_RE.test(e.title)) s += 10;
  if (t.k === 'id' && IDDOC_RE.test(e.title)) s += 10;
  return s;
}
/* 默认的词被从快捷词里改掉了，就用快捷词里同一类的那个（比如「注册邮箱」改成了「邮箱注册」） */
function preferWord(def, re) {
  const ws = linkWords();
  return ws.includes(def) || !LINK_WORDS.includes(def) ? def : ws.find(w => re.test(w)) || def;
}
function autoLinkLabel(label, t, src) {
  const l = (label || '').trim().slice(0, 40), bt = baseTitle(src.title);
  if (BIND_RE.test(l) || (bt.length >= 2 && l.toLowerCase().includes(bt))) return l;
  if (t.k === 'mail') return preferWord('注册邮箱', /邮箱|邮件|mail/i);
  if (t.k === 'phone') return preferWord('绑定手机', /手机|电话|号码|phone|tel/i);
  return IDDOC_RE.test(src.title) ? '实名认证' : preferWord('同一账号', /同一|相同/);
}

/* 按卡片内容找该连的线：同一个值出现在几条记录里，分最高（且只有一条最高）的是提供方 */
function suggestLinks() {
  const groups = new Map();
  for (const e of S.entries) {
    for (const f of e.fields) {
      const label = f.label || '', t = idValue(label, f.value);
      if (!t || (t.k === 'id' && !ID_LABEL_RE.test(label))) continue;
      const key = t.k + ':' + t.norm;
      if (!groups.has(key)) groups.set(key, { t, occ: [] });
      groups.get(key).occ.push({ e, label, s: ownScore(e, label, t) });
    }
  }
  const out = new Map();
  for (const { t, occ } of groups.values()) {
    const ents = [...new Set(occ.map(o => o.e))];
    if (ents.length < 2) continue;
    // 一栏的名字里提到了另一条记录（比如「QQ号」「绑定微信」），那条记录就是提供方
    const named = new Set();
    for (const o of occ) for (const x of ents) {
      const bt = baseTitle(x.title);
      if (x !== o.e && bt.length >= 2 && o.label.toLowerCase().includes(bt)) named.add(x);
    }
    const best = new Map();
    for (const o of occ) {
      const s = o.s + (named.has(o.e) ? 10 : 0);
      if (!best.has(o.e) || s > best.get(o.e).s) best.set(o.e, { s, label: o.label });
    }
    const ranked = [...best].sort((a, b) => b[1].s - a[1].s);
    if (ranked[0][1].s < 8 || ranked[1][1].s === ranked[0][1].s) continue;  // 看不出是谁的，留给「自动关联」的虚线
    const [src, sv] = ranked[0];
    for (const [e] of ranked.slice(1)) {
      const mine = occ.filter(o => o.e === e).sort((a, b) => a.s - b.s)[0];  // 优先用「绑定手机」这类名字
      const key = src.id + '\n' + e.id;
      if (!out.has(key)) out.set(key, { a: src.id, b: e.id, label: autoLinkLabel(mine.label, t, src), k: t.k, v: t.v, from: sv.label, to: mine.label });
    }
  }
  return [...out.values()];
}

/* 按连线补卡片：连线上写的关系 → 该抄哪一种值 */
function labelKind(l) {
  l = (l || '').trim();
  if (!l || isSecret(l) || isUrl(l) || /子账号|同一/.test(l)) return null;
  if (/手机|电话|号码|phone|tel/i.test(l)) return 'phone';
  if (/邮箱|邮件|mail/i.test(l)) return 'mail';
  if (/实名|身份|证件/.test(l)) return 'idcard';
  if (/账号|账户|帐号|帳號|用户名|ID/i.test(l)) return 'user';
  if (/登录|登陆|付款|支付|授权/.test(l)) return 'title';
  return null;
}
/* 提供方自己的那个值（不拿它「绑定」别人的） */
function providerValue(e, kind) {
  if (kind === 'title') return { v: e.title, k: 'title', label: '名称' };
  const cand = e.fields.map(f => ({ label: f.label || '', t: idValue(f.label || '', f.value) })).filter(x => x.t && !BIND_RE.test(x.label));
  const pick = x => x && { v: x.t.v, norm: x.t.norm, k: x.t.k, label: x.label };
  if (kind === 'phone') return pick(cand.find(x => x.t.k === 'phone'));
  if (kind === 'mail') return pick(cand.filter(x => x.t.k === 'mail').sort((x, y) => ownScore(e, y.label, y.t) - ownScore(e, x.label, x.t))[0]);
  if (kind === 'idcard') return pick(IDDOC_RE.test(e.title) ? cand.find(x => x.t.k === 'id') : cand.find(x => /身份证|证件号/.test(x.label)));
  if (kind === 'user') return pick(cand.find(x => x.t.k === 'id' && USER_LABEL_RE.test(x.label)) || cand.find(x => x.t.k === 'mail') || cand.find(x => x.t.k === 'phone'));
  return null;
}
/* 用的一方该填哪一栏：同名的一栏 > 同类的「绑定…」栏 > 同类的空栏 > 新加一栏 */
function targetField(e, label, kind) {
  const exact = e.fields.findIndex(f => (f.label || '').trim() === label);
  if (exact >= 0 || kind === 'title') return exact;
  const same = e.fields.map((f, i) => ({ f, i })).filter(({ f }) => labelKind(f.label) === kind);
  const hit = same.find(({ f }) => BIND_RE.test(f.label) && !f.value.trim()) || same.find(({ f }) => BIND_RE.test(f.label)) || same.find(({ f }) => !f.value.trim());
  return hit ? hit.i : -1;
}
function suggestFills() {
  const fills = [], skipped = [], seen = new Set();
  for (const l of G.links) {
    const a = entryById(l.a), b = entryById(l.b), label = (l.label || '').trim(), kind = labelKind(label);
    if (!a || !b || !kind) continue;
    const src = providerValue(a, kind);
    const has = src && b.fields.some(f => { const t = idValue(f.label || '', f.value); return f.value.trim() === src.v || (t && t.norm === src.norm); });
    if (has) continue;  // 已经填过了
    if (!src) { skipped.push({ a, b, label, why: `「${a.title}」里没有找到${{ phone: '手机号', mail: '邮箱', idcard: '证件号', user: '账号' }[kind]}` }); continue; }
    const i = targetField(b, label, kind), f = b.fields[i];
    const field = f ? f.label : label, key = b.id + '\n' + field;
    if (seen.has(key)) continue;
    seen.add(key);
    fills.push({ a, b, link: label, i, field, src, old: f?.value.trim() || '' });
  }
  return { fills, skipped };
}

/* 预览里只露一点点，看得出是哪个就行 */
function peek(v, k) {
  if (k === 'title') return v;
  if (k === 'mail') { const [u, d] = v.split('@'); return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***') + '@' + d; }
  if (k === 'phone') { const d = v.replace(/\D/g, ''); return d.length >= 7 ? d.slice(0, 3) + '****' + d.slice(-4) : d[0] + '***'; }
  const g = graphemes(v);
  return g.length <= 2 ? g[0] + '*' : g[0] + '*'.repeat(Math.min(6, g.length - 2)) + g.at(-1);
}

function openAutoLink() {
  closeLinkPop();
  const had = new Set(G.links.flatMap(l => [l.a + '\n' + l.b, l.b + '\n' + l.a]));
  const links = [], relabel = [];
  let already = 0;
  for (const s of suggestLinks()) {
    const same = G.links.find(l => l.a === s.a && l.b === s.b);
    if (same && !same.label.trim() && s.label) relabel.push({ ...s, l: same, on: true });
    else if (had.has(s.a + '\n' + s.b)) already++;
    else links.push({ ...s, on: true });
  }
  const { fills, skipped } = suggestFills();
  fills.forEach(x => { x.on = !x.old; });  // 会换掉原来内容的默认不勾
  const items = [...links, ...relabel, ...fills];
  const av = e => `<span class="avatar ak-av" data-av="${esc(e.id)}">${avatarInner(e.title, e.icon)}</span>`;
  const ends = (a, b) => `<span class="ak-ends">${av(a)}<b>${esc(a.title)}</b>${icon('chev')}${av(b)}<b>${esc(b.title)}</b></span>`;
  const row = (x, i, body) => `<div class="ak-item${x.on ? '' : ' off'}" data-i="${i}" style="--i:${Math.min(i, 12)}"><input type="checkbox" class="ak-on"${x.on ? ' checked' : ''}><div class="ak-main">${body}</div></div>`;
  const q = s => `「${esc(s)}」`;
  let n = 0;
  const html = [];
  if (links.length || relabel.length) {
    html.push(`<div class="section-title">新连线 · ${links.length + relabel.length}</div><div class="ak-list">`);
    for (const x of [...links, ...relabel]) {
      const a = entryById(x.a), b = entryById(x.b);
      html.push(row(x, n++, `<div class="ak-top">${ends(a, b)}<input class="ak-label" value="${esc(x.label)}" maxlength="40" spellcheck="false" placeholder="关系（可以不填）"></div>
        <div class="ak-why">${x.l ? '已经连过，补上关系说明 · ' : ''}${q(b.title)}的${q(x.to)}和${q(a.title)}的${q(x.from)}一样：<code>${esc(peek(x.v, x.k))}</code></div>`));
    }
    html.push('</div>');
  }
  if (fills.length) {
    html.push(`<div class="section-title">按连线补全卡片 · ${fills.length}</div><div class="ak-list">`);
    for (const x of fills) {
      html.push(row(x, n++, `<div class="ak-top">${ends(x.a, x.b)}<span class="ak-tag">${esc(x.link)}</span></div>
        <div class="ak-why">${x.i < 0 ? `给${q(x.b.title)}新加一栏` : `填${q(x.b.title)}的`}${q(x.field)}：<code>${esc(peek(x.src.v, x.src.k))}</code>（${x.src.k === 'title' ? '记录名称' : `来自${q(x.a.title)}的${q(x.src.label)}`}）
        ${x.old ? `<span class="ak-warn">${icon('alert')}会换掉原来的 <code>${esc(peek(x.old, x.src.k === 'title' ? 'id' : x.src.k))}</code></span>` : ''}</div>`));
    }
    html.push('</div>');
  }
  const notes = [];
  if (already) notes.push(`${already} 对卡片已经连过线了，不重复连`);
  if (skipped.length) notes.push(...skipped.map(s => `${esc(s.a.title)} → ${esc(s.b.title)}「${esc(s.label)}」：${esc(s.why)}，没法补`));
  const { wrap, close } = modal(`
    <div class="up-hero"><div class="up-cloud">${icon('sparkle')}</div>
      <div><h2>一键连线</h2><p>在本机比对各卡片里相同的邮箱、手机号、账号，自动连好线；已经画好、写了关系的线，也把对应的那一栏补上。勾选的才会改，改完可以撤销。</p></div></div>
    ${items.length ? html.join('') : `<div class="up-empty">${icon('check')}<span>没有要补的：该连的线都连上了，卡片也都填好了</span></div>`}
    ${notes.length ? `<details class="ak-notes"><summary>${notes.length} 条说明</summary>${notes.map(t => `<div>${t}</div>`).join('')}</details>` : ''}
    <div class="modal-foot">${S.autolink.length ? `<button class="btn ghost sm" id="akUndo" title="把那次加的线、补的卡片内容改回去；可以连续往回撤">${icon('undo')}撤回上次一键连线（${esc(fmtRunTime(S.autolink.at(-1).time))}）</button>` : ''}<span class="grow"></span><button class="btn ghost" data-close>${items.length ? '取消' : '关闭'}</button>${items.length ? `<button class="btn primary" id="akGo">${icon('check')}应用</button>` : ''}</div>`, 'wide');
  $$('[data-av]', wrap).forEach(el => { const e = entryById(el.dataset.av); if (e) setAvatarVars(el, e.title, e.icon); });
  $('[data-close]', wrap).addEventListener('click', close);
  $('#akUndo', wrap)?.addEventListener('click', () => { if (wrap.dataset.busy) return; close(); setTimeout(() => undoAutoLink(), 240); });
  const go = $('#akGo', wrap);
  const sync = () => {
    if (!go) return;
    const c = items.filter(x => x.on).length;
    go.disabled = !c;
    go.innerHTML = icon('check') + (c ? `应用 ${c} 项` : '应用');
  };
  sync();
  wrap.addEventListener('change', ev => {
    const r = ev.target.closest('.ak-item');
    if (r && ev.target.classList.contains('ak-on')) { items[+r.dataset.i].on = ev.target.checked; r.classList.toggle('off', !ev.target.checked); sync(); }
  });
  wrap.addEventListener('input', ev => {
    const r = ev.target.closest('.ak-item');
    if (r && ev.target.classList.contains('ak-label')) items[+r.dataset.i].label = ev.target.value.replace(/[\r\n]/g, ' ').trim();
  });
  go?.addEventListener('click', async () => {
    go.disabled = true;
    wrap.dataset.busy = 1;
    try { await applyAutoLink(links.filter(x => x.on), relabel.filter(x => x.on), fills.filter(x => x.on)); delete wrap.dataset.busy; close(); } catch (err) { delete wrap.dataset.busy; go.disabled = false; toastErr('保存失败：' + err.message); }
  });
}

/* 应用一键连线：先整体备份一份（「备份」里能找到），改完把这次改了什么记进 私密原件/一键连线.json，以后随时能撤回 */
async function applyAutoLink(links, relabel, fills) {
  await api('autolink-snapshot', {});
  const { idToKey } = entryKeys();
  const run = { time: Date.now(), links: [], relabels: [], fields: [] };
  const added = links.map(x => ({ a: x.a, b: x.b, label: x.label }));
  const oldLabels = relabel.map(x => [x.l, x.l.label]);
  const oldFields = new Map();
  for (const x of fills) {
    const e = x.b;
    if (!oldFields.has(e)) oldFields.set(e, e.fields.map(f => ({ ...f })));
    const f = e.fields.find(f => (f.label || '').trim() === x.field);
    run.fields.push({ e: idToKey.get(e.id), label: x.field, mode: !f ? 'add' : f.value.trim() ? 'overwrite' : 'fill', value: x.src.v, old: f?.value || '' });
    if (f) f.value = x.src.v;
    else {
      const note = e.fields.findIndex(f => /^备注$/.test((f.label || '').trim()));  // 新的一栏放在备注前面
      e.fields.splice(note >= 0 ? note : e.fields.length, 0, { label: x.field, value: x.src.v });
    }
  }
  run.links = added.map(l => ({ a: idToKey.get(l.a), b: idToKey.get(l.b), label: l.label }));
  run.relabels = relabel.map(x => ({ a: idToKey.get(x.a), b: idToKey.get(x.b), old: x.l.label, new: x.label }));
  G.links.push(...added);
  relabel.forEach(x => { x.l.label = x.label; });
  const cats = [...new Set([...oldFields.keys()].map(e => e.cat))];
  try {
    for (const c of cats) await saveCat(c);
    await api('autolink-log', { runs: [...S.autolink, run] });
  } catch (err) {
    oldFields.forEach((fs, e) => { e.fields = fs; });
    G.links = G.links.filter(l => !added.includes(l));
    oldLabels.forEach(([l, v]) => { l.label = v; });
    for (const c of cats) await saveCat(c).catch(() => {});
    throw err;
  }
  S.autolink.push(run);
  oldFields.forEach((_, e) => [...S.revealed].filter(k => k.startsWith(e.id + ':')).forEach(k => S.revealed.delete(k)));  // 栏的位置可能变了
  added.forEach(l => { l.fresh = true; });  // 新线画出来的动画
  setTimeout(() => { added.forEach(l => { delete l.fresh; }); drawLinks(); }, 900);
  graphSave(0);
  renderGrid();
  toast('已' + runSummary(run) + '。连错了随时可以在「一键连线」里撤回', { icon: 'sparkle', action: '撤回', duration: 8000, onAction: () => undoAutoLink(true) });
}

function runSummary(r) {
  const parts = [];
  if (r.links.length) parts.push(`连了 ${r.links.length} 条线`);
  if (r.relabels.length) parts.push(`补了 ${r.relabels.length} 条关系说明`);
  if (r.fields.length) parts.push(`补全了 ${r.fields.length} 处卡片内容`);
  return parts.join('，') || '没有改动';
}
const fmtRunTime = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/* 撤回最近一次一键连线：只改回那次加的线、说明和填的栏；之后又手动改过的地方不动 */
async function undoAutoLink(quiet) {
  const run = S.autolink.at(-1);
  if (!run) return toast('没有可以撤回的一键连线', { icon: 'check' });
  if (!quiet) {
    const ok = await dialog({
      title: `撤回 ${fmtRunTime(run.time)} 的一键连线？`, icon: 'undo', ok: '撤回',
      text: `那次${runSummary(run)}，会全部改回去。之后你手动改过的线和卡片不会动。可以连续撤回更早的几次。`,
    });
    if (!ok) return;
  }
  const { keyToId } = entryKeys();
  const id = k => keyToId.get(k);
  let skipped = 0;
  const pair = (a, b) => G.links.find(l => l.a === id(a) && l.b === id(b));
  const drop = new Set();
  for (const x of run.links) { const l = pair(x.a, x.b); if (l) drop.add(l); else skipped++; }
  const oldLabels = [];
  for (const x of run.relabels) {
    const l = pair(x.a, x.b);
    if (l && l.label === x.new) { oldLabels.push([l, l.label]); l.label = x.old; } else skipped++;
  }
  const oldFields = new Map();
  for (const x of [...run.fields].reverse()) {
    const e = entryById(id(x.e)), i = e ? e.fields.findIndex(f => (f.label || '').trim() === x.label) : -1;
    if (i < 0 || e.fields[i].value !== x.value) { skipped++; continue; }  // 后来又改过，不动
    if (!oldFields.has(e)) oldFields.set(e, e.fields.map(f => ({ ...f })));
    if (x.mode === 'add') e.fields.splice(i, 1); else e.fields[i].value = x.mode === 'overwrite' ? x.old : '';
  }
  const keep = G.links;
  G.links = G.links.filter(l => !drop.has(l));
  if (G.sel?.type === 'link' && drop.has(G.sel.l)) G.sel = null;
  const cats = [...new Set([...oldFields.keys()].map(e => e.cat))];
  const runs = S.autolink.slice(0, -1);
  try {
    for (const c of cats) await saveCat(c);
    await api('autolink-log', { runs });
  } catch (err) {
    G.links = keep;
    oldLabels.forEach(([l, v]) => { l.label = v; });
    oldFields.forEach((fs, e) => { e.fields = fs; });
    for (const c of cats) await saveCat(c).catch(() => {});
    return toastErr('撤回失败：' + err.message);
  }
  S.autolink = runs;
  oldFields.forEach((_, e) => [...S.revealed].filter(k => k.startsWith(e.id + ':')).forEach(k => S.revealed.delete(k)));
  graphSave(0);
  renderGrid();
  toast(`已撤回 ${fmtRunTime(run.time)} 的一键连线${skipped ? `（${skipped} 处后来改过或已经删了，没动）` : ''}`, { icon: 'undo', duration: 5000 });
}

/* ---------- 视角：平移、缩放 ---------- */
function applyCam() {
  const { x, y, k } = G.cam;
  worldEl.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  mapEl.style.setProperty('--gs', 26 * k + 'px');
  mapEl.style.setProperty('--ck', k);
  mapEl.style.setProperty('--gx', x + 'px');
  mapEl.style.setProperty('--gy', y + 'px');
  const far = k < FAR;
  if (far !== mapEl.classList.contains('far')) {
    mapEl.classList.toggle('far', far); // 缩得很小时只显示图标和名称
    measure();
    drawLinks();
  } else drawMini();
  $('#mapZoom').textContent = Math.round(k * 100) + '%';
}
const camChanged = () => { G.camSaved = true; graphSave(1500); };
function toWorld(cx, cy) {
  const r = mapEl.getBoundingClientRect(), c = G.cam;
  return { x: (cx - r.left - c.x) / c.k, y: (cy - r.top - c.y) / c.k };
}
function worldToClient(x, y) {
  const r = mapEl.getBoundingClientRect(), c = G.cam;
  return { x: r.left + c.x + x * c.k, y: r.top + c.y + y * c.k };
}
function zoomAt(f, cx, cy, animate) {
  const c = G.cam, k = clamp(c.k * f, K_MIN, K_MAX), r = k / c.k;
  if (cx == null) { cx = mapEl.clientWidth / 2; cy = mapEl.clientHeight / 2; }
  const to = { x: cx - (cx - c.x) * r, y: cy - (cy - c.y) * r, k };
  if (animate) animateCam(to); else { stopCam(); Object.assign(G.cam, to); applyCam(); }
  camChanged();
}
let camRaf = 0;
function stopCam() { cancelAnimationFrame(camRaf); camRaf = 0; }
function animateCam(to, dur = 480) {
  stopCam();
  if (REDUCED) { Object.assign(G.cam, to); return applyCam(); }
  const from = { ...G.cam }, t0 = performance.now(), W = mapEl.clientWidth / 2, H = mapEl.clientHeight / 2;
  // 屏幕中心对着的世界坐标直线移动，缩放按比例插值，看起来更匀
  const a = { x: (W - from.x) / from.k, y: (H - from.y) / from.k }, b = { x: (W - to.x) / to.k, y: (H - to.y) / to.k };
  const step = now => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    const k = from.k * Math.pow(to.k / from.k, e), cx = a.x + (b.x - a.x) * e, cy = a.y + (b.y - a.y) * e;
    G.cam = p >= 1 ? { ...to } : { x: W - cx * k, y: H - cy * k, k };
    applyCam();
    camRaf = p < 1 ? requestAnimationFrame(step) : 0;
  };
  camRaf = requestAnimationFrame(step);
}
function fitTo(ids, animate) {
  const rs = ids.map(rectOf).filter(Boolean);
  if (!rs.length) return applyCam();
  const x0 = Math.min(...rs.map(r => r.x - r.w / 2)), y0 = Math.min(...rs.map(r => r.y - r.h / 2));
  const x1 = Math.max(...rs.map(r => r.x + r.w / 2)), y1 = Math.max(...rs.map(r => r.y + r.h / 2));
  const W = mapEl.clientWidth || innerWidth, H = (mapEl.clientHeight || innerHeight) - 50, pad = 70;
  const k = clamp(Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (y1 - y0 || 1)), K_MIN, 1.1);
  const to = { x: W / 2 - (x0 + x1) / 2 * k, y: H / 2 - (y0 + y1) / 2 * k, k };
  if (animate) animateCam(to); else { stopCam(); G.cam = to; applyCam(); }
}
function centerOn(id) {
  const p = G.pos.get(id);
  if (!p) return;
  const k = Math.max(G.cam.k, 0.8);
  animateCam({ x: mapEl.clientWidth / 2 - p.x * k, y: (mapEl.clientHeight - 50) / 2 - p.y * k, k });
}

mapEl.addEventListener('wheel', ev => {
  if (ev.target.closest('.map-tools, .map-mini, .map-size-pop')) return;
  ev.preventDefault();
  const r = mapEl.getBoundingClientRect();
  const d = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
  zoomAt(Math.exp(-d * (ev.ctrlKey ? 0.01 : 0.0016)), ev.clientX - r.left, ev.clientY - r.top);
}, { passive: false });

/* ---------- 拖动：平移画布、移动卡片、连线、双指缩放 ---------- */
let drag = null;
const touches = new Map();

mapEl.addEventListener('pointerdown', ev => {
  if (ev.button === 2 || ev.target.closest('.map-tools, .map-mini, .map-tip, .map-size-pop, .map-focus')) return;
  const node = ev.target.closest('.node'), port = ev.target.closest('.port'), grip = ev.target.closest('.grip');
  const linkEl = ev.target.closest('.lk .hit, .map-label');
  stopCam();
  if (ev.pointerType === 'touch') touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (touches.size === 2) {
    const [a, b] = [...touches.values()], r = mapEl.getBoundingClientRect();
    drag = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), cam: { ...G.cam }, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
    return;
  }
  if (drag) return;
  if (grip && node) {
    ev.preventDefault();
    const id = node.dataset.id, p = G.pos.get(id), s = G.scale.get(id) || 1;
    const bw = node.offsetWidth, bh = node.offsetHeight;
    drag = { type: 'resize', id, bw, bh, bl: { x: p.x - bw * s / 2, y: p.y + bh * s / 2 }, moved: true };
    node.classList.add('resizing');
    node.dataset.pct = Math.round(s * 100) + '%';
    closeLinkPop();
  } else if (port && node) {
    ev.preventDefault();
    const p = toWorld(ev.clientX, ev.clientY);
    drag = { type: 'connect', from: node.dataset.id, x: p.x, y: p.y, target: null };
    mapEl.classList.add('connecting');
    node.classList.add('source');
  } else if (node && ev.button === 0) {
    if (ev.target.closest('[data-act]')) return;
    const p = G.pos.get(node.dataset.id);
    drag = { type: 'node', id: node.dataset.id, sx: ev.clientX, sy: ev.clientY, ox: p.x, oy: p.y, moved: false };
  } else if (linkEl && ev.button === 0) {
    drag = { type: 'link', i: +linkEl.closest('[data-i]').dataset.i, sx: ev.clientX, sy: ev.clientY, moved: false };
  } else {
    drag = { type: 'pan', sx: ev.clientX, sy: ev.clientY, ox: G.cam.x, oy: G.cam.y, moved: false };
  }
  addEventListener('pointermove', onDragMove);
  addEventListener('pointerup', onDragEnd);
  addEventListener('pointercancel', onDragEnd);
});

function navCatAt(x, y) {
  const b = document.elementFromPoint(x, y)?.closest('.nav-item');
  return b?.dataset.view?.startsWith('cat:') ? b : null;
}

function onDragMove(ev) {
  if (touches.has(ev.pointerId)) touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (!drag) return;
  if (drag.type === 'pinch') {
    if (touches.size < 2) return;
    const [a, b] = [...touches.values()], c = drag.cam;
    const k = clamp(c.k * Math.hypot(a.x - b.x, a.y - b.y) / (drag.d0 || 1), K_MIN, K_MAX), r = k / c.k;
    G.cam = { x: drag.mx - (drag.mx - c.x) * r, y: drag.my - (drag.my - c.y) * r, k };
    return applyCam();
  }
  const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
  if ('moved' in drag && !drag.moved) {
    if (Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    if (drag.type === 'pan') mapEl.classList.add('panning');
    if (drag.type === 'node') { nodeEls.get(drag.id)?.classList.add('dragging'); closeLinkPop(); }
  }
  if (drag.type === 'pan') {
    G.cam.x = drag.ox + dx;
    G.cam.y = drag.oy + dy;
    applyCam();
  } else if (drag.type === 'resize') {
    // 手指位置投影到卡片对角线上，算出放大倍数
    const p = toWorld(ev.clientX, ev.clientY), { bw, bh, bl } = drag, len = Math.hypot(bw, bh);
    const proj = ((p.x - bl.x) * bw + (bl.y - p.y) * bh) / len;
    setNodeScale(drag.id, proj / len, bl);
  } else if (drag.type === 'node') {
    const p = G.pos.get(drag.id);
    p.x = drag.ox + dx / G.cam.k;
    p.y = drag.oy + dy / G.cam.k;
    placeNode(drag.id);
    drawLinks();
    // 拖到左侧分类上：松手就移到那个分类
    const b = entryById(drag.id) && navCatAt(ev.clientX, ev.clientY);
    $$('.nav-item.drop-target').forEach(x => x !== b && x.classList.remove('drop-target'));
    b?.classList.add('drop-target');
    nodeEls.get(drag.id)?.classList.toggle('to-cat', !!b);
  } else if (drag.type === 'connect') {
    const p = toWorld(ev.clientX, ev.clientY);
    drag.x = p.x;
    drag.y = p.y;
    const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node:not(.hub)');
    const target = t && t.dataset.id !== drag.from ? t.dataset.id : null;
    if (target !== drag.target) {
      if (drag.target) nodeEls.get(drag.target)?.classList.remove('target');
      if (target) nodeEls.get(target)?.classList.add('target');
      drag.target = target;
    }
    drawLinks();
  }
}

function onDragEnd(ev) {
  touches.delete(ev.pointerId);
  const d = drag;
  if (!d) return;
  if (d.type === 'pinch') {
    if (touches.size < 2) { drag = null; camChanged(); cleanupDrag(); }
    return;
  }
  drag = null;
  cleanupDrag();
  if (d.type === 'pan') {
    mapEl.classList.remove('panning');
    if (d.moved) camChanged();
    else if (G.sel && ev.type === 'pointerup') { G.sel = null; applyDim(); drawLinks(); }
  } else if (d.type === 'resize') {
    nodeEls.get(d.id)?.classList.remove('resizing');
    graphSave(0);
    spreadSoon();
  } else if (d.type === 'node') {
    const el = nodeEls.get(d.id);
    el?.classList.remove('dragging', 'to-cat');
    const b = d.moved && ev.type === 'pointerup' && navCatAt(ev.clientX, ev.clientY);
    $$('.nav-item.drop-target').forEach(x => x.classList.remove('drop-target'));
    const e = entryById(d.id);
    if (b && e) {
      Object.assign(G.pos.get(d.id), { x: d.ox, y: d.oy });
      placeNode(d.id);
      drawLinks();
      moveEntry(e, b.dataset.view.slice(4));
    } else if (d.moved) graphSave();
    else if (ev.type === 'pointerup') {
      G.sel = G.sel?.type === 'node' && G.sel.id === d.id ? null : { type: 'node', id: d.id };
      applyDim();
      drawLinks();
    }
  } else if (d.type === 'connect') {
    mapEl.classList.remove('connecting');
    nodeEls.get(d.from)?.classList.remove('source');
    if (d.target) { nodeEls.get(d.target)?.classList.remove('target'); addLink(d.from, d.target); } else drawLinks();
  } else if (d.type === 'link' && !d.moved && ev.type === 'pointerup') {
    const l = G.links[d.i];
    if (!l) return;
    G.sel = { type: 'link', l };
    applyDim();
    drawLinks();
    openLinkPop(l, { x: ev.clientX, y: ev.clientY });
  }
}
function cleanupDrag() {
  if (drag) return;
  removeEventListener('pointermove', onDragMove);
  removeEventListener('pointerup', onDragEnd);
  removeEventListener('pointercancel', onDragEnd);
}

nodesEl.addEventListener('click', ev => {
  const btn = ev.target.closest('[data-act]'), node = ev.target.closest('.node');
  const e = node && entryById(node.dataset.id);
  if (!btn || !e) return;
  if (btn.dataset.act === 'edit') openEditor(e);
  if (btn.dataset.act === 'copy') copyField(e, +btn.closest('.nrow').dataset.idx, btn);
  if (btn.dataset.act === 'reveal') toggleReveal(e, +btn.closest('.nrow').dataset.idx);
});
mapEl.addEventListener('dblclick', ev => {
  if (ev.target.closest('.map-tools, .map-mini, .map-tip, .map-size-pop, .map-focus, [data-act], .map-label, .lk')) return;
  const node = ev.target.closest('.node');
  if (node && ev.target.closest('.grip')) {  // 双击把手：恢复原来大小
    setNodeScale(node.dataset.id, 1);
    graphSave(0);
    return;
  }
  if (node) {
    const e = entryById(node.dataset.id), h = hubById(node.dataset.id);
    if (e) openEditor(e);
    if (h) fitTo([h.id, ...h.members], true);
    return;
  }
  const r = mapEl.getBoundingClientRect();
  zoomAt(1.6, ev.clientX - r.left, ev.clientY - r.top, true);
});
mapEl.addEventListener('contextmenu', ev => {
  if (ev.target.closest('.map-tools, .map-mini, .map-tip, .map-size-pop')) return;
  ev.preventDefault();
  const at = { getBoundingClientRect: () => new DOMRect(ev.clientX, ev.clientY, 0, 0) };
  const node = ev.target.closest('.node'), e = node && entryById(node.dataset.id);
  const linkEl = ev.target.closest('.lk .hit, .map-label'), l = linkEl && G.links[+linkEl.closest('[data-i]').dataset.i];
  if (e) {
    menu(at, [
      { icon: 'edit', label: '编辑', run: () => openEditor(e) },
      ...(G.scale.has(e.id) ? [{ icon: 'resize', label: '恢复原来大小', run: () => { setNodeScale(e.id, 1); graphSave(0); spreadSoon(); } }] : []),
      { icon: 'folder', label: '移到其他分类…', run: () => moveMenu(at, e) },
      { icon: 'trash', label: '删除记录', danger: true, run: () => deleteEntry(e) },
    ]);
  } else if (l) {
    menu(at, [
      { icon: 'edit', label: '写关系说明', run: () => { G.sel = { type: 'link', l }; applyDim(); drawLinks(); openLinkPop(l, { x: ev.clientX, y: ev.clientY }, true); } },
      { icon: 'trash', label: '删除连线', danger: true, run: () => deleteLink(l) },
    ]);
  } else if (!node) {
    menu(at, [
      { icon: 'plus', label: '新增记录', run: () => openEditor(null) },
      { icon: 'fit', label: '显示全部', run: () => fitTo(visibleIds(), true) },
      { icon: 'wand', label: '自动排列', run: autoArrange },
      { icon: 'fit', label: '自动理图：团在一块', run: () => tidyMap(false) },
      { icon: 'graph', label: '自动理图：按大卡片分开摆', run: () => tidyMap(true) },
      { icon: 'sparkle', label: '一键连线…', run: openAutoLink },
      ...(S.autolink.length ? [{ icon: 'undo', label: '撤回上次一键连线', run: () => undoAutoLink() }] : []),
    ]);
  }
});

/* ---------- 自动排列（力导向布局：同分类聚在一起，连了线的互相靠近，最后去掉重叠） ---------- */
function seeded(id) { let s = parseInt(hash53(id).slice(-6), 36) || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function layoutPositions(ids, fixed = new Set()) {
  const N = ids.map(id => {
    const s = G.size.get(id) || { w: 230, h: 130 }, e = entryById(id), hub = hubById(id);
    const p = fixed.has(id) ? G.pos.get(id) : null;
    return { id, w: s.w, h: s.h, cat: e?.cat, hub, fixed: !!p, x: p?.x || 0, y: p?.y || 0 };
  });
  const at = new Map(N.map((n, i) => [n.id, i]));
  const edges = [];
  for (const l of G.links) if (at.has(l.a) && at.has(l.b)) edges.push([at.get(l.a), at.get(l.b), 300]);
  for (const l of G.hubLinks) if (at.has(l.a) && at.has(l.b)) edges.push([at.get(l.a), at.get(l.b), 190]);

  // 每个分类一个聚集点：已有卡片的分类用它们的中心，新分类排在已有内容右边
  const fixedN = N.filter(n => n.fixed);
  const bx = fixedN.length ? Math.max(...fixedN.map(n => n.x + n.w / 2)) + 420 : 0;
  const by = fixedN.length ? Math.min(...fixedN.map(n => n.y - n.h / 2)) : 0;
  const cats = [...new Set(N.filter(n => n.cat != null).map(n => n.cat))];
  const fresh = cats.filter(c => !fixedN.some(n => n.cat === c));
  const cols = Math.max(1, Math.round(Math.sqrt(fresh.length * 1.5)));
  const cell = 200 + 150 * Math.sqrt(Math.max(1, ...fresh.map(c => N.filter(n => n.cat === c).length)));  // 按最大的分类留空间
  const anchor = new Map();
  cats.forEach(c => {
    const f = fixedN.filter(n => n.cat === c);
    if (f.length) anchor.set(c, { x: f.reduce((s, n) => s + n.x, 0) / f.length, y: f.reduce((s, n) => s + n.y, 0) / f.length });
  });
  fresh.forEach((c, i) => {
    const r = Math.floor(i / cols), col = r % 2 ? cols - 1 - (i % cols) : i % cols;  // 蛇形排，相邻分类挨着
    anchor.set(c, { x: bx + col * cell * 1.25, y: by + r * cell });
  });

  // 初始位置：连着已放好的卡片就放它们旁边，否则放在分类聚集点附近
  const nb = i => edges.filter(([a, b]) => a === i || b === i).map(([a, b]) => N[a === i ? b : a]);
  const place = (n, i) => {
    const r = seeded(n.id), near = nb(i).filter(m => m.fixed || m.placed);
    const base = near.length ? { x: near.reduce((s, m) => s + m.x, 0) / near.length, y: near.reduce((s, m) => s + m.y, 0) / near.length }
      : anchor.get(n.cat) || { x: bx, y: by };
    const a = r() * Math.PI * 2, d = 60 + r() * 180;
    n.x = base.x + Math.cos(a) * d;
    n.y = base.y + Math.sin(a) * d;
    n.placed = true;
  };
  N.forEach((n, i) => { if (!n.fixed && !n.hub) place(n, i); });
  N.forEach((n, i) => { if (!n.fixed && n.hub) place(n, i); });

  const moving = N.filter(n => !n.fixed);
  if (moving.length) {
    const K = 170, iters = fixedN.length ? 180 : 320;
    let temp = fixedN.length ? 60 : 140;
    for (let it = 0; it < iters; it++) {
      const fx = new Float64Array(N.length), fy = new Float64Array(N.length);
      for (let i = 0; i < N.length; i++) {
        for (let j = i + 1; j < N.length; j++) {
          const a = N[i], b = N[j];
          if (a.fixed && b.fixed) continue;
          let dx = a.x - b.x, dy = a.y - b.y;
          if (!dx && !dy) { dx = 0.1 * (i - j); dy = 0.1; }
          const d = Math.hypot(dx, dy), minD = (Math.max(a.w, a.h) + Math.max(b.w, b.h)) / 2 + 30;
          if (d > K * 3.5 && d > minD) continue;  // 离得远的不互相推，免得越排越散
          let f = K * K / d / (a.cat === b.cat ? 1.5 : 1);
          if (d < minD) f += (minD - d) * 8;
          fx[i] += dx / d * f; fy[i] += dy / d * f;
          fx[j] -= dx / d * f; fy[j] -= dy / d * f;
        }
      }
      for (const [i, j, rest] of edges) {
        const a = N[i], b = N[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const f = (d - rest) * Math.abs(d - rest) / K * 0.5;
        fx[i] += dx / d * f; fy[i] += dy / d * f;
        fx[j] -= dx / d * f; fy[j] -= dy / d * f;
      }
      N.forEach((n, i) => {
        if (n.fixed) return;
        const g = n.hub ? null : anchor.get(n.cat);
        if (g) { fx[i] += (g.x - n.x) * 1.5; fy[i] += (g.y - n.y) * 1.5; }
        const m = Math.hypot(fx[i], fy[i]);
        if (m > 0) { const s = Math.min(m, temp) / m; n.x += fx[i] * s; n.y += fy[i] * s; }
      });
      temp = Math.max(2, temp * 0.985);
    }
    // 去掉重叠
    const GAP = 28;
    for (let pass = 0; pass < 120; pass++) {
      let moved = false;
      for (let i = 0; i < N.length; i++) {
        for (let j = i + 1; j < N.length; j++) {
          const a = N[i], b = N[j];
          if (a.fixed && b.fixed) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const ox = (a.w + b.w) / 2 + GAP - Math.abs(dx), oy = (a.h + b.h) / 2 + GAP - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          const [wa, wb] = a.fixed ? [0, 1] : b.fixed ? [1, 0] : [0.5, 0.5];
          if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox; a.x -= s * wa; b.x += s * wb; } else { const s = (dy >= 0 ? 1 : -1) * oy; a.y -= s * wa; b.y += s * wb; }
        }
      }
      if (!moved) break;
    }
  }
  return new Map(N.map(n => [n.id, { x: Math.round(n.x), y: Math.round(n.y) }]));
}

/* 图标变大后卡片可能叠在一起：只把重叠的推开，其他位置不动 */
let spreadTimer = 0;
function spreadSoon() { clearTimeout(spreadTimer); spreadTimer = setTimeout(spreadOverlaps, 450); }
function spreadOverlaps() {
  if (S.layout !== 'graph' || !G.ready || drag) return;
  const N = [...nodeEls.keys()].map(id => ({ id, ...G.pos.get(id), ...G.size.get(id) })).filter(n => n.w);
  const GAP = 24;
  let any = false;
  for (let pass = 0; pass < 120; pass++) {
    let moved = false;
    for (let i = 0; i < N.length; i++) {
      for (let j = i + 1; j < N.length; j++) {
        const a = N[i], b = N[j], dx = b.x - a.x, dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 + GAP - Math.abs(dx), oy = (a.h + b.h) / 2 + GAP - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = any = true;
        if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; a.x -= s; b.x += s; } else { const s = (dy >= 0 ? 1 : -1) * oy / 2; a.y -= s; b.y += s; }
      }
    }
    if (!moved) break;
  }
  if (!any) return;
  const before = new Map(N.map(n => [n.id, { ...G.pos.get(n.id) }]));
  movePositions(before, new Map(N.map(n => [n.id, { x: Math.round(n.x), y: Math.round(n.y) }])));
}

const posNow = ids => new Map(ids.map(id => [id, { ...G.pos.get(id) }]));
function autoArrange() {
  const ids = [...nodeEls.keys()];
  if (!ids.length) return;
  const before = posNow(ids), zones = G.zones;
  const after = layoutPositions(ids);
  G.zones = [];  // 自动排列不分组，去掉自动理图画的底色
  movePositions(before, after, () => fitTo(ids, true));
  toast('已自动排列', {
    icon: 'wand', action: '撤销', duration: 6000,
    onAction: () => { G.zones = zones; movePositions(posNow(ids), before); },
  });
}
/* 从旧位置平滑移动到新位置（sc 给了的话，卡片大小也从 sc.from 变到 sc.to），动完保存 */
function movePositions(from, to, done, sc) {
  const t0 = performance.now(), dur = REDUCED ? 0 : 650;
  const step = now => {
    const p = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - Math.pow(1 - p, 3);
    to.forEach((b, id) => {
      const a = from.get(id) || b, cur = G.pos.get(id);
      if (!cur) return;
      cur.x = a.x + (b.x - a.x) * e;
      cur.y = a.y + (b.y - a.y) * e;
      if (sc?.to.has(id)) scaleNow(id, sc.from.get(id) + (sc.to.get(id) - sc.from.get(id)) * e);
      placeNode(id);
    });
    drawLinks();
    if (p < 1) return requestAnimationFrame(step);
    graphSave(0);
    done?.();
  };
  requestAnimationFrame(step);
}
function scaleNow(id, s) {
  const el = nodeEls.get(id);
  if (!el) return;
  Math.abs(s - 1) < 0.005 ? G.scale.delete(id) : G.scale.set(id, s);
  G.size.set(id, { w: el.offsetWidth * s, h: el.offsetHeight * s });
}

/* ---------- 自动理图：按连线分组，每组一块地方，组和组之间空开 ----------
   卡片按连线条数稍微放大（开平方，最多 TIDY_MAX 倍，只连一条的不变），再分组重新摆（见 tidyPositions）。位置和大小都能撤销。 */
const TIDY_MAX = 1.4;  // 连线最多的卡片最多放大到 1.4 倍，别把图撑乱
function tidyScales(ids) {
  const deg = new Map(ids.map(id => [id, 0])), seen = new Set();
  for (const l of [...G.links, ...(G.auto ? G.hubLinks : [])]) {
    const k = [l.a, l.b].sort().join('\n');
    if (!deg.has(l.a) || !deg.has(l.b) || seen.has(k)) continue;  // 来回两条算一条
    seen.add(k);
    deg.set(l.a, deg.get(l.a) + 1);
    deg.set(l.b, deg.get(l.b) + 1);
  }
  const top = Math.sqrt(Math.max(...deg.values()));
  return new Map(ids.map(id => {
    const t = top > 1.5 ? Math.max(0, Math.sqrt(deg.get(id)) - 1) / (top - 1) : 0;
    return [id, clamp(Math.round((1 + t * (TIDY_MAX - 1)) * 100) / 100, NODE_SCALE[0], NODE_SCALE[1])];
  }));
}
/* 卡片没单独缩放时的大小：正常和缩远了（只剩图标、名称）两种样子取大的，这样放大、缩小看都不挤 */
function baseSizes(ids) {
  const read = () => new Map(ids.map(id => [id, { w: nodeEls.get(id).offsetWidth, h: nodeEls.get(id).offsetHeight }]));
  mapEl.classList.add('measuring');  // 关掉宽度动画，才能马上量到另一种样子的大小
  const a = read();
  mapEl.classList.toggle('far');
  const b = read();
  mapEl.classList.toggle('far');
  void mapEl.offsetWidth;
  mapEl.classList.remove('measuring');
  return new Map(ids.map(id => [id, { w: Math.max(a.get(id).w, b.get(id).w), h: Math.max(a.get(id).h, b.get(id).h) }]));
}
/* 自动理图的三档距离：
   inner 同一组里卡片之间至少隔多远；line 同一组里连线露在卡片外面多长；zone 组和组之间至少空出多远（一眼分得清是哪一组）；
   far 分开摆时，连着的两组再多隔多远（除以两组之间的连线数：连得越少隔得越远，看得清是谁连着两边） */
const TIDY_GAPS = {
  s: { inner: 22, line: 70, zone: 150, far: 220 },
  m: { inner: 34, line: 100, zone: 240, far: 360 },
  l: { inner: 52, line: 150, zone: 360, far: 540 },
};
const tidyGap = () => TIDY_GAPS[S.settings?.tidyGap] ? S.settings.tidyGap : 'm';

/* 把卡片分组（Louvain 社区划分）：互相连得多的分在一组。edges 是 [i, j, 权重]，返回每张卡片的组号。
   gamma 比 1 大一点，几张互相连着的小卡片（比如淘宝、支付宝、身份证）就能自成一组，不被大卡片吞掉 */
function tidyGroups(n, edges, gamma = 1.3) {
  let member = Array.from({ length: n }, (_, i) => i), curN = n, curE = edges.map(e => [...e]);
  for (let level = 0; level < 10; level++) {
    const adj = Array.from({ length: curN }, () => new Map()), k = new Float64Array(curN);
    let m = 0;
    for (const [a, b, w] of curE) {
      m += w;
      if (a === b) { k[a] += 2 * w; continue; }
      adj[a].set(b, (adj[a].get(b) || 0) + w);
      adj[b].set(a, (adj[b].get(a) || 0) + w);
      k[a] += w; k[b] += w;
    }
    if (!m) break;
    // 一张张试着挪到邻居的组，模块度变大就挪
    const comm = Array.from({ length: curN }, (_, i) => i), tot = Float64Array.from(k);
    let movedAny = false;
    for (let pass = 0; pass < 30; pass++) {
      let moved = false;
      for (let i = 0; i < curN; i++) {
        const ci = comm[i], kin = new Map();
        for (const [j, w] of adj[i]) kin.set(comm[j], (kin.get(comm[j]) || 0) + w);
        tot[ci] -= k[i];
        let best = ci, bestGain = (kin.get(ci) || 0) - gamma * tot[ci] * k[i] / (2 * m);
        for (const [c, w] of kin) {
          const g = w - gamma * tot[c] * k[i] / (2 * m);
          if (g > bestGain + 1e-12) { best = c; bestGain = g; }
        }
        tot[best] += k[i];
        if (best !== ci) { comm[i] = best; moved = movedAny = true; }
      }
      if (!moved) break;
    }
    const ids = new Map();
    comm.forEach((c, i) => { if (!ids.has(c)) ids.set(c, ids.size); comm[i] = ids.get(c); });
    member = member.map(x => comm[x]);
    if (!movedAny || ids.size === curN) break;
    // 每组缩成一个点，再往上合并
    const agg = new Map();
    for (const [a, b, w] of curE) {
      const ca = comm[a], cb = comm[b], key = Math.min(ca, cb) + ',' + Math.max(ca, cb);
      agg.set(key, (agg.get(key) || 0) + w);
    }
    curN = ids.size;
    curE = [...agg].map(([key, w]) => { const [a, b] = key.split(',').map(Number); return [a, b, w]; });
  }
  return member;
}

/* 自动理图：先分组，每组在自己的一块地方摆紧凑；再把一组组当成整块摆开，组和组之间空出一圈，一眼分得清。
   spread：分开摆（连着的两组之间连线越少隔得越远）；否则团在一块（组和组挨着，只空出一圈）。level：距离档 s / m / l。
   返回 { pos: 每张卡片的新位置, zones: 分出来的组 } */
function tidyPositions(ids, size, spread, level = 'm') {
  const P = TIDY_GAPS[level] || TIDY_GAPS.m;
  const N = ids.map(id => {
    const p = G.pos.get(id) || { x: 0, y: 0 }, s = size.get(id);
    return { id, x: p.x, y: p.y, w: s.w, h: s.h, r: Math.hypot(s.w, s.h) / 2 };
  });
  if (!N.length) return { pos: new Map(), zones: [] };
  const at = new Map(N.map((n, i) => [n.id, i])), seen = new Set(), E = [];
  for (const l of [...G.links, ...(G.auto ? G.hubLinks : [])]) {
    const i = at.get(l.a), j = at.get(l.b);
    if (i == null || j == null || i === j) continue;
    const k = Math.min(i, j) + ',' + Math.max(i, j);
    if (seen.has(k)) continue;  // 来回两条算一条
    seen.add(k);
    E.push({ i, j, w: l.auto ? 0.5 : 1 });  // 自动关联的虚线分量轻一点
  }
  // 从矩形中心沿 (ux, uy) 方向走到边上的距离
  const reach = (n, ux, uy) => Math.min(n.w / 2 / (Math.abs(ux) || 1e-9), n.h / 2 / (Math.abs(uy) || 1e-9));
  const cx0 = N.reduce((s, n) => s + n.x, 0) / N.length, cy0 = N.reduce((s, n) => s + n.y, 0) / N.length;

  // 1. 分组；一条线都没连的卡片放一起，排成格子
  const deg = N.map(() => 0);
  E.forEach(e => { deg[e.i]++; deg[e.j]++; });
  const comm = tidyGroups(N.length, E.map(e => [e.i, e.j, e.w]));
  const byComm = new Map();
  N.forEach((n, i) => { const c = deg[i] ? comm[i] : 'lonely'; byComm.set(c, [...(byComm.get(c) || []), i]); });
  const groups = [...byComm].map(([c, members]) => ({ members, lonely: c === 'lonely' }));
  const gOf = new Int32Array(N.length);
  groups.forEach((g, gi) => g.members.forEach(i => { gOf[i] = gi; }));

  // 组里的卡片不重叠；连着线的两张多留点，放得下关系牌
  const linked = new Set(E.map(e => Math.min(e.i, e.j) + ',' + Math.max(e.i, e.j)));
  const separate = (L, passes) => {
    for (let pass = 0; pass < passes; pass++) {
      let moved = false;
      for (let a = 0; a < L.length; a++) {
        for (let b = a + 1; b < L.length; b++) {
          const p = L[a], q = L[b], n = N[p.i], o = N[q.i], dx = q.x - p.x, dy = q.y - p.y;
          const g = linked.has(Math.min(p.i, q.i) + ',' + Math.max(p.i, q.i)) ? P.line * 0.8 : P.inner;
          const ox = (n.w + o.w) / 2 + g - Math.abs(dx), oy = (n.h + o.h) / 2 + g - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; p.x -= s; q.x += s; } else { const s = (dy >= 0 ? 1 : -1) * oy / 2; p.y -= s; q.y += s; }
        }
      }
      if (!moved) break;
    }
  };

  // 2. 每组在自己的地方摆紧凑（坐标相对这一组）
  // ext：这一组连到别组的线 [{ a: 组里第几张, ux, uy 朝别组的方向, w }]；给了就从现在组里的摆法接着摆，
  // 连出去的卡片往那边靠，别的卡片让开这条线经过的地方
  const pack = (g, ext = []) => {
    const M = g.members, loc = new Map(M.map((i, x) => [i, x]));
    const mx = M.reduce((s, i) => s + N[i].x, 0) / M.length, my = M.reduce((s, i) => s + N[i].y, 0) / M.length;
    const L = g.L ? g.L.map(p => ({ ...p })) : M.map(i => { const r = seeded(N[i].id); return { i, x: N[i].x - mx + (r() - 0.5) * 20, y: N[i].y - my + (r() - 0.5) * 20 }; });
    const inE = E.filter(e => gOf[e.i] === gOf[e.j] && loc.has(e.i));
    let temp = ext.length ? 80 : 200;  // 接着摆时只微调，别整组打乱
    for (let it = 0; it < 300; it++) {
      const fx = new Float64Array(L.length), fy = new Float64Array(L.length);
      for (let a = 0; a < L.length; a++) {
        for (let b = a + 1; b < L.length; b++) {
          const na = N[L[a].i], nb = N[L[b].i], k = (na.r + nb.r) * 0.5 + P.inner;
          let dx = L[a].x - L[b].x, dy = L[a].y - L[b].y;
          if (Math.abs(dx) + Math.abs(dy) < 1) { dx = (a - b) * 0.7; dy = 0.5; }
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > k * 2) continue;
          const f = k * k / d;
          fx[a] += dx / d * f; fy[a] += dy / d * f; fx[b] -= dx / d * f; fy[b] -= dy / d * f;
        }
      }
      for (const e of inE) {
        const a = loc.get(e.i), b = loc.get(e.j), p = L[a], q = L[b], dx = q.x - p.x, dy = q.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - reach(N[e.i], dx / d, dy / d) - reach(N[e.j], dx / d, dy / d) - P.line) * 3 * e.w;
        fx[a] += dx / d * f; fy[a] += dy / d * f; fx[b] -= dx / d * f; fy[b] -= dy / d * f;
      }
      L.forEach((p, a) => {
        fx[a] -= p.x * 0.08; fy[a] -= p.y * 0.08;  // 往组的中间收，摆得紧凑
      });
      if (it >= 100) for (const e of inE) {  // 组里的卡片也别压在组里别的线上（先让大体形状摆出来再管）
        const a = loc.get(e.i), b = loc.get(e.j), p = L[a], q = L[b], dx = q.x - p.x, dy = q.y - p.y, dd = dx * dx + dy * dy || 1;
        L.forEach((o, k) => {
          if (k === a || k === b) return;
          const t = clamp(((o.x - p.x) * dx + (o.y - p.y) * dy) / dd, 0, 1);
          let vx = o.x - p.x - dx * t, vy = o.y - p.y - dy * t, d = Math.sqrt(vx * vx + vy * vy);
          if (d < 0.5) { vx = -dy; vy = dx; d = Math.sqrt(dd); }
          const need = reach(N[o.i], vx / d, vy / d) + P.inner;
          if (d >= need) return;
          const f = (need - d) * 2;
          fx[k] += vx / d * f; fy[k] += vy / d * f;
        });
      }
      for (const x of ext) {
        const p = L[x.a];
        fx[x.a] += x.ux * 40 * x.w; fy[x.a] += x.uy * 40 * x.w;  // 连到别组的卡片往那一组那边靠
        L.forEach((q, b) => {  // 别的卡片让开这条往外去的线
          if (b === x.a) return;
          const vx = q.x - p.x, vy = q.y - p.y, t = vx * x.ux + vy * x.uy;
          if (t <= 0) return;
          let px = vx - t * x.ux, py = vy - t * x.uy, d = Math.sqrt(px * px + py * py);
          if (d < 0.5) { px = -x.uy; py = x.ux; d = 1; }
          const need = reach(N[q.i], px / d, py / d) + P.inner + 20;
          if (d >= need) return;
          const f = (need - d) * 2;
          fx[b] += px / d * f; fy[b] += py / d * f;
        });
      }
      L.forEach((p, a) => {
        const m = Math.sqrt(fx[a] * fx[a] + fy[a] * fy[a]);
        if (m > 0) { const s = Math.min(m, temp) / m; p.x += fx[a] * s; p.y += fy[a] * s; }
      });
      temp = Math.max(1, temp * 0.985);
    }
    separate(L, 200);
    // 还挡在往外去的线上的卡片：围着它连着的那张（组里连线最多的邻居）转个角度，挪到不挡线、不挤着别的卡片的地方
    const onRay = b => ext.some(x => {
      if (x.a === b) return false;
      const p = L[x.a], q = L[b], vx = q.x - p.x, vy = q.y - p.y, t = vx * x.ux + vy * x.uy;
      if (t <= 0) return false;
      const px = vx - t * x.ux, py = vy - t * x.uy, d = Math.sqrt(px * px + py * py) || 0.01;
      return d < reach(N[q.i], px / d, py / d) + P.inner;
    });
    const crowded = b => L.some((o, c) => c !== b && Math.abs(o.x - L[b].x) < (N[o.i].w + N[L[b].i].w) / 2 + P.inner && Math.abs(o.y - L[b].y) < (N[o.i].h + N[L[b].i].h) / 2 + P.inner);
    // 卡片 o 碰不碰到从 p 到 q 的线（线两头的卡片不算）
    const touches = (p, q, o) => {
      const dx = q.x - p.x, dy = q.y - p.y, dd = dx * dx + dy * dy || 1, t = clamp(((o.x - p.x) * dx + (o.y - p.y) * dy) / dd, 0, 1);
      const vx = o.x - p.x - dx * t, vy = o.y - p.y - dy * t, d = Math.sqrt(vx * vx + vy * vy) || 0.01;
      return d < reach(N[o.i], vx / d, vy / d) + P.inner * 0.6;
    };
    // 卡片 b 压在组里别的线上，或者它自己的线穿过组里别的卡片
    const tangled = b => inE.some(e => {
      const x = loc.get(e.i), y = loc.get(e.j);
      if (x !== b && y !== b) return touches(L[x], L[y], L[b]);
      const other = x === b ? y : x;
      return L.some((o, c) => c !== x && c !== y && touches(L[b], L[other], o));
    });
    const hubOf = b => {
      const nbs = inE.filter(e => e.i === L[b].i || e.j === L[b].i).map(e => loc.get(e.i === L[b].i ? e.j : e.i));
      return nbs.length ? nbs.reduce((h, c) => (degIn[c] > degIn[h] ? c : h)) : -1;
    };
    const degIn = L.map(p => inE.filter(e => e.i === p.i || e.j === p.i).length);
    for (let pass = 0; pass < 3; pass++) {
      let fixed = true;
      L.forEach((q, b) => {
        if (!onRay(b) && !tangled(b)) return;
        const h = hubOf(b);
        if (h < 0) return;
        const c = L[h], r = Math.hypot(q.x - c.x, q.y - c.y), a0 = Math.atan2(q.y - c.y, q.x - c.x), was = { x: q.x, y: q.y };
        for (const rr of [r, r * 1.3, r * 1.6]) {  // 这一圈转一圈都挤不下，就稍微往外一点再试
          for (let k = rr === r ? 1 : 0; k <= 44; k++) {
            const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 22.5;  // 每次多转 8°，左右轮流试
            q.x = c.x + Math.cos(a) * rr; q.y = c.y + Math.sin(a) * rr;
            if (!onRay(b) && !crowded(b) && !tangled(b)) return;
          }
        }
        q.x = was.x; q.y = was.y;
        fixed = false;
      });
      if (fixed) break;
    }
    g.L = L;
  };
  const grid = g => {
    const M = [...g.members].sort((a, b) => N[a].y - N[b].y || N[a].x - N[b].x);
    const cols = Math.max(1, Math.round(Math.sqrt(M.length * 1.5)));
    const cw = Math.max(...M.map(i => N[i].w)) + P.inner, ch = Math.max(...M.map(i => N[i].h)) + P.inner;
    g.L = M.map((i, x) => ({ i, x: (x % cols) * cw, y: Math.floor(x / cols) * ch }));
  };
  // 这一组的外框，坐标挪到外框中心
  const frame = g => {
    const x0 = Math.min(...g.L.map(p => p.x - N[p.i].w / 2)), x1 = Math.max(...g.L.map(p => p.x + N[p.i].w / 2));
    const y0 = Math.min(...g.L.map(p => p.y - N[p.i].h / 2)), y1 = Math.max(...g.L.map(p => p.y + N[p.i].h / 2));
    g.L.forEach(p => { p.x -= (x0 + x1) / 2; p.y -= (y0 + y1) / 2; });
    g.w = x1 - x0; g.h = y1 - y0;
  };
  groups.forEach(g => { (g.lonely ? grid : pack)(g); frame(g); });

  // 3. 一组组当成整块摆（place：围成一圈，组和组之间至少空出 zone）
  const W = new Map();  // 两组之间连了几条线
  E.forEach(e => {
    const a = gOf[e.i], b = gOf[e.j];
    if (a === b) return;
    const key = Math.min(a, b) + ',' + Math.max(a, b);
    W.set(key, (W.get(key) || 0) + e.w);
  });
  groups.forEach(g => {
    g.x = g.members.reduce((s, i) => s + N[i].x, 0) / g.members.length - cx0;
    g.y = g.members.reduce((s, i) => s + N[i].y, 0) / g.members.length - cy0;
  });
  // 一组组围成一圈：跟一半以上的组都连着的那组放在圆心，其余的沿着圆周排开；互相连着的组在圆周上挨着，
  // 组和组之间的线短、不横穿。圆的大小刚好放得下各组、组和组之间空出 zone。分开摆时，跟中间那组连得少的放得更靠外
  const link = (a, b) => W.get(Math.min(a, b) + ',' + Math.max(a, b)) || 0;
  const total = groups.map((g, a) => groups.reduce((s, h, b) => s + (a === b ? 0 : link(a, b)), 0));
  const rad = g => Math.hypot(g.w, g.h) / 2;
  let center = -1, ring = null, a0 = 0, ang = null;  // ang：每组在圈上的角度，第一次算好就不再变（后面只调半径，线的方向就不会跟着转）
  const place = () => {
    if (!ring) {
      const idx = groups.map((g, a) => a);
      const top = idx.reduce((b, a) => total[a] > total[b] || (total[a] === total[b] && groups[a].members.length > groups[b].members.length) ? a : b, 0);
      const partners = idx.filter(a => a !== top && link(top, a)).length;
      center = groups.length >= 3 && partners >= Math.ceil((groups.length - 1) / 2) ? top : -1;
      // 圆周上的先后：从连线最多的开始，下一个挑跟上一个连得最多的（一样多就挑跟中间连得多的、卡片多的）
      const left = idx.filter(a => a !== center);
      const score = (a, prev) => [prev < 0 ? total[a] : link(prev, a), center < 0 ? 0 : link(center, a), groups[a].members.length];
      const better = (x, y) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
      ring = [];
      while (left.length) {
        const prev = ring.length ? ring[ring.length - 1] : -1;
        const pick = left.reduce((b, a) => better(score(a, prev), score(b, prev)) ? a : b);
        ring.push(pick);
        left.splice(left.indexOf(pick), 1);
      }
      // 大体方位跟原来一样：第一组放在它原来所在的方向
      const c = center >= 0 ? groups[center] : { x: 0, y: 0 }, f = groups[ring[0]];
      a0 = Math.atan2(f.y - c.y, f.x - c.x) || 0;
    }
    const R0 = center >= 0 ? rad(groups[center]) : 0;
    const arcs = ring.map(k => 2 * rad(groups[k]) + P.zone), circ = arcs.reduce((s, x) => s + x, 0);
    const R = Math.max(circ / (2 * Math.PI), ...ring.map(k => R0 + P.zone + rad(groups[k])));
    if (center >= 0) { groups[center].x = 0; groups[center].y = 0; }
    if (!ang) {
      let run = 0;
      ang = ring.map((k, x) => { const a = a0 + (run + arcs[x] / 2) / circ * 2 * Math.PI; run += arcs[x]; return a; });
    }
    ring.forEach((k, x) => {
      const g = groups[k], a = ang[x];
      const c = center >= 0 ? link(center, k) : 0;
      const r = R + (spread ? P.far * 0.35 + P.far / (2 + c) : 0);  // 分开摆：整圈放大一些，跟中间连得越少稍微再靠外一点，圈还是圆的
      g.x = Math.cos(a) * r; g.y = Math.sin(a) * r;
    });
    if (ring.length === 1 && center < 0) { groups[ring[0]].x = 0; groups[ring[0]].y = 0; }
    // 保证组和组之间空出 zone
    for (let pass = 0; pass < 300; pass++) {
      let moved = false;
      for (let a = 0; a < groups.length; a++) {
        for (let b = a + 1; b < groups.length; b++) {
          const A = groups[a], B = groups[b], dx = B.x - A.x, dy = B.y - A.y;
          const ox = (A.w + B.w) / 2 + P.zone - Math.abs(dx), oy = (A.h + B.h) / 2 + P.zone - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          const d = Math.hypot(dx, dy) || 1, push = Math.min(ox, oy) / 2 + 1;  // 顺着两组中心的方向推开，圆形不走样
          A.x -= dx / d * push; A.y -= dy / d * push; B.x += dx / d * push; B.y += dy / d * push;
        }
      }
      if (!moved) break;
    }
  };
  place();

  // 4. 每组转个方向：连到别组的卡片朝着那一组，组和组之间的线短、不穿过组里
  const abs = new Map();
  const locate = () => groups.forEach(g => g.L.forEach(p => abs.set(p.i, { x: g.x + p.x, y: g.y + p.y })));
  locate();
  groups.forEach((g, gi) => {
    if (g.lonely) return;
    const out = E.filter(e => (gOf[e.i] === gi) !== (gOf[e.j] === gi));
    if (!out.length) return;
    const base = g.L.map(p => ({ x: p.x, y: p.y }));
    let best = 0, bestCost = Infinity;
    for (let s = 0; s < 12; s++) {
      const a = s * Math.PI / 6, c = Math.cos(a), sn = Math.sin(a);
      let cost = 0;
      for (const e of out) {
        const mine = gOf[e.i] === gi ? e.i : e.j, other = mine === e.i ? e.j : e.i, x = g.L.findIndex(p => p.i === mine);
        const px = g.x + base[x].x * c - base[x].y * sn, py = g.y + base[x].x * sn + base[x].y * c, o = abs.get(other);
        cost += Math.hypot(px - o.x, py - o.y) * e.w;
      }
      if (cost < bestCost - 1) { bestCost = cost; best = a; }
    }
    if (!best) return;
    const c = Math.cos(best), sn = Math.sin(best);
    g.L.forEach((p, x) => { p.x = base[x].x * c - base[x].y * sn; p.y = base[x].x * sn + base[x].y * c; });
    separate(g.L, 200);  // 卡片是扁的，转过之后可能挨上
    frame(g);
  });
  place();  // 转过之后外框变了，再摆一遍
  // 5. 组都放好了，每组照着连出去的线的方向再摆一遍：组里的卡片让开往外去的线，然后再把组摆一遍。
  //    摆完组的外框变了、圈上的角度会跟着动，所以做两遍，第二遍照着最后的方向让线
  for (let round = 0; round < 2; round++) {
    locate();
    groups.forEach((g, gi) => {
      if (g.lonely) return;
      const idx = new Map(g.L.map((p, x) => [p.i, x])), ext = [];
      for (const e of E) {
        if ((gOf[e.i] === gi) === (gOf[e.j] === gi)) continue;
        const mine = gOf[e.i] === gi ? e.i : e.j, o = abs.get(mine === e.i ? e.j : e.i), m = abs.get(mine);
        const d = Math.hypot(o.x - m.x, o.y - m.y) || 1;
        ext.push({ a: idx.get(mine), ux: (o.x - m.x) / d, uy: (o.y - m.y) / d, w: e.w });
      }
      if (!ext.length) return;
      pack(g, ext);
      frame(g);
    });
    place();
  }
  locate();
  return {
    pos: new Map(N.map((n, i) => { const p = abs.get(i); return [n.id, { x: Math.round(p.x + cx0), y: Math.round(p.y + cy0) }]; })),
    zones: groups.filter(g => g.members.length > 1).map(g => g.members.map(i => N[i].id)),
  };
}
/* 工具条上的「自动理图」小窗：选距离（小 / 中 / 大，记在本机设置里），再点团在一块或分开摆 */
const tidyPop = $('#mapTidyPop');
function toggleTidyPop(show = tidyPop.hidden) {
  const btn = $('.map-chip[data-z="tidy"]');
  tidyPop.hidden = !show;
  btn.classList.toggle('open', show);
  if (!show) return;
  $$('[data-tg]', tidyPop).forEach(b => b.classList.toggle('on', b.dataset.tg === tidyGap()));
  const m = mapEl.getBoundingClientRect(), r = btn.getBoundingClientRect();
  tidyPop.style.left = clamp(r.left - m.left, 12, m.width - tidyPop.offsetWidth - 12) + 'px';  // 对着按钮弹出来
}
tidyPop.addEventListener('click', ev => {
  const g = ev.target.closest('[data-tg]')?.dataset.tg, t = ev.target.closest('[data-tidy]')?.dataset.tidy;
  if (g && g !== tidyGap()) {
    S.settings = { ...S.settings, tidyGap: g };
    $$('[data-tg]', tidyPop).forEach(b => b.classList.toggle('on', b.dataset.tg === g));
    api('settings', { tidyGap: g }).then(r => { S.settings = r.settings; }).catch(err => toastErr('保存设置失败：' + err.message));
  }
  if (t) { toggleTidyPop(false); tidyMap(t === 'spread'); }
});
document.addEventListener('pointerdown', ev => {
  if (!tidyPop.hidden && !tidyPop.contains(ev.target) && !ev.target.closest('.map-chip[data-z="tidy"]')) toggleTidyPop(false);
}, true);
function tidyMap(spread) {
  const ids = [...nodeEls.keys()];
  if (!ids.length) return;
  closeLinkPop();
  const scale = tidyScales(ids), base = baseSizes(ids);
  const size = new Map(ids.map(id => [id, { w: base.get(id).w * scale.get(id), h: base.get(id).h * scale.get(id) }]));
  const scalesNow = () => new Map(ids.map(id => [id, G.scale.get(id) || 1]));
  const before = posNow(ids), oldScale = scalesNow();
  const level = tidyGap(), far = { s: '小', m: '中', l: '大' }[level];
  const oldZones = G.zones, done = tidyPositions(ids, size, spread, level);
  G.zones = done.zones;
  movePositions(before, done.pos, () => fitTo(ids, true), { from: oldScale, to: scale });
  const big = ids.filter(id => scale.get(id) > 1).length, how = (spread ? '按大卡片分开摆了' : '按连线团在一块了') + `（距离：${far}）`;
  toast(big ? `已自动理图：${big} 张连线多的卡片放大了，其他的${how}` : `已自动理图：${how}`, {
    icon: 'wand', action: '撤销', duration: 6000,
    onAction: () => { G.zones = oldZones; movePositions(posNow(ids), before, () => fitTo(ids, true), { from: scalesNow(), to: oldScale }); },
  });
}

/* ---------- 小地图 ---------- */
function drawMini() {
  if (mapEl.hidden || !G.pos.size) return;
  const W = 188, H = 122, c = G.cam, mw = mapEl.clientWidth, mh = mapEl.clientHeight;
  const vx0 = -c.x / c.k, vy0 = -c.y / c.k, vx1 = vx0 + mw / c.k, vy1 = vy0 + mh / c.k;
  let x0 = vx0, y0 = vy0, x1 = vx1, y1 = vy1, rects = '';
  const rs = [...nodeEls.keys()].map(id => [id, rectOf(id)]).filter(x => x[1]);
  rs.forEach(([, r]) => { x0 = Math.min(x0, r.x - r.w / 2); y0 = Math.min(y0, r.y - r.h / 2); x1 = Math.max(x1, r.x + r.w / 2); y1 = Math.max(y1, r.y + r.h / 2); });
  const s = Math.min((W - 12) / (x1 - x0 || 1), (H - 12) / (y1 - y0 || 1));
  const ox = (W - (x1 - x0) * s) / 2 - x0 * s, oy = (H - (y1 - y0) * s) / 2 - y0 * s;
  miniEl._t = { s, ox, oy };
  rs.forEach(([id, r]) => {
    const el = nodeEls.get(id), cls = (el.classList.contains('hub') ? 'hub ' : '') + (el.classList.contains('dim') ? 'dim' : '');
    const hh = el.style.getPropertyValue('--h');
    rects += `<rect class="${cls}" x="${f1(ox + (r.x - r.w / 2) * s)}" y="${f1(oy + (r.y - r.h / 2) * s)}" width="${f1(Math.max(2, r.w * s))}" height="${f1(Math.max(2, r.h * s))}" rx="${el.classList.contains('hub') ? 4 : 2}"${hh ? ` style="--h:${hh}"` : ''}/>`;
  });
  rects += `<rect class="vp" x="${f1(ox + vx0 * s)}" y="${f1(oy + vy0 * s)}" width="${f1((vx1 - vx0) * s)}" height="${f1((vy1 - vy0) * s)}" rx="4"/>`;
  miniEl.innerHTML = rects;
}
function miniJump(ev) {
  const t = miniEl._t, r = miniEl.getBoundingClientRect();
  if (!t) return;
  const wx = (ev.clientX - r.left - t.ox) / t.s, wy = (ev.clientY - r.top - t.oy) / t.s;
  stopCam();
  G.cam.x = mapEl.clientWidth / 2 - wx * G.cam.k;
  G.cam.y = mapEl.clientHeight / 2 - wy * G.cam.k;
  applyCam();
}
miniEl.addEventListener('pointerdown', ev => {
  ev.preventDefault();
  miniEl.setPointerCapture(ev.pointerId);
  miniJump(ev);
  const mv = e => miniJump(e);
  const up = () => { miniEl.removeEventListener('pointermove', mv); miniEl.removeEventListener('pointerup', up); camChanged(); };
  miniEl.addEventListener('pointermove', mv);
  miniEl.addEventListener('pointerup', up);
});

/* ---------- 工具条 ---------- */
$('.map-tools').addEventListener('click', ev => {
  const z = ev.target.closest('[data-z]')?.dataset.z;
  if (z === 'in') zoomAt(1.3, null, null, true);
  if (z === 'out') zoomAt(1 / 1.3, null, null, true);
  if (z === '1') zoomAt(1 / G.cam.k, null, null, true);
  if (z === 'fit') { fitTo(visibleIds(), true); camChanged(); }
  if (z === 'layout') autoArrange();
  if (z === 'size') toggleSizePop();
  if (z === 'link') openAutoLink();
  if (z === 'tidy') toggleTidyPop();
  if (z === 'auto') {
    G.auto = !G.auto;
    renderMap();
    graphSave(0);
    toast(G.auto ? '已显示自动关联：相同邮箱、手机号、账号的记录用虚线连在一起' : '已隐藏自动关联', { icon: 'link', duration: 3200 });
  }
});
function syncTip() { $('#mapTip').hidden = G.tipClosed || S.entries.length < 2 || G.links.length > 0 || !$('#mapFocus').hidden; }
$('#mapTip').addEventListener('click', ev => { if (ev.target.closest('[data-x]')) { G.tipClosed = true; syncTip(); } });
addEventListener('resize', () => { if (S.layout === 'graph') drawMini(); });

/* ---------- 关系图里的图标大小（在设置里的大小上再乘一个倍数） ---------- */
const sizePop = $('#mapSizePop'), sizeIn = $('#mapSizeIn');
const mapIconSize = () => Math.round((parseFloat(document.documentElement.style.getPropertyValue('--mav')) || 1) * 100);
let mapSizeTimer = 0;
function syncMapSize() {
  const v = mapIconSize();
  sizeIn.value = v;
  $('#mapSizeV').textContent = v + '%';
  $('#mapIconV').textContent = v === 100 ? '图标' : `图标 ${v}%`;
}
function setMapIconSize(v, tip) {
  v = clamp(Math.round(v / 5) * 5, 50, 300);
  if (v !== mapIconSize()) {
    document.documentElement.style.setProperty('--mav', v / 100);
    if (G.ready) { measure(); drawLinks(); spreadSoon(); }  // 卡片大小变了，连线端点跟着变，挤在一起的推开
    clearTimeout(mapSizeTimer);
    mapSizeTimer = setTimeout(() => api('settings', { mapIconSize: v }).then(r => { S.settings = r.settings; }).catch(err => toastErr('保存设置失败：' + err.message)), 400);
  }
  syncMapSize();
  if (tip && sizePop.hidden) toast(`关系图图标大小 ${v}%`, { icon: 'image', duration: 1200 });
}
function toggleSizePop(show = sizePop.hidden) {
  sizePop.hidden = !show;
  $('#mapIconBtn').classList.toggle('open', show);
  if (show) syncMapSize();
}
sizeIn.addEventListener('input', () => setMapIconSize(+sizeIn.value));
sizePop.addEventListener('click', ev => {
  const m = ev.target.closest('[data-ms]')?.dataset.ms;
  if (m === 'reset') setMapIconSize(100); else if (m) setMapIconSize(mapIconSize() + +m);
});
document.addEventListener('pointerdown', ev => {
  if (!sizePop.hidden && !sizePop.contains(ev.target) && !ev.target.closest('#mapIconBtn')) toggleSizePop(false);
}, true);
syncMapSize();

/* 在关系图里定位一张卡片（保存后、撤销删除后） */
function mapFlash(id) {
  const el = nodeEls.get(id);
  if (!el) return;
  const p = worldToClient(G.pos.get(id).x, G.pos.get(id).y), r = mapEl.getBoundingClientRect();
  if (p.x < r.left + 60 || p.x > r.right - 60 || p.y < r.top + 60 || p.y > r.bottom - 60) centerOn(id);
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* 快捷键（关系图里）：Delete 删连线、Esc 取消选中、+ / - 缩放、0 显示全部 */
function mapKey(ev) {
  if (ev.key === 'Delete' || ev.key === 'Backspace') { if (G.sel?.type === 'link') { deleteLink(G.sel.l); return true; } return false; }
  if (ev.key === 'Escape' && G.sel) { G.sel = null; applyDim(); drawLinks(); return true; }
  if (ev.key === '+' || ev.key === '=') { zoomAt(1.3, null, null, true); return true; }
  if (ev.key === '-' || ev.key === '_') { zoomAt(1 / 1.3, null, null, true); return true; }
  if (ev.key === '0') { fitTo(visibleIds(), true); camChanged(); return true; }
  return false;
}
