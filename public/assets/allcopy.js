/**
 * オールコピー — /api/allcopy の全項目を “詳細まで全部” 並べ、全部・グループ・1 件単位でコピーする
 */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('ja-JP');
const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

let data = null;
let query = '';

/* ---------------- 表示：自前の Markdown（この API が出す書式だけ）を HTML に ---------------- */
function inline(text) {
  let h = esc(text);
  h = h.replace(/\[([^\]]+?)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${t}</a>`);
  h = h.replace(/\\([\\`*_[\]|<>])/g, '$1').replace(/\\(&lt;|&gt;)/g, '$1');
  h = h.replace(/^([^:：<]{1,18})[:：]\s/, '<span class="k">$1：</span>');
  return h;
}

function renderMd(md) {
  const lines = md.split('\n').filter((l) => l.trim() && !l.startsWith('#### '));
  let html = '';
  let depth = 0;
  for (const line of lines) {
    const m = line.match(/^(\s*)- (.*)$/);
    if (!m) {
      while (depth) {
        html += '</li></ul>';
        depth -= 1;
      }
      html += `<p>${inline(line)}</p>`;
      continue;
    }
    const level = Math.floor(m[1].length / 2) + 1;
    if (level > depth) {
      while (depth < level) {
        html += '<ul>';
        depth += 1;
        if (depth < level) html += '<li>';
      }
    } else {
      html += '</li>';
      while (depth > level) {
        html += '</ul></li>';
        depth -= 1;
      }
    }
    html += `<li>${inline(m[2])}`;
  }
  while (depth) {
    html += '</li></ul>';
    depth -= 1;
  }
  return html;
}

/* ---------------- コピー ---------------- */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2400);
}

function flash(btn, label = 'コピー済み') {
  btn.classList.add('is-done');
  if (!btn.classList.contains('ac-all')) {
    btn.dataset.label ||= btn.innerHTML;
    btn.innerHTML = `✓ ${label}`;
  }
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.classList.remove('is-done');
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }, 1600);
}

/* ---------------- 絞り込み ---------------- */
const matches = (it) => !query || `${it.title}\n${it.md}`.toLowerCase().includes(query);

function visibleText() {
  if (!query) return data.all;
  const parts = data.groups
    .map((g) => {
      const its = g.items.filter(matches);
      return its.length ? `## ${g.label}（「${query}」で絞り込み ${its.length} 件）\n\n${its.map((i) => i.md).join('\n\n')}\n` : '';
    })
    .filter(Boolean);
  return `${data.head}\n${parts.join('\n')}`;
}

function updateDock() {
  const total = data.groups.reduce((a, g) => a + g.items.length, 0);
  const shown = data.groups.reduce((a, g) => a + g.items.filter(matches).length, 0);
  const text = visibleText();
  $('#copy-all-label').textContent = query ? `表示中の ${fmt(shown)} 件をコピー` : `全部コピー（${fmt(total)} 件）`;
  $('#copy-all-meta').textContent = `${fmt(text.length)} 文字 · 約 ${fmt(Math.round(text.length / 1.6))} トークン`;
  $('#copy-all').disabled = shown === 0;
  $('#download').disabled = shown === 0;
}

function applyFilter() {
  for (const g of data.groups) {
    const sec = document.getElementById(`g-${g.id}`);
    let n = 0;
    for (const it of g.items) {
      const ok = matches(it);
      const el = document.getElementById(`it-${it.id}`);
      if (el) el.hidden = !ok;
      if (ok) n += 1;
    }
    sec.hidden = query && n === 0;
    $('.ac-g__n', sec).textContent = query ? `${n} / ${g.items.length} 件` : `${g.items.length} 件`;
    const j = $(`#jump a[href="#g-${g.id}"] b`);
    if (j) j.textContent = query ? n : g.items.length;
  }
  updateDock();
}

/* ---------------- 描画 ---------------- */
function render() {
  $('#jump').innerHTML = data.groups.map((g) => `<a href="#g-${g.id}">${esc(g.label)} <b>${g.items.length}</b></a>`).join('');
  $('#groups').innerHTML = data.groups
    .map(
      (g) => `<section class="ac-g" id="g-${g.id}" aria-labelledby="gh-${g.id}">
        <div class="ac-g__head">
          <div><h2 id="gh-${g.id}">${esc(g.label)}<small class="ac-g__n">${g.items.length} 件</small></h2><p class="ac-g__note">${esc(g.note)}</p></div>
          ${g.items.length ? `<button class="ac-btn" type="button" data-copy-group="${g.id}">${COPY_SVG}このグループをコピー</button>` : ''}
        </div>
        <div class="ac-list">${
          g.items.length
            ? g.items
                .map(
                  (it) => `<article class="ac-it" id="it-${it.id}">
                <div class="ac-it__top"><h3>${esc(it.title)}${it.meta ? `<span class="ac-it__meta">${esc(it.meta)}</span>` : ''}</h3>
                <button class="ac-btn" type="button" data-copy-item="${it.id}" aria-label="${esc(it.title)} をコピー">${COPY_SVG}コピー</button></div>
                <div class="ac-body">${renderMd(it.md)}</div>
              </article>`,
                )
                .join('')
            : '<p class="ac-empty">まだデータがありません。</p>'
        }</div>
      </section>`,
    )
    .join('');
  const t = new Date(data.generatedAt);
  $('#stamp').textContent = `${t.toLocaleString('ja-JP')} 時点 · ${data.groups.map((g) => `${g.label} ${g.items.length}件`).join(' · ')}`;
  applyFilter();
}

async function load() {
  try {
    const res = await fetch('/api/allcopy', { headers: { Accept: 'application/json' } });
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
    data = body;
    render();
  } catch (err) {
    $('#groups').innerHTML = `<p class="ac-empty">読み込めませんでした（${esc(err.message || err)}）。時間をおいて再読み込みしてください。</p>`;
    $('#stamp').textContent = '';
  }
}

/* ---------------- 操作 ---------------- */
document.addEventListener('click', async (ev) => {
  const gi = ev.target.closest('[data-copy-group]');
  const ii = ev.target.closest('[data-copy-item]');
  if (!gi && !ii) return;
  let text;
  let label;
  if (gi) {
    const g = data.groups.find((x) => x.id === gi.dataset.copyGroup);
    text = g.md;
    label = `「${g.label}」${g.items.length} 件`;
  } else {
    const it = data.groups.flatMap((g) => g.items).find((x) => x.id === ii.dataset.copyItem);
    text = it.md;
    label = `「${it.title}」`;
  }
  const btn = gi || ii;
  if (await copyText(text)) {
    flash(btn);
    toast(`${label}をコピーしました`);
  } else toast('コピーできませんでした');
});

$('#copy-all').addEventListener('click', async () => {
  if (!data) return;
  const text = visibleText();
  if (await copyText(text)) {
    flash($('#copy-all'));
    toast(`${fmt(text.length)} 文字をコピーしました`);
  } else toast('コピーできませんでした');
});

$('#download').addEventListener('click', () => {
  if (!data) return;
  const blob = new Blob([visibleText()], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `undercurrent-allcopy-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

let timer;
$('#q').addEventListener('input', (ev) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    query = ev.target.value.trim().toLowerCase();
    if (data) applyFilter();
  }, 150);
});

$('#theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('uc.theme', JSON.stringify(next));
  } catch {
    /* 保存できない環境では何もしない */
  }
});

load();
