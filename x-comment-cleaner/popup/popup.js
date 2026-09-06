/**
 * X Spam Reply Cleaner - Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const defaultDict = typeof X_SPAM_DICTIONARY !== 'undefined' ? X_SPAM_DICTIONARY : [];

  function mergeKeywords(storedKeywords) {
    const set = new Set(defaultDict);
    if (Array.isArray(storedKeywords)) {
      for (const k of storedKeywords) {
        if (typeof k === 'string' && k.trim().length >= 2) {
          set.add(k.trim());
        }
      }
    }
    return Array.from(set);
  }

  const masterToggle = document.getElementById('masterToggle');
  const blockedCountEl = document.getElementById('blockedCount');
  const resetCountBtn = document.getElementById('resetCountBtn');
  const modeCollapse = document.getElementById('modeCollapse');
  const modeHide = document.getElementById('modeHide');
  const filterKeywords = document.getElementById('filterKeywords');
  const filterHomophones = document.getElementById('filterHomophones');
  const filterPureNumbers = document.getElementById('filterPureNumbers');
  const filterMentionSpam = document.getElementById('filterMentionSpam');
  const filterDuplicates = document.getElementById('filterDuplicates');
  const keywordInput = document.getElementById('keywordInput');
  const addKeywordBtn = document.getElementById('addKeywordBtn');
  const keywordsList = document.getElementById('keywordsList');
  const resetKeywordsBtn = document.getElementById('resetKeywordsBtn');
  const kwCountEl = document.getElementById('kwCount');

  let currentKeywords = [];

  // Load stored settings
  const settings = await chrome.storage.sync.get({
    enabled: true,
    hideMode: 'collapse',
    filterKeywords: true,
    filterHomophones: true,
    filterPureNumbers: true,
    filterMentionSpam: true,
    filterDuplicates: true,
    keywords: defaultDict,
    blockedCount: 0
  });

  // Init UI
  masterToggle.checked = !!settings.enabled;
  blockedCountEl.textContent = settings.blockedCount || 0;

  if (settings.hideMode === 'hide') {
    modeHide.checked = true;
  } else {
    modeCollapse.checked = true;
  }

  filterKeywords.checked = !!settings.filterKeywords;
  filterHomophones.checked = settings.filterHomophones !== false;
  if (filterPureNumbers) filterPureNumbers.checked = settings.filterPureNumbers !== false;
  filterMentionSpam.checked = !!settings.filterMentionSpam;
  filterDuplicates.checked = !!settings.filterDuplicates;

  currentKeywords = mergeKeywords(settings.keywords);
  renderKeywords();

  // Listeners
  masterToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: masterToggle.checked });
  });

  modeCollapse.addEventListener('change', () => {
    if (modeCollapse.checked) chrome.storage.sync.set({ hideMode: 'collapse' });
  });

  modeHide.addEventListener('change', () => {
    if (modeHide.checked) chrome.storage.sync.set({ hideMode: 'hide' });
  });

  filterKeywords.addEventListener('change', () => {
    chrome.storage.sync.set({ filterKeywords: filterKeywords.checked });
  });

  filterHomophones.addEventListener('change', () => {
    chrome.storage.sync.set({ filterHomophones: filterHomophones.checked });
  });

  if (filterPureNumbers) {
    filterPureNumbers.addEventListener('change', () => {
      chrome.storage.sync.set({ filterPureNumbers: filterPureNumbers.checked });
    });
  }

  filterMentionSpam.addEventListener('change', () => {
    chrome.storage.sync.set({ filterMentionSpam: filterMentionSpam.checked });
  });

  filterDuplicates.addEventListener('change', () => {
    chrome.storage.sync.set({ filterDuplicates: filterDuplicates.checked });
  });

  resetCountBtn.addEventListener('click', () => {
    chrome.storage.sync.set({ blockedCount: 0 }, () => {
      blockedCountEl.textContent = '0';
    });
  });

  function saveKeywords() {
    chrome.storage.sync.set({ keywords: currentKeywords });
    renderKeywords();
  }

  function renderKeywords() {
    keywordsList.innerHTML = '';
    kwCountEl.textContent = currentKeywords.length;

    if (currentKeywords.length === 0) {
      keywordsList.innerHTML = '<span style="color:#71767b;font-size:11px;padding:4px;">词库为空</span>';
      return;
    }

    currentKeywords.forEach((kw, index) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = kw;

      const removeBtn = document.createElement('span');
      removeBtn.className = 'tag-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = '删除此词';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentKeywords.splice(index, 1);
        saveKeywords();
      });

      tag.appendChild(removeBtn);
      keywordsList.appendChild(tag);
    });
  }

  function handleAddKeyword() {
    const val = keywordInput.value.trim();
    if (!val || val.length < 2) return;
    if (!currentKeywords.includes(val)) {
      currentKeywords.unshift(val);
      saveKeywords();
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

  resetKeywordsBtn.addEventListener('click', () => {
    if (confirm('确定要恢复为完整内置词库吗？')) {
      currentKeywords = [...defaultDict];
      saveKeywords();
    }
  });

  // Listen for storage changes from background or other tabs
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.blockedCount) {
      blockedCountEl.textContent = changes.blockedCount.newValue || 0;
    }
  });
});
