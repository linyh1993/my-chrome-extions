/**
 * X Spam Reply Cleaner - Popup Controller
 */

const DEFAULT_KEYWORDS = [
  '比她好看',
  '没她骚',
  '看主页',
  '看主頁',
  '看置顶',
  '私信',
  '私聊',
  '私我',
  '进群',
  '加v',
  '加V',
  '加VX',
  '门槛',
  '门槛群',
  '福利',
  '同城',
  '约拍',
  '资源群',
  '群内看',
  '微密圈',
  '无圣光'
];

document.addEventListener('DOMContentLoaded', async () => {
  const masterToggle = document.getElementById('masterToggle');
  const blockedCountEl = document.getElementById('blockedCount');
  const resetCountBtn = document.getElementById('resetCountBtn');
  const modeCollapse = document.getElementById('modeCollapse');
  const modeHide = document.getElementById('modeHide');
  const filterKeywords = document.getElementById('filterKeywords');
  const filterMentionSpam = document.getElementById('filterMentionSpam');
  const filterDuplicates = document.getElementById('filterDuplicates');
  const keywordInput = document.getElementById('keywordInput');
  const addKeywordBtn = document.getElementById('addKeywordBtn');
  const keywordsList = document.getElementById('keywordsList');
  const resetKeywordsBtn = document.getElementById('resetKeywordsBtn');

  let currentKeywords = [];

  // Load stored settings
  const settings = await chrome.storage.sync.get({
    enabled: true,
    hideMode: 'collapse',
    filterKeywords: true,
    filterMentionSpam: true,
    filterDuplicates: true,
    keywords: DEFAULT_KEYWORDS,
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
  filterMentionSpam.checked = !!settings.filterMentionSpam;
  filterDuplicates.checked = !!settings.filterDuplicates;

  currentKeywords = Array.isArray(settings.keywords) ? [...settings.keywords] : [...DEFAULT_KEYWORDS];
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
    if (currentKeywords.length === 0) {
      keywordsList.innerHTML = '<span style="color:#71767b;font-size:11px;padding:4px;">暂无自定义关键词</span>';
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
    if (!val) return;
    if (!currentKeywords.includes(val)) {
      currentKeywords.push(val);
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
    if (confirm('确定要重置为默认词库吗？')) {
      currentKeywords = [...DEFAULT_KEYWORDS];
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
