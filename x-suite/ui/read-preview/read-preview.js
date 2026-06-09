const $ = (id) => document.getElementById(id);

const PREVIEW_THREAD_SESSION_KEY = 'xsuite_read_preview_thread';
const THREAD_RECENT_LIMIT = 15;
const THREAD_RESULTS_LIMIT = 40;

let libraryCache = null;
let selectedThreadId = null;
let threadSummariesCache = [];
let threadSearchTimer = null;
let threadViewAll = false;

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

function fmtTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('zh-CN');
  } catch {
    return '';
  }
}

function displayTime(row) {
  return fmtTime(row?.tweetAt || row?.at);
}

function normText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function dedupeReadRows(rows) {
  const seen = new Set();
  const sorted = rows
    .slice()
    .sort((a, b) => (b.tweetAt || b.at || 0) - (a.tweetAt || a.at || 0));
  const out = [];
  for (const row of sorted) {
    const handle = String(row.handle || '')
      .toLowerCase()
      .replace(/^@/, '');
    const key = `${handle}|${normText(row.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => (a.tweetAt || a.at || 0) - (b.tweetAt || b.at || 0));
}

function normPageKey(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return String(url || '').split('?')[0];
  }
}

function isSignalRow(row) {
  return row.kind === XCF.COMMENT_KIND.SIGNAL;
}

function threadRows(lib, threadId, { blocked = false, lane = 'all' } = {}) {
  const list = lib.archiveByThread?.[threadId] || [];
  return list.filter((row) => {
    if (Boolean(row.blockedLane) !== blocked) return false;
    if (lane === 'signal') return isSignalRow(row);
    if (lane === 'noise') return !isSignalRow(row);
    return true;
  });
}

function allSignalRows(lib) {
  return lib.signal || [];
}

function buildThreadSummaries(lib) {
  const byThread = lib.archiveByThread || {};
  const roots = lib.threadRoots || {};
  const ids = new Set([...Object.keys(byThread), ...Object.keys(roots)]);

  return Array.from(ids)
    .map((id) => {
      const rows = byThread[id] || [];
      const root = roots[id] || null;
      const noiseCount = rows.filter((row) => !row.blockedLane && !isSignalRow(row)).length;
      const signalCount = rows.filter((row) => !row.blockedLane && isSignalRow(row)).length;
      const preview = (root?.text || rows.find((row) => row.text)?.text || '').trim();
      const handle = root?.handle ? `@${String(root.handle).replace(/^@/, '')}` : '';
      const labelCore = preview ? preview.slice(0, 42) : `帖子 ${id}`;
      const label = handle ? `${handle} · ${labelCore}` : labelCore;
      const latestAt = Math.max(root?.at || 0, ...rows.map((row) => row.at || 0));
      const pageUrl = root?.pageUrl || rows.find((row) => row.pageUrl)?.pageUrl || '';
      return { id, label, noiseCount, signalCount, latestAt, pageUrl };
    })
    .sort((a, b) => b.latestAt - a.latestAt);
}

function parseHashState() {
  const hash = (location.hash || '').replace(/^#/, '').trim();
  if (!hash) return { threadId: null, viewAll: false };
  if (hash === 'all') return { threadId: null, viewAll: true };
  const match = hash.match(/^thread\/(\d+)$/);
  return { threadId: match ? match[1] : null, viewAll: false };
}

function applyHash() {
  try {
    history.replaceState(null, '', selectedThreadId ? `#thread/${selectedThreadId}` : '#all');
  } catch {
    /* ignore */
  }
}

async function loadStoredThreadId() {
  try {
    const data = await chrome.storage.session.get(PREVIEW_THREAD_SESSION_KEY);
    return data?.[PREVIEW_THREAD_SESSION_KEY] || null;
  } catch {
    return null;
  }
}

async function persistThreadId(threadId) {
  try {
    if (threadId) {
      await chrome.storage.session.set({ [PREVIEW_THREAD_SESSION_KEY]: threadId });
    } else {
      await chrome.storage.session.remove(PREVIEW_THREAD_SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

function pickDefaultThreadId(lib) {
  const hashState = parseHashState();
  if (hashState.threadId) return hashState.threadId;
  if (lib.activeThreadId) return lib.activeThreadId;
  const summaries = buildThreadSummaries(lib);
  return summaries[0]?.id || null;
}

function formatThreadLabel(item) {
  return `${item.label}（${item.signalCount} 非噪音 / ${item.noiseCount} 噪音）`;
}

function threadSearchHaystack(item) {
  return `${item.id} ${item.label} ${item.pageUrl || ''}`.toLowerCase();
}

function filterThreadSummaries(query, summaries) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    return {
      items: summaries.slice(0, THREAD_RECENT_LIMIT),
      total: summaries.length
    };
  }
  const matched = summaries.filter((item) => threadSearchHaystack(item).includes(q));
  return {
    items: matched.slice(0, THREAD_RESULTS_LIMIT),
    total: matched.length
  };
}

function hideThreadResults() {
  const list = $('thread_results');
  const input = $('thread_search');
  if (list) list.hidden = true;
  if (input) input.setAttribute('aria-expanded', 'false');
}

function showThreadResults() {
  const list = $('thread_results');
  const input = $('thread_search');
  if (!list || !input) return;
  renderThreadResults(input.value || '');
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function renderThreadCurrent(item) {
  const current = $('thread_current');
  if (!current) return;
  if (!item) {
    current.textContent = '全部帖子（按时间合并展示非噪音回复）';
    current.title = '未限定单一帖子';
    return;
  }
  current.textContent = formatThreadLabel(item);
  current.title = item.pageUrl || item.id;
}

function renderThreadResults(query) {
  const list = $('thread_results');
  if (!list) return;
  list.textContent = '';

  const { items, total } = filterThreadSummaries(query, threadSummariesCache);
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'thread-result-more';
    empty.textContent = query.trim() ? '没有匹配的帖子' : '暂无帖子记录';
    list.appendChild(empty);
    return;
  }

  for (const item of items) {
    const node = document.createElement('li');
    node.className = 'thread-result-item';
    node.role = 'option';
    node.dataset.id = item.id;
    node.textContent = formatThreadLabel(item);
    if (item.id === selectedThreadId) node.classList.add('selected');
    node.addEventListener('mousedown', (event) => {
      event.preventDefault();
      $('thread_search').value = '';
      setSelectedThread(item.id);
      hideThreadResults();
    });
    list.appendChild(node);
  }

  if (total > items.length) {
    const more = document.createElement('li');
    more.className = 'thread-result-more';
    more.textContent = `还有 ${total - items.length} 条匹配，请继续输入关键词`;
    list.appendChild(more);
  } else if (!query.trim() && threadSummariesCache.length > items.length) {
    const more = document.createElement('li');
    more.className = 'thread-result-more';
    more.textContent = `共 ${threadSummariesCache.length} 个帖子，输入关键词可搜索更多`;
    list.appendChild(more);
  }
}

function renderThreadPicker(lib) {
  const bar = $('thread_bar');
  const total = $('thread_total');
  const openLink = $('thread_open_x');
  const viewAllBtn = $('thread_view_all');
  if (!bar) return;

  const summaries = buildThreadSummaries(lib);
  threadSummariesCache = summaries;

  if (!summaries.length) {
    bar.hidden = true;
    selectedThreadId = null;
    threadViewAll = false;
    renderThreadCurrent(null);
    return;
  }

  bar.hidden = false;
  if (selectedThreadId && !summaries.some((item) => item.id === selectedThreadId)) {
    selectedThreadId = pickDefaultThreadId(lib);
    threadViewAll = !selectedThreadId;
  }

  if (total) total.textContent = `共 ${summaries.length} 个`;

  const current = selectedThreadId
    ? summaries.find((item) => item.id === selectedThreadId) || null
    : null;
  renderThreadCurrent(current);

  if (openLink) {
    if (current?.pageUrl) {
      openLink.href = current.pageUrl;
      openLink.hidden = false;
    } else {
      openLink.href = '#';
      openLink.hidden = !selectedThreadId;
    }
  }

  if (viewAllBtn) {
    viewAllBtn.hidden = threadViewAll || !selectedThreadId;
  }

  const search = $('thread_search');
  if (search && document.activeElement !== search) {
    renderThreadResults(search.value || '');
  }
}

async function setSelectedThread(threadId) {
  selectedThreadId = threadId || null;
  threadViewAll = !threadId;
  await persistThreadId(selectedThreadId);
  applyHash();
  if (libraryCache) renderAll(libraryCache);
}

function getReadItems(lib) {
  const rows = selectedThreadId
    ? threadRows(lib, selectedThreadId, { blocked: false, lane: 'signal' })
    : allSignalRows(lib);
  return dedupeReadRows(rows);
}

function appendReadComment(container, row) {
  const block = document.createElement('p');
  block.className = 'read-comment read-signal';
  const text = String(row.text || '').trim();
  block.textContent = text || '（未保存正文；请回到原帖等待采集完成后再刷新）';
  container.appendChild(block);

  const meta = document.createElement('div');
  meta.className = 'read-meta-inline';
  const who = row.handle ? `@${String(row.handle).replace(/^@/, '')}` : '@未知';
  const when = displayTime(row);
  meta.textContent = when ? `${who} · ${when}` : who;
  container.appendChild(meta);
}

function renderReadFeed(lib) {
  const items = getReadItems(lib);
  const threadRoots = lib.threadRoots || {};
  const feed = $('read_feed');
  feed.textContent = '';
  feed.className = 'read-feed read-feed-plain';
  $('read_empty').hidden = items.length > 0;
  $('read_summary').textContent = items.length ? `${items.length} 条非噪音回复` : '';
  $('thread_caption').textContent = selectedThreadId
    ? `单帖阅读 · ${selectedThreadId}`
    : '全部帖子合并阅读';

  if (!items.length) return;

  const doc = document.createElement('div');
  doc.className = 'read-plain';

  if (selectedThreadId) {
    const root = threadRoots[selectedThreadId] || null;
    if (root && String(root.text || '').trim()) {
      const rootText = document.createElement('p');
      rootText.className = 'read-root';
      rootText.textContent = String(root.text).trim();
      doc.appendChild(rootText);

      const sep = document.createElement('div');
      sep.className = 'read-sep';
      sep.setAttribute('aria-hidden', 'true');
      doc.appendChild(sep);
    }

    items.forEach((row, index) => {
      if (index > 0) {
        const sep = document.createElement('div');
        sep.className = 'read-sep';
        sep.setAttribute('aria-hidden', 'true');
        doc.appendChild(sep);
      }
      appendReadComment(doc, row);
    });

    feed.appendChild(doc);
    return;
  }

  const groups = new Map();
  for (const row of items) {
    const key =
      row.threadId ||
      (row.pageUrl || '').match(/\/status\/(\d+)/)?.[1] ||
      normPageKey(row.pageUrl || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
    const groupA = groups.get(a);
    const groupB = groups.get(b);
    const timeA = Math.min(...groupA.map((row) => row.at || 0));
    const timeB = Math.min(...groupB.map((row) => row.at || 0));
    return timeA - timeB;
  });

  let firstGroup = true;
  for (const key of orderedKeys) {
    const rows = groups.get(key).slice().sort((a, b) => (a.at || 0) - (b.at || 0));
    if (!firstGroup) {
      const gap = document.createElement('div');
      gap.className = 'read-group-gap';
      doc.appendChild(gap);
    }
    firstGroup = false;

    const root = threadRoots[key] || threadRoots[normPageKey(key)] || null;
    if (root && String(root.text || '').trim()) {
      const rootText = document.createElement('p');
      rootText.className = 'read-root';
      rootText.textContent = String(root.text).trim();
      doc.appendChild(rootText);

      const sep = document.createElement('div');
      sep.className = 'read-sep';
      sep.setAttribute('aria-hidden', 'true');
      doc.appendChild(sep);
    }

    rows.forEach((row, index) => {
      if (index > 0) {
        const sep = document.createElement('div');
        sep.className = 'read-sep';
        sep.setAttribute('aria-hidden', 'true');
        doc.appendChild(sep);
      }
      appendReadComment(doc, row);
    });
  }

  feed.appendChild(doc);
}

function renderStats(lib) {
  const summaries = threadSummariesCache;
  const items = getReadItems(lib);
  $('view_mode_label').textContent = selectedThreadId ? '单帖阅读' : '全部帖子';
  $('stat_thread_count').textContent = String(summaries.length);
  $('stat_signal_count').textContent = String(items.length);
  $('page_hint').textContent = selectedThreadId
    ? '现在是单帖沉浸阅读：显示主贴与当前帖的非噪音回复。'
    : '现在是合并阅读：按帖子分组展示所有已采集的非噪音回复。';
}

function renderAll(lib) {
  renderThreadPicker(lib);
  renderReadFeed(lib);
  renderStats(lib);
}

async function refresh() {
  const lib = await send(XCF.MSG.GET_LIBRARY);
  if (!lib) return;
  if (!threadViewAll && selectedThreadId == null) {
    selectedThreadId = pickDefaultThreadId(lib) || null;
  }
  libraryCache = lib;
  renderAll(lib);
}

function bindEvents() {
  $('btn_refresh')?.addEventListener('click', () => {
    refresh();
  });

  $('thread_view_all')?.addEventListener('click', () => {
    $('thread_search').value = '';
    setSelectedThread(null);
    hideThreadResults();
  });

  $('thread_current')?.addEventListener('click', () => {
    const input = $('thread_search');
    if (!input) return;
    input.focus();
    showThreadResults();
  });

  $('thread_current')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    $('thread_search')?.focus();
    showThreadResults();
  });

  $('thread_search')?.addEventListener('focus', () => {
    showThreadResults();
  });

  $('thread_search')?.addEventListener('input', (event) => {
    clearTimeout(threadSearchTimer);
    threadSearchTimer = setTimeout(() => {
      renderThreadResults(event.target.value || '');
      showThreadResults();
    }, 120);
  });

  $('thread_search')?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideThreadResults();
      event.target.blur();
    }
  });

  document.addEventListener('click', (event) => {
    const box = $('thread_combobox');
    if (!box || box.contains(event.target)) return;
    hideThreadResults();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

async function init() {
  bindEvents();

  const hashState = parseHashState();
  if (hashState.viewAll) {
    threadViewAll = true;
  } else if (hashState.threadId) {
    selectedThreadId = hashState.threadId;
  } else {
    selectedThreadId = await loadStoredThreadId();
  }

  await refresh();
}

init();
