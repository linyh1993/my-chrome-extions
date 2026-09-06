/**
 * X Spam Reply Cleaner - Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const rulesEngine = globalThis.XCleanerRules || {};
  const presetPacks = rulesEngine.KEYWORD_PACKS || [];
  const defaultSettings = rulesEngine.DEFAULT_CLEANER_SETTINGS || {};

  // Elements
  const masterToggle = document.getElementById('masterToggle');
  const blockedCountEl = document.getElementById('blockedCount');
  const resetCountBtn = document.getElementById('resetCountBtn');
  const modeCollapse = document.getElementById('modeCollapse');
  const modeHide = document.getElementById('modeHide');

  const packsGrid = document.getElementById('packsGrid');

  const filterSimhash = document.getElementById('filterSimhash');
  const filterHeuristics = document.getElementById('filterHeuristics');
  const filterPureNumbers = document.getElementById('filterPureNumbers');
  const filterMentionSpam = document.getElementById('filterMentionSpam');
  const filterDuplicates = document.getElementById('filterDuplicates');

  const whitelistInput = document.getElementById('whitelistInput');
  const addWhitelistBtn = document.getElementById('addWhitelistBtn');
  const whitelistList = document.getElementById('whitelistList');
  const whiteCountEl = document.getElementById('whiteCount');

  const keywordInput = document.getElementById('keywordInput');
  const addKeywordBtn = document.getElementById('addKeywordBtn');
  const keywordsList = document.getElementById('keywordsList');
  const customKwCountEl = document.getElementById('customKwCount');

  // Load stored settings
  const stored = await chrome.storage.sync.get(defaultSettings);
  const settings = {
    ...defaultSettings,
    ...stored,
    packSettings: {
      ...(defaultSettings.packSettings || {}),
      ...(stored.packSettings || {})
    }
  };

  let currentWhitelist = Array.isArray(settings.whitelist) ? [...settings.whitelist] : [];
  let currentCustomKeywords = Array.isArray(settings.customKeywords) ? [...settings.customKeywords] : [];

  // Init Main Controls
  masterToggle.checked = !!settings.enabled;
  blockedCountEl.textContent = settings.blockedCount || 0;

  if (settings.hideMode === 'hide') {
    modeHide.checked = true;
  } else {
    modeCollapse.checked = true;
  }

  // Init Algorithm Toggles
  if (filterSimhash) filterSimhash.checked = settings.filterSimhash !== false;
  if (filterHeuristics) filterHeuristics.checked = settings.filterHeuristics !== false;
  if (filterPureNumbers) filterPureNumbers.checked = settings.filterPureNumbers !== false;
  if (filterMentionSpam) filterMentionSpam.checked = settings.filterMentionSpam !== false;
  if (filterDuplicates) filterDuplicates.checked = settings.filterDuplicates !== false;

  // Render 8 Preset Packs
  renderPacksGrid(settings.packSettings);

  // Render Whitelist & Custom Keywords
  renderWhitelist();
  renderCustomKeywords();

  // --- Listeners ---
  masterToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: masterToggle.checked });
  });

  modeCollapse.addEventListener('change', () => {
    if (modeCollapse.checked) chrome.storage.sync.set({ hideMode: 'collapse' });
  });

  modeHide.addEventListener('change', () => {
    if (modeHide.checked) chrome.storage.sync.set({ hideMode: 'hide' });
  });

  if (filterSimhash) {
    filterSimhash.addEventListener('change', () => {
      chrome.storage.sync.set({ filterSimhash: filterSimhash.checked });
    });
  }

  if (filterHeuristics) {
    filterHeuristics.addEventListener('change', () => {
      chrome.storage.sync.set({ filterHeuristics: filterHeuristics.checked });
    });
  }

  if (filterPureNumbers) {
    filterPureNumbers.addEventListener('change', () => {
      chrome.storage.sync.set({ filterPureNumbers: filterPureNumbers.checked });
    });
  }

  if (filterMentionSpam) {
    filterMentionSpam.addEventListener('change', () => {
      chrome.storage.sync.set({ filterMentionSpam: filterMentionSpam.checked });
    });
  }

  if (filterDuplicates) {
    filterDuplicates.addEventListener('change', () => {
      chrome.storage.sync.set({ filterDuplicates: filterDuplicates.checked });
    });
  }

  resetCountBtn.addEventListener('click', () => {
    chrome.storage.sync.set({ blockedCount: 0 }, () => {
      blockedCountEl.textContent = '0';
    });
  });

  // --- Pack Rendering & Change ---
  function renderPacksGrid(packStates) {
    packsGrid.innerHTML = '';
    presetPacks.forEach((pack) => {
      const isChecked = packStates[pack.id] !== false;

      const card = document.createElement('label');
      card.className = `pack-card ${isChecked ? 'active' : ''}`;

      card.innerHTML = `
        <input type="checkbox" class="pack-checkbox" data-pack-id="${pack.id}" ${isChecked ? 'checked' : ''}>
        <div class="pack-info">
          <div class="pack-name-row">
            <span class="pack-name">${escapeHtml(pack.name)}</span>
            <span class="pack-count">${pack.rules.length}词</span>
          </div>
          <div class="pack-desc">${escapeHtml(pack.description)}</div>
        </div>
      `;

      const checkbox = card.querySelector('.pack-checkbox');
      checkbox.addEventListener('change', () => {
        packStates[pack.id] = checkbox.checked;
        if (checkbox.checked) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
        chrome.storage.sync.set({ packSettings: packStates });
      });

      packsGrid.appendChild(card);
    });
  }

  // --- Whitelist Functions ---
  function saveWhitelist() {
    chrome.storage.sync.set({ whitelist: currentWhitelist });
    renderWhitelist();
  }

  function renderWhitelist() {
    whitelistList.innerHTML = '';
    whiteCountEl.textContent = currentWhitelist.length;

    if (currentWhitelist.length === 0) {
      whitelistList.innerHTML = '<span style="color:#71767b;font-size:11px;padding:4px;">暂无白名单用户（评论区可一键加白）</span>';
      return;
    }

    currentWhitelist.forEach((handle, index) => {
      const tag = document.createElement('span');
      tag.className = 'tag tag-white';
      tag.textContent = `@${handle}`;

      const removeBtn = document.createElement('span');
      removeBtn.className = 'tag-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = '移除';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentWhitelist.splice(index, 1);
        saveWhitelist();
      });

      tag.appendChild(removeBtn);
      whitelistList.appendChild(tag);
    });
  }

  function handleAddWhitelist() {
    const raw = whitelistInput.value.trim();
    if (!raw) return;
    const cleanHandle = raw.replace(/^@+/, '').toLowerCase();
    if (cleanHandle.length >= 1 && !currentWhitelist.includes(cleanHandle)) {
      currentWhitelist.unshift(cleanHandle);
      saveWhitelist();
    }
    whitelistInput.value = '';
  }

  addWhitelistBtn.addEventListener('click', handleAddWhitelist);
  whitelistInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddWhitelist();
    }
  });

  // --- Custom Keywords Functions ---
  function saveCustomKeywords() {
    chrome.storage.sync.set({ customKeywords: currentCustomKeywords });
    renderCustomKeywords();
  }

  function renderCustomKeywords() {
    keywordsList.innerHTML = '';
    customKwCountEl.textContent = currentCustomKeywords.length;

    if (currentCustomKeywords.length === 0) {
      keywordsList.innerHTML = '<span style="color:#71767b;font-size:11px;padding:4px;">暂无自定义关键词</span>';
      return;
    }

    currentCustomKeywords.forEach((kw, index) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = kw;

      const removeBtn = document.createElement('span');
      removeBtn.className = 'tag-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = '删除此词';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentCustomKeywords.splice(index, 1);
        saveCustomKeywords();
      });

      tag.appendChild(removeBtn);
      keywordsList.appendChild(tag);
    });
  }

  function handleAddKeyword() {
    const val = keywordInput.value.trim();
    if (!val || val.length < 2) return;
    if (!currentCustomKeywords.includes(val)) {
      currentCustomKeywords.unshift(val);
      saveCustomKeywords();
    }
    keywordInput.value = '';
  }

  addKeywordBtn.addEventListener('click', handleAddKeyword);
  keywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddKeyword();
    }
  });

  // Storage listener for background stats updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.blockedCount) {
      blockedCountEl.textContent = changes.blockedCount.newValue || 0;
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});

