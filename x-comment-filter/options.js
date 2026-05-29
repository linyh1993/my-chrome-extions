const $ = (id) => document.getElementById(id);

const TAB_IDS = ['read', 'filtered', 'blocked', 'accounts', 'keywords'];
let activeTab = 'read';
let libraryCache = null;

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

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString('zh-CN');
  } catch {
    return '';
  }
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
    ? '仅「过滤记录」中的评论正文，条目之间用下划线分隔。'
    : '管理过滤记录、屏蔽名单与关键词；数据保存在本机浏览器。';
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
    history.replaceState(null, '', `#${tabId}`);
  } catch {
    /* ignore */
  }
}

function initTabs() {
  const hash = (location.hash || '').replace(/^#/, '');
  if (TAB_IDS.includes(hash)) switchTab(hash);
  else switchTab('read');

  document.querySelectorAll('.tabs .tab[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function isReadableRow(row) {
  return true;
}

function getReadItems(archive) {
  return (archive || [])
    .filter(isReadableRow)
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}

function renderReadFeed(lib) {
  const archive = lib.archive || [];
  const items = getReadItems(archive);
  const threadRoots = lib.threadRoots || {};

  $('tab_read_count').textContent = String(items.length);

  const feed = $('read_feed');
  feed.textContent = '';
  feed.className = 'read-feed read-feed-plain';
  $('read_empty').hidden = items.length > 0;

  const summary = items.length > 0 ? `${items.length} 条评论` : '';
  $('read_summary').textContent = summary;

  if (items.length === 0) return;

  const doc = document.createElement('div');
  doc.className = 'read-plain';

  // 按主推文 id 分组：先主贴正文，再评论
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
      const when = row.at ? fmtTime(row.at) : '';
      meta.textContent = when ? `${who} · ${when}` : who;
      doc.appendChild(meta);
    });
  }

  feed.appendChild(doc);
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
  meta.textContent = `${fmtTime(row.at)} · ${row.reason || row.ruleId || ''}`;
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

function renderFiltered(rows) {
  const ul = $('archive');
  ul.textContent = '';
  $('tab_archive_count').textContent = String(rows.length);
  $('archive_empty').hidden = rows.length > 0;

  for (const row of rows) {
    const blockBtn = document.createElement('button');
    blockBtn.type = 'button';
    blockBtn.className = 'btn-sm warn';
    blockBtn.textContent = '屏蔽';
    blockBtn.addEventListener('click', async () => {
      await send(XCF.MSG.BLOCK_ARCHIVE_ENTRY, { id: row.id });
      await refresh();
    });
    ul.appendChild(buildEntryRow(row, [blockBtn]));
  }
}

function renderBlockedReplies(rows) {
  const ul = $('blocked_replies');
  ul.textContent = '';
  $('tab_blocked_count').textContent = String(rows.length);
  $('blocked_empty').hidden = rows.length > 0;

  for (const row of rows) {
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'btn-sm ghost';
    restoreBtn.textContent = '移回列表';
    restoreBtn.addEventListener('click', async () => {
      await send(XCF.MSG.RESTORE_ARCHIVE_ENTRY, { id: row.id });
      await refresh();
    });
    ul.appendChild(buildEntryRow(row, [restoreBtn]));
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
  const st = lib.stats;
  let msg = `过滤记录 ${lib.archive?.length || 0} 条 · 屏蔽回复 ${lib.blockedReplies?.length || 0} 条 · 账号 ${accounts} 个 · 关键词 ${kws} 个。`;
  if (st && st.removed > 0) {
    msg += ` 已从 ${st.before} 条合并去重，删除重复 ${st.removed} 条。`;
  }
  $('storage_hint').textContent = msg;
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
  const el = $('display_name_keywords_input');
  if (!el) return;
  el.value = (list || []).join('\n');
  const cb = $('rule_display_name_keywords');
  if (cb) cb.checked = rules?.display_name_keywords !== false;
}

async function refresh() {
  const lib = await send(XCF.MSG.GET_LIBRARY);
  if (!lib) return;
  libraryCache = lib;
  renderReadFeed(lib);
  renderBlocklist(lib.blocklist || []);
  renderWhitelist(lib.whitelist || []);
  renderFiltered(lib.archive || []);
  renderBlockedReplies(lib.blockedReplies || []);
  renderKeywords(lib.textKeywords || [], lib.rules);
  renderDisplayNameKeywords(lib.displayNameKeywords || [], lib.rules);
  updateStorageHint(lib);
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
  if (!confirm('清空「过滤记录」？「屏蔽回复」与已屏蔽账号会保留。')) return;
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

$('btn_save_display_name_keywords')?.addEventListener('click', async () => {
  const unique = [...new Set(parseLines($('display_name_keywords_input').value))];
  const rules = { display_name_keywords: $('rule_display_name_keywords').checked };
  await send(XCF.MSG.SAVE_SETTINGS, {
    partial: { displayNameKeywords: unique, rules }
  });
  const hint = $('display_name_keywords_save_hint');
  if (hint) {
    hint.hidden = false;
    clearTimeout(hint._t);
    hint._t = setTimeout(() => {
      hint.hidden = true;
    }, 2000);
  }
  await refresh();
});

initTabs();
refresh();
