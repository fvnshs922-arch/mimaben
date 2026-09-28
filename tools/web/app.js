'use strict';

/* ================= 基础工具 ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
const SPRING = 'cubic-bezier(.34,1.56,.64,1)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const anim = (el, kf, opt) => (REDUCED || !el || !el.animate ? null : el.animate(kf, opt));

/* 是否在 pywebview 新窗口里（后台打开新窗口时网址带 w=1），要在下面清掉网址参数之前读 */
const IN_APP_WINDOW = (() => {
  const q = new URLSearchParams(location.search).get('w');
  try { if (q) sessionStorage.setItem('w', q); return (q || sessionStorage.getItem('w')) === '1'; } catch { return q === '1'; }
})();

const TOKEN = (() => {
  const q = new URLSearchParams(location.search).get('t');
  let t = q;
  try { if (q) sessionStorage.setItem('t', q); else t = sessionStorage.getItem('t'); } catch { /* 忽略 */ }
  if (q) history.replaceState(null, '', '/');
  return t || '';
})();

async function api(path, body) {
  let r;
  try {
    r = await fetch('/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Token': TOKEN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) { if (!S.restarting) showGone(); throw err; }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) showGone(j.error);
  if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

/* ================= 图标 ================= */
const I = {
  shield: '<path d="M12 3l7.5 3v5.2c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V6L12 3z"/><path d="M9 12.2l2.1 2.1 4-4.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M3.5 3.5l17 17"/><path d="M10.4 5.7c.5-.1 1-.2 1.6-.2 6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.8 3.6M6.6 7.2C4 9 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.3-1.1"/><path d="M9.9 10a2.8 2.8 0 0 0 4 4"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M5 15.5V7a2.5 2.5 0 0 1 2.5-2.5H15"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19.2 8.8a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5h6V7"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  cloud: '<path d="M7 18.5a4.8 4.8 0 0 1-.7-9.6A6 6 0 0 1 17.8 9.6a4.5 4.5 0 0 1-.3 8.9H7z"/><path d="M12 11.5v5M9.8 13.6L12 11.4l2.2 2.2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9.5" r="1.8"/><path d="M21 15.5l-5-5-9.5 9.5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  more: '<circle cx="5.5" cy="12" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="18.5" cy="12" r="1.1" fill="currentColor"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r=".9" fill="currentColor"/><circle cx="15" cy="15" r=".9" fill="currentColor"/><circle cx="15" cy="9" r=".9" fill="currentColor"/><circle cx="9" cy="15" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 0 1-13.3 4.8M4.5 12a7.5 7.5 0 0 1 13.3-4.8"/><path d="M18 3.5v4h-4M6 20.5v-4h4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.5 3.5 5.3 3.5 8.5s-1.2 6-3.5 8.5c-2.3-2.5-3.5-5.3-3.5-8.5S9.7 6 12 3.5z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  alert: '<path d="M12 4L2.8 19.5h18.4L12 4z"/><path d="M12 10v4.2M12 17v.01"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  upload: '<path d="M12 15.5V4.5M7.5 9L12 4.5 16.5 9"/><path d="M4.5 15v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  download: '<path d="M12 4.5v11M7.5 11L12 15.5 16.5 11"/><path d="M4.5 15v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.4 7.4 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6z"/>',
  graph: '<circle cx="6" cy="6.5" r="2.6"/><circle cx="18" cy="8" r="2.6"/><circle cx="9.5" cy="18" r="2.6"/><path d="M8.6 6.8l6.8.9M16.3 10.1l-5.1 5.8M6.8 9l1.9 6.4"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
  undo: '<path d="M9 7.5L4.5 12 9 16.5"/><path d="M4.5 12h10a5 5 0 0 1 0 10H12"/>',
  wand: '<path d="M4.5 19.5L15 9M13.5 7.5l3 3"/><path d="M18 3.5v3M16.5 5h3M20 11v2M19 12h2M9.5 3.5v2M8.5 4.5h2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4.5 7.5l7.5 5.5 7.5-5.5"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.8h2"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  resize: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/>',
  swap: '<path d="M7 7.5h12M15.5 4l3.5 3.5-3.5 3.5M17 16.5H5M8.5 13L5 16.5 8.5 20"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.7 0-.9.7-1.6 1.6-1.6h2.1a4.1 4.1 0 0 0 4.1-4.1C20.5 6.6 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11.5" r="1" fill="currentColor"/><circle cx="10" cy="7.6" r="1" fill="currentColor"/><circle cx="14.5" cy="7.6" r="1" fill="currentColor"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;

/* ================= 状态 ================= */
const S = { cats: [], entries: [], view: 'all', layout: null, q: '', status: null, revealed: new Set(), restarting: false };
let uidN = 0;
const uid = () => 'e' + ++uidN;

const DEFAULT_FIELDS = ['网址', '账户名', '邮箱', '密码', '密保', '备注'];
const QUICK = ['支付密码', '绑定手机', '密保问题', '密保答案', '恢复码', '用户ID'];
const quickFields = () => S.settings?.quickFields || QUICK;       // 「添加字段」里的按钮，可以在「常用字段」里改
const newFields = () => S.settings?.newFields || DEFAULT_FIELDS;  // 新增记录默认带的字段
const isSecret = l => /密码|密保|口令|PIN|恢复码|答案|安全码/i.test(l || '');
const isPw = l => /密码|口令|PIN/i.test(l || '');
const isUrl = l => /网址|网站|链接|URL|域名/i.test(l || '');
const hue = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
const initial = t => ([...String(t || '').trim()][0] || '?').toUpperCase();
const SEG = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
const graphemes = s => (SEG ? [...SEG.segment(s)].map(x => x.segment) : [...s]);
const mask = v => '•'.repeat(clamp([...v].length, 6, 12));
const prettyUrl = u => u.replace(/^https?:\/\//i, '').replace(/\/$/, '');

/* ================= 元素 ================= */
const navList = $('#navList'), gridEl = $('#grid'), emptyEl = $('#empty');
const drawer = $('#drawer'), scrim = $('#scrim'), searchIn = $('#search');

/* ================= 加载 ================= */
async function load() {
  await graphFlushPending(); // 关系图还没写出去的先写掉，再重新读
  const d = await api('data');
  S.cats = d.categories.map(c => c.name);
  S.entries = d.categories.flatMap(c => c.entries.map(e => ({ id: uid(), cat: c.name, title: e.title, icon: e.icon || {}, fields: e.fields })));
  S.deleted = d.deleted || [];
  S.settings = d.settings || { autoIcon: true };
  S.autolink = d.autolink || [];  // 一键连线的记录，撤回用
  S.layout ??= S.settings.layout === 'graph' ? 'graph' : 'grid';
  graphFromData(d.graph);
}

/* ================= 侧栏 ================= */
function renderNav() {
  const counts = {};
  S.entries.forEach(e => (counts[e.cat] = (counts[e.cat] || 0) + 1));
  const prev = Object.fromEntries($$('.nav-item', navList).map(b => [b.dataset.view, $('.count', b).textContent]));
  let i = 0;
  const item = (view, label, ic, n, menu) =>
    `<button class="nav-item${S.view === view ? ' active' : ''}" data-view="${esc(view)}" style="--i:${i++}" title="${esc(label)}">` +
    `${icon(ic)}<span class="nav-text">${esc(label)}</span><span class="count">${n}</span>` +
    (menu ? `<span class="nav-more" data-menu="${esc(label)}" title="重命名 / 删除">${icon('more')}</span>` : '') + `</button>`;
  navList.innerHTML =
    item('all', '全部记录', 'grid', S.entries.length) +
    `<div class="nav-label" style="--i:${i++}">分类</div>` +
    (S.cats.map(c => item('cat:' + c, c, 'folder', counts[c] || 0, true)).join('') || `<div class="nav-empty">还没有分类</div>`) +
    (S.deleted?.length ? item('deleted', '最近删除', 'trash', S.deleted.length).replace('nav-item', 'nav-item trash-item') : '');
  $$('.nav-item', navList).forEach(b => {
    const c = $('.count', b), p = prev[b.dataset.view];
    if (p !== undefined && p !== c.textContent) anim(c, [{ transform: 'scale(1.8)', opacity: .4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 550, easing: SPRING });
  });
  moveIndicator();
}

function moveIndicator(instant) {
  const a = $('.nav-item.active', navList), ind = $('.nav-ind');
  if (!a) { ind.style.opacity = 0; return; }
  if (instant) ind.style.transition = 'none';
  ind.style.transform = `translateY(${a.offsetTop}px)`;
  ind.style.height = a.offsetHeight + 'px';
  ind.style.opacity = 1;
  if (instant) { void ind.offsetWidth; ind.style.transition = ''; }
}

function setView(v) {
  if (S.view === v) return;
  S.view = v;
  $$('.nav-item', navList).forEach(b => b.classList.toggle('active', b.dataset.view === v));
  moveIndicator();
  $('#main').scrollTo({ top: 0 });
  renderMain(true);
}

navList.addEventListener('click', ev => {
  const more = ev.target.closest('.nav-more');
  if (more) { ev.stopPropagation(); catMenu(more, more.dataset.menu); return; }
  const b = ev.target.closest('.nav-item');
  if (b?.dataset.view === 'deleted') return openDeleted();
  if (b) setView(b.dataset.view);
});

/* ================= 主区 ================= */
function renderMain(fresh) {
  const title = S.view === 'all' ? '全部记录' : S.view.slice(4);
  const h1 = $('#viewTitle');
  if (h1.textContent !== title) {
    h1.textContent = title;
    anim(h1, [{ opacity: 0, transform: 'translateY(10px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 450, easing: EASE_OUT });
  }
  $('#newBtn').innerHTML = icon('plus') + '<span>新增记录</span>';
  renderGrid(fresh);
  updateSub();
}

function updateSub() {
  const n = visibleEntries().length;
  $('#viewSub').textContent = S.q.trim() ? `找到 ${n} 条` : `${n} 条记录`;
  syncRevealAll();
}

const matchText = e => [e.title, e.cat, ...e.fields.filter(f => !isSecret(f.label)).map(f => f.label + ' ' + f.value)].join(' ').toLowerCase();
function visibleEntries() {
  const q = S.q.trim().toLowerCase();
  return S.entries.filter(e => (S.view === 'all' || S.view === 'cat:' + e.cat) && (!q || matchText(e).includes(q)));
}

function hl(text) {
  const t = String(text ?? ''), q = S.q.trim();
  const i = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
}

const sig = e => JSON.stringify([e.title, e.cat, iconKey(e.icon), e.fields, S.view === 'all', S.q.trim()]);

function cardEl(e) {
  const url = e.fields.find(f => isUrl(f.label) && f.value)?.value || '';
  const rows = e.fields.map((f, idx) => [f, idx]).filter(([f]) => !isUrl(f.label) && (f.label || f.value));
  const el = document.createElement('article');
  el.className = 'card';
  el.tabIndex = 0;
  el.draggable = true;
  el.title = '可以拖到左侧的分类里';
  el.dataset.id = e.id;
  el.dataset.v = sig(e);
  setAvatarVars(el, e.title, e.icon);
  el.innerHTML = `
    <div class="card-glow"></div>
    <header class="card-head">
      <div class="avatar">${avatarInner(e.title, e.icon)}</div>
      <div class="card-title">
        <h3>${hl(e.title)}</h3>
        ${url ? `<span class="card-url">${icon('globe')}<span>${hl(prettyUrl(url))}</span></span>` : ''}
      </div>
      ${S.view === 'all' ? `<span class="chip">${esc(e.cat)}</span>` : ''}
    </header>
    <div class="card-tools">
      <button class="icon-btn" data-act="edit" title="编辑">${icon('edit')}</button>
      <button class="icon-btn" data-act="move" title="移动到其他分类">${icon('folder')}</button>
      <button class="icon-btn danger" data-act="del" title="删除">${icon('trash')}</button>
    </div>
    <div class="rows">${rows.map(([f, idx]) => rowHTML(e, f, idx)).join('') || '<p class="no-rows">还没有填写内容</p>'}</div>`;
  return el;
}

function rowHTML(e, f, idx) {
  const secret = isSecret(f.label), shown = S.revealed.has(e.id + ':' + idx), empty = !f.value;
  const val = empty ? '未填写' : secret && !shown ? mask(f.value) : secret ? esc(f.value) : hl(f.value);
  return `<div class="row${secret ? ' secret' : ''}${shown ? ' shown' : ''}" data-idx="${idx}">
    <span class="row-label" title="${esc(f.label)}">${esc(f.label || '备注')}</span>
    <span class="row-val${empty ? ' empty' : ''}">${val}</span>
    ${empty ? '<span></span>' : `<span class="row-act">
      ${secret ? `<button class="icon-btn" data-act="reveal" title="显示 / 隐藏">${icon(shown ? 'eyeOff' : 'eye')}</button>` : ''}
      <button class="icon-btn" data-act="copy" title="复制">${icon('copy')}${icon('check', 'ok')}</button></span>`}
  </div>`;
}

/* 带动画的增量渲染：保留已有卡片，位置变化用 FLIP，离场留残影淡出 */
function renderGrid(fresh) {
  if (S.layout === 'graph') return renderMap(fresh);
  const list = visibleEntries();
  const old = new Map($$('.card', gridEl).map(el => [el.dataset.id, el]));
  const rects = new Map();
  if (!fresh) old.forEach((el, id) => rects.set(id, el.getBoundingClientRect()));
  const keep = new Set(fresh ? [] : list.map(e => e.id));
  old.forEach((el, id) => { if (!keep.has(id)) { if (!fresh) ghostOut(el); el.remove(); } });

  const next = list.map(e => {
    let el = keep.has(e.id) ? old.get(e.id) : null;
    const isNew = !el;
    if (el && el.dataset.v !== sig(e)) { const n = cardEl(e); el.replaceWith(n); el = n; }
    else if (!el) el = cardEl(e);
    return { el, isNew, id: e.id };
  });
  next.forEach(({ el }) => gridEl.appendChild(el));

  let k = 0;
  next.forEach(({ el, isNew, id }) => {
    if (isNew) {
      anim(el, [{ opacity: 0, transform: 'translateY(22px) scale(.96)' }, { opacity: 1, transform: 'none' }],
        { duration: 600, delay: Math.min(k++, 14) * 38, easing: EASE_OUT, fill: 'backwards' });
    } else {
      const a = rects.get(id), b = el.getBoundingClientRect();
      if (a && (a.left !== b.left || a.top !== b.top)) {
        anim(el, [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: 500, easing: EASE_OUT });
      }
    }
  });
  renderEmpty(!list.length, S.q.trim() ? 'search' : 'entries');
  updateSub();
}

function ghostOut(el) {
  if (REDUCED) return;
  const r = el.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
  const g = el.cloneNode(true);
  g.classList.add('ghost');
  g.removeAttribute('data-id');
  setTimeout(() => g.remove(), 600);
  Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, pointerEvents: 'none', zIndex: 4 });
  document.body.appendChild(g);
  const a = g.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9)', filter: 'blur(4px)' }], { duration: 320, easing: 'ease-in', fill: 'forwards' });
  a.onfinish = () => g.remove();
}


function renderEmpty(show, kind) {
  const was = !emptyEl.hidden && emptyEl.dataset.kind === kind && emptyEl.dataset.q === S.q;
  emptyEl.hidden = !show;
  if (!show || was) return;
  emptyEl.dataset.kind = kind;
  emptyEl.dataset.q = S.q;
  const art = ic => `<div class="empty-art"><span class="ring"></span><span class="ring r2"></span><div class="empty-ic">${icon(ic)}</div></div>`;
  emptyEl.innerHTML = {
    search: `${art('search')}<h3>没有找到「${esc(S.q.trim())}」</h3><p>换个关键词试试。为了安全，密码和密保的内容不参与搜索。</p>`,
    entries: `${art('key')}<h3>这里还没有记录</h3><p>照着纸上的记录，一条条录进来吧。账户名、邮箱、密码、密保只存在本机。</p><button class="btn primary" data-act="new">${icon('plus')}新增第一条</button>`,
  }[kind];
  emptyEl.classList.remove('in');
  void emptyEl.offsetWidth;
  emptyEl.classList.add('in');
}
emptyEl.addEventListener('click', ev => {
  const a = ev.target.closest('[data-act]')?.dataset.act;
  if (a === 'new') openEditor(null);
});

/* ---- 卡片交互 ---- */
gridEl.addEventListener('click', ev => {
  const card = ev.target.closest('.card');
  if (!card) return;
  const e = S.entries.find(x => x.id === card.dataset.id);
  if (!e) return;
  const btn = ev.target.closest('[data-act]');
  const act = btn?.dataset.act;
  if (act === 'copy') return copyField(e, +btn.closest('.row').dataset.idx, btn);
  if (act === 'reveal') return toggleReveal(e, +btn.closest('.row').dataset.idx);
  if (act === 'del') return deleteEntry(e);
  if (act === 'move') return moveMenu(btn, e);
  if (getSelection()?.toString()) return;
  openEditor(e);
});
gridEl.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.classList.contains('card')) {
    const e = S.entries.find(x => x.id === ev.target.dataset.id);
    if (e) openEditor(e);
  }
});
gridEl.addEventListener('pointermove', ev => {
  const c = ev.target.closest('.card');
  if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', ev.clientX - r.left + 'px');
  c.style.setProperty('--my', ev.clientY - r.top + 'px');
});

async function copyField(e, idx, btn) {
  const f = e.fields[idx];
  try { await navigator.clipboard.writeText(f.value); }
  catch {
    const t = Object.assign(document.createElement('textarea'), { value: f.value });
    document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  btn.classList.add('done');
  setTimeout(() => btn.classList.remove('done'), 1500);
  toast(`已复制「${f.label || '备注'}」`, { icon: 'copy' });
}

const hideTimers = new Map();
function toggleReveal(e, idx, force, ms = 20000) {
  const key = e.id + ':' + idx, f = e.fields[idx];
  const shown = force ?? !S.revealed.has(key);
  shown ? S.revealed.add(key) : S.revealed.delete(key);
  clearTimeout(hideTimers.get(key));
  // 卡片视图和关系图里的这一行都要更新
  const rows = [[gridEl.querySelector(`.card[data-id="${e.id}"] .row[data-idx="${idx}"]`), '.row-val'],
    [$('#mapNodes').querySelector(`.node[data-id="${e.id}"] .nrow[data-idx="${idx}"]`), 'b']];
  for (const [row, sel] of rows) {
    if (!row) continue;
    row.classList.toggle('shown', shown);
    const b = $('[data-act="reveal"]', row);
    if (b) b.innerHTML = icon(shown ? 'eyeOff' : 'eye');
    const v = $(sel, row);
    if (shown) scramble(v, f.value);
    else { cancelAnimationFrame(v._raf); clearTimeout(v._end); v.textContent = mask(f.value); anim(v, [{ opacity: .2, filter: 'blur(6px)' }, { opacity: 1, filter: 'none' }], { duration: 350, easing: EASE }); }
  }
  if (shown) hideTimers.set(key, setTimeout(() => toggleReveal(e, idx, false), ms)); // 到时间自动隐藏
  syncRevealAll();
}

/* ---- 一键显示 / 隐藏当前页所有密码 ---- */
const secretKeys = () => visibleEntries().flatMap(e => e.fields.map((f, idx) => [e, idx, f]))
  .filter(([, , f]) => isSecret(f.label) && f.value);
function syncRevealAll() {
  const all = secretKeys(), on = all.length && all.every(([e, idx]) => S.revealed.has(e.id + ':' + idx));
  const b = $('#revealAllBtn');
  b.disabled = !all.length;
  b.innerHTML = icon(on ? 'eyeOff' : 'eye') + `<span>${on ? '隐藏密码' : '显示密码'}</span>`;
}
function revealAll() {
  const all = secretKeys();
  if (!all.length) return;
  const show = !all.every(([e, idx]) => S.revealed.has(e.id + ':' + idx));
  all.forEach(([e, idx]) => toggleReveal(e, idx, show, 60000)); // 全部显示的 60 秒后自动隐藏
  toast(show ? `已显示 ${all.length} 个密码，60 秒后自动隐藏` : '已隐藏全部密码', { icon: show ? 'eye' : 'eyeOff' });
}
$('#revealAllBtn').addEventListener('click', revealAll);

/* 解码动画：字符先随机跳动，再从左到右依次定格 */
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#$%&*@?';
function scramble(el, text, setter) {
  const put = setter || (s => (el.textContent = s));
  if (REDUCED) return put(text);
  const arr = [...text], dur = clamp(220 + arr.length * 28, 300, 750), t0 = performance.now();
  cancelAnimationFrame(el._raf);
  clearTimeout(el._end);
  const tick = now => {
    const p = Math.min(1, (now - t0) / dur), n = Math.floor(p * arr.length);
    put(arr.map((c, i) => (i < n || c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join(''));
    if (p < 1) el._raf = requestAnimationFrame(tick); else put(text);
  };
  el._raf = requestAnimationFrame(tick);
  // 窗口在后台时 requestAnimationFrame 会暂停，兜底保证最终显示正确
  el._end = setTimeout(() => { cancelAnimationFrame(el._raf); put(text); }, dur + 80);
}

/* ---- 把记录移到其他分类：卡片上的按钮，或者把卡片拖到左侧分类上 ---- */
function moveMenu(anchor, e) {
  const others = S.cats.filter(c => c !== e.cat);
  menu(anchor, [
    ...others.map(c => ({ icon: 'folder', label: c, run: () => moveEntry(e, c) })),
    { icon: 'plus', label: '新建分类…', run: async () => { const c = await promptCatName('新建分类'); if (c) moveEntry(e, c); } },
  ]);
}

async function moveEntry(e, cat, undo) {
  const from = e.cat;
  if (!cat || cat === from) return;
  try {
    if (!S.cats.includes(cat)) {
      await api('category', { action: 'create', name: cat });
      S.cats = [...S.cats, cat].sort((a, b) => a.localeCompare(b, 'zh'));
    }
    e.cat = cat;
    await saveCat(cat);
    await saveCat(from);
  } catch (err) { e.cat = from; return toastErr('移动失败：' + err.message); }
  renderNav();
  renderGrid();
  if (!undo) toast(`已把「${e.title}」移到「${cat}」`, { icon: 'folder', action: '撤销', duration: 5000, onAction: () => moveEntry(e, from, true) });
}

gridEl.addEventListener('dragstart', ev => {
  const card = ev.target.closest?.('.card');
  if (!card) return;
  ev.dataTransfer.setData('text/x-entry', card.dataset.id);
  ev.dataTransfer.effectAllowed = 'move';
  card.classList.add('dragging');
  document.body.classList.add('dragging-entry');
});
gridEl.addEventListener('dragend', ev => {
  ev.target.closest?.('.card')?.classList.remove('dragging');
  document.body.classList.remove('dragging-entry');
  $$('.nav-item.drop-target').forEach(x => x.classList.remove('drop-target'));
});
const entryDrag = ev => [...(ev.dataTransfer?.types || [])].includes('text/x-entry');
const catItem = ev => { const b = ev.target.closest('.nav-item'); return b?.dataset.view?.startsWith('cat:') ? b : null; };
navList.addEventListener('dragover', ev => {
  const b = entryDrag(ev) && catItem(ev);
  if (!b) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  $$('.nav-item.drop-target').forEach(x => x !== b && x.classList.remove('drop-target'));
  b.classList.add('drop-target');
});
navList.addEventListener('dragleave', ev => { const b = catItem(ev); if (b && !b.contains(ev.relatedTarget)) b.classList.remove('drop-target'); });
navList.addEventListener('drop', ev => {
  const b = entryDrag(ev) && catItem(ev);
  if (!b) return;
  ev.preventDefault();
  b.classList.remove('drop-target');
  const e = S.entries.find(x => x.id === ev.dataTransfer.getData('text/x-entry'));
  if (e) moveEntry(e, b.dataset.view.slice(4));
});

async function deleteEntry(e) {
  const idx = S.entries.indexOf(e);
  if (idx < 0) return;
  S.entries.splice(idx, 1);
  if (ED && ED.id === e.id) closeDrawer();
  renderNav();
  renderGrid();
  try { await saveCat(e.cat); } catch (err) { return toastErr('删除失败：' + err.message); }
  toast(`已删除「${e.title}」`, {
    icon: 'trash', action: '撤销', duration: 6000,
    onAction: async () => {
      S.entries.splice(Math.min(idx, S.entries.length), 0, e);
      renderNav(); renderGrid();
      await saveCat(e.cat).catch(err => toastErr(err.message));
      flash(e.id);
    },
  });
}

function flash(id) {
  if (S.layout === 'graph') return mapFlash(id);
  const c = gridEl.querySelector(`.card[data-id="${id}"]`);
  if (!c) return;
  c.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
  c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
}

let statusTimer = 0;
async function saveCat(name) {
  await api('save', { name, entries: S.entries.filter(e => e.cat === name).map(({ title, icon, fields }) => ({ title, icon, fields })) });
  graphTouch(); // 关系图按「分类/标题」记，改名、换分类后重新保存
  clearTimeout(statusTimer);
  statusTimer = setTimeout(refreshStatus, 400);
}

/* ================= 编辑抽屉 ================= */
let ED = null;
const edSnap = () => JSON.stringify([ED.title, ED.cat, iconKey(ED.icon), ED.fields]);

function currentCat() {
  if (S.view.startsWith('cat:')) return S.view.slice(4);
  return S.cats[0] || '默认';
}

function openEditor(e) {
  ED = e
    ? { id: e.id, cat: e.cat, title: e.title, icon: { ...e.icon }, fields: e.fields.map(f => ({ ...f })) }
    : { id: null, cat: currentCat(), title: '', icon: {}, fields: newFields().map(label => ({ label, value: '' })) };
  ED.snap = edSnap();
  $('#dHeading').textContent = e ? '编辑记录' : '新增记录';
  $('#dTitle').value = ED.title;
  $('#dDelete').hidden = !e;
  renderCatSelect();
  renderFields();
  updateAvatar(true);
  drawer.classList.remove('open');
  void drawer.offsetWidth;
  drawer.classList.add('open');
  scrim.classList.add('on');
  $('#dBody').scrollTop = 0;
  setTimeout(() => (e ? $('.f-value', $('#dFields')) : $('#dTitle'))?.focus(), 120);
}

function closeDrawer() {
  drawer.classList.remove('open');
  scrim.classList.remove('on');
  closeGen();
  closeIcp();
  ED = null;
}

async function requestClose() {
  if (!ED) return;
  if (edSnap() !== ED.snap) {
    const ok = await dialog({ title: '放弃未保存的修改？', text: '刚才填写的内容还没有保存。', ok: '放弃修改', danger: true, icon: 'alert' });
    if (!ok) return;
  }
  closeDrawer();
}

function renderCatSelect() {
  const cats = S.cats.includes(ED.cat) ? S.cats : [...S.cats, ED.cat];
  $('#dCat').innerHTML = cats.map(c => `<option${c === ED.cat ? ' selected' : ''}>${esc(c)}</option>`).join('') + '<option value="__new">＋ 新建分类…</option>';
}

$('#dCat').addEventListener('change', async ev => {
  if (ev.target.value !== '__new') { ED.cat = ev.target.value; return; }
  const name = await promptCatName('新建分类');
  if (name) ED.cat = name;
  renderCatSelect();
});

function updateAvatar(init) {
  const a = $('#dAvatar'), t = ED.title.trim();
  setAvatarVars(a, t, ED.icon);
  const html = avatarInner(t, ED.icon);
  if (a._html !== html) {
    a._html = html;
    a.innerHTML = html;
    if (!init) anim(a, [{ transform: 'scale(.6) rotate(-15deg)' }, { transform: 'none' }], { duration: 500, easing: SPRING });
  }
}
$('#dTitle').addEventListener('input', ev => { ED.title = ev.target.value; updateAvatar(); scheduleAutoIcon(); });

/* ================= 图标：颜色 / emoji / 图片 ================= */
const PRESETS = ['#ff5a5f', '#ff8a3d', '#ffb020', '#34c759', '#14b8a6', '#22b8f0', '#3b82f6',
  '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#64748b', '#1f2937', '#ffffff'];
const EMOJIS = ['🔑', '💬', '🎮', '🛒', '🏦', '💳', '📧', '🎵', '🎬', '📺', '☁️', '💼',
  '🎓', '🏥', '✈️', '🚗', '🍔', '📱', '💻', '🐧', '⭐', '❤️', '🔥', '🌐'];
const iconKey = ic => [ic?.color || '', ic?.text || '', ic?.image || ''].join('|');
const iconUrl = name => `/api/icon?name=${encodeURIComponent(name)}&t=${encodeURIComponent(TOKEN)}`;

function hexHsl(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}

/* 自定义颜色时用这个色做渐变起点，稍微转一点色相、压暗一点做终点；浅色背景换深色字 */
function setAvatarVars(el, title, ic) {
  const c = ic?.color, set = (k, v) => (v == null ? el.style.removeProperty(k) : el.style.setProperty(k, v));
  if (!c) { set('--h', hue(title || '?')); set('--c1'); set('--c2'); set('--fg'); return; }
  const { h, s, l, lum } = hexHsl(c);
  set('--h', Math.round(h));
  set('--c1', c);
  set('--c2', `hsl(${Math.round(h + (s > 12 ? 26 : 0)) % 360} ${Math.round(Math.min(100, s + 4))}% ${Math.round(clamp(l - 12, 6, 88))}%)`);
  set('--fg', lum > 0.62 ? '#1d2233' : null);
}

function avatarInner(title, ic) {
  const fb = esc(initial(title));
  if (ic?.image) return `<img src="${esc(iconUrl(ic.image))}" alt="" draggable="false" data-fb="${fb}">`;
  if (ic?.text) return `<span class="av-t${graphemes(ic.text).length > 1 ? ' two' : ''}">${esc(ic.text)}</span>`;
  return `<span class="av-t">${fb}</span>`;
}

/* 小图标（例如 32px 的 favicon）铺满会糊，四周留白；加载失败退回首字母 */
document.addEventListener('load', ev => {
  const img = ev.target;
  if (img.tagName === 'IMG' && img.parentElement?.classList.contains('avatar')) img.classList.toggle('pad', img.naturalWidth < 96);
}, true);
document.addEventListener('error', ev => {
  const img = ev.target;
  if (img.tagName !== 'IMG') return;
  if (img.parentElement?.classList.contains('avatar')) img.outerHTML = `<span class="av-t">${esc(img.dataset.fb || '?')}</span>`;
  else if (img.parentElement?.classList.contains('res')) { // 浏览器显示不了的候选直接去掉
    const box = img.closest('.icp-results');
    img.parentElement.remove();
    if (box && !$('.res', box)) box.innerHTML = '<p class="icp-empty">没有找到能用的图标。可以检查网址，或者用本地图片。</p>';
  }
}, true);

const icp = $('#icp');
const P = { mode: 'letter', searching: 0 };

function openIcp() {
  if (!ED) return;
  if (!icp.hidden) return closeIcp();
  closeGen();
  P.mode = ED.icon.image ? 'image' : ED.icon.text ? 'text' : 'letter';
  $('#icpText').value = ED.icon.text || '';
  $('#icpResults').innerHTML = '';
  $('#icpEmoji').innerHTML = EMOJIS.map(e => `<button data-e="${e}">${e}</button>`).join('');
  icp.hidden = false;
  icp.style.animation = 'none'; void icp.offsetWidth; icp.style.animation = '';
  const r = $('#dAvatar').getBoundingClientRect(), w = icp.offsetWidth;
  icp.style.left = clamp(r.left, 12, innerWidth - w - 12) + 'px';
  icp.style.top = clamp(r.bottom + 10, 12, Math.max(12, innerHeight - icp.offsetHeight - 12)) + 'px';
  syncIcp();
}
function closeIcp() { icp.hidden = true; P.searching++; }

function syncIcp() {
  $$('#icpTabs button').forEach(b => b.classList.toggle('on', b.dataset.mode === P.mode));
  const on = $(`#icpTabs [data-mode="${P.mode}"]`), ind = $('.icp-ind', icp);
  ind.style.transform = `translateX(${on.offsetLeft}px)`;
  ind.style.width = on.offsetWidth + 'px';
  $$('.icp-pane', icp).forEach(p => (p.hidden = p.dataset.pane !== P.mode));
  const cur = ED.icon.color || '';
  $('#icpSwatches').innerHTML =
    `<button class="sw auto${cur ? '' : ' on'}" data-c="" title="自动（按名称生成）" style="--h:${hue(ED.title.trim() || '?')}"></button>` +
    PRESETS.map(c => `<button class="sw${cur === c ? ' on' : ''}" data-c="${c}" title="${c}" style="--c:${c}"></button>`).join('') +
    `<label class="sw custom${cur && !PRESETS.includes(cur) ? ' on' : ''}" title="自定义颜色"${cur && !PRESETS.includes(cur) ? ` style="--c:${cur}"` : ''}>` +
    `<input type="color" id="icpColor" value="${cur || '#8b7bff'}"></label>`;
}

function setIcon(patch) {
  ED.iconTouched = true;  // 自己改过图标，就不再自动找
  ED.icon = { ...ED.icon, ...patch };
  for (const k of Object.keys(ED.icon)) if (!ED.icon[k]) delete ED.icon[k];
  updateAvatar();
}

$('#dAvatar').addEventListener('click', openIcp);
$('#icpTabs').addEventListener('click', ev => {
  const b = ev.target.closest('[data-mode]');
  if (!b) return;
  P.mode = b.dataset.mode;
  if (P.mode === 'letter') setIcon({ text: '', image: '' });
  if (P.mode === 'text' && $('#icpText').value) setIcon({ text: $('#icpText').value, image: '' });
  syncIcp();
  if (P.mode === 'text') setTimeout(() => $('#icpText').focus(), 30);
});
function takeText(ev) {
  if (ev?.isComposing) return;
  const inp = $('#icpText'), v = graphemes(inp.value.replace(/\s/g, '')).slice(0, 2).join('');
  if (v !== inp.value) inp.value = v;
  setIcon({ text: v, image: '' });
}
$('#icpText').addEventListener('input', takeText);
$('#icpText').addEventListener('compositionend', () => takeText());
$('#icpEmoji').addEventListener('click', ev => {
  const b = ev.target.closest('[data-e]');
  if (!b) return;
  $('#icpText').value = b.dataset.e;
  setIcon({ text: b.dataset.e, image: '' });
});
$('#icpSwatches').addEventListener('click', ev => {
  const b = ev.target.closest('button.sw');
  if (!b) return;
  setIcon({ color: b.dataset.c });
  syncIcp();
});
$('#icpSwatches').addEventListener('input', ev => {
  if (ev.target.id !== 'icpColor') return;
  setIcon({ color: ev.target.value.toLowerCase() });
  const lab = ev.target.parentElement;
  $$('.sw', $('#icpSwatches')).forEach(x => x.classList.toggle('on', x === lab));
  lab.style.setProperty('--c', ev.target.value);
});
$('#icpReset').addEventListener('click', () => {
  ED.icon = {};
  $('#icpText').value = '';
  P.mode = 'letter';
  updateAvatar();
  syncIcp();
});
$('#icpDone').addEventListener('click', closeIcp);

async function uploadIcon(body) {
  let r;
  try { r = await fetch('/api/icon', { method: 'POST', headers: { 'X-Token': TOKEN }, body }); }
  catch (err) { showGone(); throw err; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
  return j.name;
}
async function useIconFile(file) {
  if (!ED) return;
  try {
    const name = await uploadIcon(file);
    setIcon({ image: name, text: '' });
    P.mode = 'image';
    if (!icp.hidden) syncIcp();
  } catch (err) { toastErr('图标添加失败：' + err.message); }
}
$('#icpFile').addEventListener('click', () => $('#iconIn').click());
$('#iconIn').addEventListener('change', ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) useIconFile(f); });
addEventListener('paste', ev => {
  if (icp.hidden) return;
  const f = [...(ev.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
  if (f) { ev.preventDefault(); useIconFile(f); }
});

$('#icpSearch').addEventListener('click', async () => {
  const url = ED.fields.find(f => isUrl(f.label) && f.value.trim())?.value.trim() || '';
  const name = ED.title.trim();
  if (!url && !name) { toastErr('先填写名称或网址，再联网查找'); return; }
  const box = $('#icpResults'), btn = $('#icpSearch'), my = ++P.searching;
  btn.disabled = true;
  box.innerHTML = Array.from({ length: 6 }, () => '<span class="res skel"></span>').join('');
  try {
    const { icons } = await api('icon-search', { url, name });
    if (my !== P.searching) return;
    box.innerHTML = icons.length
      ? icons.map((x, i) => `<button class="res" data-i="${i}" title="${esc(x.label)}" style="--i:${i}"><img src="${esc(x.data)}" alt=""></button>`).join('')
      : `<p class="icp-empty">没有找到图标。可以检查网址，或者用本地图片。</p>`;
    box._icons = icons;
  } catch (err) {
    if (my === P.searching) box.innerHTML = `<p class="icp-empty">查找失败：${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
});
$('#icpResults').addEventListener('click', ev => {
  const b = ev.target.closest('.res[data-i]');
  const x = b && $('#icpResults')._icons?.[+b.dataset.i];
  if (!x) return;
  const bin = atob(x.data.slice(x.data.indexOf(',') + 1));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  $$('.res', $('#icpResults')).forEach(r => r.classList.toggle('on', r === b));
  useIconFile(new Blob([bytes]));
});

document.addEventListener('pointerdown', ev => {
  if (!icp.hidden && !icp.contains(ev.target) && !ev.target.closest('#dAvatar')) closeIcp();
}, true);

function renderFields() {
  const box = $('#dFields');
  box.innerHTML = '';
  ED.fields.forEach((f, i) => box.appendChild(fieldEl(f, i)));
  renderChips();
}
function renderChips() {
  $('#dChips').innerHTML = quickFields().map(l => `<button class="chip-btn" data-label="${esc(l)}" title="右键可以从常用字段里去掉">${icon('plus')}${esc(l)}</button>`).join('') +
    `<button class="chip-btn" data-label="">${icon('plus')}自定义</button>` +
    `<button class="chip-btn chip-edit" data-edit title="增删、排序这些按钮，以及新记录默认带哪些字段">${icon('edit')}修改</button>`;
}

function fieldEl(f, i) {
  const d = document.createElement('div');
  d.className = 'field';
  d.style.setProperty('--i', i);
  d._f = f;
  d.innerHTML = `
    <div class="field-top">
      <input class="f-label" maxlength="20" placeholder="字段名，例如：支付密码" spellcheck="false">
      <button class="icon-btn f-del" title="删除这个字段" tabindex="-1">${icon('x')}</button>
    </div>
    <div class="f-box"><input class="f-value" autocomplete="off" spellcheck="false" placeholder="未填写"><span class="f-tools"></span></div>
    <div class="meter"><div class="meter-track"><i></i></div><span class="meter-text"></span></div>`;
  const lab = $('.f-label', d), val = $('.f-value', d);
  lab.value = f.label;
  val.value = f.value;
  lab.addEventListener('input', () => {
    const clean = lab.value.replace(/[：:【】]/g, '');
    if (clean !== lab.value) lab.value = clean;
    f.label = clean;
    updateField(d);
  });
  val.addEventListener('input', () => { f.value = val.value; updateMeter(d); if (isUrl(f.label)) scheduleAutoIcon(); });
  $('.f-del', d).addEventListener('click', () => removeField(d));
  $('.f-tools', d).addEventListener('click', ev => {
    const t = ev.target.closest('[data-t]')?.dataset.t;
    if (t === 'eye') { d._shown = !d._shown; val.type = d._shown ? 'text' : 'password'; ev.target.closest('button').innerHTML = icon(d._shown ? 'eyeOff' : 'eye'); }
    if (t === 'gen') openGen(ev.target.closest('button'), d);
  });
  updateField(d);
  return d;
}

function updateField(d) {
  const f = d._f, secret = isSecret(f.label), pw = isPw(f.label);
  const kind = [secret, pw].join();
  if (d._kind === kind) return;
  d._kind = kind;
  d.classList.toggle('is-secret', secret);
  d.classList.toggle('is-pw', pw);
  const val = $('.f-value', d);
  if (!secret) { d._shown = false; val.type = 'text'; } else if (!d._shown) val.type = 'password';
  $('.f-tools', d).innerHTML =
    (secret ? `<button class="icon-btn" data-t="eye" title="显示 / 隐藏">${icon(d._shown ? 'eyeOff' : 'eye')}</button>` : '') +
    (pw ? `<button class="icon-btn" data-t="gen" title="生成随机密码">${icon('dice')}</button>` : '');
  updateMeter(d);
}

function strength(p) {
  if (!p) return 0;
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/\d/.test(p)) pool += 10;
  if (/[^\w\s]/.test(p)) pool += 24;
  if (/[^\x00-\x7f]/.test(p)) pool += 100;
  if (/^(.)\1*$/.test(p) || /^(0?123456789?|abcdefg?|qwerty|password|111111)/i.test(p)) return 1;
  const bits = [...p].length * Math.log2(pool || 2);
  return bits < 30 ? 1 : bits < 48 ? 2 : bits < 70 ? 3 : 4;
}
function updateMeter(d) {
  if (!d.classList.contains('is-pw')) return;
  const s = strength(d._f.value);
  const m = $('.meter', d);
  m.dataset.s = s;
  $('.meter-text', m).textContent = d._f.value ? ['', '弱', '一般', '强', '很强'][s] : '';
}

function addField(label) {
  const f = { label, value: '' };
  ED.fields.push(f);
  const d = fieldEl(f, 0);
  d.style.animation = 'none';
  $('#dFields').appendChild(d);
  anim(d, [{ opacity: 0, transform: 'translateY(-10px) scale(.96)', maxHeight: '0px' }, { opacity: 1, transform: 'none', maxHeight: '160px' }], { duration: 450, easing: EASE_OUT });
  d.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
  setTimeout(() => $(label ? '.f-value' : '.f-label', d).focus(), 60);
}
$('#dChips').addEventListener('click', ev => {
  const b = ev.target.closest('.chip-btn');
  if (b?.hasAttribute('data-edit')) openFieldPrefs();
  else if (b) addField(b.dataset.label);
});
$('#dChips').addEventListener('contextmenu', ev => {
  const b = ev.target.closest('.chip-btn[data-label]'), l = b?.dataset.label;
  if (!l) return;
  ev.preventDefault();
  menu(b, [
    { icon: 'x', label: `从常用字段里去掉「${l}」`, run: () => saveFieldPrefs({ quickFields: quickFields().filter(x => x !== l) }, `已去掉「${l}」`) },
    { icon: 'edit', label: '修改常用字段…', run: openFieldPrefs },
  ]);
});

/* ---- 常用字段：「添加字段」里的按钮、新增记录默认带的字段，都可以自己改 ---- */
async function saveFieldPrefs(body, msg) {
  try { S.settings = (await api('settings', body)).settings; } catch (err) { toastErr('保存设置失败：' + err.message); return false; }
  if (ED) renderChips();
  if (msg) toast(msg, { icon: 'check' });
  return true;
}
function openFieldPrefs() {
  const lists = { quickFields: [...quickFields()], newFields: [...newFields()] };
  const { wrap, close } = modal(`
    <div class="up-hero"><div class="up-cloud">${icon('edit')}</div><div><h2>常用字段</h2><p>只保存在这台电脑上</p></div></div>
    <div class="section-title">编辑时「添加字段」里的按钮</div>
    <div class="fp" data-k="quickFields"></div>
    <div class="section-title">新增记录时默认带的字段</div>
    <div class="fp" data-k="newFields"></div>
    <p class="fp-hint">拖动调整顺序，双击改名，点 × 去掉，在虚线框里输入新字段按回车添加。字段名不能有冒号，最多 20 个字；上传时所有字段的内容一律清空，只上传字段名。</p>
    <div class="modal-foot"><button class="btn ghost sm" id="fpReset">${icon('refresh')}恢复默认</button><span class="grow"></span><button class="btn ghost" data-close>取消</button><button class="btn primary" id="fpSave">${icon('check')}保存</button></div>`, 'wide');
  const ed = chipLists(wrap, lists, {
    clean: v => v.replace(/[：:【】\r\n]/g, '').trim().slice(0, 20),
    check: v => v === '图标' ? '「图标」这一栏由程序维护，换个名字吧' : '',
    placeholder: '＋ 新字段，回车添加',
  });
  $('#fpReset', wrap).addEventListener('click', () => { lists.quickFields = [...QUICK]; lists.newFields = [...DEFAULT_FIELDS]; Object.keys(lists).forEach(k => ed.render(k)); });
  $('[data-close]', wrap).addEventListener('click', close);
  $('#fpSave', wrap).addEventListener('click', async () => {
    if (!ed.flush()) return;  // 输入框里还没回车的也加上
    if (await saveFieldPrefs({ ...lists }, '常用字段已保存')) close();
  });
}

/* 几组可以拖动排序、双击改名、点 × 去掉、在虚线框里回车添加的小标签（常用字段、连线常用词共用）。
   lists 是 {组名: [文字…]}，直接在上面改；onRename(组名, 旧, 新) 在改名后调用 */
function chipLists(wrap, lists, { clean, check = () => '', placeholder, max = 20, onRename } = {}) {
  const render = (k, focus) => {
    const box = $(`.fp[data-k="${k}"]`, wrap);
    box.innerHTML = lists[k].map((l, i) => `<span class="fp-chip" draggable="true" data-i="${i}" title="双击改名">${esc(l)}<button class="fp-x" data-x="${i}" title="去掉">${icon('x')}</button></span>`).join('') +
      `<input class="fp-in" maxlength="${max}" placeholder="${esc(placeholder)}" spellcheck="false">`;
    if (focus) $('.fp-in', box).focus();
  };
  const problem = (k, v, skip = -1) => check(v) || (lists[k].some((x, i) => x === v && i !== skip) ? `「${v}」已经有了` : '');
  const add = (k, inp) => {
    const v = clean(inp.value);
    if (!v) return true;
    const err = problem(k, v);
    if (err) { toastErr(err); shake(inp); return false; }
    lists[k].push(v);
    render(k, true);
    return true;
  };
  Object.keys(lists).forEach(k => render(k));
  // 双击改名：小标签变成输入框，回车或点别处就改好
  wrap.addEventListener('dblclick', ev => {
    const c = ev.target.closest('.fp-chip');
    if (!c || ev.target.closest('.fp-x')) return;
    const k = c.closest('.fp').dataset.k, i = +c.dataset.i, old = lists[k][i];
    const inp = document.createElement('input');
    Object.assign(inp, { className: 'fp-in fp-ren', value: old, maxLength: max, spellcheck: false });
    c.replaceWith(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const v = clean(inp.value), err = v && v !== old && problem(k, v, i);
      if (err) toastErr(err);
      else if (v && v !== old) { lists[k][i] = v; onRename?.(k, old, v); }
      render(k);
    };
    inp.addEventListener('keydown', e => { if (!e.isComposing && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(); } });
    inp.addEventListener('blur', finish);
  });
  wrap.addEventListener('keydown', ev => {
    const inp = ev.target.closest('.fp-in:not(.fp-ren)');
    if (!inp || ev.isComposing) return;
    const k = inp.closest('.fp').dataset.k;
    if (ev.key === 'Enter') { ev.preventDefault(); add(k, inp); }
    if (ev.key === 'Backspace' && !inp.value && lists[k].length) { lists[k].pop(); render(k, true); }
  });
  wrap.addEventListener('click', ev => {
    const x = ev.target.closest('[data-x]');
    if (!x) return;
    const k = x.closest('.fp').dataset.k;
    lists[k].splice(+x.dataset.x, 1);
    render(k);
  });
  // 拖动排序（只在同一组里）
  let dragFrom = null;
  wrap.addEventListener('dragstart', ev => {
    const c = ev.target.closest?.('.fp-chip');
    if (!c) return;
    dragFrom = { k: c.closest('.fp').dataset.k, i: +c.dataset.i };
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', '');
    c.classList.add('dragging');
  });
  wrap.addEventListener('dragover', ev => {
    const c = ev.target.closest('.fp-chip');
    if (!dragFrom || !c || c.closest('.fp').dataset.k !== dragFrom.k) return;
    ev.preventDefault();
    $$('.fp-chip.over', wrap).forEach(x => x !== c && x.classList.remove('over'));
    c.classList.add('over');
  });
  wrap.addEventListener('drop', ev => {
    const c = ev.target.closest('.fp-chip');
    if (!dragFrom || !c || c.closest('.fp').dataset.k !== dragFrom.k) return;
    ev.preventDefault();
    const list = lists[dragFrom.k], [item] = list.splice(dragFrom.i, 1);
    list.splice(+c.dataset.i, 0, item);
    render(dragFrom.k);
  });
  wrap.addEventListener('dragend', () => { dragFrom = null; $$('.fp-chip', wrap).forEach(x => x.classList.remove('dragging', 'over')); });
  return {
    render,
    flush: () => $$('.fp-in:not(.fp-ren)', wrap).every(inp => add(inp.closest('.fp').dataset.k, inp)),
  };
}

function removeField(d) {
  const i = ED.fields.indexOf(d._f);
  if (i >= 0) ED.fields.splice(i, 1);
  const a = anim(d, [
    { opacity: 1, maxHeight: d.offsetHeight + 'px' },
    { opacity: 0, transform: 'translateX(40px)', maxHeight: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-10px' },
  ], { duration: 340, easing: EASE });
  if (a) a.onfinish = () => d.remove(); else d.remove();
}

async function saveEditor() {
  if (!ED) return;
  const title = ED.title.trim();
  if (!title) { shake($('#dTitle')); $('#dTitle').focus(); toastErr('请填写网站或应用名称'); return; }
  const fields = ED.fields.map(f => ({ label: f.label.trim(), value: f.value })).filter(f => f.label || f.value.trim());
  const noLabel = ED.fields.findIndex(f => !f.label.trim() && f.value.trim());
  if (noLabel >= 0) {
    const d = $$('.field', $('#dFields')).find(x => x._f === ED.fields[noLabel]);
    if (d) { shake(d); $('.f-label', d).focus(); }
    toastErr('这个字段还没有名字，没有名字的内容会原样上传');
    return;
  }
  const btn = $('#dSave');
  btn.disabled = true;
  try {
    const cat = ED.cat;
    if (!S.cats.includes(cat)) {
      await api('category', { action: 'create', name: cat });
      S.cats.push(cat);
      S.cats.sort((a, b) => a.localeCompare(b, 'zh'));
    }
    let id = ED.id;
    if (id) {
      const e = S.entries.find(x => x.id === id);
      const oldCat = e.cat;
      Object.assign(e, { title, icon: { ...ED.icon }, fields, cat });
      [...S.revealed].filter(k => k.startsWith(id + ':')).forEach(k => S.revealed.delete(k));
      await saveCat(cat);
      if (oldCat !== cat) await saveCat(oldCat);
    } else {
      const e = { id: uid(), cat, title, icon: { ...ED.icon }, fields };
      id = e.id;
      S.entries.push(e);
      await saveCat(cat);
      if (!ED.iconTouched && !e.icon.image && !e.icon.text) setTimeout(() => autoIconFor([e]), 300);  // 还没找到图标就在后台接着找
    }
    const wasNew = !ED.id;
    closeDrawer();
    renderNav();
    if (S.view.startsWith('cat:') && S.view !== 'cat:' + cat) setView('cat:' + cat);
    else renderGrid();
    setTimeout(() => flash(id), 120);
    toast(wasNew ? `已添加「${title}」` : `已保存「${title}」`);
  } catch (err) {
    toastErr('保存失败：' + err.message);
  } finally {
    btn.disabled = false;
  }
}

$('#dSave').addEventListener('click', saveEditor);
$('#dCancel').addEventListener('click', requestClose);
$('#dClose').addEventListener('click', requestClose);
scrim.addEventListener('click', requestClose);
$('#dDelete').addEventListener('click', async () => {
  const e = S.entries.find(x => x.id === ED?.id);
  if (e) { closeDrawer(); deleteEntry(e); }
});

/* ================= 密码生成器 ================= */
const GEN = { len: 16, upper: true, lower: true, digit: true, sym: true, target: null };
const gen = $('#gen');
function rnd(n) {
  const lim = Math.floor(0x100000000 / n) * n, a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return a[0] % n;
}
function genPassword() {
  const pools = [];
  if (GEN.upper) pools.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
  if (GEN.lower) pools.push('abcdefghijkmnopqrstuvwxyz');
  if (GEN.digit) pools.push('23456789');
  if (GEN.sym) pools.push('!@#$%^&*-_=+?');
  if (!pools.length) pools.push('abcdefghijkmnopqrstuvwxyz');
  const all = pools.join(''), out = pools.map(p => p[rnd(p.length)]);
  while (out.length < GEN.len) out.push(all[rnd(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.slice(0, GEN.len).join('');
}
function regen() {
  const out = $('#genOut');
  GEN.value = genPassword();
  scramble(out, GEN.value);
}
function openGen(btn, d) {
  closeIcp();
  GEN.target = d;
  gen.hidden = false;
  gen.style.animation = 'none'; void gen.offsetWidth; gen.style.animation = '';
  const r = btn.getBoundingClientRect(), w = gen.offsetWidth, h = gen.offsetHeight;
  let top = r.bottom + 8;
  if (top + h > innerHeight - 12) { top = r.top - h - 8; gen.style.transformOrigin = 'bottom right'; } else gen.style.transformOrigin = 'top right';
  gen.style.left = clamp(r.right - w, 12, innerWidth - w - 12) + 'px';
  gen.style.top = Math.max(12, top) + 'px';
  syncGenUI();
  regen();
}
function closeGen() { gen.hidden = true; GEN.target = null; }
function syncGenUI() {
  const len = $('#genLen');
  len.value = GEN.len;
  $('#genLenV').textContent = GEN.len;
  len.style.setProperty('--p', ((GEN.len - 8) / 32) * 100 + '%');
  $$('.gen-opts input').forEach(c => (c.checked = GEN[c.dataset.k]));
}
$('#genLen').addEventListener('input', ev => { GEN.len = +ev.target.value; syncGenUI(); regen(); });
$$('.gen-opts input').forEach(c => c.addEventListener('change', () => {
  GEN[c.dataset.k] = c.checked;
  if (!['upper', 'lower', 'digit', 'sym'].some(k => GEN[k])) { GEN[c.dataset.k] = c.checked = true; shake(c.nextElementSibling); return; }
  regen();
}));
$('#genRe').addEventListener('click', ev => {
  const b = ev.currentTarget;
  b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin');
  setTimeout(() => b.classList.remove('spin'), 500);
  regen();
});
$('#genUse').addEventListener('click', () => {
  const d = GEN.target;
  if (!d) return;
  const val = $('.f-value', d), v = GEN.value;
  d._shown = true;
  val.type = 'text';
  const eye = $('[data-t="eye"]', d);
  if (eye) eye.innerHTML = icon('eyeOff');
  d._f.value = v;
  scramble(val, v, s => (val.value = s));
  setTimeout(() => updateMeter(d), 10);
  closeGen();
  toast('已填入随机密码，记得保存');
});
document.addEventListener('pointerdown', ev => {
  if (!gen.hidden && !gen.contains(ev.target) && !ev.target.closest('[data-t="gen"]')) closeGen();
}, true);

/* ================= 分类管理 ================= */
function validCatName(v, except) {
  if (!v) return '名称不能为空';
  if (/[\\/:*?"<>|]/.test(v)) return '不能包含 \\ / : * ? " < > |';
  if (v.startsWith('.')) return '不能以点开头';
  if (v !== except && S.cats.includes(v)) return '已经有这个分类了';
  return '';
}
function promptCatName(title, value = '') {
  return dialog({
    title, icon: 'folder', ok: value ? '重命名' : '创建',
    text: '分类对应「私密原件」文件夹里的一个 txt 文件。',
    input: { value, placeholder: '例如：游戏、购物、社交', validate: v => validCatName(v, value) },
  });
}

$('#addCat').addEventListener('click', async () => {
  const name = await promptCatName('新建分类');
  if (!name) return;
  try {
    await api('category', { action: 'create', name });
    S.cats.push(name);
    S.cats.sort((a, b) => a.localeCompare(b, 'zh'));
    renderNav();
    setView('cat:' + name);
    toast(`已创建分类「${name}」`, { icon: 'folder' });
  } catch (err) { toastErr(err.message); }
});

function catMenu(anchor, name) {
  menu(anchor, [
    { icon: 'edit', label: '重命名', run: () => renameCat(name) },
    { icon: 'trash', label: '删除分类', danger: true, run: () => deleteCat(name) },
  ]);
}

async function renameCat(name) {
  const nn = await promptCatName('重命名分类', name);
  if (!nn || nn === name) return;
  try {
    await api('category', { action: 'rename', name, newName: nn });
    S.cats = S.cats.map(c => (c === name ? nn : c)).sort((a, b) => a.localeCompare(b, 'zh'));
    S.entries.forEach(e => { if (e.cat === name) e.cat = nn; });
    graphTouch();
    if (S.view === 'cat:' + name) S.view = 'cat:' + nn;
    renderNav();
    renderMain(false);
    refreshStatus();
    toast(`已重命名为「${nn}」`, { icon: 'folder' });
  } catch (err) { toastErr(err.message); }
}

/* 删分类只删侧栏这一栏，里面的记录移到另一个分类（默认「未分类」），不会删记录 */
function pickMoveTarget(name, n) {
  const others = S.cats.filter(c => c !== name);
  const fallback = name === '未分类' ? '默认' : '未分类';
  const opts = [...new Set([fallback, ...others])];
  return new Promise(resolve => {
    let result = null;
    const { wrap, close } = modal(`
      <div class="modal-ic">${icon('folder')}</div>
      <h2>删除分类「${esc(name)}」？</h2>
      <p>只删掉左侧这一栏，里面的 ${n} 条记录不会删除，会移到：</p>
      <div class="cat-pick move-pick">${icon('folder')}<select>${opts.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="modal-foot"><button class="btn ghost" data-r="0">取消</button><button class="btn primary" data-r="1">删除分类，保留记录</button></div>`);
    wrap.addEventListener('click', ev => {
      const r = ev.target.closest('[data-r]');
      if (!r) return;
      if (r.dataset.r === '1') result = $('select', wrap).value;
      close();
    });
    new MutationObserver((_, obs) => { if (!wrap.isConnected) { obs.disconnect(); resolve(result); } }).observe(document.body, { childList: true });
    setTimeout(() => $('[data-r="1"]', wrap).focus(), 60);
  });
}

async function deleteCat(name) {
  const n = S.entries.filter(e => e.cat === name).length;
  let moveTo = '';
  if (n) {
    moveTo = await pickMoveTarget(name, n);
    if (!moveTo) return;
  } else if (!await dialog({ title: `删除分类「${name}」？`, text: '这个分类是空的。', icon: 'folder', ok: '删除' })) return;
  try {
    await api('category', { action: 'delete', name, moveTo });
    S.cats = S.cats.filter(c => c !== name);
    if (moveTo && !S.cats.includes(moveTo)) S.cats = [...S.cats, moveTo].sort((a, b) => a.localeCompare(b, 'zh'));
    // 后台把记录接在目标分类末尾，这里也挪到末尾，关系图里重名记录的编号才对得上
    const moved = S.entries.filter(e => e.cat === name);
    moved.forEach(e => { e.cat = moveTo; });
    S.entries = [...S.entries.filter(e => !moved.includes(e)), ...moved];
    graphTouch();
    if (S.view === 'cat:' + name) { S.view = ''; renderNav(); setView(moveTo ? 'cat:' + moveTo : 'all'); } else { renderNav(); renderMain(false); }
    refreshStatus();
    toast(moveTo ? `已删除分类「${name}」，${n} 条记录移到了「${moveTo}」` : `已删除分类「${name}」`, { icon: 'folder', duration: 4000 });
  } catch (err) { toastErr(err.message); }
}

/* ---- 删掉的分类：撤销 / 最近删除 ---- */
async function restoreDeleted(file) {
  try {
    const { name } = await api('category', { action: 'restore', file });
    await load();
    S.view = '';
    renderNav();
    setView('cat:' + name);
    refreshStatus();
    toast(`已恢复分类「${name}」`, { icon: 'check' });
    return true;
  } catch (err) { toastErr('恢复失败：' + err.message); return false; }
}

const fmtStamp = s => (/^\d{8}-\d{6}/.test(s) ? `${+s.slice(4, 6)}/${+s.slice(6, 8)} ${s.slice(9, 11)}:${s.slice(11, 13)}` : '');

function openDeleted() {
  const list = S.deleted || [];
  const { wrap, close } = modal(`
    <div class="up-hero"><div class="up-cloud">${icon('trash')}</div>
      <div><h2>最近删除</h2><p>删掉的分类都在「私密原件\\.备份」里，随时可以恢复</p></div></div>
    <div class="upd-list">${list.length ? list.map((d, i) => `
      <div class="upd-item bak" style="--i:${i}"><span class="pill 删除">${icon('folder', 'tiny')}</span>
        <span><b>${esc(d.name)}</b> · ${d.count} 条记录${d.stamp ? ` · ${esc(fmtStamp(d.stamp))} 删除` : ''}</span>
        <button class="btn ghost sm" data-file="${esc(d.file)}">恢复</button></div>`).join('')
      : `<div class="up-empty">${icon('check')}<span>没有删除过的分类。</span></div>`}</div>
    <div class="modal-foot"><button class="btn ghost" data-close>关闭</button></div>`, 'wide');
  $('[data-close]', wrap).addEventListener('click', close);
  wrap.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-file]');
    if (!b || b.disabled) return;
    b.disabled = true;
    if (await restoreDeleted(b.dataset.file)) close(); else b.disabled = false;
  });
}

/* ================= 拖进 txt 导入 ================= */
let dragDepth = 0;
const hasFiles = ev => [...(ev.dataTransfer?.types || [])].includes('Files');
addEventListener('dragenter', ev => { if (!hasFiles(ev)) return; ev.preventDefault(); dragDepth++; if (icp.hidden) $('#drop').classList.add('on'); });
addEventListener('dragover', ev => { if (hasFiles(ev)) ev.preventDefault(); });
addEventListener('dragleave', ev => { if (!hasFiles(ev)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('on'); } });
addEventListener('drop', ev => {
  if (!hasFiles(ev)) return;
  ev.preventDefault();
  dragDepth = 0;
  $('#drop').classList.remove('on');
  if (!icp.hidden) { const f = ev.dataTransfer.files[0]; if (f) useIconFile(f); return; }
  const txt = [...ev.dataTransfer.files].find(f => /\.txt$/i.test(f.name));
  if (txt) openImport(txt); else toastErr('只能拖入 txt 文件导入记录');
});

/* ================= 上传到 GitHub ================= */
async function refreshStatus() {
  let st;
  try { st = S.status = await api('status'); } catch { return; }
  const n = st.changes.length + (st.other ? 1 : 0);
  const badge = $('#upBadge'), prev = badge.hidden ? '0' : badge.textContent;
  badge.hidden = !n;
  badge.textContent = n;
  $('#uploadBtn').classList.toggle('has-changes', n > 0 || st.ahead > 0);
  $('#upSub').textContent = st.repo === false ? '安装版：只存在本机' : !st.remote ? '还没有绑定仓库' : n ? `${n} 处变化待上传` : st.ahead ? `${st.ahead} 次提交待推送` : '已是最新';
  if (n && prev !== String(n)) anim(badge, [{ transform: 'scale(.2)' }, { transform: 'scale(1)' }], { duration: 550, easing: SPRING });
}

function previewHTML(text) {
  return text.replace(/\n$/, '').split('\n').map(line => {
    const m = line.match(/^(\s*)([^：:\r\n]{1,20}?)(\s*[：:])(.*)$/);
    if (m && m[2].trim() !== '图标') return `<div>${esc(m[1] + m[2] + m[3])}<span class="cleared">${icon('lock')}已清空</span></div>`;
    return `<div>${esc(line) || '&nbsp;'}</div>`;
  }).join('');
}

async function openUpload() {
  let st;
  try { st = await api('status'); } catch (err) { return toastErr(err.message); }
  const { wrap, close } = modal(`
    <div class="up-hero"><div class="up-cloud">${icon('cloud')}</div>
      <div><h2>上传到 GitHub</h2><p>${esc(st.repo === false ? '安装版：数据只保存在这台电脑上' : st.remote || '还没有绑定仓库')}</p></div></div>
    ${st.repo === false ? `<div class="up-note">${icon('alert')}<span>安装版不带 GitHub 同步，记录只保存在这台电脑上（请自己另外备份「私密原件」文件夹）。想把脱敏后的网站列表同步到自己的 GitHub 私有仓库，请看说明里的「用 git 同步」。</span></div>` : ''}
    <div class="up-note">${icon('lock')}<span>上传前会清空所有字段的内容，只上传网站名称、字段名和图标颜色；「私密原件」文件夹永远不会上传。</span></div>
    <div class="section-title">将要上传的内容</div>
    <div class="chg-list">${st.changes.length ? st.changes.map((c, i) => `
      <div class="chg" style="--i:${i}">
        <button class="chg-head">${icon('chev', 'chev')}<span class="chg-name">记录/${esc(c.file)}</span><span class="pill ${esc(c.status)}">${esc(c.status)}</span></button>
        <div class="chg-body"><div>${c.preview ? `<div class="pv">${previewHTML(c.preview)}</div>` : '<div class="pv">这个文件会从 GitHub 上删除</div>'}</div></div>
      </div>`).join('') : `<div class="up-empty">${icon('check')}<span>记录没有变化${st.other ? `，另有 ${st.other} 个程序文件有改动` : ''}${st.ahead ? `，${st.ahead} 次提交待推送` : ''}</span></div>`}
    </div>
    <div class="steps">
      <div class="step"><div class="step-dot">1</div>脱敏</div><div class="step-line"><i></i></div>
      <div class="step"><div class="step-dot">2</div>提交</div><div class="step-line"><i></i></div>
      <div class="step"><div class="step-dot">3</div>推送</div>
    </div>
    <pre class="up-log" hidden></pre>
    <div class="modal-foot"><button class="btn ghost sm" id="upRevert" title="把本机的记录、关系图、图标恢复成上次上传成功时的样子">${icon('undo')}撤回到上次上传</button><span class="grow"></span><button class="btn ghost" data-close>关闭</button><button class="btn primary" id="upGo"${st.remote ? '' : ' disabled'}>${icon('cloud')}开始上传</button></div>`, 'wide');

  wrap.addEventListener('click', ev => {
    const h = ev.target.closest('.chg-head');
    if (h) h.parentElement.classList.toggle('open');
  });
  const first = $('.chg', wrap);
  if (first && st.changes.length === 1) setTimeout(() => first.classList.add('open'), 350);

  const go = $('#upGo', wrap), closeBtn = $('[data-close]', wrap), log = $('.up-log', wrap), cloud = $('.up-cloud', wrap);
  closeBtn.addEventListener('click', close);
  $('#upRevert', wrap).addEventListener('click', () => { if (wrap.dataset.busy) return; close(); setTimeout(openRevert, 240); });
  go.addEventListener('click', async function run() {
    if (go.dataset.done) return close();
    go.disabled = closeBtn.disabled = true;
    wrap.dataset.busy = '1';
    log.hidden = true;
    log.classList.remove('err');
    cloud.classList.add('busy');
    const steps = $$('.step', wrap), lines = $$('.step-line i', wrap);
    steps.forEach((s, i) => { s.className = 'step'; $('.step-dot', s).textContent = i + 1; });
    lines.forEach(l => (l.style.transform = ''));
    const names = ['sanitize', 'commit', 'push'];
    const logs = [];
    for (let i = 0; i < names.length; i++) {
      steps[i].className = 'step run';
      const t0 = performance.now();
      let r;
      try { r = await api('upload', { step: names[i] }); } catch (err) { r = { ok: false, log: err.message }; }
      await sleep(Math.max(0, 450 - (performance.now() - t0)));
      if (r.log) logs.push(r.log);
      steps[i].className = 'step ' + (r.ok ? 'done' : 'fail');
      $('.step-dot', steps[i]).innerHTML = icon(r.ok ? 'check' : 'x');
      if (!r.ok) {
        cloud.classList.remove('busy');
        log.hidden = false;
        log.classList.add('err');
        log.textContent = r.log || '出错了';
        go.disabled = closeBtn.disabled = false;
        go.innerHTML = icon('refresh') + '重试';
        delete wrap.dataset.busy;
        return;
      }
      if (lines[i]) lines[i].style.transform = 'scaleX(1)';
      await sleep(220);
    }
    cloud.classList.remove('busy');
    cloud.classList.add('ok');
    cloud.innerHTML = icon('check');
    $('h2', wrap).textContent = '上传完成';
    log.hidden = false;
    log.textContent = logs.join('\n');
    go.innerHTML = icon('check') + '完成';
    go.dataset.done = '1';
    go.disabled = closeBtn.disabled = false;
    delete wrap.dataset.busy;
    confetti(go);
    refreshStatus();
  });
}
$('#uploadBtn').addEventListener('click', openUpload);

/* ================= 跟随 GitHub 更新 ================= */
async function checkUpdate(silent) {
  const btn = $('#updBtn'), sub = $('#updSub');
  if (btn.classList.contains('busy')) return null;
  btn.classList.add('busy');
  sub.textContent = '检查中…';
  let r;
  try { r = await api('update-check', {}); } catch (err) { r = { ok: false, log: err.message }; }
  btn.classList.remove('busy');
  if (!r.ok) {
    sub.textContent = silent ? '' : '检查失败';
    if (!silent) toastErr('检查更新失败：' + r.log);
    return null;
  }
  const had = btn.classList.contains('has-update');
  btn.classList.toggle('has-update', r.behind > 0);
  sub.textContent = r.behind ? `${r.behind} 项新内容` : '已是最新';
  if (r.behind && !had) anim($('.upd-ic', btn), [{ transform: 'scale(.3)' }, { transform: 'scale(1)' }], { duration: 550, easing: SPRING });
  if (silent && r.behind) toast(`GitHub 上有 ${r.behind} 项更新`, { icon: 'download', action: '查看', duration: 8000, onAction: openUpdate });
  return r;
}

async function openUpdate() {
  const st = await checkUpdate(false);
  if (!st) return;
  if (!st.behind) return toast('已经是最新版本', { icon: 'check', action: '更新前备份', duration: 4000, onAction: openBackups });
  const list = st.commits.map((c, i) => `<div class="upd-item" style="--i:${i}"><code>${esc(c.hash)}</code><span title="${esc(c.subject)}">${esc(c.subject)}</span><small>${esc(c.when)}</small></div>`).join('');
  const { wrap, close } = modal(`
    <div class="up-hero"><div class="up-cloud">${icon('download')}</div>
      <div><h2>有新版本</h2><p>${esc(st.branch)} · ${st.behind} 项新内容</p></div></div>
    <div class="up-note">${icon('lock')}<span>${st.release ? '点「去下载」会在浏览器打开新版本的下载页。下载新的安装程序，装到原来的位置就行，「私密原件」里的账号密码不会动。' : `更新只会替换程序文件和「记录」文件夹，「私密原件」里的账号密码不会动。更新前还会自动把整个「私密原件」打包备份一份，出问题可以一键恢复。${st.ahead ? `本机还有 ${st.ahead} 次提交没推送，会接在新内容后面。` : ''}`}</span></div>
    <div class="section-title">更新内容</div>
    <div class="upd-list">${list}${st.behind > st.commits.length ? `<div class="upd-more">……还有 ${st.behind - st.commits.length} 项</div>` : ''}</div>
    <pre class="up-log" hidden></pre>
    <div class="modal-foot"><button class="btn ghost sm" id="updBak">${icon('refresh')}更新前备份</button><span class="grow"></span><button class="btn ghost" data-close>稍后</button><button class="btn primary" id="updGo">${icon('download')}${st.release ? '去下载' : '立即更新'}</button></div>`, 'wide');
  const go = $('#updGo', wrap), closeBtn = $('[data-close]', wrap), log = $('.up-log', wrap), cloud = $('.up-cloud', wrap);
  closeBtn.addEventListener('click', close);
  $('#updBak', wrap).addEventListener('click', () => { if (wrap.dataset.busy) return; close(); setTimeout(openBackups, 240); });
  go.addEventListener('click', async () => {
    if (go.dataset.done) return close();
    go.disabled = closeBtn.disabled = true;
    wrap.dataset.busy = '1';
    cloud.classList.add('busy');
    log.hidden = true;
    let r;
    try { r = await api('update-apply', {}); } catch (err) { r = { ok: false, log: err.message }; }
    cloud.classList.remove('busy');
    delete wrap.dataset.busy;
    go.disabled = closeBtn.disabled = false;
    if (!r.ok) {
      log.hidden = false;
      log.classList.add('err');
      log.textContent = r.log || '出错了';
      go.innerHTML = icon('refresh') + '重试';
      return;
    }
    cloud.classList.add('ok');
    cloud.innerHTML = icon('check');
    log.hidden = false;
    log.classList.remove('err');
    log.textContent = r.log;
    if (!r.release) {  // 安装版只是打开了下载页，还没装上新版本
      $('#updBtn').classList.remove('has-update');
      $('#updSub').textContent = '已是最新';
    }
    if (r.code) {
      $('h2', wrap).textContent = '更新完成，正在重启…';
      wrap.dataset.busy = '1';
      go.disabled = closeBtn.disabled = true;
      return restartApp();
    }
    $('h2', wrap).textContent = r.release ? '已打开下载页' : '更新完成';
    go.innerHTML = icon('check') + '完成';
    go.dataset.done = '1';
    try { await load(); renderNav(); renderMain(false); } catch { /* 忽略 */ }
    refreshStatus();
  });
}
$('#updBtn').addEventListener('click', openUpdate);

/* ---- 更新前备份：列出 私密原件 的快照，一键恢复 ---- */
const fmtSize = n => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB');
const fmtTime = t => new Date(t * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function openBackups() {
  let snaps;
  try { snaps = (await api('snapshots')).snapshots; } catch (err) { return toastErr(err.message); }
  const { wrap, close } = modal(`
    <div class="up-hero"><div class="up-cloud">${icon('refresh')}</div>
      <div><h2>备份</h2><p>私密原件/.备份/ · 每种保留最近 10 份</p></div></div>
    <div class="up-note">${icon('lock')}<span>每次点「立即更新」前、一键连线前、每次上传成功后，都会把整个「私密原件」（记录、关系图和图标）打包备份。恢复时会先把现在的数据另存一份「恢复前」备份，恢复错了还能再恢复回来。</span></div>
    <div class="section-title">备份列表</div>
    <div class="upd-list">${snaps.length ? snaps.map((b, i) => `
      <div class="upd-item bak" style="--i:${i}"><span class="pill ${{ 更新前: '新增', 上传时: '上传', 连线前: '上传' }[b.tag] || '修改'}">${esc(b.tag)}</span>
        <span>${esc(fmtTime(b.mtime))} · ${b.files} 个文件 · ${fmtSize(b.size)}</span>
        <button class="btn ghost sm" data-name="${esc(b.name)}" data-time="${esc(fmtTime(b.mtime))}">恢复</button></div>`).join('')
      : `<div class="up-empty">${icon('check')}<span>还没有备份。下次点「立即更新」或上传成功时会自动创建。</span></div>`}</div>
    <div class="modal-foot"><button class="btn ghost" data-close>关闭</button></div>`, 'wide');
  $('[data-close]', wrap).addEventListener('click', close);
  wrap.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-name]');
    if (!b || wrap.dataset.busy) return;
    const ok = await dialog({
      title: `恢复到 ${b.dataset.time} 的状态？`, icon: 'alert', danger: true, ok: '恢复',
      text: '「私密原件」里现在的记录和图标会被替换成这份备份。替换前会先自动另存一份「恢复前」备份。',
    });
    if (!ok) return;
    wrap.dataset.busy = '1';
    b.disabled = true;
    try {
      const r = await api('snapshot-restore', { name: b.dataset.name });
      delete wrap.dataset.busy;
      close();
      await reloadAll();
      toast(`已恢复，恢复前的数据另存为 ${r.safety}`, { icon: 'check', duration: 5000 });
    } catch (err) {
      delete wrap.dataset.busy;
      b.disabled = false;
      toastErr('恢复失败：' + err.message);
    }
  });
}

async function reloadAll() {
  if (ED) closeDrawer();
  await load();
  renderNav();
  renderMain(false);
  refreshStatus();
}

/* ---- 撤回到上次上传：把 私密原件 恢复成上次上传成功时存下的样子 ---- */
async function openRevert() {
  let r;
  try { r = await api('revert-info'); } catch (err) { return toastErr(err.message); }
  if (!r.snap) return toast('还没有上传时的备份：从这个版本起，每次上传成功都会自动存一份，之后就能撤回', { icon: 'alert', duration: 6000 });
  const when = fmtTime(r.snap.mtime);
  if (!r.changes.length) return toast(`现在和上次上传时（${when}）一样，没有要撤回的`, { icon: 'check', duration: 4000 });
  const names = a => a.map(t => `「${esc(t)}」`).join('、');
  const rows = r.changes.map((c, i) => {
    let ic = 'edit', text;
    if (c.kind === 'cat') {
      const parts = [];
      if (c.status === '新增') { ic = 'trash'; parts.push('上传后新建的分类，会去掉' + (c.added.length ? `（里面有${names(c.added)}）` : '')); }
      else if (c.status === '删除') { ic = 'undo'; parts.push('上传后删掉的分类，会找回来' + (c.removed.length ? `（里面有${names(c.removed)}）` : '')); }
      else {
        if (c.changed.length) parts.push(`${names(c.changed)}改回上传时的内容`);
        if (c.added.length) parts.push(`去掉新加的${names(c.added)}`);
        if (c.removed.length) parts.push(`找回删掉的${names(c.removed)}`);
        if (!parts.length) parts.push('顺序、格式改回去');
      }
      text = `<b>${esc(c.name)}</b>　${parts.join('；')}`;
    } else if (c.kind === 'graph') { ic = 'graph'; text = '<b>关系图</b>　卡片位置和连线改回去'; }
    else if (c.kind === 'icons') { ic = 'image'; text = `<b>图标</b>　${c.count} 个图标文件改回去`; }
    else text = `<b>${esc(c.name)}</b>　改回去`;
    return `<div class="rv-item" style="--i:${Math.min(i, 12)}">${icon(ic)}<span>${text}</span></div>`;
  }).join('');
  const { wrap, close } = modal(`
    <div class="up-hero"><div class="up-cloud">${icon('undo')}</div>
      <div><h2>撤回到上次上传</h2><p>上次上传成功：${esc(when)}</p></div></div>
    <div class="up-note">${icon('lock')}<span>上传之后在本机做的这些修改会撤掉，记录、关系图和图标都回到上传时的样子。撤回前会先把现在的数据另存一份「恢复前」备份，撤回错了还能恢复回来。GitHub 上的内容不受影响。</span></div>
    <div class="section-title">会撤掉的修改</div>
    <div class="rv-list">${rows}</div>
    <div class="modal-foot"><button class="btn ghost sm" id="rvBak">${icon('refresh')}所有备份</button><span class="grow"></span><button class="btn ghost" data-close>取消</button><button class="btn danger" id="rvGo">${icon('undo')}撤回</button></div>`, 'wide');
  $('[data-close]', wrap).addEventListener('click', close);
  $('#rvBak', wrap).addEventListener('click', () => { if (wrap.dataset.busy) return; close(); setTimeout(openBackups, 240); });
  const go = $('#rvGo', wrap);
  go.addEventListener('click', async () => {
    go.disabled = true;
    wrap.dataset.busy = '1';
    try {
      const res = await api('snapshot-restore', { name: r.snap.name });
      delete wrap.dataset.busy;
      close();
      await reloadAll();
      toast(`已撤回到 ${when} 上传时的样子`, {
        icon: 'undo', action: '撤销', duration: 8000,
        onAction: async () => {
          try { await api('snapshot-restore', { name: res.safety }); await reloadAll(); toast('已恢复撤回前的数据', { icon: 'check' }); } catch (err) { toastErr('恢复失败：' + err.message); }
        },
      });
    } catch (err) {
      delete wrap.dataset.busy;
      go.disabled = false;
      toastErr('撤回失败：' + err.message);
    }
  });
}

/* ---- 还在 Edge 窗口里时：等后台装好 pywebview，自动换成新窗口 ---- */
async function watchWindow() {
  if (IN_APP_WINDOW) return;
  let told = false;
  for (;;) {
    let st;
    try { st = await api('window'); } catch { return; }
    if (st.state === 'ready') {
      toast('新窗口已经准备好，正在切换…', { icon: 'check', duration: 4000 });
      try { await api('window-open', {}); } catch (err) { return toastErr(err.message); }
      await sleep(3000);
      window.close();
      await sleep(500);  // 关不掉时（极少数情况）提示手动关
      toast('已经在新窗口打开了，这个旧窗口可以关掉', { icon: 'check', duration: 60000 });
      return;
    }
    if (st.state === 'installing' && !told) {
      told = true;
      toast('正在后台安装新窗口组件，装好后会自动切换，不用管它', { icon: 'download', duration: 6000 });
    }
    if (st.state === 'failed') return toastErr(st.error || '新窗口打不开，先用这个窗口');
    if (st.state !== 'installing') return;
    await sleep(3000);
  }
}

/* 程序文件换了，让后台用同一个端口和令牌重启，等新进程接上后刷新页面 */
async function restartApp() {
  S.restarting = true;
  const pid = (await api('ping', {}).catch(() => ({}))).pid;
  await api('restart', {}).catch(() => {});
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const r = await fetch('/api/ping', { method: 'POST', headers: { 'X-Token': TOKEN } });
      const j = await r.json();
      if (r.ok && j.pid && j.pid !== pid) return location.reload();
    } catch { /* 还在重启 */ }
  }
  S.restarting = false;
  showGone('重启没有成功。请关闭这个窗口，重新双击「打开程序.bat」。');
}

function confetti(from) {
  if (REDUCED) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  const dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  document.body.appendChild(c);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const r = from.getBoundingClientRect(), ox = r.left + r.width / 2, oy = r.top + r.height / 2;
  const colors = ['#8b7bff', '#3fd0e0', '#c04bd8', '#35d49a', '#ffb547', '#5d8bff'];
  const ps = Array.from({ length: 140 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2, v = 6 + Math.random() * 10;
    return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, c: colors[(Math.random() * colors.length) | 0] };
  });
  const t0 = performance.now(), life = 2000;
  (function frame(now) {
    const t = now - t0;
    g.clearRect(0, 0, innerWidth, innerHeight);
    ps.forEach(p => {
      p.vy += 0.3; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save();
      g.globalAlpha = Math.max(0, 1 - t / life);
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.scale(1, Math.cos(p.r * 2));
      g.fillStyle = p.c;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    });
    if (t < life) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

/* ================= 弹窗 / 菜单 / 提示 ================= */
function modal(html, cls = '') {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  let closed = false;
  const close = () => {
    if (closed || wrap.dataset.busy) return;
    closed = true;
    wrap.classList.add('out');
    setTimeout(() => wrap.remove(), 230);
    removeEventListener('keydown', key, true);
  };
  const key = ev => { if (ev.key === 'Escape' && wrap === $$('.modal-wrap').at(-1)) { ev.stopPropagation(); close(); } }; // 叠了多层时只关最上面一层
  addEventListener('keydown', key, true);
  wrap.addEventListener('click', ev => { if (ev.target === wrap) close(); });
  return { wrap, close };
}

function dialog({ title, text = '', input = null, ok = '确定', cancel = '取消', danger = false, icon: ic = null }) {
  return new Promise(resolve => {
    const { wrap, close } = modal(`
      ${ic ? `<div class="modal-ic${danger ? ' danger' : ''}">${icon(ic)}</div>` : ''}
      <h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
      ${input ? `<input class="modal-input" maxlength="40" placeholder="${esc(input.placeholder || '')}" spellcheck="false"><div class="modal-err"></div>` : ''}
      <div class="modal-foot"><button class="btn ghost" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`);
    const inp = $('.modal-input', wrap);
    if (inp) inp.value = input.value || '';
    let result = false;
    const finish = v => { result = v; close(); };
    const submit = () => {
      if (!inp) return finish(true);
      const v = inp.value.trim(), err = input.validate?.(v);
      if (err) { $('.modal-err', wrap).textContent = err; shake($('.modal', wrap)); inp.focus(); return; }
      finish(v);
    };
    wrap.addEventListener('click', ev => {
      const r = ev.target.closest('[data-r]');
      if (r) r.dataset.r === '1' ? submit() : finish(false);
    });
    wrap.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); submit(); } });
    new MutationObserver((_, obs) => { if (!wrap.isConnected) { obs.disconnect(); resolve(result); } }).observe(document.body, { childList: true });
    setTimeout(() => { (inp || $('[data-r="1"]', wrap)).focus(); inp?.select(); }, 60);
  });
}

function menu(anchor, items) {
  $$('.menu').forEach(m => m.remove());
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon)}${esc(it.label)}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = clamp(r.left, 8, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = clamp(r.bottom + 6, 8, innerHeight - m.offsetHeight - 8) + 'px';
  const close = () => { m.classList.add('out'); setTimeout(() => m.remove(), 150); removeEventListener('pointerdown', outside, true); };
  const outside = ev => { if (!m.contains(ev.target)) close(); };
  setTimeout(() => addEventListener('pointerdown', outside, true));
  m.addEventListener('click', ev => {
    const b = ev.target.closest('[data-i]');
    if (b) { close(); items[+b.dataset.i].run(); }
  });
}

function toast(msg, { icon: ic = 'check', type = '', action, onAction, duration = 2600 } = {}) {
  const box = $('#toasts');
  while (box.children.length >= 4) box.firstElementChild.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>${action ? `<button class="toast-act">${esc(action)}</button>` : ''}<i class="toast-bar" style="animation-duration:${duration}ms"></i>`;
  box.appendChild(t);
  let done = false;
  const close = () => { if (done) return; done = true; t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  const timer = setTimeout(close, duration);
  if (action) $('.toast-act', t).addEventListener('click', () => { clearTimeout(timer); close(); onAction?.(); });
}
const toastErr = msg => toast(msg, { icon: 'alert', type: 'err', duration: 4200 });

function shake(el) {
  anim(el, [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 420, easing: 'ease-out' });
}

function showGone(msg) {
  if ($('#gone')) return;
  const d = document.createElement('div');
  d.id = 'gone';
  d.className = 'modal-wrap';
  d.style.zIndex = 90;
  d.innerHTML = `<div class="modal"><div class="modal-ic danger">${icon('alert')}</div><h2>程序已经关闭</h2><p>${esc(msg || '后台服务已停止运行。请关闭这个窗口，重新双击「打开程序.bat」。')}</p></div>`;
  document.body.appendChild(d);
}

/* 按钮水波纹 */
document.addEventListener('pointerdown', ev => {
  const b = ev.target.closest('.btn, .icon-btn, .nav-item, .chip-btn, .upload-btn, .toast-act');
  if (!b || REDUCED) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2;
  const sp = document.createElement('span');
  sp.className = 'ripple';
  Object.assign(sp.style, { width: s + 'px', height: s + 'px', left: ev.clientX - r.left - s / 2 + 'px', top: ev.clientY - r.top - s / 2 + 'px' });
  b.appendChild(sp);
  setTimeout(() => sp.remove(), 700);
});

/* ================= 主题 ================= */
function syncThemeIcon() {
  $('#themeBtn').innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
  window.syncTitleBar?.();
  api('theme', { theme: document.documentElement.dataset.theme }).catch(() => {}); // 后台记住主题，并给窗口标题栏换色
}
$('#themeBtn').addEventListener('click', ev => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', ev));
function setTheme(next, ev) {
  if (next === document.documentElement.dataset.theme) return;
  const apply = () => {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* 忽略 */ }
    syncThemeIcon();
  };
  if (!document.startViewTransition || REDUCED) return apply();
  const x = ev.clientX, y = ev.clientY;
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(apply).ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'cubic-bezier(.65,0,.35,1)', pseudoElement: '::view-transition-new(root)' });
  });
}

/* ================= 设置：字体 / 主题 ================= */
const FONTS = [
  ['system', '系统默认', '微软雅黑，干净清楚'],
  ['thin', '思源黑体 · 细', '细字重的无衬线，利落'],
  ['news', '报刊衬线', 'Playfair + 思源宋体'],
  ['song', '思源宋体', '端正的宋体'],
  ['wenkai', '霞鹜文楷', '手写感的楷体'],
  ['xiaowei', '站酷小薇', 'Cormorant + 小薇，秀气'],
  ['brush', '毛笔', '标题用马善政毛笔字'],
  ['mono', '等宽', 'JetBrains Mono，字符好区分'],
];
function openSettings() {
  const root = document.documentElement, cur = root.dataset.font || 'system';
  const { wrap, close } = modal(`
    <div class="up-hero"><div class="up-cloud">${icon('gear')}</div><div><h2>设置</h2><p>只保存在这台电脑上</p></div></div>
    <div class="section-title">主题</div>
    <div class="seg" id="setTheme">
      <button data-t="light">${icon('sun')}浅色</button><button data-t="dark">${icon('moon')}深色</button>
    </div>
    <div class="section-title">字体</div>
    <div class="font-grid">${FONTS.map(([k, name, desc]) => `
      <button class="font-card${k === cur ? ' on' : ''}" data-font="${k}" data-pick="${k}">
        <span class="fc-check">${icon('check')}</span>
        <b class="fc-title">谷歌邮箱 Aa</b><span class="fc-val">example@gmail.com · 2026</span>
        <small>${esc(name)} · ${esc(desc)}</small></button>`).join('')}</div>
    <label class="switch-row"><input type="checkbox" id="setFontUI"${root.hasAttribute('data-font-ui') ? ' checked' : ''}>按钮、菜单、侧栏这些界面文字也用这个字体</label>
    <div class="section-title">图标</div>
    <div class="size-row">
      <div class="size-demo">${['谷', 'Q', '🐧'].map((t, i) => `<div class="avatar" style="--h:${[8, 330, 200][i]}"><span class="av-t">${t}</span></div>`).join('')}</div>
      <div class="size-ctl">
        <div class="size-top"><span>图标大小</span><b id="setIconV"></b><button class="btn ghost sm" id="setIconReset">恢复默认</button></div>
        <div class="size-bar"><button class="icon-btn" data-d="-10" title="缩小">${icon('minus')}</button>
          <input type="range" id="setIconSize" min="60" max="200" step="5">
          <button class="icon-btn" data-d="10" title="放大">${icon('plus')}</button></div>
        <small>卡片和关系图里的图标一起变；关系图左下角还能单独再调。卡片视图里快捷键 <kbd>[</kbd> 缩小、<kbd>]</kbd> 放大</small>
      </div>
    </div>
    <label class="switch-row"><input type="checkbox" id="setAutoIcon"${S.settings?.autoIcon !== false ? ' checked' : ''}>新建和导入的记录自动联网找图标（只发送网站名称和网址）</label>
    <button class="btn ghost sm" id="setFillIcons" style="margin-top:10px">${icon('search')}给已有的、还没有图标的记录找图标</button>
    <div class="section-title">字段</div>
    <button class="btn ghost sm" id="setFields">${icon('edit')}常用字段：「添加字段」里的按钮、新记录默认带的字段</button>
    <div class="section-title">上传</div>
    <button class="btn ghost sm" id="setRevert">${icon('undo')}撤回到上次上传</button>
    <div class="modal-foot"><button class="btn primary" data-close>${icon('check')}完成</button></div>`, 'wide');
  const syncSeg = () => $$('#setTheme button', wrap).forEach(b => b.classList.toggle('on', b.dataset.t === root.dataset.theme));
  syncSeg();
  $('[data-close]', wrap).addEventListener('click', close);
  $('#setTheme', wrap).addEventListener('click', ev => { const b = ev.target.closest('[data-t]'); if (b) { setTheme(b.dataset.t, ev); setTimeout(syncSeg, 50); } });
  $('.font-grid', wrap).addEventListener('click', ev => {
    const b = ev.target.closest('[data-pick]');
    if (!b) return;
    root.dataset.font = b.dataset.pick;
    $$('.font-card', wrap).forEach(x => x.classList.toggle('on', x === b));
    api('settings', { font: b.dataset.pick }).catch(err => toastErr('保存设置失败：' + err.message));
  });
  $('#setFontUI', wrap).addEventListener('change', ev => {
    root.toggleAttribute('data-font-ui', ev.target.checked);
    api('settings', { fontUI: ev.target.checked }).catch(err => toastErr('保存设置失败：' + err.message));
  });
  const size = $('#setIconSize', wrap);
  const syncSize = () => { size.value = iconSize(); $('#setIconV', wrap).textContent = iconSize() + '%'; };
  syncSize();
  size.addEventListener('input', () => { setIconSize(+size.value); syncSize(); });
  $('.size-bar', wrap).addEventListener('click', ev => { const b = ev.target.closest('[data-d]'); if (b) { setIconSize(iconSize() + +b.dataset.d); syncSize(); } });
  $('#setIconReset', wrap).addEventListener('click', () => { setIconSize(100); syncSize(); });
  $('#setAutoIcon', wrap).addEventListener('change', ev => {
    S.settings.autoIcon = ev.target.checked;
    api('settings', { autoIcon: ev.target.checked }).catch(err => toastErr('保存设置失败：' + err.message));
  });
  $('#setFields', wrap).addEventListener('click', () => { close(); setTimeout(openFieldPrefs, 240); });
  $('#setRevert', wrap).addEventListener('click', () => { close(); setTimeout(openRevert, 240); });
  $('#setFillIcons', wrap).addEventListener('click', () => {
    const todo = S.entries.filter(e => !e.icon?.image && !e.icon?.text);
    if (!todo.length) return toast('所有记录都已经有图标了', { icon: 'check' });
    close();
    autoIconFor(todo, true);
  });
}

/* ---- 图标大小：卡片和关系图里的图标一起放大缩小 ---- */
const iconSize = () => Math.round((parseFloat(document.documentElement.style.getPropertyValue('--av')) || 1) * 100);
let iconSizeTimer = 0;
function setIconSize(v, tip) {
  v = clamp(Math.round(v / 5) * 5, 60, 200);
  if (v === iconSize()) return;
  document.documentElement.style.setProperty('--av', v / 100);
  if (S.layout === 'graph' && G.ready) { measure(); drawLinks(); spreadSoon(); }  // 卡片大小变了，连线端点跟着变，挤在一起的推开
  if (tip) toast(`图标大小 ${v}%`, { icon: 'image', duration: 1200 });
  clearTimeout(iconSizeTimer);
  iconSizeTimer = setTimeout(() => api('settings', { iconSize: v }).then(r => { S.settings = r.settings; }).catch(err => toastErr('保存设置失败：' + err.message)), 400);
}

/* ================= 自动联网找图标 ================= */
const entryUrl = e => e.fields.find(f => isUrl(f.label) && f.value.trim())?.value.trim() || '';
const autoOn = () => S.settings?.autoIcon !== false;

/* 编辑新记录时：名称 / 网址停下来 1 秒后自动找图标，先显示在左上角 */
let autoTimer = 0, autoSeq = 0;
function scheduleAutoIcon() {
  clearTimeout(autoTimer);
  if (!ED || ED.id || ED.iconTouched || !autoOn()) return;
  autoTimer = setTimeout(async () => {
    const name = ED?.title.trim(), url = ED && entryUrl(ED);
    if (!ED || (!name && !url)) return;
    const my = ++autoSeq, ed = ED;
    $('#dAvatar').classList.add('finding');
    try {
      const { name: img } = await api('icon-auto', { url, name });
      if (my !== autoSeq || ED !== ed || ED.iconTouched) return;
      ED.icon = { ...ED.icon, image: img || undefined };
      if (!img) delete ED.icon.image;
      updateAvatar();
    } catch { /* 没网就算了 */ } finally { if (my === autoSeq) $('#dAvatar').classList.remove('finding'); }
  }, 1000);
}

/* 给一批记录找图标（导入后、保存新记录后、设置里手动补） */
let autoQueue = Promise.resolve();
function autoIconFor(entries, manual) {
  if (!manual && !autoOn()) return;
  autoQueue = autoQueue.then(async () => {
    const list = entries.filter(e => S.entries.includes(e) && !e.icon?.image && !e.icon?.text);
    if (!list.length) return;
    const cats = new Set();
    let found = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (list.length > 1) toast(`正在联网找图标 ${i + 1} / ${list.length}：${e.title}`, { icon: 'search', duration: 2500 });
      try {
        const { name } = await api('icon-auto', { url: entryUrl(e), name: e.title });
        if (name && S.entries.includes(e) && !e.icon?.image) {
          e.icon = { ...e.icon, image: name };
          cats.add(e.cat);
          found++;
          renderGrid();
        }
      } catch { /* 这一条找不到，接着下一条 */ }
    }
    for (const c of cats) await saveCat(c).catch(err => toastErr(err.message));
    if (list.length > 1 || manual) toast(`找到 ${found} 个图标${list.length - found ? `，${list.length - found} 条没找到` : ''}`, { icon: 'check' });
  });
}

/* ================= 导入 txt：自动识别 ================= */
async function parseText(body) {
  const r = await fetch('/api/parse-text', { method: 'POST', headers: { 'X-Token': TOKEN }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

function openImport(file) {
  let items = [];
  const cats = [...new Set([currentCat(), ...S.cats])];
  const { wrap, close } = modal(`
    <div class="up-hero"><div class="up-cloud">${icon('upload')}</div>
      <div><h2>导入 txt</h2><p>随手记的格式也行，程序会自动认出网站名、账号、密码、邮箱、手机号、网址</p></div></div>
    <textarea class="imp-text" placeholder="把 txt 里的内容粘贴到这里，比如：\n\nQQ 123456 mypassword\n微信----13800000000----password\n\n淘宝\n账号：tb_user\n密码：tb_pass" spellcheck="false"></textarea>
    <div class="imp-bar"><button class="btn ghost sm" id="impFile">${icon('folder')}选择 txt 文件</button><span class="imp-hint">也可以直接把 txt 拖进窗口</span></div>
    <div class="section-title imp-count">识别结果</div>
    <div class="imp-list"><div class="up-empty">${icon('search')}<span>还没有内容</span></div></div>
    <div class="imp-opts">
      <label class="cat-pick">${icon('folder')}<select id="impCat">${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="switch-row"><input type="checkbox" id="impIcon"${autoOn() ? ' checked' : ''}>导入后自动联网找图标</label>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>取消</button><button class="btn primary" id="impGo" disabled>${icon('check')}导入</button></div>`, 'wide');
  const ta = $('.imp-text', wrap), list = $('.imp-list', wrap), go = $('#impGo', wrap);
  const fin = document.createElement('input');
  Object.assign(fin, { type: 'file', accept: '.txt,text/plain' });
  $('#impFile', wrap).addEventListener('click', () => fin.click());
  $('[data-close]', wrap).addEventListener('click', close);

  const render = () => {
    const n = items.filter(x => x.on).length;
    $('.imp-count', wrap).textContent = items.length ? `识别出 ${items.length} 条，勾选要导入的` : '识别结果';
    go.disabled = !n;
    go.innerHTML = icon('check') + (n ? `导入 ${n} 条` : '导入');
    if (!items.length) { list.innerHTML = `<div class="up-empty">${icon('search')}<span>${ta.value.trim() ? '没认出记录。试试一行写一个网站，或者用「名称 账号 密码」的格式' : '还没有内容'}</span></div>`; return; }
    list.innerHTML = items.map((x, i) => `
      <div class="imp-item${x.on ? '' : ' off'}" data-i="${i}" style="--i:${Math.min(i, 12)}">
        <input type="checkbox" class="imp-on"${x.on ? ' checked' : ''}>
        <input class="imp-title" value="${esc(x.title)}" spellcheck="false">
        <div class="imp-fields">${x.fields.map(f => `<span class="imp-f"><i>${esc(f.label)}</i>${esc(f.value)}</span>`).join('')}</div>
      </div>`).join('');
  };
  let parseSeq = 0;
  const run = async (body, showText) => {
    const my = ++parseSeq;
    try {
      const got = await parseText(body);
      if (my !== parseSeq) return;
      if (showText) ta.value = got.text;  // 后台认好编码（UTF-8 / GBK）的文字，方便核对
      items = got.entries.map(x => ({ ...x, on: true }));
      render();
    } catch (err) { toastErr('识别失败：' + err.message); }
  };
  let t = 0;
  ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => run(new Blob([ta.value])), 350); });
  const useFile = f => run(f, true);  // 文件原样交给后台，自动识别 UTF-8 / GBK
  fin.addEventListener('change', () => { if (fin.files[0]) useFile(fin.files[0]); });
  list.addEventListener('input', ev => {
    const row = ev.target.closest('.imp-item');
    if (row && ev.target.classList.contains('imp-title')) items[+row.dataset.i].title = ev.target.value;
  });
  list.addEventListener('change', ev => {
    const row = ev.target.closest('.imp-item');
    if (row && ev.target.classList.contains('imp-on')) { items[+row.dataset.i].on = ev.target.checked; row.classList.toggle('off', !ev.target.checked); render(); }
  });
  go.addEventListener('click', async () => {
    const cat = $('#impCat', wrap).value, pick = items.filter(x => x.on && x.title.trim());
    if (!pick.length) return;
    go.disabled = true;
    try {
      if (!S.cats.includes(cat)) {
        await api('category', { action: 'create', name: cat });
        S.cats = [...S.cats, cat].sort((a, b) => a.localeCompare(b, 'zh'));
      }
      const added = pick.map(x => ({ id: uid(), cat, title: x.title.trim(), icon: {}, fields: x.fields }));
      S.entries.push(...added);
      await saveCat(cat);
      close();
      renderNav();
      if (S.view !== 'all' && S.view !== 'cat:' + cat) setView('cat:' + cat); else renderGrid();
      toast(`已导入 ${added.length} 条到「${cat}」`, { icon: 'check' });
      if ($('#impIcon', wrap).checked) autoIconFor(added, true);
    } catch (err) { go.disabled = false; toastErr('导入失败：' + err.message); }
  });
  if (file) useFile(file);
  setTimeout(() => ta.focus(), 60);
}
$('#importBtn').addEventListener('click', () => openImport());
$('#setBtn').addEventListener('click', openSettings);

/* ================= 搜索 / 快捷键 ================= */
searchIn.addEventListener('input', () => { S.q = searchIn.value; renderGrid(); });
searchIn.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.isComposing && S.layout === 'graph') fitTo(visibleIds(), true); });

/* ================= 卡片 / 关系图 切换 ================= */
function syncLayoutSeg() {
  document.body.classList.toggle('graph', S.layout === 'graph');
  $$('#layoutSeg button').forEach(b => b.classList.toggle('on', b.dataset.l === S.layout));
}
function setLayout(l) {
  if (S.layout === l) return;
  S.layout = l;
  syncLayoutSeg();
  closeLinkPop();
  api('settings', { layout: l }).then(r => { S.settings = r.settings; }).catch(() => {});
  $('#main').scrollTo({ top: 0 });
  $('#topbar').classList.remove('scrolled');
  if (l === 'graph') G.entered = false; // 切过来时按当前分类重新对准
  renderMain(true);
}
$('#layoutSeg').addEventListener('click', ev => { const b = ev.target.closest('[data-l]'); if (b) setLayout(b.dataset.l); });
$('#newBtn').addEventListener('click', () => openEditor(null));
$('#main').addEventListener('scroll', ev => $('#topbar').classList.toggle('scrolled', ev.target.scrollTop > 6), { passive: true });
addEventListener('resize', () => moveIndicator(true));

const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
document.addEventListener('keydown', ev => {
  if (ev.isComposing || $('.modal-wrap')) return;
  const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
  if (drawer.classList.contains('open')) {
    if (mod && k === 's') { ev.preventDefault(); saveEditor(); }
    if (ev.key === 'Escape') { ev.preventDefault(); if (!icp.hidden) closeIcp(); else if (!gen.hidden) closeGen(); else requestClose(); }
    return;
  }
  if (mod && k === 'k') {
    ev.preventDefault();
    searchIn.focus();
    searchIn.select();
    return;
  }
  if (ev.key === 'Escape' && document.activeElement === searchIn) {
    if (searchIn.value) { searchIn.value = ''; S.q = ''; renderGrid(); } else searchIn.blur();
    return;
  }
  if (typing() || mod || ev.altKey) return;
  if (k === '/') { ev.preventDefault(); searchIn.focus(); }
  if (k === 'n') { ev.preventDefault(); openEditor(null); }
  if (k === '[' || k === ']') {  // 关系图里调关系图自己的图标大小，卡片视图里调全局的
    ev.preventDefault();
    const d = k === ']' ? 10 : -10;
    if (S.layout === 'graph') setMapIconSize(mapIconSize() + d, true); else setIconSize(iconSize() + d, true);
    return;
  }
  if (k === 'g') { ev.preventDefault(); setLayout(S.layout === 'graph' ? 'grid' : 'graph'); return; }
  if (S.layout === 'graph' && !drawer.classList.contains('open') && mapKey(ev)) { ev.preventDefault(); return; }
  if (k === 'h') { ev.preventDefault(); revealAll(); }
});

/* ================= 启动 ================= */
async function boot() {
  $$('[data-ic]').forEach(el => { el.outerHTML = icon(el.dataset.ic); });
  syncThemeIcon();
  try { await load(); } catch (err) { if (!$('#gone')) showGone('无法读取数据：' + err.message); return; }
  syncLayoutSeg();
  renderNav();
  moveIndicator(true);
  await sleep(REDUCED ? 0 : 450);
  document.body.classList.remove('booting');
  document.body.classList.add('intro');
  $('#splash').classList.add('hide');
  setTimeout(() => $('#splash')?.remove(), 700);
  setTimeout(() => document.body.classList.remove('intro'), 1600);
  await sleep(REDUCED ? 0 : 150);
  renderMain(true);
  refreshStatus();
  setTimeout(() => checkUpdate(true), 2500);
  setTimeout(watchWindow, 1500);
  const ping = () => api('ping', {}).catch(() => {});
  ping();
  setInterval(ping, 15000);
  addEventListener('pagehide', () => navigator.sendBeacon('/api/bye?t=' + encodeURIComponent(TOKEN)));
}
addEventListener('DOMContentLoaded', boot); // 等 map.js 也加载完
