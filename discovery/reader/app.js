/* Signal Discovery reader — static, dependency-free. Loads the committed
 * JSON index, renders a graph view and an equivalent ranked list view, and
 * persists judgements/queue in localStorage (this page is only ever served
 * over HTTPS via GitHub Pages, never opened from disk, so localStorage is
 * available). No ordering here derives from any engagement metric — the
 * index itself never carries view/like counts, so it isn't possible to. */

const $main = document.getElementById('main');
const $stat = document.getElementById('statLine');

let summary = null; // { schemaVersion, generatedAt, channels: [...] }
let graphData = null; // { nodes, edges }
const channelDetailCache = new Map();
let currentView = 'graph';
let focusChannelId = null;
const focusHistory = [];

/* ---------------- persistence (localStorage) ---------------- */
const LS_JUDGEMENTS = 'sd_judgements_v1';
const LS_QUEUE = 'sd_queue_v1';

function loadJudgements() {
  try {
    return JSON.parse(localStorage.getItem(LS_JUDGEMENTS)) || { schemaVersion: 1, channelJudgements: {}, itemJudgements: {}, sourceJudgements: {} };
  } catch {
    return { schemaVersion: 1, channelJudgements: {}, itemJudgements: {}, sourceJudgements: {} };
  }
}
function saveJudgements(j) {
  localStorage.setItem(LS_JUDGEMENTS, JSON.stringify(j));
}
function setJudgement(bucket, id, verdict) {
  const j = loadJudgements();
  const current = j[bucket][id];
  if (current?.verdict === verdict) {
    delete j[bucket][id]; // clicking the active verdict again clears it
  } else {
    j[bucket][id] = { verdict, at: new Date().toISOString() };
  }
  saveJudgements(j);
  return j;
}

function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(LS_QUEUE)) || [];
  } catch {
    return [];
  }
}
function saveQueue(q) {
  localStorage.setItem(LS_QUEUE, JSON.stringify(q));
}
function addToQueue(item) {
  const q = loadQueue();
  if (!q.some((x) => x.videoId === item.videoId)) {
    q.push({ ...item, addedAt: Date.now() });
    saveQueue(q);
    toast('Added to queue');
  }
}
function removeFromQueue(videoId) {
  saveQueue(loadQueue().filter((x) => x.videoId !== videoId));
}

/* ---------------- utilities ---------------- */
function toast(msg, ms = 3000) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function fmtDuration(sec) {
  if (!sec) return '0:00';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function timeAgo(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- data loading ---------------- */
async function loadData() {
  const [s, e] = await Promise.all([
    fetch('./data/index/summary.v1.json').then((r) => r.json()),
    fetch('./data/index/edges.v1.json').then((r) => r.json()),
  ]);
  summary = s;
  graphData = e;
  $stat.textContent = summary.channels.length
    ? `${summary.channels.length} channels · index generated ${new Date(summary.generatedAt).toLocaleString()}`
    : 'No data yet — the ingestion job hasn\'t produced an index. See Settings.';
}
async function loadChannelDetail(id) {
  if (channelDetailCache.has(id)) return channelDetailCache.get(id);
  const detail = await fetch(`./data/index/channel/${id}.v1.json`).then((r) => (r.ok ? r.json() : null));
  channelDetailCache.set(id, detail);
  return detail;
}

/* ---------------- navigation ---------------- */
document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => navigate(b.dataset.view));
});
function navigate(view) {
  currentView = view;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'graph') return renderGraphView();
  if (view === 'list') return renderListView();
  if (view === 'queue') return renderQueueView();
  if (view === 'settings') return renderSettingsView();
}

/* ---------------- judgement buttons (shared markup) ---------------- */
function judgeButtonsHtml(bucket, id) {
  const j = loadJudgements();
  const verdict = j[bucket][id]?.verdict;
  const cls = (v) => (verdict === v ? `active-${v}` : '');
  return `
    <div class="judge-btns" data-jbucket="${bucket}" data-jid="${escapeHtml(id)}">
      <button data-jverdict="positive" class="${cls('positive')}" title="Good">👍</button>
      <button data-jverdict="negative" class="${cls('negative')}" title="Not for me">👎</button>
      <button data-jverdict="excluded" class="${cls('excluded')}" title="Never show this again">🚫</button>
    </div>`;
}
// Updates every judge-button group for (bucket, id) anywhere on the current
// page in place — the same channel's buttons can appear in more than one
// place at once (a list row and its expanded detail panel) and neither
// should force a full view re-render, which would e.g. collapse the very
// panel the user just clicked in.
function refreshJudgeButtonsInPlace(bucket, id) {
  const verdict = loadJudgements()[bucket][id]?.verdict;
  document.querySelectorAll(`[data-jbucket="${CSS.escape(bucket)}"][data-jid="${CSS.escape(id)}"]`).forEach((wrap) => {
    wrap.querySelectorAll('button').forEach((btn) => {
      btn.className = btn.dataset.jverdict === verdict ? `active-${verdict}` : '';
    });
  });
}
function wireJudgeButtons(root, onChange) {
  root.querySelectorAll('[data-jbucket]').forEach((wrap) => {
    wrap.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        setJudgement(wrap.dataset.jbucket, wrap.dataset.jid, btn.dataset.jverdict);
        refreshJudgeButtonsInPlace(wrap.dataset.jbucket, wrap.dataset.jid);
        if (onChange) onChange();
      });
    });
  });
}

/* ---------------- Graph view ---------------- */
function renderGraphView() {
  if (!summary || !summary.channels.length) {
    $main.innerHTML = `<div class="empty">No index yet. Once the ingestion job has run at least once, channels will appear here.</div>`;
    return;
  }
  if (!focusChannelId) focusChannelId = summary.channels[0].id; // highest ranked, since summary is pre-sorted

  const nodeId = `channel:${focusChannelId}`;
  const inbound = graphData.edges.filter((e) => e.to === nodeId);
  const outbound = graphData.edges.filter((e) => e.from === nodeId);
  const nodeById = new Map(graphData.nodes.map((n) => [n.id, n]));
  const centerInfo = summary.channels.find((c) => c.id === focusChannelId);

  $main.innerHTML = `
    <div class="crumbs">
      ${focusHistory.map((id, i) => `<button data-crumb="${i}">${escapeHtml(nodeLabel(id))}</button> → `).join('')}
      <strong>${escapeHtml(centerInfo?.title || focusChannelId)}</strong>
    </div>
    <p class="graph-legend">Inner ring: sources that reference this channel (Wikipedia articles, or channels that feature it). Outer ring: channels this one features. Click any channel node to re-center; click a source to open it.</p>
    <div id="graphCanvas"></div>
    <div class="panel channel-detail" id="focusDetail"><div class="empty">Loading channel detail…</div></div>
  `;
  document.querySelectorAll('[data-crumb]').forEach((b) => {
    b.addEventListener('click', () => {
      const idx = +b.dataset.crumb;
      focusChannelId = focusHistory[idx];
      focusHistory.length = idx;
      renderGraphView();
    });
  });

  drawGraphSvg(document.getElementById('graphCanvas'), centerInfo, inbound, outbound, nodeById);
  renderFocusDetail(focusChannelId);
}
function nodeLabel(channelId) {
  return summary.channels.find((c) => c.id === channelId)?.title || channelId;
}
function drawGraphSvg(container, centerInfo, inbound, outbound, nodeById) {
  const W = container.clientWidth || 900, H = Math.max(420, window.innerHeight * 0.55);
  const cx = W / 2, cy = H / 2;
  const svgns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgns, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  function place(list, radius) {
    return list.map((edge, i) => {
      const angle = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2;
      return { edge, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    });
  }
  const inPlaced = place(inbound, Math.min(W, H) * 0.28);
  const outPlaced = place(outbound, Math.min(W, H) * 0.42);

  function line(x1, y1, x2, y2, color) {
    const l = document.createElementNS(svgns, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', color); l.setAttribute('stroke-width', '1.2'); l.setAttribute('opacity', '0.5');
    svg.appendChild(l);
  }
  function node(x, y, r, fill, label, onClick, title) {
    const g = document.createElementNS(svgns, 'g');
    g.style.cursor = onClick ? 'pointer' : 'default';
    const c = document.createElementNS(svgns, 'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', r);
    c.setAttribute('fill', fill); c.setAttribute('stroke', '#233043');
    g.appendChild(c);
    const t = document.createElementNS(svgns, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y + r + 13);
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '10.5'); t.setAttribute('fill', '#8b98a9');
    t.textContent = label.length > 22 ? label.slice(0, 21) + '…' : label;
    g.appendChild(t);
    if (title) { const titleEl = document.createElementNS(svgns, 'title'); titleEl.textContent = title; g.appendChild(titleEl); }
    if (onClick) g.addEventListener('click', onClick);
    svg.appendChild(g);
    return g;
  }

  for (const p of inPlaced) line(cx, cy, p.x, p.y, '#5ec8ff');
  for (const p of outPlaced) line(cx, cy, p.x, p.y, '#ffb454');

  node(cx, cy, 26, '#1a3550', centerInfo.title, null, `${centerInfo.title} — score ${centerInfo.score}`);

  for (const p of inPlaced) {
    const n = nodeById.get(p.edge.from);
    if (!n) continue;
    const isChannel = n.kind === 'channel';
    node(p.x, p.y, 14, isChannel ? '#1c2b3f' : '#0e141c', n.label, () => {
      if (isChannel) {
        focusHistory.push(focusChannelId);
        focusChannelId = n.channelId;
        renderGraphView();
      } else if (n.url) {
        window.open(n.url, '_blank', 'noopener');
      }
    }, n.label);
  }
  for (const p of outPlaced) {
    const n = nodeById.get(p.edge.to);
    if (!n) continue;
    const isChannel = n.kind === 'channel';
    node(p.x, p.y, 14, isChannel ? '#1c2b3f' : '#0e141c', n.label, () => {
      if (isChannel) {
        focusHistory.push(focusChannelId);
        focusChannelId = n.channelId;
        renderGraphView();
      } else if (n.url) {
        window.open(n.url, '_blank', 'noopener');
      }
    }, n.label);
  }

  container.innerHTML = '';
  container.appendChild(svg);
}
async function renderFocusDetail(channelId) {
  const el = document.getElementById('focusDetail');
  const detail = await loadChannelDetail(channelId);
  if (!el) return; // view changed while loading
  if (!detail) { el.innerHTML = `<div class="empty">Detail not found for this channel.</div>`; return; }
  el.innerHTML = channelDetailHtml(detail);
  wireChannelDetailActions(el, detail);
}

/* ---------------- List view ---------------- */
function renderListView() {
  if (!summary || !summary.channels.length) {
    $main.innerHTML = `<div class="empty">No index yet.</div>`;
    return;
  }
  $main.innerHTML = `
    <div class="searchbar">
      <input type="text" id="queryInput" placeholder="Filter loaded channels/items by title (secondary — browse or graph-navigate first)">
    </div>
    <div class="panel" id="listBody"></div>
  `;
  document.getElementById('queryInput').addEventListener('input', renderListBody);
  renderListBody();
}
function renderListBody() {
  const q = (document.getElementById('queryInput')?.value || '').trim().toLowerCase();
  const body = document.getElementById('listBody');
  const rows = summary.channels.filter((c) => !q || c.title.toLowerCase().includes(q));
  if (!rows.length) { body.innerHTML = `<div class="empty">No matches.</div>`; return; }
  body.innerHTML = rows.map((c) => `
    <div class="list-row" data-crow="${c.id}">
      <img src="${c.thumb}" alt="">
      <div class="main">
        <div class="title" data-expand="${c.id}">${escapeHtml(c.title)}</div>
        <div class="meta">score ${c.score} · ${c.distinctSourceCount} distinct source(s) · hop ${c.hop}
          ${c.uploadsPerDay >= 2 ? `<span class="badge">⚠ ${c.uploadsPerDay}/day</span>` : ''}
        </div>
      </div>
      ${judgeButtonsHtml('channelJudgements', c.id)}
      <button class="btn small" data-focusgraph="${c.id}">View in graph</button>
    </div>
    <div class="channel-detail" id="expand-${c.id}" style="display:none"></div>
  `).join('');
  wireJudgeButtons(body);
  body.querySelectorAll('[data-expand]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.dataset.expand;
      const target = document.getElementById(`expand-${id}`);
      if (target.style.display === 'block') { target.style.display = 'none'; return; }
      target.style.display = 'block';
      target.innerHTML = `<div class="empty">Loading…</div>`;
      const detail = await loadChannelDetail(id);
      if (!detail) { target.innerHTML = `<div class="empty">Not found.</div>`; return; }
      target.innerHTML = channelDetailHtml(detail);
      wireChannelDetailActions(target, detail);
    });
  });
  body.querySelectorAll('[data-focusgraph]').forEach((el) => {
    el.addEventListener('click', () => {
      focusChannelId = el.dataset.focusgraph;
      focusHistory.length = 0;
      navigate('graph');
    });
  });
}

/* ---------------- shared channel-detail rendering (sources + recent items) ---------------- */
function channelDetailHtml(detail) {
  const sourcesHtml = detail.sources.map((s) => `
    <span class="badge">${s.type === 'wikipedia' ? '📄' : '📺'} ${escapeHtml(s.label)}</span>
  `).join(' ');
  const itemsHtml = detail.recentItems.length
    ? detail.recentItems.map((it) => `
      <div class="item-row" data-item="${it.id}">
        <img src="${it.thumb}" alt="" data-queueadd>
        <div style="flex:1">
          <div class="title" data-queueadd>${escapeHtml(it.title)}</div>
          <div class="meta">${timeAgo(it.publishedAt)} · ${fmtDuration(it.durationSec)}</div>
          ${it.chapters.length ? `<div class="chapters">${it.chapters.map((c) => `${fmtDuration(c.seconds)} ${escapeHtml(c.label)}`).join(' · ')}</div>` : ''}
          <div style="margin-top:4px;display:flex;gap:8px;align-items:center">
            <button class="btn small" data-addqueue="${it.id}" data-title="${escapeHtml(it.title)}" data-thumb="${it.thumb}">+ Queue</button>
            ${judgeButtonsHtml('itemJudgements', it.id)}
          </div>
        </div>
      </div>
    `).join('')
    : `<div class="empty">No recent items passed the filters, or none fetched yet.</div>`;
  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div>Sources (${detail.distinctSourceCount}): ${sourcesHtml}</div>
      ${judgeButtonsHtml('channelJudgements', detail.id)}
    </div>
    <div style="margin-top:10px">${itemsHtml}</div>
  `;
}
function wireChannelDetailActions(root, detail) {
  wireJudgeButtons(root);
  root.querySelectorAll('[data-addqueue]').forEach((btn) => {
    btn.addEventListener('click', () => {
      addToQueue({ videoId: btn.dataset.addqueue, title: btn.dataset.title, thumb: btn.dataset.thumb });
    });
  });
  root.querySelectorAll('[data-queueadd]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      const row = ev.currentTarget.closest('.item-row');
      const item = detail.recentItems.find((it) => it.id === row.dataset.item);
      if (item) openPlayerFromQueueOrDirect(item.id, item.title, item.thumb);
    });
  });
}

/* ---------------- Queue view + playback ---------------- */
function renderQueueView() {
  const q = loadQueue();
  if (!q.length) { $main.innerHTML = `<div class="empty">Queue is empty. Add items from a channel's recent items.</div>`; return; }
  $main.innerHTML = `<div class="panel" id="queueBody"></div>`;
  const body = document.getElementById('queueBody');
  body.innerHTML = q.map((it) => `
    <div class="queue-row" data-qid="${it.videoId}">
      <img src="${it.thumb}" alt="" style="width:64px;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#000;cursor:pointer" data-play>
      <div style="flex:1;cursor:pointer" data-play>${escapeHtml(it.title)}</div>
      <button class="btn small" data-unqueue>Remove</button>
    </div>
  `).join('');
  body.querySelectorAll('[data-play]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.closest('.queue-row').dataset.qid;
      openPlayer(id);
    });
  });
  body.querySelectorAll('[data-unqueue]').forEach((el) => {
    el.addEventListener('click', () => {
      removeFromQueue(el.closest('.queue-row').dataset.qid);
      renderQueueView();
    });
  });
}
function openPlayerFromQueueOrDirect(videoId) {
  openPlayer(videoId);
}
const playerDialog = document.getElementById('playerDialog');
function openPlayer(videoId) {
  document.getElementById('playerHolder').innerHTML =
    `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?rel=0" allowfullscreen allow="encrypted-media"></iframe>`;
  playerDialog.showModal();
}
document.getElementById('closePlayer').addEventListener('click', () => {
  document.getElementById('playerHolder').innerHTML = '';
  playerDialog.close();
});

/* ---------------- Settings view (export/import judgements) ---------------- */
function renderSettingsView() {
  const j = loadJudgements();
  $main.innerHTML = `
    <div class="panel">
      <h3 style="margin-top:0">Judgements</h3>
      <p style="color:var(--muted);font-size:12.5px">
        Your 👍/👎/🚫 choices live only in this browser. To feed them back into the next ingestion run,
        export this file and commit it as <code>discovery/data/judgements.json</code> (via a PR, or
        directly if you have write access) — the job reads it as input and never overwrites it.
      </p>
      <textarea readonly id="exportBox">${escapeHtml(JSON.stringify(j, null, 2))}</textarea>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button class="btn" id="copyExport">Copy to clipboard</button>
        <button class="btn" id="downloadExport">Download judgements.json</button>
      </div>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">Import</h3>
      <p style="color:var(--muted);font-size:12.5px">Paste a judgements.json to replace what's stored in this browser.</p>
      <textarea id="importBox" placeholder="paste JSON here"></textarea>
      <div style="margin-top:8px"><button class="btn" id="doImport">Import</button></div>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">About this data</h3>
      <p style="color:var(--muted);font-size:12.5px">
        Index generated at: ${summary?.generatedAt ? new Date(summary.generatedAt).toLocaleString() : 'never'}.
        ${summary?.channels.length || 0} channels currently pass the ranking threshold.
        No ordering in this reader is derived from view counts, likes, or any engagement metric —
        the index itself never fetches or stores them.
      </p>
    </div>
  `;
  document.getElementById('copyExport').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('exportBox').value).then(() => toast('Copied'));
  });
  document.getElementById('downloadExport').addEventListener('click', () => {
    const blob = new Blob([document.getElementById('exportBox').value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'judgements.json'; a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('doImport').addEventListener('click', () => {
    try {
      const parsed = JSON.parse(document.getElementById('importBox').value);
      saveJudgements(parsed);
      toast('Imported. Re-rendering…');
      renderSettingsView();
    } catch (e) {
      toast('Invalid JSON: ' + e.message, 5000);
    }
  });
}

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    await loadData();
  } catch (e) {
    $stat.textContent = 'Failed to load index data.';
    $main.innerHTML = `<div class="empty">Could not load the index (${escapeHtml(e.message)}). If you're opening this file directly from disk, that won't work — it must be served over HTTPS (GitHub Pages).</div>`;
    return;
  }
  navigate('graph');
})();
