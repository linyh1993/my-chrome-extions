/** @file Markdown 导出设置（chrome.storage.sync） */
const MarkdownExportSettings = (() => {
  const STORAGE_KEY = 'xsuite_markdown_export_settings';
  const DEFAULTS = {
    noteLocation: '00-Inbox/02-Clippings',
    fileNameTemplate: '{{title}}',
    properties: [
      { key: 'title', value: '{{title}}' },
      { key: 'source', value: '{{url}}' },
      { key: 'author', value: '{{author}}' },
      { key: 'published', value: '{{published}}' },
      { key: 'created', value: '{{date}}' },
      { key: 'description', value: '{{description}}' },
      { key: 'tags', value: 'x-suite, clipping' }
    ]
  };

  function normalizeProperty(item) {
    return {
      key: String(item?.key || '').trim(),
      value: String(item?.value || '').trim()
    };
  }

  function normalize(raw) {
    const merged = {
      ...DEFAULTS,
      ...(raw || {})
    };
    merged.noteLocation = String(merged.noteLocation || '').trim();
    merged.fileNameTemplate =
      String(merged.fileNameTemplate || '').trim() || DEFAULTS.fileNameTemplate;
    merged.properties = Array.isArray(merged.properties)
      ? merged.properties.map(normalizeProperty)
      : DEFAULTS.properties.map(normalizeProperty);
    return merged;
  }

  async function load() {
    const data = await chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULTS });
    return normalize(data[STORAGE_KEY]);
  }

  async function save(partial) {
    const current = await load();
    const next = normalize({
      ...current,
      ...(partial || {}),
      properties: partial?.properties ?? current.properties
    });
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
