/**
 * まとめてコピー — /api/export の Markdown をセクション単位・全体でコピーする
 */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('ja-JP');

let data = null;
const selected = new Set();

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2600);
}

/** クリップボードへ。http や古いブラウザでは textarea で代替 */
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

function flash(btn, label) {
  const prev = btn.dataset.label || btn.textContent;
  btn.dataset.label = prev;
  btn.classList.add('is-done');
  if (label && !btn.classList.contains('cp-big')) btn.textContent = label;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.classList.remove('is-done');
    if (!btn.classList.contains('cp-big')) btn.textContent = prev;
  }, 1800);
}

function composed() {
  const parts = data.sections.filter((s) => selected.has(s.id)).map((s) => s.body);
  return `${data.head}\n${parts.join('\n')}`;
}

function updateMain() {
  const all = selected.size === data.sections.length;
  const text = composed();
  $('#copy-all-label').textContent = selected.size === 0 ? 'コピーする項目を選んでください' : all ? 'すべてコピー' : `選んだ ${selected.size} 項目をコピー`;
  $('#copy-all-meta').textContent = selected.size ? `${fmt(text.length)} 文字 · 約 ${fmt(Math.round(text.length / 1.6))} トークン · Markdown` : '';
  $('#copy-all').disabled = selected.size === 0;
  $('#download').disabled = selected.size === 0;
  $('#toggle-all').textContent = all ? 'すべて選択を解除' : 'すべて選択';
}

function render() {
  const groups = [...new Set(data.sections.map((s) => s.group))];
  $('#list').innerHTML = groups
    .map(
      (g) => `<div class="cp-group"><h2>${esc(g)}</h2><div class="cp-cards">${data.sections
        .filter((s) => s.group === g)
        .map(
          (s) => `<article class="cp-card" data-id="${esc(s.id)}">
            <div class="cp-row">
              <label class="cp-check"><input type="checkbox" data-sel="${esc(s.id)}" ${selected.has(s.id) ? 'checked' : ''} aria-label="${esc(s.title)} を含める"><span></span></label>
              <div class="cp-info"><b>${esc(s.title)}</b><small>${fmt(s.chars)} 文字</small></div>
              <div class="cp-act">
                <button class="cp-btn cp-btn--ghost" type="button" data-preview="${esc(s.id)}" aria-expanded="false">中身を見る</button>
                <button class="cp-btn" type="button" data-copy="${esc(s.id)}">コピー</button>
              </div>
            </div>
            <pre class="cp-pre" hidden>${esc(s.body)}</pre>
          </article>`,
        )
        .join('')}</div></div>`,
    )
    .join('');
  const t = new Date(data.generatedAt);
  $('#stamp').textContent = `${t.toLocaleString('ja-JP')} 時点の最新データ`;
  updateMain();
}

async function load() {
  try {
    const res = await fetch('/api/export', { headers: { Accept: 'application/json' } });
    data = await res.json();
    if (!data.ok) throw new Error(data.error || 'error');
    for (const s of data.sections) selected.add(s.id);
    render();
  } catch (err) {
    $('#copy-all-label').textContent = '読み込めませんでした';
    $('#copy-all-meta').textContent = String(err.message || err);
  }
}

document.addEventListener('click', async (ev) => {
  const c = ev.target.closest('[data-copy]');
  if (c) {
    const s = data.sections.find((x) => x.id === c.dataset.copy);
    if (s && (await copyText(s.body))) {
      flash(c, 'コピー済み');
      toast(`「${s.title}」をコピーしました`);
    } else toast('コピーできませんでした');
    return;
  }
  const p = ev.target.closest('[data-preview]');
  if (p) {
    const pre = $('.cp-pre', p.closest('.cp-card'));
    pre.hidden = !pre.hidden;
    p.setAttribute('aria-expanded', String(!pre.hidden));
    p.textContent = pre.hidden ? '中身を見る' : '閉じる';
  }
});
document.addEventListener('change', (ev) => {
  const id = ev.target.dataset?.sel;
  if (!id) return;
  if (ev.target.checked) selected.add(id);
  else selected.delete(id);
  updateMain();
});
$('#copy-all').addEventListener('click', async () => {
  if (!data || !selected.size) return;
  const text = composed();
  if (await copyText(text)) {
    flash($('#copy-all'));
    toast(`${fmt(text.length)} 文字をコピーしました`);
  } else toast('コピーできませんでした');
});
$('#download').addEventListener('click', () => {
  const blob = new Blob([composed()], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `undercurrent-ai-pulse-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#toggle-all').addEventListener('click', () => {
  const all = selected.size === data.sections.length;
  selected.clear();
  if (!all) for (const s of data.sections) selected.add(s.id);
  for (const cb of $$('[data-sel]')) cb.checked = !all;
  updateMain();
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
