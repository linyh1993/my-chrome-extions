/**
 * X Spam Reply Cleaner - Content Script
 */

(function () {
  'use strict';

  let currentSettings = {
    enabled: true,
    hideMode: 'collapse', // 'collapse' or 'hide'
    groupConsecutive: true, // Group consecutive spam replies into a single aggregate card
    filterKeywords: true,
    filterHomophones: true,
    filterMentionSpam: true,
    filterDuplicates: true,
    keywords: [],
    blockedCount: 0
  };

  let currentThreadUrl = '';
  const threadTextOccurrences = new Map(); // normalizedText -> Set of author handles
  let isScanning = false;
  let scanDebounceTimer = null;

  // Load settings
  chrome.storage.sync.get(null, (stored) => {
    if (chrome.runtime.lastError) return;
    currentSettings = { ...currentSettings, ...stored };
    scheduleScan(50);
  });

  // Listen for settings change
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let shouldRescan = false;

    for (const [key, change] of Object.entries(changes)) {
      currentSettings[key] = change.newValue;
      if (key !== 'blockedCount') {
        shouldRescan = true;
      }
    }

    if (shouldRescan) {
      if (!currentSettings.enabled) {
        restoreAll();
      } else {
        resetProcessedMarks();
        scheduleScan(80);
      }
    }
  });

  function isStatusPage() {
    return /\/(?:twitter\.com|x\.com)\/[^/]+\/status\/\d+/i.test(window.location.href);
  }

  function checkUrlChange() {
    const currentUrl = window.location.href.split('?')[0];
    if (currentUrl !== currentThreadUrl) {
      currentThreadUrl = currentUrl;
      threadTextOccurrences.clear();
      resetProcessedMarks();
    }
  }

  function resetProcessedMarks() {
    document.querySelectorAll('[data-x-spam-processed]').forEach((el) => {
      delete el.dataset.xSpamProcessed;
      delete el.dataset.xSpamReason;
      delete el.dataset.xSpamClusterId;
      el.classList.remove('x-spam-tweet-collapsed', 'x-spam-cell-hidden');
    });

    document.querySelectorAll('.x-spam-collapsed-card, .x-spam-cluster-card').forEach((card) => {
      card.remove();
    });
  }

  function restoreAll() {
    document.querySelectorAll('.x-spam-tweet-collapsed').forEach((el) => {
      el.classList.remove('x-spam-tweet-collapsed');
    });
    document.querySelectorAll('.x-spam-cell-hidden').forEach((el) => {
      el.classList.remove('x-spam-cell-hidden');
    });
    document.querySelectorAll('.x-spam-collapsed-card, .x-spam-cluster-card').forEach((card) => {
      card.remove();
    });
  }

  // Symbol, homophone and variant normalization
  function normalizeTextForMatching(text) {
    if (!text) return '';
    let s = text.toLowerCase();

    if (currentSettings.filterHomophones) {
      // Normalize common symbols & homophones
      s = s
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
        .replace(/➕|\＋|\+/g, '加')
        .replace(/👗/g, '群')
        .replace(/🛰️|🛰/g, '微')
        .replace(/威信|薇信|唯心|维信/g, '微信')
        .replace(/裙内|进裙|入裙/g, '进群')
        .replace(/門檻|门坎|门卡/g, '门槛')
        .replace(/看主頁/g, '看主页')
        .replace(/置頂/g, '置顶')
        .replace(/[\s\-_,，。！？!?.~～`@#$%^&*()（）:：/\\|<>'"“”‘’]+/g, '');
    }

    return s;
  }

  function normalizeTextForComparison(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/@[\w_]+/g, '')
      .replace(/[\s\p{Emoji}\u200d\uFE0F\d.,!?;:，。！？；：_~`@#$%^&*()+\-=[\]{}|\\/<>'"“”‘’]+/gu, '')
      .trim();
  }

  function evaluateSpam(tweetElement, text, authorHandle) {
    if (!text) return { isSpam: false };

    const lowerText = text.toLowerCase();
    const normalizedText = normalizeTextForMatching(text);

    // 1. Keyword check
    if (currentSettings.filterKeywords && Array.isArray(currentSettings.keywords)) {
      for (const kw of currentSettings.keywords) {
        const trimmed = kw.trim();
        if (!trimmed) continue;
        const normKw = normalizeTextForMatching(trimmed);

        if (lowerText.includes(trimmed.toLowerCase()) || (normKw && normalizedText.includes(normKw))) {
          return { isSpam: true, reason: `匹配关键词: "${trimmed}"` };
        }
      }
    }

    // 2. Homophone & Bait sentence heuristics (通假字 / 诱导诱饵句)
    if (currentSettings.filterHomophones) {
      // 诱导句式: "没人比我玩的开", "我福不黑不信你看", "不信你看", "玩得开"
      if (/(?:没人|谁)比我.*(?:玩|骚|放|浪)/i.test(normalizedText)) {
        return { isSpam: true, reason: '特征匹配: 诱导话术' };
      }
      if (/(?:不黑|水多|粉嫩|耐操|反差|大瓜).*不信/i.test(normalizedText)) {
        return { isSpam: true, reason: '特征匹配: 诱导话术' };
      }
      if (/(?:看主页|看置顶|看相册|私信我|进群).*(?:福利|无门槛|吃瓜|资源)/i.test(normalizedText)) {
        return { isSpam: true, reason: '特征匹配: 引流诱导' };
      }
    }

    // 3. Mention Spam Pattern (短语 + @mention + 随机Emoji/数字)
    if (currentSettings.filterMentionSpam) {
      const mentionPattern = /@[\w_]{3,20}\s*[\p{Emoji}\u200d\uFE0F\d\s]{1,15}$/u;
      if (mentionPattern.test(text)) {
        return { isSpam: true, reason: '特征匹配: Bot 引流艾特后缀' };
      }

      const shortTrafficPattern = /(?:比她|好看|骚|看主|置顶|资源|私聊|福利|主页|吃瓜).*@[\w_]{3,20}/i;
      if (shortTrafficPattern.test(text)) {
        return { isSpam: true, reason: '特征匹配: 引流诱导 + @账号' };
      }
    }

    // 4. Copypasta check
    if (currentSettings.filterDuplicates) {
      const normalized = normalizeTextForComparison(text);
      if (normalized.length >= 6) {
        let authors = threadTextOccurrences.get(normalized);
        if (!authors) {
          authors = new Set();
          threadTextOccurrences.set(normalized, authors);
        }

        if (authorHandle) {
          authors.add(authorHandle);
        }

        if (authors.size >= 2) {
          return { isSpam: true, reason: `重复刷屏评论 (${authors.size} 个账号发送相同内容)` };
        }
      }
    }

    return { isSpam: false };
  }

  function getAuthorHandle(tweetElement) {
    const userLink = tweetElement.querySelector('div[data-testid="User-Name"] a[href^="/"]');
    if (userLink) {
      const href = userLink.getAttribute('href') || '';
      const match = href.match(/^\/([a-zA-Z0-9_]+)/);
      if (match) return match[1];
    }
    return '';
  }

  function isPrimaryMainTweet(tweetElement) {
    const primaryColumn = document.querySelector('div[data-testid="primaryColumn"]') || document.querySelector('main');
    if (!primaryColumn) return false;

    const allTweets = Array.from(primaryColumn.querySelectorAll('article[data-testid="tweet"]'));
    if (allTweets.length > 0 && allTweets[0] === tweetElement) {
      return isStatusPage();
    }
    return false;
  }

  function processTweet(tweetElement) {
    if (!currentSettings.enabled) return;
    if (tweetElement.dataset.xSpamProcessed === 'true') return;

    if (isPrimaryMainTweet(tweetElement)) {
      tweetElement.dataset.xSpamProcessed = 'true';
      return;
    }

    const tweetTextEl = tweetElement.querySelector('[data-testid="tweetText"]');
    const text = tweetTextEl ? tweetTextEl.textContent.trim() : '';
    const authorHandle = getAuthorHandle(tweetElement);

    const checkResult = evaluateSpam(tweetElement, text, authorHandle);
    tweetElement.dataset.xSpamProcessed = 'true';

    if (checkResult.isSpam) {
      tweetElement.dataset.xSpamReason = checkResult.reason;
      tweetElement.dataset.xSpamRawText = text;

      chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED_COUNT', delta: 1 }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
      });

      if (currentSettings.hideMode === 'hide') {
        const cell = tweetElement.closest('[data-testid="cellInnerDiv"]') || tweetElement;
        cell.classList.add('x-spam-cell-hidden');
      } else {
        tweetElement.classList.add('x-spam-tweet-collapsed');
      }
    }
  }

  // Group consecutive collapsed spam comments into clean single aggregate cards
  function updateClusterCards() {
    if (currentSettings.hideMode === 'hide' || !currentSettings.enabled) return;

    const primaryColumn = document.querySelector('div[data-testid="primaryColumn"]') || document.querySelector('main');
    if (!primaryColumn) return;

    // Remove obsolete cards
    document.querySelectorAll('.x-spam-collapsed-card, .x-spam-cluster-card').forEach(card => card.remove());

    const allCells = Array.from(primaryColumn.querySelectorAll('div[data-testid="cellInnerDiv"]'));
    let currentCluster = [];

    function flushCluster() {
      if (currentCluster.length === 0) return;

      if (currentCluster.length === 1 || !currentSettings.groupConsecutive) {
        // Render single cards
        for (const { tweetEl, reason, text } of currentCluster) {
          renderSingleCard(tweetEl, reason, text);
        }
      } else {
        // Render aggregate cluster card
        renderClusterCard(currentCluster);
      }
      currentCluster = [];
    }

    for (const cell of allCells) {
      const tweetEl = cell.querySelector('article[data-testid="tweet"]');
      if (tweetEl && tweetEl.dataset.xSpamReason) {
        currentCluster.push({
          cell,
          tweetEl,
          reason: tweetEl.dataset.xSpamReason,
          text: tweetEl.dataset.xSpamRawText || ''
        });
      } else {
        flushCluster();
      }
    }
    flushCluster();
  }

  function renderSingleCard(tweetElement, reason, rawText) {
    const card = document.createElement('div');
    card.className = 'x-spam-collapsed-card';

    const snippet = rawText.length > 24 ? rawText.slice(0, 24) + '...' : rawText;

    card.innerHTML = `
      <div class="x-spam-left">
        <span class="x-spam-tag">🚫 已折叠垃圾评论</span>
        <span class="x-spam-reason" title="${escapeHtml(reason + (snippet ? ' · ' + snippet : ''))}">${escapeHtml(reason)} ${snippet ? '· ' + escapeHtml(snippet) : ''}</span>
      </div>
      <button class="x-spam-expand-btn" type="button">展开查看</button>
    `;

    card.querySelector('.x-spam-expand-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      tweetElement.classList.remove('x-spam-tweet-collapsed');
      delete tweetElement.dataset.xSpamReason;
      card.remove();
    });

    tweetElement.parentNode.insertBefore(card, tweetElement);
  }

  function renderClusterCard(clusterItems) {
    const firstTweetEl = clusterItems[0].tweetEl;
    const count = clusterItems.length;

    const reasons = Array.from(new Set(clusterItems.map(item => item.reason.replace(/^匹配关键词:\s*"?|"?$/g, '')))).slice(0, 3).join(', ');

    const card = document.createElement('div');
    card.className = 'x-spam-cluster-card';

    card.innerHTML = `
      <div class="x-spam-left">
        <span class="x-spam-tag x-spam-cluster-tag">🚫 已连续折叠 ${count} 条垃圾评论</span>
        <span class="x-spam-reason" title="${escapeHtml(reasons)}">(${escapeHtml(reasons)}${reasons ? ' 等' : ''})</span>
      </div>
      <button class="x-spam-expand-btn" type="button">展开全部 (${count})</button>
    `;

    card.querySelector('.x-spam-expand-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      for (const item of clusterItems) {
        item.tweetEl.classList.remove('x-spam-tweet-collapsed');
        delete item.tweetEl.dataset.xSpamReason;
      }
      card.remove();
    });

    firstTweetEl.parentNode.insertBefore(card, firstTweetEl);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function scanTweets() {
    if (isScanning || !currentSettings.enabled) return;
    isScanning = true;

    try {
      checkUrlChange();
      const tweets = document.querySelectorAll('article[data-testid="tweet"]:not([data-x-spam-processed="true"])');
      let foundNew = false;
      for (const tweet of tweets) {
        processTweet(tweet);
        foundNew = true;
      }

      // Update aggregate cards
      updateClusterCards();
    } finally {
      isScanning = false;
    }
  }

  function scheduleScan(delay = 100) {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(scanTweets, delay);
  }

  // Observe DOM additions (tweets dynamically injected by SPA)
  const observer = new MutationObserver((mutations) => {
    let hasRelevantNodes = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasRelevantNodes = true;
        break;
      }
    }
    if (hasRelevantNodes) {
      scheduleScan(120);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  scheduleScan(150);
})();
