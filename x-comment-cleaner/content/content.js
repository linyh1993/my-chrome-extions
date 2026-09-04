/**
 * X Spam Reply Cleaner - Content Script
 */

(function () {
  'use strict';

  let currentSettings = {
    enabled: true,
    hideMode: 'collapse', // 'collapse' or 'hide'
    filterKeywords: true,
    filterMentionSpam: true,
    filterDuplicates: true,
    keywords: [
      '比她好看', '没她骚', '看主页', '看主頁', '看置顶',
      '私信', '私聊', '私我', '进群', '加v', '加V',
      '加VX', '门槛', '门槛群', '福利', '同城', '约拍',
      '资源群', '群内看', '微密圈', '无圣光'
    ],
    blockedCount: 0
  };

  // Cache for duplicate detection per status thread
  let currentThreadUrl = '';
  const threadTextOccurrences = new Map(); // normalizedText -> Set of author handles
  let isScanning = false;
  let scanDebounceTimer = null;

  // Load initial settings
  chrome.storage.sync.get(null, (stored) => {
    if (chrome.runtime.lastError) return;
    currentSettings = { ...currentSettings, ...stored };
    scheduleScan(50);
  });

  // Listen for storage changes from Popup
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
      // If disabled, restore all hidden/collapsed items
      if (!currentSettings.enabled) {
        restoreAll();
      } else {
        // Re-process all cells
        resetProcessedMarks();
        scheduleScan(100);
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
      delete el.dataset.xSpamOriginalDisplay;
      el.classList.remove('x-spam-tweet-collapsed', 'x-spam-cell-hidden');
    });

    document.querySelectorAll('.x-spam-collapsed-card').forEach((card) => {
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
    document.querySelectorAll('.x-spam-collapsed-card').forEach((card) => {
      card.remove();
    });
  }

  function normalizeTextForComparison(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/@[\w_]+/g, '') // remove @mentions
      .replace(/[\s\p{Emoji}\u200d\uFE0F\d.,!?;:，。！？；：_~`@#$%^&*()+\-=[\]{}|\\/<>'"“”‘’]+/gu, '') // remove symbols & emojis & numbers
      .trim();
  }

  function evaluateSpam(tweetElement, text, authorHandle) {
    if (!text) return { isSpam: false };

    const lowerText = text.toLowerCase();

    // 1. Keyword check
    if (currentSettings.filterKeywords && Array.isArray(currentSettings.keywords)) {
      for (const kw of currentSettings.keywords) {
        const trimmed = kw.trim().toLowerCase();
        if (trimmed && lowerText.includes(trimmed)) {
          return { isSpam: true, reason: `匹配关键词: "${kw.trim()}"` };
        }
      }
    }

    // 2. Mention Spam / Bot 引流模式识别
    // 典型特征: 文本以引导语开头 + @引流账号 + 尾随随机 Emoji 或数字，例如 "...@lldidii 🏃3💃"
    if (currentSettings.filterMentionSpam) {
      const mentionPattern = /@[\w_]{3,20}\s*[\p{Emoji}\u200d\uFE0F\d\s]{1,15}$/u;
      if (mentionPattern.test(text)) {
        return { isSpam: true, reason: '特征匹配: Bot 引流艾特后缀' };
      }

      // 引流短语 + @mention 结合
      const shortTrafficPattern = /(?:比她|好看|骚|看主|置顶|资源|私聊|福利|主页).*@[\w_]{3,20}/i;
      if (shortTrafficPattern.test(text)) {
        return { isSpam: true, reason: '特征匹配: 引流诱导 + @账号' };
      }
    }

    // 3. 同帖重复刷屏评论检测 (Copypasta)
    if (currentSettings.filterDuplicates) {
      const normalized = normalizeTextForComparison(text);
      if (normalized.length >= 6) { // Only track meaningful phrase length
        let authors = threadTextOccurrences.get(normalized);
        if (!authors) {
          authors = new Set();
          threadTextOccurrences.set(normalized, authors);
        }

        if (authorHandle) {
          authors.add(authorHandle);
        }

        // If 2 or more different accounts post this same normalized text in the thread
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
    // In status view, the focal main tweet has specific characteristics
    // Check if it is the first article inside the primaryColumn before replies
    const primaryColumn = document.querySelector('div[data-testid="primaryColumn"]') || document.querySelector('main');
    if (!primaryColumn) return false;

    const allTweets = Array.from(primaryColumn.querySelectorAll('article[data-testid="tweet"]'));
    if (allTweets.length > 0 && allTweets[0] === tweetElement) {
      // First tweet in status page is the main focal tweet
      return isStatusPage();
    }
    return false;
  }

  function processTweet(tweetElement) {
    if (!currentSettings.enabled) return;
    if (tweetElement.dataset.xSpamProcessed === 'true') return;

    // Never filter the focal main post
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
      
      // Increment blocked count in background
      chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED_COUNT', delta: 1 }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
      });

      if (currentSettings.hideMode === 'hide') {
        const cell = tweetElement.closest('[data-testid="cellInnerDiv"]') || tweetElement;
        cell.classList.add('x-spam-cell-hidden');
      } else {
        // Collapse mode
        collapseTweet(tweetElement, checkResult.reason, text);
      }
    }
  }

  function collapseTweet(tweetElement, reason, rawText) {
    tweetElement.classList.add('x-spam-tweet-collapsed');

    // Create collapsed card
    const existingCard = tweetElement.parentElement?.querySelector(`.x-spam-collapsed-card[data-for-id="${tweetElement.id || 't'}"]`);
    if (existingCard) return;

    const card = document.createElement('div');
    card.className = 'x-spam-collapsed-card';
    card.dataset.forId = tweetElement.id || 't';

    const snippet = rawText.length > 28 ? rawText.slice(0, 28) + '...' : rawText;

    card.innerHTML = `
      <div class="x-spam-left">
        <span class="x-spam-tag">🚫 已折叠垃圾评论</span>
        <span class="x-spam-reason" title="${escapeHtml(reason + (snippet ? ' | ' + snippet : ''))}">${escapeHtml(reason)} ${snippet ? '· ' + escapeHtml(snippet) : ''}</span>
      </div>
      <button class="x-spam-expand-btn" type="button">展开查看</button>
    `;

    const expandBtn = card.querySelector('.x-spam-expand-btn');
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      tweetElement.classList.remove('x-spam-tweet-collapsed');
      card.remove();
    });

    tweetElement.parentNode.insertBefore(card, tweetElement);
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
      for (const tweet of tweets) {
        processTweet(tweet);
      }
    } finally {
      isScanning = false;
    }
  }

  function scheduleScan(delay = 120) {
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

  // Initial trigger
  scheduleScan(200);
})();
