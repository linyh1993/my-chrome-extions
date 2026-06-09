const $ = (id) => document.getElementById(id);

const PREVIEW_THREAD_SESSION_KEY = 'xsuite_read_preview_thread';
const THREAD_RECENT_LIMIT = 15;
const THREAD_RESULTS_LIMIT = 40;

let libraryCache = null;
let selectedThreadId = null;
let threadSummariesCache = [];
let threadSearchTimer = null;
let threadViewAll = false;
let exportSettingsCache = null;
let exportDirectoryHandle = null;
let exportSaveTimer = null;
let exportStatusTimer = null;
let selectedThreadPageUrl = '';
let threadActionStatusTimer = null;
let threadClearBusy = false;
let threadFollowUpRefreshTimers = [];

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

function isoTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toISOString();
  } catch {
    return '';
  }
}

function normText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
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

function resolveThreadKey(row) {
  return (
    row?.threadId ||
    (row?.pageUrl || '').match(/\/status\/(\d+)/)?.[1] ||
    normPageKey(row?.pageUrl || '')
  );
}

function buildThreadSummaries(lib) {
  const byThread = lib.archiveByThread || {};
  const roots = lib.threadRoots || {};
  const ids = new Set([...Object.keys(byThread), ...Object.keys(roots)]);

  return Array.from(ids)
    .map((id) => {
      const rows = byThread[id] || [];
      const root = roots[id] || null;
      const preview = (root?.text || rows.find((row) => row.text)?.text || '').trim();
      const handle = root?.handle ? `@${String(root.handle).replace(/^@/, '')}` : '';
      const labelCore = preview ? preview.slice(0, 42) : `帖子 ${id}`;
      const label = handle ? `${handle} · ${labelCore}` : labelCore;
      const latestAt = Math.max(root?.at || 0, ...rows.map((row) => row.at || 0));
      const pageUrl = root?.pageUrl || rows.find((row) => row.pageUrl)?.pageUrl || '';
      return { id, label, latestAt, pageUrl };
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
  return item.label;
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
    current.textContent = '全部帖子（按时间合并展示）';
    current.title = '未限定单一帖子';
    return;
  }
  current.textContent = formatThreadLabel(item);
  current.title = item.pageUrl || item.id;
}

function displayedRootText(_threadId, root) {
  return cleanText(root?.text);
}

function displayedRowText(row) {
  return cleanText(row?.text);
}

function setThreadActionStatus(message, tone = 'success', autoHide = false) {
  const el = $('thread_action_status');
  if (!el) return;
  clearTimeout(threadActionStatusTimer);
  el.hidden = false;
  el.textContent = message;
  el.className = `thread-action-status is-${tone}`;
  if (autoHide) {
    threadActionStatusTimer = setTimeout(() => {
      el.hidden = true;
    }, 2600);
  }
}

function clearThreadActionStatus() {
  const el = $('thread_action_status');
  if (!el) return;
  clearTimeout(threadActionStatusTimer);
  el.hidden = true;
  el.textContent = '';
  el.className = 'thread-action-status';
}

function buildPendingThreadItem(threadId) {
  if (!threadId) return null;
  return {
    id: threadId,
    label: `帖子 ${threadId}（等待重新抓取）`,
    latestAt: 0,
    pageUrl: selectedThreadPageUrl || ''
  };
}

function clearFollowUpRefreshTimers() {
  for (const timerId of threadFollowUpRefreshTimers) {
    clearTimeout(timerId);
  }
  threadFollowUpRefreshTimers = [];
}

function scheduleFollowUpRefreshes() {
  clearFollowUpRefreshTimers();
  for (const delay of [1800, 4200]) {
    const timerId = setTimeout(() => {
      threadFollowUpRefreshTimers = threadFollowUpRefreshTimers.filter((id) => id !== timerId);
      refresh();
    }, delay);
    threadFollowUpRefreshTimers.push(timerId);
  }
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
  }
}

function renderThreadPicker(lib) {
  const bar = $('thread_bar');
  const total = $('thread_total');
  const openLink = $('thread_open_x');
  const viewAllBtn = $('thread_view_all');
  const clearBtn = $('thread_clear_current');
  if (!bar) return;

  const summaries = buildThreadSummaries(lib);
  threadSummariesCache = summaries;

  if (!summaries.length) {
    if (selectedThreadId && !threadViewAll) {
      bar.hidden = false;
      renderThreadCurrent(buildPendingThreadItem(selectedThreadId));
      if (clearBtn) {
        clearBtn.hidden = false;
        clearBtn.disabled = threadClearBusy;
      }
      if (openLink) {
        openLink.href = selectedThreadPageUrl || '#';
        openLink.hidden = !selectedThreadPageUrl;
      }
      if (viewAllBtn) {
        viewAllBtn.hidden = false;
      }
    } else {
      bar.hidden = true;
      selectedThreadId = null;
      threadViewAll = false;
      selectedThreadPageUrl = '';
      clearThreadActionStatus();
      renderThreadCurrent(null);
    }
    return;
  }

  bar.hidden = false;

  if (total) {
    total.textContent = '';
    total.hidden = true;
  }

  const resolvedCurrent = selectedThreadId
    ? summaries.find((item) => item.id === selectedThreadId) || null
    : null;
  const current = resolvedCurrent || (selectedThreadId && !threadViewAll
    ? buildPendingThreadItem(selectedThreadId)
    : null);
  if (resolvedCurrent?.pageUrl) selectedThreadPageUrl = resolvedCurrent.pageUrl;
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

  if (clearBtn) {
    clearBtn.hidden = !selectedThreadId || threadViewAll;
    clearBtn.disabled = threadClearBusy;
  }

  const search = $('thread_search');
  if (search && document.activeElement !== search) {
    renderThreadResults(search.value || '');
  }
}

async function setSelectedThread(threadId) {
  selectedThreadId = threadId || null;
  threadViewAll = !threadId;
  if (!threadId) {
    selectedThreadPageUrl = '';
    clearFollowUpRefreshTimers();
    clearThreadActionStatus();
  } else {
    const current = threadSummariesCache.find((item) => item.id === threadId) || null;
    if (current?.pageUrl) selectedThreadPageUrl = current.pageUrl;
  }
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

function countMediaEntries(mediaList) {
  return (Array.isArray(mediaList) ? mediaList : []).filter((item) => mediaTarget(item)).length;
}

function renderStats(lib) {
  const viewMode = $('stat_view_mode');
  const threadCount = $('stat_thread_count');
  const replyCount = $('stat_reply_count');
  const mediaCount = $('stat_media_count');
  if (!viewMode || !threadCount || !replyCount || !mediaCount) return;

  const items = getReadItems(lib);
  const visibleThreadIds = new Set();
  let visibleMediaCount = 0;

  if (selectedThreadId) {
    visibleThreadIds.add(selectedThreadId);
    visibleMediaCount += countMediaEntries(lib.threadRoots?.[selectedThreadId]?.media);
  }

  for (const row of items) {
    const key = resolveThreadKey(row);
    if (key) visibleThreadIds.add(key);
    visibleMediaCount += countMediaEntries(row.media);
  }

  if (!selectedThreadId) {
    for (const key of visibleThreadIds) {
      const root = lib.threadRoots?.[key] || lib.threadRoots?.[normPageKey(key)] || null;
      visibleMediaCount += countMediaEntries(root?.media);
    }
  }

  viewMode.textContent = selectedThreadId ? '单帖阅读' : '全部帖子';
  threadCount.textContent = String(visibleThreadIds.size);
  replyCount.textContent = String(items.length);
  mediaCount.textContent = String(visibleMediaCount);
}

function appendReadComment(container, row) {
  const block = document.createElement('p');
  block.className = 'read-comment read-signal';
  const text = displayedRowText(row);
  block.textContent = text || '（未保存正文；请回到原帖等待采集完成后再刷新）';
  container.appendChild(block);

  const meta = document.createElement('div');
  meta.className = 'read-meta-inline';
  const who = row.handle ? `@${String(row.handle).replace(/^@/, '')}` : '@未知';
  const when = fmtTime(row?.tweetAt || row?.at);
  meta.textContent = when ? `${who} · ${when}` : who;
  container.appendChild(meta);
  appendReadAttachments(container, row);
}

function appendReadAttachments(container, item) {
  const media = Array.isArray(item?.media) ? item.media.filter((entry) => mediaTarget(entry)) : [];
  const references = Array.isArray(item?.references) ? item.references : [];
  if (!media.length && !references.length) return;

  const wrap = document.createElement('div');
  wrap.className = 'read-attachments';

  for (const entry of media) {
    const target = mediaTarget(entry);
    if (!target) continue;
    if (entry.type === 'image') {
      const img = document.createElement('img');
      img.className = 'read-attachment-image';
      img.src = target;
      img.alt = entry.alt || 'image';
      img.loading = 'lazy';
      wrap.appendChild(img);
      continue;
    }
    const link = document.createElement('a');
    link.className = 'read-attachment-link';
    link.href = target;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = `${mediaLabel(entry)}: ${target}`;
    wrap.appendChild(link);
  }

  for (const ref of references) {
    const refBlock = document.createElement('div');
    refBlock.className = 'read-reference';

    const title = document.createElement('p');
    title.className = 'read-reference-title';
    title.textContent = ref.title || referenceLabel(ref);
    refBlock.appendChild(title);

    if (ref.url) {
      const link = document.createElement('a');
      link.className = 'read-attachment-link';
      link.href = ref.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = ref.url;
      refBlock.appendChild(link);
    }

    if (cleanText(ref.text)) {
      const body = document.createElement('p');
      body.className = 'read-reference-body';
      body.textContent = cleanText(ref.text);
      refBlock.appendChild(body);
    }

    wrap.appendChild(refBlock);
  }

  container.appendChild(wrap);
}

function renderReadFeed(lib) {
  const items = getReadItems(lib);
  const threadRoots = lib.threadRoots || {};
  const feed = $('read_feed');
  feed.textContent = '';
  feed.className = 'read-feed read-feed-plain';
  $('read_empty').hidden = items.length > 0;
  $('read_summary').textContent = selectedThreadId ? '当前帖子阅读' : '全部帖子阅读';

  const currentRoot = selectedThreadId ? threadRoots[selectedThreadId] || null : null;
  const currentAuthor = currentRoot?.handle
    ? `@${String(currentRoot.handle).replace(/^@/, '')}`
    : '';
  const currentTime = fmtTime(currentRoot?.tweetAt || currentRoot?.at);
  $('thread_caption').textContent = currentAuthor || currentTime
    ? [currentAuthor, currentTime].filter(Boolean).join(' · ')
    : selectedThreadId
      ? `帖子 ${selectedThreadId}`
      : '按帖子分组的合并阅读';

  if (!items.length) return;

  const doc = document.createElement('div');
  doc.className = 'read-plain';

  if (selectedThreadId) {
    const root = threadRoots[selectedThreadId] || null;
    const rootTextValue = displayedRootText(selectedThreadId, root);
    if (root && rootTextValue) {
      const rootText = document.createElement('p');
      rootText.className = 'read-root';
      rootText.textContent = rootTextValue;
      doc.appendChild(rootText);
      appendReadAttachments(doc, root);

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
    const key = resolveThreadKey(row);
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
    const rootTextValue = displayedRootText(key, root);
    if (root && rootTextValue) {
      const rootText = document.createElement('p');
      rootText.className = 'read-root';
      rootText.textContent = rootTextValue;
      doc.appendChild(rootText);
      appendReadAttachments(doc, root);

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

function renderPageHint() {
  $('page_hint').textContent = selectedThreadId
    ? '单帖模式：展示主贴和当前帖子的非噪音回复，并可直接导出 Markdown。'
    : '合并模式：按帖子分组展示所有已采集的非噪音回复，并可直接导出 Markdown。';
}

function renderAll(lib) {
  renderThreadPicker(lib);
  renderStats(lib);
  renderReadFeed(lib);
  renderPageHint();
}

function renderMetaRows(properties) {
  const list = $('export_meta_list');
  if (!list) return;
  list.textContent = '';

  for (const item of properties || []) {
    const row = document.createElement('div');
    row.className = 'export-meta-row';

    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'export-input export-meta-key';
    keyInput.placeholder = 'key';
    keyInput.value = item.key || '';

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'export-input export-meta-value';
    valueInput.placeholder = '{{title}}';
    valueInput.value = item.value || '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'export-meta-remove';
    removeBtn.textContent = '删';
    removeBtn.setAttribute('aria-label', `删除属性 ${item.key || ''}`.trim());

    row.appendChild(keyInput);
    row.appendChild(valueInput);
    row.appendChild(removeBtn);
    list.appendChild(row);
  }

  if (!list.children.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = '暂无属性；点击 Add property 添加 frontmatter 字段。';
    list.appendChild(empty);
  }
}

function renderExportSettings() {
  if (!exportSettingsCache) return;
  $('export_note_location').value = exportSettingsCache.noteLocation || '';
  $('export_filename_template').value = exportSettingsCache.fileNameTemplate || '';
  renderMetaRows(exportSettingsCache.properties || []);
}

function updateDirectoryStatus() {
  const el = $('export_dir_status');
  if (!el) return;
  if (!('showDirectoryPicker' in window)) {
    el.textContent = '当前浏览器环境不支持目录写入。';
    el.className = 'export-dir-status is-muted';
    return;
  }
  if (!exportDirectoryHandle) {
    el.textContent = '未选择导出目录';
    el.className = 'export-dir-status is-muted';
    return;
  }
  el.textContent = `当前目录：${exportDirectoryHandle.name}`;
  el.className = 'export-dir-status';
}

function setExportStatus(message, tone = 'success', autoHide = false) {
  const el = $('export_status');
  if (!el) return;
  clearTimeout(exportStatusTimer);
  el.hidden = false;
  el.textContent = message;
  el.className = `export-status is-${tone}`;
  if (autoHide) {
    exportStatusTimer = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }
}

function readMetaRowsFromDom() {
  return Array.from(document.querySelectorAll('.export-meta-row'))
    .map((row) => ({
      key: row.querySelector('.export-meta-key')?.value || '',
      value: row.querySelector('.export-meta-value')?.value || ''
    }))
    .filter((item) => item.key.trim() || item.value.trim());
}

function readExportSettingsFromDom() {
  return {
    noteLocation: $('export_note_location')?.value || '',
    fileNameTemplate: $('export_filename_template')?.value || '',
    properties: readMetaRowsFromDom()
  };
}

async function persistExportSettings() {
  exportSettingsCache = await MarkdownExportSettings.save(readExportSettingsFromDom());
  return exportSettingsCache;
}

function scheduleExportSettingsSave() {
  clearTimeout(exportSaveTimer);
  exportSaveTimer = setTimeout(async () => {
    await persistExportSettings();
    setExportStatus('导出配置已保存。', 'success', true);
  }, 180);
}

function addMetaPropertyRow() {
  const next = readMetaRowsFromDom();
  next.push({ key: '', value: '' });
  exportSettingsCache = MarkdownExportSettings.normalize({
    ...exportSettingsCache,
    properties: next
  });
  renderMetaRows(exportSettingsCache.properties);
  persistExportSettings().catch(() => {});
}

function removeMetaPropertyRow(button) {
  const row = button.closest('.export-meta-row');
  if (!row) return;
  row.remove();
  persistExportSettings()
    .then((next) => {
      exportSettingsCache = next;
      renderMetaRows(exportSettingsCache.properties);
      setExportStatus('属性已更新。', 'success', true);
    })
    .catch(() => {
      setExportStatus('属性保存失败。', 'error');
    });
}

function sanitizeSegment(input, fallback = 'untitled') {
  const cleaned = String(input || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned || fallback;
}

function renderTemplate(template, vars) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] || '') : ''
  );
}

function mediaLabel(item) {
  const type = String(item?.type || '').trim().toLowerCase();
  if (type === 'image') return '图片';
  if (type === 'video') return '视频';
  if (type === 'audio') return '音频';
  return '媒体';
}

function mediaTarget(item) {
  return String(item?.src || item?.pageUrl || item?.poster || '').trim();
}

function appendMediaMarkdown(chunks, mediaList) {
  const media = Array.isArray(mediaList) ? mediaList : [];
  if (!media.length) return;

  chunks.push('#### 媒体');
  for (const item of media) {
    const target = mediaTarget(item);
    if (!target) continue;
    if (item.type === 'image') {
      chunks.push(`![](${target})`);
      continue;
    }
    if (item.poster) {
      chunks.push(`![](${item.poster})`);
    }
    chunks.push(`- ${mediaLabel(item)}：${target}`);
  }
}

function referenceLabel(item) {
  if (item?.type === 'quote_tweet') return '引用帖子';
  if (item?.type === 'external_card') return '外部卡片';
  return '引用';
}

function appendReferencesMarkdown(chunks, references) {
  const refs = Array.isArray(references) ? references : [];
  if (!refs.length) return;

  chunks.push('#### 引用');
  for (const item of refs) {
    const title = String(item?.title || '').trim();
    const text = cleanText(item?.text);
    const url = String(item?.url || '').trim();
    chunks.push(`- ${title || referenceLabel(item)}${url ? `: ${url}` : ''}`);
    if (text) {
      chunks.push(text);
    }
  }
}

function appendReplyMarkdown(chunks, row) {
  const who = row.handle ? `@${String(row.handle).replace(/^@/, '')}` : '@未知';
  const when = fmtTime(row?.tweetAt || row?.at);
  chunks.push(`### ${who}${when ? ` 路 ${when}` : ''}`);
  chunks.push(displayedRowText(row) || '（未保存正文）');
  appendMediaMarkdown(chunks, row.media);
  appendReferencesMarkdown(chunks, row.references);
}

function appendReplySection(chunks, title, rows) {
  const list = Array.isArray(rows) ? rows.slice().sort((a, b) => (a.at || 0) - (b.at || 0)) : [];
  if (!list.length) return;
  chunks.push(`## ${title}`);
  list.forEach((row) => {
    appendReplyMarkdown(chunks, row);
  });
}

function buildSingleThreadMarkdown(root, items) {
  const chunks = [];
  const rootBodyText = displayedRootText(selectedThreadId, root);
  if (rootBodyText) {
    chunks.push('## 原帖');
    chunks.push(rootBodyText);
    appendMediaMarkdown(chunks, root?.media);
    appendReferencesMarkdown(chunks, root?.references);
  }

  if (items.length) {
    chunks.push('## 回复');
  }

  items.forEach((row) => {
    const who = row.handle ? `@${String(row.handle).replace(/^@/, '')}` : '@未知';
    const when = fmtTime(row?.tweetAt || row?.at);
    chunks.push(`### ${who}${when ? ` · ${when}` : ''}`);
    chunks.push(displayedRowText(row) || '（未保存正文）');
    appendMediaMarkdown(chunks, row.media);
    appendReferencesMarkdown(chunks, row.references);
  });

  return chunks.filter(Boolean).join('\n\n');
}

function buildFullThreadMarkdown(root, { signalRows = [], noiseRows = [], confirmedRows = [] } = {}) {
  const chunks = [];
  const rootBodyText = cleanText(root?.text);
  if (rootBodyText) {
    chunks.push('## 原帖');
    chunks.push(rootBodyText);
    appendMediaMarkdown(chunks, root?.media);
    appendReferencesMarkdown(chunks, root?.references);
  }

  appendReplySection(chunks, '非噪音回复', signalRows);
  appendReplySection(chunks, '噪音回复', noiseRows);
  appendReplySection(chunks, '已确认噪音', confirmedRows);

  return chunks.filter(Boolean).join('\n\n');
}

function buildMergedMarkdown(groups) {
  const chunks = [];
  for (const group of groups) {
    chunks.push(`## ${group.heading}`);
    if (group.pageUrl) {
      chunks.push(`来源：${group.pageUrl}`);
    }
    if (cleanText(group.rootText)) {
      chunks.push(cleanText(group.rootText));
      appendMediaMarkdown(chunks, group.rootMedia);
      appendReferencesMarkdown(chunks, group.rootReferences);
    }
    group.items.forEach((row) => {
      const who = row.handle ? `@${String(row.handle).replace(/^@/, '')}` : '@未知';
      const when = fmtTime(row?.tweetAt || row?.at);
      chunks.push(`### ${who}${when ? ` · ${when}` : ''}`);
      chunks.push(displayedRowText(row) || '（未保存正文）');
      appendMediaMarkdown(chunks, row.media);
      appendReferencesMarkdown(chunks, row.references);
    });
  }
  return chunks.filter(Boolean).join('\n\n');
}

function pickThreadExportAnchor(root, signalRows, noiseRows, confirmedRows) {
  return (
    signalRows.find((row) => displayedRowText(row)) ||
    noiseRows.find((row) => displayedRowText(row)) ||
    confirmedRows.find((row) => displayedRowText(row)) ||
    signalRows[0] ||
    noiseRows[0] ||
    confirmedRows[0] ||
    root ||
    null
  );
}

function buildFullThreadExportModel(lib, threadId, exportedAt = new Date()) {
  const threadRoots = lib.threadRoots || {};
  const root = threadRoots[threadId] || threadRoots[normPageKey(threadId)] || null;
  const signalRows = threadRows(lib, threadId, { blocked: false, lane: 'signal' });
  const noiseRows = threadRows(lib, threadId, { blocked: false, lane: 'noise' });
  const confirmedRows = threadRows(lib, threadId, { blocked: true, lane: 'noise' });
  const anchor = pickThreadExportAnchor(root, signalRows, noiseRows, confirmedRows);
  const titleSeed =
    cleanText(root?.text) ||
    displayedRowText(anchor) ||
    `X Thread ${threadId}`;
  const pageUrl = root?.pageUrl || anchor?.pageUrl || '';
  const author = root?.handle
    ? `@${String(root.handle).replace(/^@/, '')}`
    : anchor?.handle
      ? `@${String(anchor.handle).replace(/^@/, '')}`
      : '';
  const publishedAt =
    root?.tweetAt || root?.at || anchor?.tweetAt || anchor?.at || null;
  const description = (
    cleanText(root?.text) ||
    displayedRowText(anchor) ||
    ''
  ).slice(0, 160);
  const body = buildFullThreadMarkdown(root, { signalRows, noiseRows, confirmedRows });
  const itemsCount = signalRows.length + noiseRows.length + confirmedRows.length;

  return {
    title: titleSeed.slice(0, 80),
    url: pageUrl,
    author,
    published: isoTime(publishedAt),
    date: exportedAt.toISOString(),
    threadId,
    description,
    view: 'thread-full',
    itemsCount: String(itemsCount),
    body
  };
}

function buildAllThreadExportModels(lib) {
  const exportedAt = new Date();
  return buildThreadSummaries(lib)
    .map((item) => buildFullThreadExportModel(lib, item.id, exportedAt))
    .filter((model) => model.body || model.url || model.description);
}

function buildExportModel(lib) {
  const items = getReadItems(lib);
  const threadRoots = lib.threadRoots || {};
  const exportedAt = new Date();

  if (selectedThreadId) {
    const root = threadRoots[selectedThreadId] || null;
    const titleSeed =
      displayedRootText(selectedThreadId, root) ||
      displayedRowText(items[0]) ||
      `X Thread ${selectedThreadId}`;
    const pageUrl = root?.pageUrl || items.find((row) => row.pageUrl)?.pageUrl || '';
    const author = root?.handle
      ? `@${String(root.handle).replace(/^@/, '')}`
      : items[0]?.handle
        ? `@${String(items[0].handle).replace(/^@/, '')}`
        : '';
    const publishedAt = root?.tweetAt || root?.at || items[0]?.tweetAt || items[0]?.at || null;
    const description = (displayedRootText(selectedThreadId, root) || displayedRowText(items[0]) || '')
      .slice(0, 160);

    return {
      title: titleSeed.slice(0, 80),
      url: pageUrl,
      author,
      published: isoTime(publishedAt),
      date: exportedAt.toISOString(),
      threadId: selectedThreadId,
      description,
      view: 'thread',
      itemsCount: String(items.length),
      body: buildSingleThreadMarkdown(root, items)
    };
  }

  const groupsMap = new Map();
  for (const row of items) {
    const key = resolveThreadKey(row);
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(row);
  }

  const groups = Array.from(groupsMap.entries()).map(([key, rows]) => {
    const root = threadRoots[key] || threadRoots[normPageKey(key)] || null;
    const headingSeed =
      displayedRootText(key, root) ||
      displayedRowText(rows[0]) ||
      `帖子 ${key}`;
    return {
      heading: headingSeed.slice(0, 80),
      pageUrl: root?.pageUrl || rows[0]?.pageUrl || '',
      rootText: displayedRootText(key, root),
      rootMedia: root?.media || [],
      rootReferences: root?.references || [],
      items: rows.slice().sort((a, b) => (a.at || 0) - (b.at || 0))
    };
  });

  return {
    title: `X 阅读导出 ${exportedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}`,
    url: '',
    author: '',
    published: '',
    date: exportedAt.toISOString(),
    threadId: 'all',
    description: (displayedRowText(items[0]) || '').slice(0, 160),
    view: 'all',
    itemsCount: String(items.length),
    body: buildMergedMarkdown(groups)
  };
}

function yamlString(value) {
  const text = String(value ?? '');
  if (!text.trim()) return '""';
  if (text.includes('\n')) {
    return `|\n${text
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}`;
  }
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildFrontmatter(settings, vars) {
  const lines = ['---'];
  for (const property of settings.properties || []) {
    const key = sanitizeSegment(property.key, '').replace(/\s+/g, '_');
    if (!key) continue;
    const value = renderTemplate(property.value, vars).trim();
    lines.push(`${key}: ${yamlString(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function buildExportVars(model) {
  return {
    title: model.title,
    url: model.url,
    source: model.url,
    author: model.author,
    published: model.published,
    date: model.date,
    threadId: model.threadId,
    description: model.description,
    view: model.view,
    itemsCount: model.itemsCount
  };
}

function splitRelativePathSegments(noteLocation, vars) {
  return renderTemplate(noteLocation, vars)
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => sanitizeSegment(part, 'untitled'));
}

async function ensureExportDirectory(rootHandle, segments) {
  let current = rootHandle;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  return current;
}

function ensureUniqueFileBase(fileBase, noteSegments, model, usedPaths) {
  if (!usedPaths) return fileBase;
  let candidate = fileBase;
  let key = [...noteSegments, `${candidate}.md`.toLowerCase()].join('/');
  if (!usedPaths.has(key)) {
    usedPaths.add(key);
    return candidate;
  }

  let index = 1;
  do {
    const suffix = index === 1 && model.threadId ? `-${model.threadId}` : `-${index + 1}`;
    candidate = sanitizeSegment(`${fileBase}${suffix}`, model.title);
    key = [...noteSegments, `${candidate}.md`.toLowerCase()].join('/');
    index += 1;
  } while (usedPaths.has(key));

  usedPaths.add(key);
  return candidate;
}

async function prepareExportState() {
  if (!libraryCache) {
    setExportStatus('当前没有可导出的内容。', 'error');
    return null;
  }
  if (!exportDirectoryHandle) {
    setExportStatus('请先选择导出目录。', 'error');
    return null;
  }

  const granted = await ReadPreviewDirectoryStore.ensureWritePermission(exportDirectoryHandle);
  if (!granted) {
    setExportStatus('目录写入权限不可用，请重新选择目录。', 'error');
    return null;
  }

  clearTimeout(exportSaveTimer);
  exportSettingsCache = MarkdownExportSettings.normalize(readExportSettingsFromDom());
  const settings = await MarkdownExportSettings.save(exportSettingsCache);
  exportSettingsCache = settings;
  return settings;
}

async function writeMarkdownModel(model, settings, usedPaths = null) {
  const vars = buildExportVars(model);
  const rawFileBase = sanitizeSegment(renderTemplate(settings.fileNameTemplate, vars), model.title);
  const noteSegments = splitRelativePathSegments(settings.noteLocation, vars);
  const fileBase = ensureUniqueFileBase(rawFileBase, noteSegments, model, usedPaths);
  const targetDir = await ensureExportDirectory(exportDirectoryHandle, noteSegments);
  const fileHandle = await targetDir.getFileHandle(`${fileBase}.md`, { create: true });
  const frontmatter = buildFrontmatter(settings, vars);
  const content = `${frontmatter}\n\n${model.body || ''}\n`;
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  return [...noteSegments, `${fileBase}.md`].join('/');
}

async function pickExportDirectory() {
  if (!('showDirectoryPicker' in window)) {
    setExportStatus('当前浏览器不支持目录授权。', 'error');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    const granted = await ReadPreviewDirectoryStore.ensureWritePermission(handle);
    if (!granted) {
      setExportStatus('目录授权被拒绝。', 'error');
      return;
    }
    await ReadPreviewDirectoryStore.set(handle);
    exportDirectoryHandle = handle;
    updateDirectoryStatus();
    setExportStatus('目录已保存。', 'success', true);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    setExportStatus(`选择目录失败：${error?.message || error}`, 'error');
  }
}

async function exportMarkdown() {
  if (!libraryCache) {
    setExportStatus('当前没有可导出的内容。', 'error');
    return;
  }
  if (!exportDirectoryHandle) {
    setExportStatus('请先选择导出目录。', 'error');
    return;
  }

  const granted = await ReadPreviewDirectoryStore.ensureWritePermission(exportDirectoryHandle);
  if (!granted) {
    setExportStatus('目录写入权限不可用，请重新选择目录。', 'error');
    return;
  }

  try {
    const model = buildExportModel(libraryCache);
    clearTimeout(exportSaveTimer);
    exportSettingsCache = MarkdownExportSettings.normalize(readExportSettingsFromDom());
    const settings = await MarkdownExportSettings.save(exportSettingsCache);
    exportSettingsCache = settings;
    const vars = {
      title: model.title,
      url: model.url,
      source: model.url,
      author: model.author,
      published: model.published,
      date: model.date,
      threadId: model.threadId,
      description: model.description,
      view: model.view,
      itemsCount: model.itemsCount
    };

    const fileBase = sanitizeSegment(renderTemplate(settings.fileNameTemplate, vars), model.title);
    const noteSegments = splitRelativePathSegments(settings.noteLocation, vars);
    const targetDir = await ensureExportDirectory(exportDirectoryHandle, noteSegments);
    const fileHandle = await targetDir.getFileHandle(`${fileBase}.md`, { create: true });
    const frontmatter = buildFrontmatter(settings, vars);
    const content = `${frontmatter}\n\n${model.body || ''}\n`;
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    const savedPath = [...noteSegments, `${fileBase}.md`].join('/');
    setExportStatus(`已导出到 ${exportDirectoryHandle.name}/${savedPath}`, 'success');
  } catch (error) {
    setExportStatus(`导出失败：${error?.message || error}`, 'error');
  }
}

async function exportAllThreadsMarkdown() {
  try {
    const settings = await prepareExportState();
    if (!settings) return;
    const models = buildAllThreadExportModels(libraryCache);
    if (!models.length) {
      setExportStatus('当前没有可批量导出的帖子。', 'error');
      return;
    }

    const usedPaths = new Set();
    for (const model of models) {
      await writeMarkdownModel(model, settings, usedPaths);
    }

    setExportStatus(`已批量导出 ${models.length} 个帖子到 ${exportDirectoryHandle.name}`, 'success');
  } catch (error) {
    setExportStatus(`批量导出失败：${error?.message || error}`, 'error');
  }
}

function currentThreadPageUrl(lib, threadId) {
  if (!threadId) return '';
  const rootUrl = lib?.threadRoots?.[threadId]?.pageUrl;
  if (rootUrl) return rootUrl;
  const summaryUrl = threadSummariesCache.find((item) => item.id === threadId)?.pageUrl;
  return summaryUrl || selectedThreadPageUrl || '';
}

async function clearCurrentThreadAndRefresh() {
  const threadId = selectedThreadId;
  if (!threadId || threadViewAll || threadClearBusy) return;

  const prompt = `确认清空帖子 ${threadId} 的已采集数据，并从当前已打开的 X 页面重新抓取吗？`;
  if (typeof window.confirm === 'function' && !window.confirm(prompt)) {
    return;
  }

  threadClearBusy = true;
  if ($('thread_clear_current')) $('thread_clear_current').disabled = true;
  setThreadActionStatus('正在清空该帖子数据，并从当前已打开的 X 页面重新抓取…', 'success');

  try {
    const pageUrl = currentThreadPageUrl(libraryCache, threadId);
    selectedThreadPageUrl = pageUrl || selectedThreadPageUrl;
    const result = await send(XCF.MSG.CLEAR_THREAD_ARCHIVE, { threadId, pageUrl });
    await persistThreadId(threadId);
    await refresh();

    if (!result?.ok) {
      setThreadActionStatus('清空帖子数据失败，请重试。', 'error');
      return;
    }

    const recapturedTabs = Number(result.recapturedTabs || 0);
    const base = `已清空帖子 ${threadId} 的数据`;
    if (recapturedTabs > 0) {
      scheduleFollowUpRefreshes();
      setThreadActionStatus(`${base}，并从 ${recapturedTabs} 个已打开的 X 页面重新抓取。`, 'success');
    } else {
      setThreadActionStatus(`${base}。未找到已打开的对应帖子页，请保持帖子页打开后再点一次。`, 'error');
    }
  } catch (error) {
    setThreadActionStatus(`清空帖子数据失败：${error?.message || error}`, 'error');
  } finally {
    threadClearBusy = false;
    if ($('thread_clear_current')) $('thread_clear_current').disabled = false;
    if (libraryCache) renderThreadPicker(libraryCache);
  }
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

  $('thread_clear_current')?.addEventListener('click', () => {
    clearCurrentThreadAndRefresh();
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

  $('btn_pick_export_dir')?.addEventListener('click', () => {
    pickExportDirectory();
  });

  $('btn_export_md')?.addEventListener('click', () => {
    exportMarkdown();
  });

  $('btn_export_all_md')?.addEventListener('click', () => {
    exportAllThreadsMarkdown();
  });

  $('export_note_location')?.addEventListener('input', scheduleExportSettingsSave);
  $('export_filename_template')?.addEventListener('input', scheduleExportSettingsSave);

  $('btn_add_meta')?.addEventListener('click', () => {
    addMetaPropertyRow();
  });

  $('export_meta_list')?.addEventListener('input', () => {
    scheduleExportSettingsSave();
  });

  $('export_meta_list')?.addEventListener('click', (event) => {
    if (!event.target.classList.contains('export-meta-remove')) return;
    removeMetaPropertyRow(event.target);
  });
}

async function initExportConfig() {
  exportSettingsCache = await MarkdownExportSettings.load();
  renderExportSettings();
  try {
    exportDirectoryHandle = await ReadPreviewDirectoryStore.get();
  } catch {
    exportDirectoryHandle = null;
  }
  updateDirectoryStatus();
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

  await initExportConfig();
  await refresh();
}

init();
