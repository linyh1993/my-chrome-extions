const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

function parseLines(text, { lower = false, stripAt = false } = {}) {
  return text
    .split(/\r?\n/)
    .map((l) => {
      let s = l.trim();
      if (stripAt) s = s.replace(/^@/, '');
      if (lower) s = s.toLowerCase();
      return s;
    })
    .filter(Boolean);
}

async function loadUi() {
  const s = await send(XCF.MSG.GET_SETTINGS);
  if (!s) return;

  $('enabled').checked = s.enabled !== false;
  $('ctx_post_thread').checked = s.contexts?.post_thread !== false;
  $('ctx_timeline').checked = Boolean(s.contexts?.timeline);
  $('ctx_article').checked = Boolean(s.contexts?.article);

  $('rule_blocklist').checked = s.rules?.blocklist !== false;
  $('rule_text_keywords').checked = s.rules?.text_keywords !== false;
  $('rule_probable_spam').checked = s.rules?.probable_spam !== false;
  $('rule_mention_spam').checked = s.rules?.mention_spam !== false;
  $('rule_emoji_spam').checked = s.rules?.emoji_spam !== false;
  $('rule_display_name_keywords').checked = s.rules?.display_name_keywords !== false;

  const blocklist = (s.blocklist || []).map((h) => '@' + h.replace(/^@/, ''));
  $('blocklist').value = blocklist.join('\n');
  $('blocklist_count').textContent = `${blocklist.length} 个账号`;

  const kws = s.textKeywords || [];
  $('text_keywords').value = kws.join('\n');
  $('keywords_count').textContent = `${kws.length} 个关键词`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && /x\.com|twitter\.com/.test(tab.url || '')) {
      chrome.tabs.sendMessage(tab.id, { type: XCF.MSG.GET_PAGE_STATS }, (stats) => {
        if (stats?.foldedCount > 0) {
          $('page_stats').textContent = `当前页已折叠 ${stats.foldedCount} 条`;
        }
      });
    }
  } catch {
    /* ignore */
  }
}

async function persist(partial) {
  await send(XCF.MSG.SAVE_SETTINGS, { partial });
}

$('enabled').addEventListener('change', () => {
  persist({ enabled: $('enabled').checked });
});

for (const [id, key] of [
  ['rule_blocklist', 'blocklist'],
  ['rule_text_keywords', 'text_keywords'],
  ['rule_probable_spam', 'probable_spam'],
  ['rule_mention_spam', 'mention_spam'],
  ['rule_emoji_spam', 'emoji_spam'],
  ['rule_display_name_keywords', 'display_name_keywords']
]) {
  $(id).addEventListener('change', async () => {
    const s = await send(XCF.MSG.GET_SETTINGS);
    await persist({
      rules: {
        ...s.rules,
        [key]: $(id).checked
      }
    });
  });
}

$('open_library').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tid = tab?.url?.match(/\/status\/(\d+)/)?.[1];
    if (tid) {
      await chrome.storage.session.set({ [XCF.SESSION.OPTIONS_THREAD]: tid });
    }
  } catch {
    /* ignore */
  }
  chrome.runtime.openOptionsPage();
});

$('save_blocklist').addEventListener('click', async () => {
  const unique = [...new Set(parseLines($('blocklist').value, { lower: true, stripAt: true }))];
  await persist({ blocklist: unique });
  $('blocklist_count').textContent = `${unique.length} 个账号`;
  $('blocklist').value = unique.map((h) => '@' + h).join('\n');
});

$('save_keywords').addEventListener('click', async () => {
  const unique = [...new Set(parseLines($('text_keywords').value))];
  await persist({ textKeywords: unique });
  $('keywords_count').textContent = `${unique.length} 个关键词`;
  $('text_keywords').value = unique.join('\n');
});

loadUi();
