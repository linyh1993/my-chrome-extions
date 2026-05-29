const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, resolve);
  });
}

async function loadUi() {
  const s = await send('getSettings');
  if (!s) return;

  $('enabled').checked = s.enabled !== false;
  $('ctx_post_thread').checked = s.contexts?.post_thread !== false;
  $('ctx_timeline').checked = Boolean(s.contexts?.timeline);
  $('ctx_article').checked = Boolean(s.contexts?.article);

  $('rule_blocklist').checked = s.rules?.blocklist !== false;
  $('rule_emoji_spam').checked = s.rules?.emoji_spam !== false;
  $('rule_display_name_keywords').checked = s.rules?.display_name_keywords !== false;

  const list = (s.blocklist || []).map((h) => '@' + h.replace(/^@/, ''));
  $('blocklist').value = list.join('\n');
  $('blocklist_count').textContent = `${list.length} 个账号`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && /x\.com|twitter\.com/.test(tab.url || '')) {
      chrome.tabs.sendMessage(tab.id, { type: 'getPageStats' }, (stats) => {
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
  await send('saveSettings', { partial });
}

$('enabled').addEventListener('change', () => {
  persist({ enabled: $('enabled').checked });
});

for (const [id, key] of [
  ['rule_blocklist', 'blocklist'],
  ['rule_emoji_spam', 'emoji_spam'],
  ['rule_display_name_keywords', 'display_name_keywords']
]) {
  $(id).addEventListener('change', async () => {
    const s = await send('getSettings');
    await persist({
      rules: {
        ...s.rules,
        [key]: $(id).checked
      }
    });
  });
}

$('save_blocklist').addEventListener('click', async () => {
  const lines = $('blocklist')
    .value.split(/\r?\n/)
    .map((l) => l.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(lines)];
  await persist({ blocklist: unique });
  $('blocklist_count').textContent = `${unique.length} 个账号`;
  $('blocklist').value = unique.map((h) => '@' + h).join('\n');
});

loadUi();
