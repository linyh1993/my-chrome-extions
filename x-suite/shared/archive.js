/** @file 噪音记录：chrome.storage.local，按主推文 id 分组 */
const XcfArchive = (() => {
  const KEY = 'xcf_archive';
  const THREAD_KEY = 'xcf_thread_roots';
  const MAX_ENTRIES = 1000;

  function threadIdFromPageUrl(url) {
    const m = String(url || '').match(/\/status\/(\d+)/);
    return m ? m[1] : '';
  }

  function loadRaw() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [KEY]: {} }, (data) => resolve(data[KEY]));
    });
  }

  function saveByThread(map) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: map || {} }, () => resolve(map || {}));
    });
  }

  function normText(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function normPageUrl(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname;
    } catch {
      return String(url || '').split('?')[0];
    }
  }

  function makeId(entry) {
    const tid = String(entry.tweetId || '').trim();
    const threadId =
      String(entry.threadId || '').trim() ||
      threadIdFromPageUrl(entry.pageUrl);
    if (tid && tid !== threadId) return `tw:${tid}`;
    const h = String(entry.handle || '')
      .toLowerCase()
      .replace(/^@/, '');
    const t = normText(entry.text);
    const u = normPageUrl(entry.pageUrl);
    return `fb:${h}|${t}|${u}`;
  }

  function contentKey(row) {
    const h = String(row.handle || '')
      .toLowerCase()
      .replace(/^@/, '');
    const t = normText(row.text);
    const threadId =
      row.threadId || threadIdFromPageUrl(row.pageUrl) || '';
    return `${threadId}|${h}|${t}`;
  }

  function normalizeRow(row) {
    const isSignal = row.kind === XCF.COMMENT_KIND.SIGNAL;
    if (isSignal && row.blockedLane) {
      const copy = { ...row, blockedLane: false };
      delete copy.blockedAt;
      return copy;
    }
    return row;
  }

  function mergeRow(prev, row) {
    const pm = prev.metrics || {};
    const rm = row.metrics || {};
    const prevMedia = Array.isArray(prev.media) ? prev.media : [];
    const rowMedia = Array.isArray(row.media) ? row.media : [];
    const media = [];
    const seenMedia = new Set();
    for (const item of [...prevMedia, ...rowMedia]) {
      const type = String(item?.type || '').trim();
      const src = String(item?.src || '').trim();
      const poster = String(item?.poster || '').trim();
      const pageUrl = String(item?.pageUrl || '').trim();
      const key = `${type}|${src}|${poster}|${pageUrl}`;
      if (!type || seenMedia.has(key)) continue;
      seenMedia.add(key);
      media.push({
        type,
        src,
        poster,
        alt: String(item?.alt || '').trim(),
        pageUrl
      });
    }
    return {
      ...prev,
      ...row,
      id: row.id,
      tweetId: prev.tweetId || row.tweetId,
      threadId: prev.threadId || row.threadId,
      at: Math.max(prev.at || 0, row.at || 0),
      tweetAt: Math.max(prev.tweetAt || 0, row.tweetAt || 0) || prev.tweetAt || row.tweetAt,
      blockedLane: Boolean(prev.blockedLane || row.blockedLane),
      blockedAt: prev.blockedAt || row.blockedAt,
      kind:
        row.kind === XCF.COMMENT_KIND.NOISE || prev.kind === XCF.COMMENT_KIND.NOISE
          ? XCF.COMMENT_KIND.NOISE
          : row.kind || prev.kind || XCF.COMMENT_KIND.SIGNAL,
      media,
      metrics: {
        reply: Math.max(pm.reply || 0, rm.reply || 0),
        repost: Math.max(pm.repost || 0, rm.repost || 0),
        like: Math.max(pm.like || 0, rm.like || 0),
        view: Math.max(pm.view || 0, rm.view || 0),
        bookmark: Math.max(pm.bookmark || 0, rm.bookmark || 0)
      }
    };
  }

  function buildRow(entry) {
    const threadId =
      entry.threadId || threadIdFromPageUrl(entry.pageUrl) || '';
    return {
      id: entry.id || makeId(entry),
      at: entry.at || Date.now(),
      tweetAt: entry.tweetAt || null,
      handle: entry.handle || '',
      displayName: entry.displayName || '',
      text: (entry.text || '').slice(0, 500),
      media: Array.isArray(entry.media) ? entry.media.slice(0, 12) : [],
      tweetId: entry.tweetId || '',
      threadId,
      ruleId: entry.ruleId || '',
      reason: entry.reason || '',
      matchedKeyword: entry.matchedKeyword || '',
      pageUrl: entry.pageUrl || '',
      source: entry.source || 'auto_filter',
      kind:
        entry.kind ||
        (entry.source === 'auto_signal'
          ? XCF.COMMENT_KIND.SIGNAL
          : XCF.COMMENT_KIND.NOISE),
      metrics: entry.metrics || null,
      blockedLane: Boolean(entry.blockedLane),
      blockedAt: entry.blockedAt
    };
  }

  /** 将旧格式迁移为 { [threadId]: CommentRow[] } */
  function migrateToByThread(raw) {
    const out = {};

    const pushRow = (row) => {
      if (!row || typeof row !== 'object') return;
      const built = buildRow(row);
      const threadId = built.threadId || threadIdFromPageUrl(built.pageUrl);
      if (!threadId) return;
      // 主推文 id 与评论 tweetId 相同则不入评论列表（主贴在 thread_roots）
      if (built.tweetId && built.tweetId === threadId && !built.ruleId) return;
      if (!out[threadId]) out[threadId] = [];
      const id = built.id;
      const idx = out[threadId].findIndex((r) => r.id === id);
      if (idx >= 0) out[threadId][idx] = mergeRow(out[threadId][idx], built);
      else out[threadId].push(built);
    };

    if (Array.isArray(raw)) {
      for (const row of raw) pushRow(row);
      return out;
    }

    if (!raw || typeof raw !== 'object') return out;

    for (const [key, val] of Object.entries(raw)) {
      if (Array.isArray(val)) {
        for (const row of val) pushRow(row);
        continue;
      }
      if (val && typeof val === 'object' && val.text !== undefined) {
        const row = { ...val, threadId: val.threadId || key };
        pushRow(row);
      }
    }
    return out;
  }

  async function loadByThread() {
    const raw = await loadRaw();
    const map = migrateToByThread(raw);
    const isLegacy =
      Array.isArray(raw) ||
      (raw &&
        typeof raw === 'object' &&
        Object.values(raw).some((v) => v && !Array.isArray(v) && v.text !== undefined));
    if (isLegacy) await saveByThread(map);
    return map;
  }

  function flatten(map) {
    const rows = [];
    for (const [threadId, list] of Object.entries(map || {})) {
      if (!Array.isArray(list)) continue;
      for (const row of list) {
        rows.push({ ...row, threadId: row.threadId || threadId });
      }
    }
    return rows.sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  function dedupeThreadList(list) {
    const byId = new Map();
    for (const raw of list || []) {
      const row = normalizeRow(buildRow(raw));
      const id = row.id || makeId(row);
      const prev = byId.get(id);
      byId.set(id, prev ? mergeRow(prev, { ...row, id }) : { ...row, id });
    }
    const byContent = new Map();
    for (const row of byId.values()) {
      const ck = contentKey(row);
      const prev = byContent.get(ck);
      if (!prev) {
        byContent.set(ck, row);
        continue;
      }
      byContent.set(ck, mergeRow(prev, row));
    }
    return Array.from(byContent.values()).sort(
      (a, b) => (b.tweetAt || b.at || 0) - (a.tweetAt || a.at || 0)
    );
  }

  function trimTotal(map) {
    let rows = flatten(map);
    if (rows.length <= MAX_ENTRIES) return map;
    rows = rows.slice(0, MAX_ENTRIES);
    const next = {};
    for (const row of rows) {
      const tid = row.threadId || threadIdFromPageUrl(row.pageUrl);
      if (!tid) continue;
      if (!next[tid]) next[tid] = [];
      next[tid].push(row);
    }
    for (const tid of Object.keys(next)) {
      next[tid] = dedupeThreadList(next[tid]);
    }
    return next;
  }

  async function load() {
    return flatten(await loadByThread());
  }

  function splitLanes(list) {
    const noise = [];
    const signal = [];
    const confirmedNoise = [];
    for (const row of list) {
      const normalized = normalizeRow(row);
      const isSignal = normalized.kind === XCF.COMMENT_KIND.SIGNAL;
      if (normalized.blockedLane && !isSignal) {
        confirmedNoise.push(normalized);
        continue;
      }
      if (isSignal) signal.push(normalized);
      else noise.push(normalized);
    }
    return {
      noise,
      signal,
      confirmedNoise,
      filtered: noise,
      blockedReplies: confirmedNoise
    };
  }

  function findRowById(map, id) {
    for (const [threadId, list] of Object.entries(map)) {
      if (!Array.isArray(list)) continue;
      const idx = list.findIndex((r) => r.id === id);
      if (idx >= 0) return { threadId, idx, row: list[idx] };
    }
    return null;
  }

  async function append(entry) {
    const threadId =
      entry.threadId || threadIdFromPageUrl(entry.pageUrl) || '';
    if (!threadId) return flatten(await loadByThread());

    const map = await loadByThread();
    const list = map[threadId] || [];
    const row = buildRow({
      ...entry,
      threadId,
      blockedLane: false,
      kind: entry.kind || XCF.COMMENT_KIND.NOISE
    });
    const idx = list.findIndex((r) => r.id === row.id);
    if (idx >= 0) list[idx] = mergeRow(list[idx], row);
    else list.push(row);
    map[threadId] = dedupeThreadList(list);
    await saveByThread(trimTotal(map));
    return load();
  }

  async function compact() {
    const map = await loadByThread();
    const before = flatten(map).length;
    const next = {};
    for (const [tid, list] of Object.entries(map)) {
      next[tid] = dedupeThreadList(list);
    }
    const trimmed = trimTotal(next);
    await saveByThread(trimmed);
    const after = flatten(trimmed).length;
    return { before, after, removed: Math.max(0, before - after) };
  }

  async function moveToBlockedLane(id) {
    const map = await loadByThread();
    const hit = findRowById(map, id);
    if (hit) {
      const list = map[hit.threadId];
      const prev = list[hit.idx];
      list[hit.idx] = {
        ...prev,
        kind: XCF.COMMENT_KIND.NOISE,
        blockedLane: true,
        blockedAt: Date.now(),
        ruleId: prev.ruleId || 'manual_confirm',
        reason: prev.reason || '手动确认'
      };
      map[hit.threadId] = list;
      await saveByThread(map);
    }
    return load();
  }

  async function restoreFromBlockedLane(id) {
    const map = await loadByThread();
    const hit = findRowById(map, id);
    if (hit) {
      const copy = { ...map[hit.threadId][hit.idx] };
      delete copy.blockedAt;
      copy.blockedLane = false;
      map[hit.threadId][hit.idx] = copy;
      await saveByThread(map);
    }
    return load();
  }

  async function removeEntry(id) {
    const map = await loadByThread();
    const hit = findRowById(map, id);
    if (!hit) return { removed: null, list: await load() };
    const removed = { ...hit.row };
    const list = map[hit.threadId];
    list.splice(hit.idx, 1);
    if (list.length) map[hit.threadId] = list;
    else delete map[hit.threadId];
    await saveByThread(map);
    return { removed, list: await load() };
  }

  async function clear() {
    await saveByThread({});
    return [];
  }

  async function clearFilteredOnly() {
    const map = await loadByThread();
    const next = {};
    for (const [tid, list] of Object.entries(map)) {
      const kept = (list || []).filter(
        (r) =>
          r.blockedLane || r.kind === XCF.COMMENT_KIND.SIGNAL
      );
      if (kept.length) next[tid] = kept;
    }
    await saveByThread(next);
    return flatten(next);
  }

  async function clearThread(threadId) {
    const tid = String(threadId || '').trim();
    if (!tid) {
      return { threadId: '', removedReplies: 0, removedRoot: false, pageUrl: '' };
    }

    const map = await loadByThread();
    const removedReplies = Array.isArray(map[tid]) ? map[tid].length : 0;
    if (tid in map) {
      delete map[tid];
      await saveByThread(map);
    }

    let roots = await loadThreadRoots();
    roots = await migrateThreadRoots(roots);
    const root = roots[tid] || null;
    const pageUrl = root?.pageUrl || '';
    const removedRoot = Boolean(root);
    if (removedRoot) {
      delete roots[tid];
      await saveThreadRoots(roots);
    }

    return { threadId: tid, removedReplies, removedRoot, pageUrl };
  }

  function loadThreadRoots() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [THREAD_KEY]: {} }, (data) => {
        const v = data[THREAD_KEY];
        resolve(v && typeof v === 'object' ? v : {});
      });
    });
  }

  function saveThreadRoots(map) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [THREAD_KEY]: map || {} }, () => resolve(map || {}));
    });
  }

  async function migrateThreadRoots(map) {
    const next = {};
    for (const [key, val] of Object.entries(map || {})) {
      if (!val || typeof val !== 'object') continue;
      const tid =
        val.tweetId ||
        threadIdFromPageUrl(val.pageUrl) ||
        (/^\d+$/.test(key) ? key : threadIdFromPageUrl(key));
      if (!tid) continue;
      next[tid] = {
        ...val,
        tweetId: tid,
        pageUrl: val.pageUrl || key
      };
    }
    return next;
  }

  async function upsertThreadRoot(entry) {
    const threadId =
      entry.tweetId || threadIdFromPageUrl(entry.pageUrl) || '';
    if (!threadId) return null;

    let map = await loadThreadRoots();
    map = await migrateThreadRoots(map);
    const prev = map[threadId] || {};
    const next = {
      tweetId: threadId,
      pageUrl: entry.pageUrl || prev.pageUrl || '',
      at: entry.at || prev.at || Date.now(),
      handle: entry.handle || prev.handle || '',
      displayName: entry.displayName || prev.displayName || '',
      text: (entry.text || prev.text || '').slice(0, 2000),
      media: Array.isArray(entry.media)
        ? entry.media.slice(0, 12)
        : Array.isArray(prev.media)
          ? prev.media
          : [],
      metrics: entry.metrics || prev.metrics || null
    };
    map[threadId] = next;
    await saveThreadRoots(map);
    return next;
  }

  async function getLibrary() {
    const stats = await compact();
    const byThread = await loadByThread();
    const all = flatten(byThread);
    const lanes = splitLanes(all);
    let threadRoots = await loadThreadRoots();
    threadRoots = await migrateThreadRoots(threadRoots);
    return {
      all,
      archiveByThread: byThread,
      ...lanes,
      stats,
      threadRoots
    };
  }

  async function exportBundle() {
    const settings = await XcfSettings.load();
    await compact();
    const byThread = await loadByThread();
    let threadRoots = await loadThreadRoots();
    threadRoots = await migrateThreadRoots(threadRoots);
    const lanes = splitLanes(flatten(byThread));
    return {
      version: 3,
      exportedAt: new Date().toISOString(),
      blocklist: settings.blocklist || [],
      textKeywords: settings.textKeywords || [],
      whitelist: settings.whitelist || [],
      displayNameKeywords: settings.displayNameKeywords || [],
      nicknameSpamKeywords: settings.nicknameSpamKeywords || [],
      emojiSpamKeywords: settings.emojiSpamKeywords || [],
      mentionSpamKeywords: settings.mentionSpamKeywords || [],
      threadRoots,
      archiveByThread: byThread,
      noise: lanes.noise,
      confirmedNoise: lanes.confirmedNoise,
      signal: lanes.signal,
      archive: lanes.noise,
      blockedReplies: lanes.confirmedNoise
    };
  }

  async function listCaptureKeys(threadId) {
    if (!threadId) return [];
    const map = await loadByThread();
    const list = map[threadId] || [];
    const keys = new Set();
    for (const row of list) {
      if (row.id) keys.add(row.id);
      const tid = String(row.tweetId || '').trim();
      if (tid && tid !== threadId) keys.add(`tw:${tid}`);
    }
    return Array.from(keys);
  }

  return {
    KEY,
    THREAD_KEY,
    load,
    append,
    compact,
    moveToBlockedLane,
    restoreFromBlockedLane,
    removeEntry,
    clear,
    clearFilteredOnly,
    clearThread,
    loadByThread,
    loadThreadRoots,
    upsertThreadRoot,
    getLibrary,
    exportBundle,
    makeId,
    threadIdFromPageUrl,
    splitLanes,
    listCaptureKeys,
    MAX_ENTRIES
  };
})();
