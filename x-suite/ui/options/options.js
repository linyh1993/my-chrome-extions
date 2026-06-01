const $ = (id) => document.getElementById(id);

const TAB_IDS = ['read', 'signal', 'filtered', 'blocked', 'accounts', 'keywords'];
let activeTab = 'read';
let libraryCache = null;
let selectedThreadId = null;
let threadSummariesCache = [];
let threadSearchTimer = null;
let threadViewAll = false;

const THREAD_RECENT_LIMIT = 15;
const THREAD_RESULTS_LIMIT = 40;

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

function parseLines(raw) {
  return raw
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderKeywordTextarea(inputId, list, ruleCheckboxId, ruleKey, rules) {
  const el = $(inputId);
  if (el) el.value = (list || []).join('\n');
  const cb = ruleCheckboxId ? $(ruleCheckboxId) : null;
  if (cb) cb.checked = rules?.[ruleKey] !== false;
}

async function saveKeywordPanel({
  inputId,
  hintId,
  settingsKey,
  ruleKey,
  ruleCheckboxId
}) {
  const unique = [...new Set(parseLines($(inputId).value))];
  const partial = { [settingsKey]: unique };
  if (ruleKey && ruleCheckboxId) {
    partial.rules = { [ruleKey]: $(ruleCheckboxId).checked };
  }
  await send(XCF.MSG.SAVE_SETTINGS, { partial });
  const hint = hintId ? $(hintId) : null;
  if (hint) {
    hint.hidden = false;
    clearTimeout(hint._t);
    hint._t = setTimeout(() => {
      hint.hidden = true;
    }, 2000);
  }
  await refresh();
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
    const h = String(row.handle || '')
      .toLowerCase()
      .replace(/^@/, '');
    const k = `${h}|${normText(row.text)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out.sort((a, b) => (a.tweetAt || a.at || 0) - (b.tweetAt || b.at || 0));
}

function normPageKey(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return String(url || '').split('?')[0];
  }
}

function downloadJson(data) {
  const name = `xcf-export-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function setPageMode(tabId) {
  const isRead = tabId === 'read';
  document.body.classList.toggle('mode-read', isRead);
  document.body.classList.toggle('mode-manage', !isRead);
  // 顶部工具栏在所有 Tab 都保留，避免切换时布局跳动
  $('toolbar_manage').hidden = false;
  $('storage_hint').hidden = false;
  $('page_sub').textContent = isRead
    ? '当前帖子的非噪音回复正文 + 主推文，条目之间用下划线分隔。'
    : '管理非噪音/噪音记录、屏蔽名单与关键词；数据保存在本机浏览器。';
}

function switchTab(tabId) {
  if (!TAB_IDS.includes(tabId)) return;
  activeTab = tabId;
  setPageMode(tabId);

  for (const id of TAB_IDS) {
    const btn = $(`tab_btn_${id}`);
    const panel = $(`panel_${id}`);
    const on = id === tabId;
    if (btn) {
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (panel) {
      panel.classList.toggle('active', on);
      panel.hidden = !on;
    }
  }

  try {
    const threadPart = selectedThreadId ? `/thread/${selectedThreadId}` : '';
    history.replaceState(null, '', `#${tabId}${threadPart}`);
  } catch {
    /* ignore */
  }
}

function parseHashThreadId() {
  const hash = (location.hash || '').replace(/^#/, '');
  const m = hash.match(/(?:^|\/)thread\/(\d+)/);
  return m ? m[1] : null;
}

function initTabs() {
  const hash = (location.hash || '').replace(/^#/, '');
  const tab = hash.split('/')[0];
  if (TAB_IDS.includes(tab)) switchTab(tab);
  else switchTab('read');

  document.querySelectorAll('.tabs .tab[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function isSignalRow(row) {
  return row.kind === XCF.COMMENT_KIND.SIGNAL;
}

function isNoiseRow(row) {
  return !isSignalRow(row);
}

function threadRows(lib, threadId, { blocked = false, lane = 'all' } = {}) {
  const list = lib.archiveByThread?.[threadId] || [];
  return list.filter((r) => {
    if (Boolean(r.blockedLane) !== blocked) return false;
    if (lane === 'signal') return isSignalRow(r);
    if (lane === 'noise') return isNoiseRow(r);
    return true;
  });
}

function allNoiseRows(lib) {
  return (lib.noise || lib.archive || []).filter(isNoiseRow);
}

function allSignalRows(lib) {
  return lib.signal || [];
}

function rowsForView(lib, { blocked = false, lane = 'noise' } = {}) {
  if (selectedThreadId) return threadRows(lib, selectedThreadId, { blocked, lane });
  if (lane === 'signal') return allSignalRows(lib);
  if (blocked) return allConfirmedRows(lib);
  return allNoiseRows(lib);
}

function threadReplyRows(lib, threadId) {
  return threadRows(lib, threadId, { blocked: false, lane: 'all' });
}

function allConfirmedRows(lib) {
  return lib.confirmedNoise || lib.blockedReplies || [];
}

function buildThreadSummaries(lib) {
  const byThread = lib.archiveByThread || {};
  const roots = lib.threadRoots || {};
  const ids = new Set([...Object.keys(byThread), ...Object.keys(roots)]);

  return Array.from(ids)
    .map((id) => {
      const rows = byThread[id] || [];
      const root = roots[id] || null;
      const noiseCount = rows.filter((r) => !r.blockedLane && isNoiseRow(r)).length;
      const signalCount = rows.filter((r) => !r.blockedLane && isSignalRow(r)).length;
      const preview = (root?.text || rows.find((r) => r.text)?.text || '').trim();
      const who = root?.handle ? `@${String(root.handle).replace(/^@/, '')}` : '';
      const labelCore = preview ? preview.slice(0, 42) : `帖子 ${id}`;
      const label = who ? `${who} · ${labelCore}` : labelCore;
      const latestAt = Math.max(
        root?.at || 0,
        ...rows.map((r) => r.at || 0)
      );
      const pageUrl = root?.pageUrl || rows.find((r) => r.pageUrl)?.pageUrl || '';
      return { id, label, noiseCount, signalCount, latestAt, pageUrl };
    })
    .sort((a, b) => b.latestAt - a.latestAt);
}

function pickDefaultThreadId(lib) {
  const fromHash = parseHashThreadId();
  if (fromHash) return fromHash;
  if (lib.optionsThreadId) return lib.optionsThreadId;
  if (lib.activeThreadId) return lib.activeThreadId;
  const summaries = buildThreadSummaries(lib);
  return summaries[0]?.id || null;
}

function formatThreadLabel(item) {
  return `${item.label}（${item.signalCount} 非噪音 · ${item.noiseCount} 噪音）`;
}

function threadSearchHaystack(item) {
  return `${item.id} ${item.label} ${item.pageUrl || ''}`.toLowerCase();
}

function filterThreadSummaries(query, summaries) {
  const q = (query || '').trim().toLowerCase();
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
  const ul = $('thread_results');
  const input = $('thread_search');
  if (ul) ul.hidden = true;
  if (input) input.setAttribute('aria-expanded', 'false');
}

function showThreadResults() {
  const ul = $('thread_results');
  const input = $('thread_search');
  if (!ul || !input) return;
  renderThreadResults(input.value || '');
  ul.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function renderThreadCurrent(item) {
  const el = $('thread_current');
  if (!el) return;
  if (!item) {
    el.textContent = '全部帖子（合并展示各帖非噪音）';
    el.title = '未限定单个帖子';
    return;
  }
  el.textContent = formatThreadLabel(item);
  el.title = item.pageUrl || item.id;
}

function renderThreadResults(query) {
  const ul = $('thread_results');
  if (!ul) return;
  ul.textContent = '';

  const { items, total } = filterThreadSummaries(query, threadSummariesCache);

  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'thread-result-more';
    empty.textContent = query.trim() ? '没有匹配的帖子' : '暂无帖子记录';
    ul.appendChild(empty);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'thread-result-item';
    li.role = 'option';
    li.dataset.id = item.id;
    li.textContent = formatThreadLabel(item);
    if (item.id === selectedThreadId) li.classList.add('selected');
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      $('thread_search').value = '';
      setSelectedThread(item.id);
      hideThreadResults();
    });
    ul.appendChild(li);
  }

  if (total > items.length) {
    const more = document.createElement('li');
    more.className = 'thread-result-more';
    more.textContent = `还有 ${total - items.length} 条匹配，请继续输入关键词`;
    ul.appendChild(more);
  } else if (!query.trim() && threadSummariesCache.length > items.length) {
    const more = document.createElement('li');
    more.className = 'thread-result-more';
    more.textContent = `共 ${threadSummariesCache.length} 个帖子，输入关键词搜索更多`;
    ul.appendChild(more);
  }
}

function renderThreadPicker(lib) {
  const bar = $('thread_bar');
  const openLink = $('thread_open_x');
  const totalEl = $('thread_total');
  const viewAllBtn = $('thread_view_all');
  if (!bar) return;

  const summaries = buildThreadSummaries(lib);
  threadSummariesCache = summaries;

  if (summaries.length === 0) {
    bar.hidden = true;
    selectedThreadId = null;
    return;
  }

  bar.hidden = false;
  if (selectedThreadId && !summaries.some((s) => s.id === selectedThreadId)) {
    selectedThreadId = pickDefaultThreadId(lib);
  }

  if (totalEl) {
    totalEl.textContent = `共 ${summaries.length} 个`;
  }

  const current = selectedThreadId
    ? summaries.find((s) => s.id === selectedThreadId) || null
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
  if (selectedThreadId) {
    try {
      await chrome.storage.session.set({
        [XCF.SESSION.OPTIONS_THREAD]: selectedThreadId
      });
    } catch {
      /* options 页扩展重载时可忽略 */
    }
  }
  try {
    const threadPart = selectedThreadId ? `/thread/${selectedThreadId}` : '';
    history.replaceState(null, '', `#${activeTab}${threadPart}`);
  } catch {
    /* ignore */
  }
  if (libraryCache) renderAll(libraryCache);
}

function isReadableRow(row) {
  return true;
}

function getReadItems(lib) {
  const rows = selectedThreadId
    ? threadRows(lib, selectedThreadId, { blocked: false, lane: 'signal' })
    : allSignalRows(lib);
  return dedupeReadRows(rows.filter(isReadableRow));
}

function renderReadFeed(lib) {
  const items = getReadItems(lib);
  const threadRoots = lib.threadRoots || {};

  $('tab_read_count').textContent = String(items.length);
  $('tab_signal_count').textContent = String(
    selectedThreadId
      ? getReadItems(lib).length
      : allSignalRows(lib).length
  );

  const feed = $('read_feed');
  feed.textContent = '';
  feed.className = 'read-feed read-feed-plain';
  $('read_empty').hidden = items.length > 0;

  const summary = items.length > 0 ? `${items.length} 条非噪音` : '';
  $('read_summary').textContent = summary;

  if (items.length === 0) return;

  const doc = document.createElement('div');
  doc.className = 'read-plain';

  if (selectedThreadId) {
    const root = threadRoots[selectedThreadId] || null;
    if (root && (root.text || '').trim()) {
      const rootP = document.createElement('p');
      rootP.className = 'read-root';
      rootP.textContent = root.text.trim();
      doc.appendChild(rootP);
      const sep = document.createElement('div');
      sep.className = 'read-sep';
      sep.setAttribute('aria-hidden', 'true');
      doc.appendChild(sep);
    }

    items.forEach((row, i) => {
      if (i > 0) {
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

  // 未选帖子时：按 thread 分组（兼容旧行为）
  const groups = new Map();
  for (const row of items) {
    const k =
      row.threadId ||
      (row.pageUrl || '').match(/\/status\/(\d+)/)?.[1] ||
      normPageKey(row.pageUrl || '');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }

  const orderedKeys = Array.from(groups.keys());
  orderedKeys.sort((a, b) => {
    const aa = groups.get(a);
    const bb = groups.get(b);
    const ta = Math.min(...aa.map((x) => x.at || 0));
    const tb = Math.min(...bb.map((x) => x.at || 0));
    return ta - tb;
  });

  let firstGroup = true;
  for (const k of orderedKeys) {
    const rows = groups.get(k).slice().sort((a, b) => (a.at || 0) - (b.at || 0));
    if (!firstGroup) {
      const gap = document.createElement('div');
      gap.className = 'read-group-gap';
      doc.appendChild(gap);
    }
    firstGroup = false;

    const root = threadRoots[k] || threadRoots[normPageKey(k)] || null;
    if (root && (root.text || '').trim()) {
      const rootP = document.createElement('p');
      rootP.className = 'read-root';
      rootP.textContent = root.text.trim();
      doc.appendChild(rootP);
      const sep = document.createElement('div');
      sep.className = 'read-sep';
      sep.setAttribute('aria-hidden', 'true');
      doc.appendChild(sep);
    }

    rows.forEach((row, i) => {
      if (i > 0) {
        const sep = document.createElement('div');
        sep.className = 'read-sep';
        sep.setAttribute('aria-hidden', 'true');
        doc.appendChild(sep);
      }
      const block = document.createElement('p');
      block.className = 'read-comment';
      const t = (row.text || '').trim();
      block.textContent = t || '（未保存正文：可能是当时 X 尚未渲染完成，建议回到原帖重新触发一次过滤）';
      doc.appendChild(block);

      const meta = document.createElement('div');
      meta.className = 'read-meta-inline';
      const who = row.handle ? '@' + String(row.handle).replace(/^@/, '') : '@未知';
      const when = displayTime(row);
      meta.textContent = when ? `${who} · ${when}` : who;
      doc.appendChild(meta);
    });
  }

  feed.appendChild(doc);
}

function appendReadComment(doc, row) {
  const block = document.createElement('p');
  block.className = 'read-comment read-signal';
  const t = (row.text || '').trim();
  block.textContent =
    t || '（未保存正文：可能是当时 X 尚未渲染完成，请回到原帖等待扫描完成）';
  doc.appendChild(block);

  const meta = document.createElement('div');
  meta.className = 'read-meta-inline';
  const who = row.handle ? '@' + String(row.handle).replace(/^@/, '') : '@未知';
  const when = displayTime(row);
  meta.textContent = when ? `${who} · ${when}` : who;
  doc.appendChild(meta);
}

function renderBlocklist(handles) {
  const ul = $('blocklist');
  ul.textContent = '';
  $('tab_block_count').textContent = String(handles.length);
  $('block_empty').hidden = handles.length > 0;

  for (const h of handles) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'row-head';
    const name = document.createElement('span');
    name.className = 'handle';
    name.textContent = '@' + h;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-sm ghost';
    btn.textContent = '取消屏蔽';
    btn.addEventListener('click', async () => {
      await send(XCF.MSG.UNBLOCK_HANDLE, { handle: h });
      await refresh();
    });
    row.appendChild(name);
    row.appendChild(btn);
    li.appendChild(row);
    ul.appendChild(li);
  }
}

function buildEntryRow(row, actions) {
  const li = document.createElement('li');
  const head = document.createElement('div');
  head.className = 'row-head';

  const body = document.createElement('div');
  const handle = document.createElement('span');
  handle.className = 'handle';
  handle.textContent = row.handle ? '@' + row.handle : '@未知';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${displayTime(row)} · ${row.reason || row.ruleId || ''}`;
  body.appendChild(handle);
  body.appendChild(meta);

  if (row.displayName) {
    const dn = document.createElement('div');
    dn.className = 'meta';
    dn.textContent = row.displayName;
    body.appendChild(dn);
  }
  if (row.text) {
    const p = document.createElement('p');
    p.className = 'text';
    p.textContent = row.text;
    body.appendChild(p);
  }
  if (row.pageUrl) {
    const a = document.createElement('a');
    a.className = 'link';
    a.href = row.pageUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '来源帖子';
    body.appendChild(a);
  }

  const act = document.createElement('div');
  act.className = 'actions';
  for (const btn of actions) act.appendChild(btn);

  head.appendChild(body);
  head.appendChild(act);
  li.appendChild(head);
  return li;
}

function renderSignalList(rows) {
  const ul = $('signal_list');
  if (!ul) return;
  ul.textContent = '';
  $('signal_empty').hidden = rows.length > 0;

  for (const row of rows) {
    const blockBtn = document.createElement('button');
    blockBtn.type = 'button';
    blockBtn.className = 'btn-sm warn';
    blockBtn.textContent = '确认屏蔽';
    blockBtn.title = '标为噪音，移入已确认，并将账号加入屏蔽名单';
    blockBtn.addEventListener('click', async () => {
      await send(XCF.MSG.BLOCK_ARCHIVE_ENTRY, { id: row.id });
      await refresh();
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-sm ghost';
    cancelBtn.textContent = '取消分类';
    cancelBtn.title = '从记录中移除，并在帖子页展开（若仍打开）';
    cancelBtn.addEventListener('click', async () => {
      await send(XCF.MSG.UNCLASSIFY_ENTRY, { id: row.id });
      await refresh();
    });
    ul.appendChild(buildEntryRow(row, [cancelBtn, blockBtn]));
  }
}

function renderNoiseList(rows) {
  const ul = $('archive');
  ul.textContent = '';
  $('tab_archive_count').textContent = String(rows.length);
  $('archive_empty').hidden = rows.length > 0;

  for (const row of rows) {
    const blockBtn = document.createElement('button');
    blockBtn.type = 'button';
    blockBtn.className = 'btn-sm warn';
    blockBtn.textContent = '确认屏蔽';
    blockBtn.addEventListener('click', async () => {
      await send(XCF.MSG.BLOCK_ARCHIVE_ENTRY, { id: row.id });
      await refresh();
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-sm ghost';
    cancelBtn.textContent = '取消分类';
    cancelBtn.title = '从噪音记录移除，并在帖子页展开';
    cancelBtn.addEventListener('click', async () => {
      await send(XCF.MSG.UNCLASSIFY_ENTRY, { id: row.id });
      await refresh();
    });
    ul.appendChild(buildEntryRow(row, [cancelBtn, blockBtn]));
  }
}

function renderBlockedReplies(rows) {
  const ul = $('blocked_replies');
  ul.textContent = '';
  $('tab_blocked_count').textContent = String(rows.length);
  $('blocked_empty').hidden = rows.length > 0;

  for (const row of rows) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-sm ghost';
    cancelBtn.textContent = '取消分类';
    cancelBtn.addEventListener('click', async () => {
      await send(XCF.MSG.UNCLASSIFY_ENTRY, { id: row.id });
      await refresh();
    });
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'btn-sm ghost';
    restoreBtn.textContent = '移回噪音';
    restoreBtn.addEventListener('click', async () => {
      await send(XCF.MSG.RESTORE_ARCHIVE_ENTRY, { id: row.id });
      await refresh();
    });
    ul.appendChild(buildEntryRow(row, [cancelBtn, restoreBtn]));
  }
}

function renderKeywords(keywords, rules) {
  const list = keywords || [];
  $('keywords_input').value = list.join('\n');
  $('tab_keywords_count').textContent = String(list.length);
  if ($('rule_text_keywords')) {
    $('rule_text_keywords').checked = rules?.text_keywords !== false;
  }
}

function updateStorageHint(lib) {
  const accounts = lib.blocklist?.length || 0;
  const kws = lib.textKeywords?.length || 0;
  const nickKws = lib.nicknameSpamKeywords?.length || 0;
  const st = lib.stats;
  const noiseRows = rowsForView(lib, { blocked: false, lane: 'noise' });
  const signalRows = selectedThreadId
    ? getReadItems(lib)
    : rowsForView(lib, { blocked: false, lane: 'signal' });
  const confirmedRows = rowsForView(lib, { blocked: true, lane: 'noise' });
  let msg = `非噪音 ${signalRows.length} 条 · 噪音 ${noiseRows.length} 条 · 已确认 ${confirmedRows.length} 条 · 账号 ${accounts} 个 · 正文关键词 ${kws} 个 · 引流昵称 ${nickKws} 个。`;
  if (selectedThreadId) msg += ` 当前帖子 ${selectedThreadId}。`;
  if (st && st.removed > 0) {
    msg += ` 已从 ${st.before} 条合并去重，删除重复 ${st.removed} 条。`;
  }
  $('storage_hint').textContent = msg;
}

function renderAll(lib) {
  renderThreadPicker(lib);
  renderReadFeed(lib);
  renderBlocklist(lib.blocklist || []);
  renderWhitelist(lib.whitelist || []);
  renderSignalList(
    selectedThreadId
      ? getReadItems(lib)
      : rowsForView(lib, { blocked: false, lane: 'signal' })
  );
  renderNoiseList(rowsForView(lib, { blocked: false, lane: 'noise' }));
  renderBlockedReplies(rowsForView(lib, { blocked: true, lane: 'noise' }));
  renderKeywords(lib.textKeywords || [], lib.rules);
  renderDisplayNameKeywords(lib.displayNameKeywords || [], lib.rules);
  renderKeywordTextarea(
    'nickname_spam_keywords_input',
    lib.nicknameSpamKeywords,
    'rule_nickname_spam',
    'nickname_spam',
    lib.rules
  );
  renderKeywordTextarea(
    'emoji_spam_keywords_input',
    lib.emojiSpamKeywords,
    'rule_emoji_spam',
    'emoji_spam',
    lib.rules
  );
  renderKeywordTextarea(
    'mention_spam_keywords_input',
    lib.mentionSpamKeywords,
    'rule_mention_spam',
    'mention_spam',
    lib.rules
  );
  updateStorageHint(lib);
}

async function refresh() {
  const lib = await send(XCF.MSG.GET_LIBRARY);
  if (!lib) return;
  const hashThread = parseHashThreadId();
  if (hashThread) {
    selectedThreadId = hashThread;
    threadViewAll = false;
  } else if (!threadViewAll && selectedThreadId == null) {
    selectedThreadId = pickDefaultThreadId(lib) || null;
  }
  libraryCache = lib;
  renderAll(lib);
}

function renderWhitelist(handles) {
  const ul = $('whitelist');
  if (!ul) return;
  ul.textContent = '';
  $('whitelist_empty').hidden = (handles || []).length > 0;
  for (const h of handles || []) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'row-head';
    const name = document.createElement('span');
    name.className = 'handle';
    name.textContent = '@' + h;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-sm ghost';
    btn.textContent = '移出白名单';
    btn.addEventListener('click', async () => {
      // whitelist 是 settings.rules 的保护名单：移除即允许再次按规则过滤
      const cur = await send(XCF.MSG.GET_SETTINGS);
      const next = (cur?.whitelist || []).map((x) => String(x).replace(/^@/, '').toLowerCase());
      const filtered = next.filter((x) => x !== String(h).replace(/^@/, '').toLowerCase());
      await send(XCF.MSG.SAVE_SETTINGS, { partial: { whitelist: filtered } });
      await refresh();
    });
    row.appendChild(name);
    row.appendChild(btn);
    li.appendChild(row);
    ul.appendChild(li);
  }
}

function renderDisplayNameKeywords(list, rules) {
  renderKeywordTextarea(
    'display_name_keywords_input',
    list,
    'rule_display_name_keywords',
    'display_name_keywords',
    rules
  );
}

$('btn_compact').addEventListener('click', async () => {
  const res = await send(XCF.MSG.COMPACT_ARCHIVE);
  const removed = res?.stats?.removed || 0;
  if (removed > 0) {
    alert(`已合并重复 ${removed} 条（${res.stats.before} → ${res.stats.after}）。`);
  } else {
    alert('没有发现重复记录。');
  }
  await refresh();
});

$('btn_export').addEventListener('click', async () => {
  const data = await send(XCF.MSG.EXPORT_DATA);
  if (data) downloadJson(data);
});

$('btn_clear_archive').addEventListener('click', async () => {
  if (!confirm('清空「噪音」记录？「已确认噪音」与已屏蔽账号会保留。')) return;
  await send(XCF.MSG.CLEAR_ARCHIVE);
  await refresh();
});

$('btn_save_keywords').addEventListener('click', async () => {
  const unique = [...new Set(parseLines($('keywords_input').value))];
  const rules = { text_keywords: $('rule_text_keywords').checked };
  await send(XCF.MSG.SAVE_SETTINGS, {
    partial: { textKeywords: unique, rules }
  });
  const hint = $('keywords_save_hint');
  hint.hidden = false;
  clearTimeout(hint._t);
  hint._t = setTimeout(() => {
    hint.hidden = true;
  }, 2000);
  await refresh();
});

$('rule_text_keywords').addEventListener('change', async () => {
  await send(XCF.MSG.SAVE_SETTINGS, {
    partial: { rules: { text_keywords: $('rule_text_keywords').checked } }
  });
});

$('rule_display_name_keywords')?.addEventListener('change', async () => {
  await send(XCF.MSG.SAVE_SETTINGS, {
    partial: { rules: { display_name_keywords: $('rule_display_name_keywords').checked } }
  });
});

$('btn_save_display_name_keywords')?.addEventListener('click', () =>
  saveKeywordPanel({
    inputId: 'display_name_keywords_input',
    hintId: 'display_name_keywords_save_hint',
    settingsKey: 'displayNameKeywords',
    ruleKey: 'display_name_keywords',
    ruleCheckboxId: 'rule_display_name_keywords'
  })
);

$('btn_save_nickname_spam_keywords')?.addEventListener('click', () =>
  saveKeywordPanel({
    inputId: 'nickname_spam_keywords_input',
    hintId: 'nickname_spam_keywords_save_hint',
    settingsKey: 'nicknameSpamKeywords',
    ruleKey: 'nickname_spam',
    ruleCheckboxId: 'rule_nickname_spam'
  })
);

$('btn_save_emoji_spam_keywords')?.addEventListener('click', () =>
  saveKeywordPanel({
    inputId: 'emoji_spam_keywords_input',
    hintId: 'emoji_spam_keywords_save_hint',
    settingsKey: 'emojiSpamKeywords',
    ruleKey: 'emoji_spam',
    ruleCheckboxId: 'rule_emoji_spam'
  })
);

$('btn_save_mention_spam_keywords')?.addEventListener('click', () =>
  saveKeywordPanel({
    inputId: 'mention_spam_keywords_input',
    hintId: 'mention_spam_keywords_save_hint',
    settingsKey: 'mentionSpamKeywords',
    ruleKey: 'mention_spam',
    ruleCheckboxId: 'rule_mention_spam'
  })
);

for (const [checkboxId, ruleKey] of [
  ['rule_nickname_spam', 'nickname_spam'],
  ['rule_emoji_spam', 'emoji_spam'],
  ['rule_mention_spam', 'mention_spam']
]) {
  $(checkboxId)?.addEventListener('change', async () => {
    await send(XCF.MSG.SAVE_SETTINGS, {
      partial: { rules: { [ruleKey]: $(checkboxId).checked } }
    });
  });
}

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

$('thread_search')?.addEventListener('focus', () => {
  showThreadResults();
});

$('thread_search')?.addEventListener('input', (e) => {
  clearTimeout(threadSearchTimer);
  threadSearchTimer = setTimeout(() => {
    renderThreadResults(e.target.value || '');
    showThreadResults();
  }, 120);
});

$('thread_search')?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideThreadResults();
    e.target.blur();
  }
});

document.addEventListener('click', (e) => {
  const box = $('thread_combobox');
  if (!box || box.contains(e.target)) return;
  hideThreadResults();
});

window.xcfActivateTab = switchTab;

initTabs();
refresh();
