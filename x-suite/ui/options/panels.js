/** @file X Suite 选项页：主导航 + 评论设置 / 镜像 / 关于 */
(() => {
  const $ = (id) => document.getElementById(id);

  const MAIN_SECTIONS = [
    { id: 'library', label: '评论库' },
    { id: 'filter-settings', label: '评论设置' },
    { id: 'mirror', label: '流量镜像' },
    { id: 'about', label: '关于' }
  ];

  function sendFilter(type, payload = {}) {
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

  function setMainSection(sectionId) {
    const valid = MAIN_SECTIONS.some((s) => s.id === sectionId);
    const id = valid ? sectionId : 'library';

    for (const s of MAIN_SECTIONS) {
      const el = $(`main_${s.id.replace(/-/g, '_')}`);
      if (el) el.hidden = s.id !== id;
      const btn = document.querySelector(`[data-main="${s.id}"]`);
      if (btn) {
        btn.classList.toggle('active', s.id === id);
        btn.setAttribute('aria-selected', s.id === id ? 'true' : 'false');
      }
    }

    document.body.classList.toggle('suite-main-library', id === 'library');
    document.body.classList.toggle('suite-main-other', id !== 'library');
  }

  async function resolveInitialMain() {
    return new Promise((resolve) => {
      chrome.storage.session.get({ [XCF.SESSION.OPTIONS_MAIN]: '' }, (data) => {
        const stored = data[XCF.SESSION.OPTIONS_MAIN];
        if (stored) {
          chrome.storage.session.remove(XCF.SESSION.OPTIONS_MAIN);
        }
        resolve(
          MAIN_SECTIONS.some((s) => s.id === stored) ? stored : 'library'
        );
      });
    });
  }

  function initMainNav() {
    const nav = $('main_nav');
    if (!nav) return;

    for (const s of MAIN_SECTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'main-nav-btn';
      btn.dataset.main = s.id;
      btn.textContent = s.label;
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => setMainSection(s.id));
      nav.appendChild(btn);
    }

    resolveInitialMain().then((id) => setMainSection(id));
  }

  async function loadFilterSettingsPanel() {
    const s = await sendFilter(XCF.MSG.GET_SETTINGS);
    if (!s) return;

    $('fs_enabled').checked = s.enabled !== false;
    $('fs_ctx_post_thread').checked = s.contexts?.post_thread !== false;
    $('fs_ctx_timeline').checked = Boolean(s.contexts?.timeline);
    $('fs_ctx_article').checked = Boolean(s.contexts?.article);

    const rules = [
      ['fs_rule_blocklist', 'blocklist'],
      ['fs_rule_text_keywords', 'text_keywords'],
      ['fs_rule_probable_spam', 'probable_spam'],
      ['fs_rule_mention_spam', 'mention_spam'],
      ['fs_rule_emoji_spam', 'emoji_spam'],
      ['fs_rule_display_name_keywords', 'display_name_keywords'],
      ['fs_rule_nickname_spam', 'nickname_spam']
    ];
    for (const [elId, key] of rules) {
      const el = $(elId);
      if (el) el.checked = s.rules?.[key] !== false;
    }

    const blocklist = (s.blocklist || []).map((h) => '@' + String(h).replace(/^@/, ''));
    $('fs_blocklist').value = blocklist.join('\n');
    $('fs_blocklist_count').textContent = `${blocklist.length} 个账号`;

    const kws = s.textKeywords || [];
    $('fs_text_keywords').value = kws.join('\n');
    $('fs_keywords_count').textContent = `${kws.length} 个关键词`;
  }

  function initFilterSettingsPanel() {
    $('fs_enabled')?.addEventListener('change', async () => {
      await sendFilter(XCF.MSG.SAVE_SETTINGS, {
        partial: { enabled: $('fs_enabled').checked }
      });
    });

    for (const [elId, key] of [
      ['fs_rule_blocklist', 'blocklist'],
      ['fs_rule_text_keywords', 'text_keywords'],
      ['fs_rule_probable_spam', 'probable_spam'],
      ['fs_rule_mention_spam', 'mention_spam'],
      ['fs_rule_emoji_spam', 'emoji_spam'],
      ['fs_rule_display_name_keywords', 'display_name_keywords'],
      ['fs_rule_nickname_spam', 'nickname_spam']
    ]) {
      $(elId)?.addEventListener('change', async () => {
        const cur = await sendFilter(XCF.MSG.GET_SETTINGS);
        await sendFilter(XCF.MSG.SAVE_SETTINGS, {
          partial: {
            rules: { ...cur.rules, [key]: $(elId).checked }
          }
        });
      });
    }

    $('fs_save_blocklist')?.addEventListener('click', async () => {
      const unique = [
        ...new Set(parseLines($('fs_blocklist').value, { lower: true, stripAt: true }))
      ];
      await sendFilter(XCF.MSG.SAVE_SETTINGS, { partial: { blocklist: unique } });
      $('fs_blocklist_count').textContent = `${unique.length} 个账号`;
      $('fs_blocklist').value = unique.map((h) => '@' + h).join('\n');
      showHint('fs_save_hint');
    });

    $('fs_save_keywords')?.addEventListener('click', async () => {
      const unique = [...new Set(parseLines($('fs_text_keywords').value))];
      await sendFilter(XCF.MSG.SAVE_SETTINGS, { partial: { textKeywords: unique } });
      $('fs_keywords_count').textContent = `${unique.length} 个关键词`;
      $('fs_text_keywords').value = unique.join('\n');
      showHint('fs_save_hint');
    });

    $('fs_go_keywords_tab')?.addEventListener('click', () => {
      setMainSection('library');
      if (typeof window.xcfActivateTab === 'function') {
        window.xcfActivateTab('keywords');
      }
    });

    loadFilterSettingsPanel();
  }

  function showHint(id) {
    const el = $(id);
    if (!el) return;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.hidden = true;
    }, 2000);
  }

  async function loadMirrorPanel() {
    const cfg = await MirrorSettings.load();
    const filterSettings = await sendFilter(XCF.MSG.GET_SETTINGS);
    $('mirror_url').value = cfg.mirrorUrl;
    $('mirror_path_display').textContent = (cfg.pathIncludes || []).join(', ') || '/api/graphql';
    $('mirror_default_mode').value = XCF.displayModeFromPanelUi(
      filterSettings?.panelUi || {}
    );

    chrome.runtime.sendMessage(
      { domain: 'mirror', action: 'GET_ACTIVE_TAB_STATUS' },
      (res) => {
        const el = $('mirror_live_status');
        if (!el) return;
        if (!res?.site) {
          el.textContent = '当前标签页不是 X。';
          return;
        }
        el.textContent = res.isAttached
          ? `当前标签页：${res.site.label} · 监听中`
          : `当前标签页：${res.site.label} · 已关闭（在页内面板或侧边栏开启）`;
      }
    );
  }

  function initMirrorPanel() {
    $('mirror_save')?.addEventListener('click', async () => {
      const mirrorUrl = $('mirror_url').value.trim();
      const panelUi = XCF.panelUiFromDisplayMode($('mirror_default_mode').value);
      await MirrorSettings.save({ mirrorUrl });
      await sendFilter(XCF.MSG.SAVE_SETTINGS, { partial: { panelUi } });
      showHint('mirror_save_hint');
      await loadMirrorPanel();
    });

    $('mirror_open_sidepanel')?.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId != null && chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
    });

    loadMirrorPanel();
  }

  function initAboutPanel() {
    const manifest = chrome.runtime.getManifest();
    $('about_version').textContent = manifest.version || '—';
    $('about_name').textContent = manifest.name || 'X Suite';
  }

  function initSuitePanels() {
    initMainNav();
    initFilterSettingsPanel();
    initMirrorPanel();
    initAboutPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSuitePanels);
  } else {
    initSuitePanels();
  }
})();
