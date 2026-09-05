/**
 * X Spam Reply Cleaner - Popup Controller
 */

const DEFAULT_KEYWORDS = [
  '比她好看', '没她骚', '比我玩的开', '比我玩得开', '玩的开', '玩得开', '玩的嗨', '玩得嗨', '放得开', '放的开',
  '福不黑', '服不黑', '批不黑', '逼不黑', '鲍不黑', '粉嫩', '不信你看', '不信看', '信不信你看',
  '看主页', '看主頁', '看置顶', '看置頂', '看头像', '点头像', '点主页', '看动态', '看相册', '私密相册',
  '私信', '私聊', '私我', '斯我', '斯聊', '丝我', '丝聊', '私发', '私密',
  '加v', '加V', '加vx', '加VX', '加微', '加🛰', '加卫星', '卫星：', '卫星号', '威信', '薇信', '唯心',
  '＋v', '＋V', '➕v', '➕V', '➕vx', '➕微', '🛰️', '🛰',
  '门槛', '门槛群', '門檻', '门卡', '门坎', '无门槛', '进群', '进裙', '入群', '入裙', '裙内', '群内看',
  '福利', '福力', '资源群', '微密圈', '无圣光', '秀人', '麻豆', '反差', '反差婊', '反差女',
  '吃瓜群', '黑料', '大瓜', '夸克网盘', '夸克', '度盘', '合集', '约拍', '同城'
];

document.addEventListener('DOMContentLoaded', async () => {
  const masterToggle = document.getElementById('masterToggle');
  const blockedCountEl = document.getElementById('blockedCount');
  const resetCountBtn = document.getElementById('resetCountBtn');
  const modeCollapse = document.getElementById('modeCollapse');
  const modeHide = document.getElementById('modeHide');
  const groupConsecutive = document.getElementById('groupConsecutive');
  const filterKeywords = document.getElementById('filterKeywords');
  const filterHomophones = document.getElementById('filterHomophones');
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
    groupConsecutive: true,
    filterKeywords: true,
    filterHomophones: true,
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

  groupConsecutive.checked = settings.groupConsecutive !== false;
  filterKeywords.checked = !!settings.filterKeywords;
  filterHomophones.checked = settings.filterHomophones !== false;
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

  groupConsecutive.addEventListener('change', () => {
    chrome.storage.sync.set({ groupConsecutive: groupConsecutive.checked });
  });

  filterKeywords.addEventListener('change', () => {
    chrome.storage.sync.set({ filterKeywords: filterKeywords.checked });
  });

  filterHomophones.addEventListener('change', () => {
    chrome.storage.sync.set({ filterHomophones: filterHomophones.checked });
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
