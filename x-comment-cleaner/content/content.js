/**
 * X Spam Reply Cleaner - Content Script
 */

(function () {
  'use strict';

  const defaultDict = typeof X_SPAM_DICTIONARY !== 'undefined' ? X_SPAM_DICTIONARY : [];
  const defaultPatterns = typeof X_SPAM_PATTERNS !== 'undefined' ? X_SPAM_PATTERNS : [];

  let currentSettings = {
    enabled: true,
    hideMode: 'collapse', // 'collapse' or 'hide'
    filterKeywords: true,
    filterHomophones: true,
    filterMentionSpam: true,
    filterDuplicates: true,
    keywords: defaultDict,
    blockedCount: 0
  };

  let currentThreadUrl = '';
  const threadTextOccurrences = new Map(); // normalizedText -> Set of author handles
  let isScanning = false;
  let scanDebounceTimer = null;

  // Track cluster expand state across DOM re-renders
  const clusterExpandedState = new Map(); // clusterKey -> boolean

  // Load stored settings
  chrome.storage.sync.get(null, (stored) => {
    if (chrome.runtime.lastError) return;
    currentSettings = {
      ...currentSettings,
      ...stored,
      keywords: Array.isArray(stored.keywords) && stored.keywords.length > 0 ? stored.keywords : defaultDict
    };
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
      clusterExpandedState.clear();
      resetProcessedMarks();
    }
  }

  function resetProcessedMarks() {
    document.querySelectorAll('[data-x-spam-processed]').forEach((el) => {
      delete el.dataset.xSpamProcessed;
      delete el.dataset.xSpamReason;
      delete el.dataset.xSpamText;
      delete el.dataset.xSpam;
      el.classList.remove('x-spam-cell-hidden-by-cleaner');
    });

    document.querySelectorAll('.x-spam-cluster-bar').forEach((bar) => {
      bar.remove();
    });
  }

  function restoreAll() {
    document.querySelectorAll('.x-spam-cell-hidden-by-cleaner').forEach((el) => {
      el.classList.remove('x-spam-cell-hidden-by-cleaner');
    });
    document.querySelectorAll('.x-spam-cluster-bar').forEach((bar) => {
      bar.remove();
    });
  }

  // Symbol, homophone and variant normalization
  function normalizeTextForMatching(text) {
    if (!text) return '';
    let s = text.toLowerCase();

    if (currentSettings.filterHomophones) {
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

  function evaluateSpam(text, authorHandle) {
    if (!text) return { isSpam: false };

    const lowerText = text.toLowerCase();
    const normalizedText = normalizeTextForMatching(text);

    // 1. Curated / custom keywords check
    if (currentSettings.filterKeywords && Array.isArray(currentSettings.keywords)) {
      for (const kw of currentSettings.keywords) {
        const trimmed = kw.trim();
        if (!trimmed) continue;
        const normKw = normalizeTextForMatching(trimmed);

        if (lowerText.includes(trimmed.toLowerCase()) || (normKw && normalizedText.includes(normKw))) {
          return { isSpam: true, reason: trimmed };
        }
      }
    }

    // 2. Homophone & Bait sentence heuristics
    if (currentSettings.filterHomophones) {
      if (/(?:没人|谁)比我.*(?:玩|骚|放|浪)/i.test(normalizedText)) {
        return { isSpam: true, reason: '诱导话术' };
      }
      if (/(?:不黑|水多|粉嫩|耐操|反差|大瓜).*不信/i.test(normalizedText)) {
        return { isSpam: true, reason: '诱导话术' };
      }
      if (/(?:看主页|看置顶|看相册|私信我|进群).*(?:福利|无门槛|吃瓜|资源|相册)/i.test(normalizedText)) {
        return { isSpam: true, reason: '引流诱导' };
      }

      for (const pattern of defaultPatterns) {
        if (pattern.test(text) || pattern.test(normalizedText)) {
          return { isSpam: true, reason: '特征匹配' };
        }
      }
    }

    // 3. Mention Spam Pattern (短语 + @mention + 随机Emoji/数字)
    if (currentSettings.filterMentionSpam) {
      const mentionPattern = /@[\w_]{3,20}\s*[\p{Emoji}\u200d\uFE0F\d\s]{1,15}$/u;
      if (mentionPattern.test(text)) {
        return { isSpam: true, reason: 'Bot 引流艾特' };
      }
    }

    // 4. Copypasta / duplicate reply check
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
          return { isSpam: true, reason: `重复刷屏 (${authors.size} 账号同发)` };
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

  function getTopLevelTimelineCells() {
    const primaryColumn = document.querySelector('div[data-testid="primaryColumn"]') || document.querySelector('main');
    if (!primaryColumn) return [];

    const allCells = Array.from(primaryColumn.querySelectorAll('div[data-testid="cellInnerDiv"]'));
    if (allCells.length === 0) return [];

    // Filter only top-level cells (never nested inside another cellInnerDiv)
    return allCells.filter(cell => !cell.parentElement.closest('div[data-testid="cellInnerDiv"]'));
  }

  function findRepliesStartIndex(topCells) {
    // 1. Find composer cell (Post your reply)
    for (let i = 0; i < topCells.length; i++) {
      const cell = topCells[i];
      if (cell.querySelector('[data-testid="tweetTextarea_0"]') ||
          cell.querySelector('[data-testid="inline_reply_composer"]') ||
          cell.querySelector('[data-testid="tweetTextarea_0_label"]') ||
          cell.querySelector('div[role="progressbar"]')) {
        return i + 1;
      }
    }

    // 2. Fallback: find focal main tweet matching status ID
    const currentUrl = window.location.href;
    const statusMatch = currentUrl.match(/\/status\/(\d+)/);
    const statusId = statusMatch ? statusMatch[1] : null;

    if (statusId) {
      for (let i = 0; i < topCells.length; i++) {
        const cell = topCells[i];
        const tweet = cell.querySelector('article[data-testid="tweet"]');
        if (tweet && tweet.querySelector(`a[href*="/status/${statusId}"]`)) {
          return i + 1;
        }
      }
    }

    // Default: skip the first cell
    return 1;
  }

  function scanAndGroupTimeline() {
    if (isScanning || !currentSettings.enabled) return;
    if (!isStatusPage()) return; // Only operate on post threads

    isScanning = true;

    try {
      checkUrlChange();
      const topCells = getTopLevelTimelineCells();
      if (topCells.length === 0) return;

      const startIndex = findRepliesStartIndex(topCells);

      // Ensure main post cells are never marked as spam or hidden
      for (let i = 0; i < startIndex && i < topCells.length; i++) {
        const mainCell = topCells[i];
        delete mainCell.dataset.xSpam;
        delete mainCell.dataset.xSpamReason;
        delete mainCell.dataset.xSpamText;
        mainCell.classList.remove('x-spam-cell-hidden-by-cleaner');
      }

      // Process reply cells
      for (let i = startIndex; i < topCells.length; i++) {
        const cell = topCells[i];
        const tweetElement = cell.querySelector('article[data-testid="tweet"]');

        if (!tweetElement) {
          // If no tweet (e.g. spacer / ad / loading), skip
          continue;
        }

        if (tweetElement.dataset.xSpamProcessed !== 'true') {
          tweetElement.dataset.xSpamProcessed = 'true';
          const tweetTextEl = tweetElement.querySelector('[data-testid="tweetText"]');
          const text = tweetTextEl ? tweetTextEl.textContent.trim() : '';
          const authorHandle = getAuthorHandle(tweetElement);

          const checkResult = evaluateSpam(text, authorHandle);

          if (checkResult.isSpam) {
            cell.dataset.xSpam = 'true';
            cell.dataset.xSpamReason = checkResult.reason;
            cell.dataset.xSpamText = text;

            chrome.runtime.sendMessage({ type: 'INCREMENT_BLOCKED_COUNT', delta: 1 }, () => {
              if (chrome.runtime.lastError) { /* ignore */ }
            });
          } else {
            delete cell.dataset.xSpam;
            delete cell.dataset.xSpamReason;
            delete cell.dataset.xSpamText;
          }
        }
      }

      // Build consecutive clusters for replies
      const clusters = [];
      let currentCluster = [];

      for (let i = startIndex; i < topCells.length; i++) {
        const cell = topCells[i];
        if (cell.dataset.xSpam === 'true') {
          currentCluster.push(cell);
        } else {
          if (currentCluster.length > 0) {
            clusters.push(currentCluster);
            currentCluster = [];
          }
        }
      }
      if (currentCluster.length > 0) {
        clusters.push(currentCluster);
      }

      // Clean up existing bars
      document.querySelectorAll('.x-spam-cluster-bar').forEach(b => b.remove());

      if (currentSettings.hideMode === 'hide') {
        for (const cluster of clusters) {
          for (const cell of cluster) {
            cell.classList.add('x-spam-cell-hidden-by-cleaner');
          }
        }
        return;
      }

      // Render single aggregate bar per cluster
      for (const cluster of clusters) {
        const firstCell = cluster[0];
        const count = cluster.length;
        const sampleReasons = Array.from(new Set(cluster.map(c => c.dataset.xSpamReason).filter(Boolean))).slice(0, 3).join(', ');

        const clusterKey = cluster.map(c => c.dataset.xSpamText?.slice(0, 10) || '').join('|');
        const isExpanded = clusterExpandedState.get(clusterKey) === true;

        const bar = document.createElement('div');
        bar.className = 'x-spam-cluster-bar' + (isExpanded ? ' is-expanded' : '');

        const reasonDesc = sampleReasons ? ` · (${escapeHtml(sampleReasons)}${sampleReasons ? ' 等' : ''})` : '';

        bar.innerHTML = `
          <div class="x-spam-cluster-left">
            <span class="x-spam-cluster-tag">🚫 已折叠 ${count} 条垃圾评论</span>
            <span class="x-spam-cluster-info" title="${escapeHtml(sampleReasons)}">${reasonDesc}</span>
          </div>
          <button class="x-spam-cluster-btn" type="button">${isExpanded ? `重新收起 (${count})` : `展开全部 (${count})`}</button>
        `;

        for (const cell of cluster) {
          if (isExpanded) {
            cell.classList.remove('x-spam-cell-hidden-by-cleaner');
          } else {
            cell.classList.add('x-spam-cell-hidden-by-cleaner');
          }
        }

        const btn = bar.querySelector('.x-spam-cluster-btn');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const nextState = !bar.classList.contains('is-expanded');
          clusterExpandedState.set(clusterKey, nextState);

          if (nextState) {
            bar.classList.add('is-expanded');
            btn.textContent = `重新收起 (${count})`;
            for (const cell of cluster) {
              cell.classList.remove('x-spam-cell-hidden-by-cleaner');
            }
          } else {
            bar.classList.remove('is-expanded');
            btn.textContent = `展开全部 (${count})`;
            for (const cell of cluster) {
              cell.classList.add('x-spam-cell-hidden-by-cleaner');
            }
          }
        });

        firstCell.parentNode.insertBefore(bar, firstCell);
      }

    } finally {
      isScanning = false;
    }
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

  function scheduleScan(delay = 100) {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(scanAndGroupTimeline, delay);
  }

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
