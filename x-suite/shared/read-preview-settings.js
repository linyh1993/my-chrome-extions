/** @file 阅读预览设置（chrome.storage.sync） */
const ReadPreviewSettings = (() => {
  const STORAGE_KEY = 'xsuite_read_preview_settings';
  const DEFAULTS = {
    sourceLanguage: 'auto',
    targetLanguage: 'zh'
  };

  function normalize(raw) {
    const merged = {
      ...DEFAULTS,
      ...(raw || {})
    };
    merged.sourceLanguage = String(merged.sourceLanguage || 'auto').trim() || 'auto';
    merged.targetLanguage = String(merged.targetLanguage || 'zh').trim() || 'zh';
    return merged;
  }

  async function load() {
    const data = await chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULTS });
    return normalize(data[STORAGE_KEY]);
  }

  async function save(partial) {
    const current = await load();
    const next = normalize({ ...current, ...(partial || {}) });
    await chrome.storage.sync.set({ [STORAGE_KEY]: next });
    return next;
  }

  return {
    STORAGE_KEY,
    DEFAULTS,
    normalize,
    load,
    save
  };
})();
