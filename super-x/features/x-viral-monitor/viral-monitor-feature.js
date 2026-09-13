/**
 * SuperX Feature: x-viral-monitor (推文流速与爆帖监控)
 * 核心能力：
 * 1. 实时分析推文每小时浏览流速 (views/h) 与综合爆帖指数 (0~100)
 * 2. 在时间线渲染三级热度徽章 (🌱 正常 / 🚀 热门 / 🔥 爆帖) 与悬浮指标卡
 * 3. 补齐 X 官方时间线隐藏的书签数展示
 * 4. 推文一键复制为结构化 Markdown
 * 5. 与 Sidepanel / 大盘协同的实时流速排行榜
 */
(function() {
  'use strict';

  window.__SuperX__ = window.__SuperX__ || {};

  const FEATURE_ID = 'x-viral-monitor';
  const STORAGE_KEY_CONFIG = 'superx_viral_monitor_config';
  const STORAGE_KEY_LEADERBOARD = 'superx_viral_leaderboard';
  const MAX_TWEET_STORE = 300;

  const DEFAULT_CONFIG = {
    enabled: true,
    showBadges: true,
    showBookmarkCount: true,
    copyAsMarkdown: true,
    thresholdTrending: 1000,
    thresholdViral: 10000
  };

  class ViralMonitorFeature {
    constructor() {
      this.id = FEATURE_ID;
      this.name = '推文流速与爆帖监控';
      this.defaultEnabled = true;

      this.context = null;
      this.config = { ...DEFAULT_CONFIG };
      this.tweetStore = new Map(); // tweetId -> tweetData
      this.tooltipEl = null;
      this.renderDebounceTimer = null;
      this.leaderboardBroadcastTimer = null;
    }

    async init(context) {
      this.context = context;

      // 1. 读取持久化配置
      try {
        const stored = await chrome.storage.local.get([STORAGE_KEY_CONFIG]);
        if (stored[STORAGE_KEY_CONFIG]) {
          this.config = { ...DEFAULT_CONFIG, ...stored[STORAGE_KEY_CONFIG] };
        }
      } catch (err) {
        console.warn('[SuperX ViralMonitor] Failed to read config:', err);
      }

      // 2. 初始化悬浮 Tooltip 容器
      this._initTooltip();

      // 3. 监听全局事件与来自 Sidepanel 的操作
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || !msg.type) return;

        if (msg.type === 'SUPERX_VIRAL_GET_LEADERBOARD') {
          sendResponse({ success: true, list: this._getLeaderboard(15) });
          return true;
        }

        if (msg.type === 'SUPERX_VIRAL_SCROLL_TO_TWEET') {
          const ok = this._scrollToTweet(msg.tweetId);
          sendResponse({ success: ok });
          return true;
        }

        if (msg.type === 'SUPERX_VIRAL_UPDATE_CONFIG') {
          if (msg.config) {
            this.config = { ...this.config, ...msg.config };
            chrome.storage.local.set({ [STORAGE_KEY_CONFIG]: this.config });
            this._refreshUi();
          }
          sendResponse({ success: true });
          return true;
        }
      });
    }

    async enable() {
      this.config.enabled = true;
      document.body.classList.add('superx-viral-enabled');
      this._processVisibleArticles();
    }

    async disable() {
      this.config.enabled = false;
      document.body.classList.remove('superx-viral-enabled');
      document.querySelectorAll('.superx-viral-badge, .superx-bookmark-count, .superx-copy-md-btn').forEach(el => el.remove());
      document.querySelectorAll('article[data-superx-viral-processed]').forEach(a => a.removeAttribute('data-superx-viral-processed'));
      if (this.tooltipEl) this.tooltipEl.style.display = 'none';
    }

    /**
     * 响应核心 DOMObserver 观察到的新推文节点
     */
    onDOMNodes(nodes) {
      if (!this.config.enabled) return;
      this._scheduleRender();
    }

    /**
     * 响应底座网络劫持截获的 GraphQL 数据
     */
    onGraphQLResponse(endpoint, data) {
      if (!this.config.enabled || !data) return;
      let foundNew = false;

      // 递归提取所有推文对象
      const extractTweets = (obj) => {
        if (!obj || typeof obj !== 'object') return;

        const result = obj.tweet_results?.result || obj.tweetResult?.result || obj.tweetResults?.result;
        if (result) {
          const parsed = this._parseGraphQLTweet(result);
          if (parsed && parsed.id) {
            this.tweetStore.set(parsed.id, parsed);
            foundNew = true;
          }
        }

        if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) extractTweets(obj[i]);
        } else {
          for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v && typeof v === 'object') extractTweets(v);
          }
        }
      };

      try {
        extractTweets(data);
      } catch (err) {
        // 容错防止深层解析异常
      }

      // 控制 Map 最大容量
      if (this.tweetStore.size > MAX_TWEET_STORE) {
        const keys = Array.from(this.tweetStore.keys());
        const removeCount = keys.length - MAX_TWEET_STORE;
        for (let i = 0; i < removeCount; i++) {
          this.tweetStore.delete(keys[i]);
        }
      }

      if (foundNew) {
        this._scheduleRender();
        this._scheduleLeaderboardBroadcast();
      }
    }

    // ================= 核心计算与数据解析 =================

    _parseGraphQLTweet(result) {
      const tweet = result.tweet || result;
      const legacy = tweet.legacy;
      if (!legacy || !legacy.id_str) return null;

      const viewCount = parseInt(tweet.views?.count, 10) || 0;
      const screenName = tweet.core?.user_results?.result?.legacy?.screen_name ||
                         tweet.core?.user_results?.result?.core?.screen_name || '';
      const text = tweet.note_tweet?.note_tweet_results?.result?.text || legacy.full_text || '';

      return {
        id: legacy.id_str,
        screenName,
        views: viewCount,
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        replies: legacy.reply_count || 0,
        bookmarks: legacy.bookmark_count || 0,
        createdAt: legacy.created_at || '',
        text,
        url: screenName && legacy.id_str ? `https://x.com/${screenName}/status/${legacy.id_str}` : ''
      };
    }

    _getTweetData(article, tweetId) {
      let data = this.tweetStore.get(tweetId);
      if (data && data.views > 0 && data.createdAt) return data;

      // DOM 兜底扫描
      const timeEl = article.querySelector('time[datetime]');
      const analyticsEl = article.querySelector(`a[href*="/status/${tweetId}/analytics"]`);
      const textEl = article.querySelector('[data-testid="tweetText"]');
      const userLink = article.querySelector(`a[href*="/status/${tweetId}"]`);

      const parseNumber = (el) => {
        if (!el) return 0;
        const raw = el.getAttribute('aria-label') || el.textContent || '';
        const match = raw.match(/\d[\d.,\s\u00a0\u202f]*/);
        if (!match) return 0;
        return parseInt(match[0].replace(/\D/g, ''), 10) || 0;
      };

      const views = analyticsEl ? parseNumber(analyticsEl) : (data?.views || 0);
      const createdAt = timeEl ? timeEl.getAttribute('datetime') : (data?.createdAt || '');
      const screenName = userLink ? (userLink.getAttribute('href')?.match(/^\/([^/]+)\/status\//)?.[1] || '') : (data?.screenName || '');

      const likes = parseNumber(article.querySelector('button[data-testid="like"], button[data-testid="unlike"]')) || data?.likes || 0;
      const retweets = parseNumber(article.querySelector('button[data-testid="retweet"]')) || data?.retweets || 0;
      const replies = parseNumber(article.querySelector('button[data-testid="reply"]')) || data?.replies || 0;
      const bookmarks = parseNumber(article.querySelector('button[data-testid="bookmark"]')) || data?.bookmarks || 0;

      data = {
        id: tweetId,
        screenName,
        views,
        likes,
        retweets,
        replies,
        bookmarks,
        createdAt,
        text: textEl ? textEl.textContent : (data?.text || ''),
        url: screenName ? `https://x.com/${screenName}/status/${tweetId}` : (data?.url || `https://x.com/i/status/${tweetId}`)
      };

      if (views > 0 || createdAt) {
        this.tweetStore.set(tweetId, data);
      }
      return data;
    }

    _computeMetrics(data) {
      if (!data || !data.createdAt) {
        return {
          velocity: 0,
          formattedVelocity: '0',
          score: 0,
          level: 'normal',
          levelEmoji: '🌱',
          levelLabel: '平稳',
          engagementRate: '0%',
          rtRatio: '0%',
          bmRatio: '0%',
          hoursText: '--'
        };
      }

      const now = Date.now();
      const createdTime = new Date(data.createdAt).getTime();
      const hours = Math.max((now - createdTime) / 3600000, 0.05); // 至少 3 分钟，防除以零
      const views = data.views || 0;
      const velocity = Math.round(views / hours);

      // 综合爆帖指数评分 (0~100)
      // 1. 流速分 (0~40): 50,000/h 满分
      const velocityScore = Math.min(velocity / 50000, 1) * 40;

      // 2. 互动率 (0~25): 互动数/浏览量，10% 满分
      const engagements = (data.likes || 0) + (data.retweets || 0) + (data.replies || 0);
      const engagementRate = views > 0 ? (engagements / views) : 0;
      const engagementScore = Math.min(engagementRate / 0.1, 1) * 25;

      // 3. 转赞比 (0~20): 转发/点赞，50% 满分
      const rtRatio = (data.likes > 0) ? ((data.retweets || 0) / data.likes) : 0;
      const rtScore = Math.min(rtRatio / 0.5, 1) * 20;

      // 4. 藏赞比 (0~15): 收藏/点赞，30% 满分
      const bmRatio = (data.likes > 0) ? ((data.bookmarks || 0) / data.likes) : 0;
      const bmScore = Math.min(bmRatio / 0.3, 1) * 15;

      const totalScore = Math.min(Math.round(velocityScore + engagementScore + rtScore + bmScore), 100);

      let level = 'normal';
      let levelEmoji = '🌱';
      let levelLabel = '正常';

      if (velocity >= this.config.thresholdViral) {
        level = 'viral';
        levelEmoji = '🔥';
        levelLabel = '爆帖';
      } else if (velocity >= this.config.thresholdTrending) {
        level = 'trending';
        levelEmoji = '🚀';
        levelLabel = '热门';
      }

      const formatNum = (v) => {
        if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
        if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
        return String(v);
      };

      const formatElapsed = (h) => {
        if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分钟前`;
        if (h < 24) return `${h.toFixed(1)} 小时前`;
        const days = Math.floor(h / 24);
        return `${days} 天前`;
      };

      return {
        velocity,
        formattedVelocity: formatNum(velocity) + '/h',
        score: totalScore,
        level,
        levelEmoji,
        levelLabel,
        engagementRate: (engagementRate * 100).toFixed(1) + '%',
        rtRatio: (rtRatio * 100).toFixed(1) + '%',
        bmRatio: (bmRatio * 100).toFixed(1) + '%',
        hoursText: formatElapsed(hours)
      };
    }

    // ================= DOM 渲染与徽章注入 =================

    _scheduleRender() {
      if (this.renderDebounceTimer) clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = setTimeout(() => {
        this._processVisibleArticles();
      }, 150);
    }

    _refreshUi() {
      document.querySelectorAll('.superx-viral-badge, .superx-bookmark-count, .superx-copy-md-btn').forEach(el => el.remove());
      document.querySelectorAll('article[data-superx-viral-processed]').forEach(a => a.removeAttribute('data-superx-viral-processed'));
      this._processVisibleArticles();
    }

    _processVisibleArticles() {
      if (!this.config.enabled) return;

      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (const article of articles) {
        const tweetId = this._getTweetIdFromArticle(article);
        if (!tweetId) continue;

        const data = this._getTweetData(article, tweetId);
        if (!data) continue;

        const metrics = this._computeMetrics(data);

        // 1. 注入流速徽章
        if (this.config.showBadges && metrics.velocity > 0) {
          this._injectVelocityBadge(article, tweetId, data, metrics);
        }

        // 2. 注入书签数
        if (this.config.showBookmarkCount) {
          this._injectBookmarkCount(article, data);
        }

        // 3. 注入一键复制 Markdown
        if (this.config.copyAsMarkdown) {
          this._injectCopyMarkdownBtn(article, data);
        }

        article.setAttribute('data-superx-viral-processed', tweetId);
      }
    }

    _getTweetIdFromArticle(article) {
      const statusLink = article.querySelector('a[href*="/status/"]');
      if (!statusLink) return null;
      const match = statusLink.getAttribute('href')?.match(/\/status\/(\d+)/);
      return match ? match[1] : null;
    }

    _injectVelocityBadge(article, tweetId, data, metrics) {
      let badge = article.querySelector('.superx-viral-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = `superx-viral-badge superx-badge-${metrics.level}`;

        // 寻找注入位置：优先置于互动操作组后方，或者置于用户 handle 后方
        const group = article.querySelector('[role="group"]');
        if (group) {
          group.appendChild(badge);
        } else {
          const userBlock = article.querySelector('[data-testid="User-Name"]');
          if (userBlock) userBlock.appendChild(badge);
          else return;
        }

        // 鼠标移入展开详细指标卡
        badge.addEventListener('mouseenter', (e) => {
          this._showTooltip(e.currentTarget, data, metrics);
        });
        badge.addEventListener('mouseleave', () => {
          this._hideTooltip();
        });
      }

      // 更新徽章内容与状态
      badge.className = `superx-viral-badge superx-badge-${metrics.level}`;
      badge.innerHTML = `
        <span class="superx-badge-emoji">${metrics.levelEmoji}</span>
        <span class="superx-badge-val">${metrics.formattedVelocity}</span>
        <span class="superx-badge-score">${metrics.score}分</span>
      `;
    }

    _injectBookmarkCount(article, data) {
      if (data.bookmarks === undefined || data.bookmarks === null) return;
      const bookmarkBtn = article.querySelector('button[data-testid="bookmark"]');
      if (!bookmarkBtn) return;

      let countSpan = bookmarkBtn.parentElement?.querySelector('.superx-bookmark-count');
      if (!countSpan) {
        countSpan = document.createElement('span');
        countSpan.className = 'superx-bookmark-count';
        bookmarkBtn.parentElement?.appendChild(countSpan);
      }
      countSpan.textContent = data.bookmarks > 0 ? this._formatCompact(data.bookmarks) : '';
    }

    _injectCopyMarkdownBtn(article, data) {
      const group = article.querySelector('[role="group"]');
      if (!group || group.querySelector('.superx-copy-md-btn')) return;

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'superx-copy-md-btn';
      copyBtn.setAttribute('title', '复制推文为 Markdown 格式');
      copyBtn.setAttribute('aria-label', '复制为 Markdown');
      copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
        </svg>
        <span class="copy-text">MD</span>
      `;

      copyBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this._copyTweetAsMarkdown(data, copyBtn);
      };

      group.appendChild(copyBtn);
    }

    async _copyTweetAsMarkdown(data, btn) {
      const md = `> **@${data.screenName || 'user'}** · [原文链接](${data.url})\n>\n> ${data.text.replace(/\n/g, '\n> ')}\n\n*📊 浏览: ${data.views.toLocaleString()} | 点赞: ${data.likes.toLocaleString()} | 转发: ${data.retweets.toLocaleString()} | 收藏: ${data.bookmarks.toLocaleString()}*`;
      try {
        await navigator.clipboard.writeText(md);
        btn.classList.add('copied');
        const origHtml = btn.innerHTML;
        btn.innerHTML = `✓ 已复制`;
        setTimeout(() => {
          btn.innerHTML = origHtml;
          btn.classList.remove('copied');
        }, 1500);
      } catch (err) {
        console.warn('[SuperX Viral] Failed to copy markdown:', err);
      }
    }

    // ================= 悬浮 Tooltip 卡片 =================

    _initTooltip() {
      if (this.tooltipEl) return;
      this.tooltipEl = document.createElement('div');
      this.tooltipEl.className = 'superx-viral-tooltip';
      this.tooltipEl.style.display = 'none';
      document.body.appendChild(this.tooltipEl);

      window.addEventListener('scroll', () => this._hideTooltip(), true);
    }

    _showTooltip(targetEl, data, metrics) {
      if (!this.tooltipEl || !targetEl) return;

      const rect = targetEl.getBoundingClientRect();
      this.tooltipEl.innerHTML = `
        <div class="superx-tt-header">
          <span class="superx-tt-pill superx-badge-${metrics.level}">${metrics.levelEmoji} ${metrics.levelLabel}</span>
          <span class="superx-tt-time">${metrics.hoursText}</span>
        </div>
        <div class="superx-tt-score-row">
          <div class="superx-tt-score-num">${metrics.score}</div>
          <div class="superx-tt-score-desc">
            <div class="score-title">综合爆帖指数</div>
            <div class="superx-progress-track">
              <div class="superx-progress-fill" style="width: ${metrics.score}%"></div>
            </div>
          </div>
        </div>
        <div class="superx-tt-grid">
          <div class="superx-tt-item">
            <span class="item-label">实时流速</span>
            <span class="item-val highlight">${metrics.formattedVelocity}</span>
          </div>
          <div class="superx-tt-item">
            <span class="item-label">总浏览量</span>
            <span class="item-val">${data.views ? data.views.toLocaleString() : '--'}</span>
          </div>
          <div class="superx-tt-item">
            <span class="item-label">互动率</span>
            <span class="item-val">${metrics.engagementRate}</span>
          </div>
          <div class="superx-tt-item">
            <span class="item-label">转赞比</span>
            <span class="item-val">${metrics.rtRatio}</span>
          </div>
          <div class="superx-tt-item">
            <span class="item-label">藏赞比</span>
            <span class="item-val">${metrics.bmRatio}</span>
          </div>
          <div class="superx-tt-item">
            <span class="item-label">点赞 / 转发</span>
            <span class="item-val">${data.likes || 0} / ${data.retweets || 0}</span>
          </div>
        </div>
      `;

      this.tooltipEl.style.display = 'block';

      const ttRect = this.tooltipEl.getBoundingClientRect();
      let top = rect.top - ttRect.height - 8;
      let left = rect.left + (rect.width / 2) - (ttRect.width / 2);

      // 边界检查
      if (top < 10) top = rect.bottom + 8;
      if (left < 10) left = 10;
      if (left + ttRect.width > window.innerWidth - 10) {
        left = window.innerWidth - ttRect.width - 10;
      }

      this.tooltipEl.style.top = `${top + window.scrollY}px`;
      this.tooltipEl.style.left = `${left + window.scrollX}px`;
    }

    _hideTooltip() {
      if (this.tooltipEl) this.tooltipEl.style.display = 'none';
    }

    // ================= 排行榜与跨端通信 =================

    _getLeaderboard(limit = 15) {
      const list = [];
      for (const [id, data] of this.tweetStore.entries()) {
        const metrics = this._computeMetrics(data);
        if (metrics.velocity > 0) {
          list.push({
            id,
            screenName: data.screenName,
            text: (data.text || '').slice(0, 120),
            views: data.views,
            velocity: metrics.velocity,
            formattedVelocity: metrics.formattedVelocity,
            score: metrics.score,
            level: metrics.level,
            levelEmoji: metrics.levelEmoji,
            url: data.url
          });
        }
      }

      // 按流速从大到小降序排列
      list.sort((a, b) => b.velocity - a.velocity);
      return list.slice(0, limit);
    }

    _scheduleLeaderboardBroadcast() {
      if (this.leaderboardBroadcastTimer) clearTimeout(this.leaderboardBroadcastTimer);
      this.leaderboardBroadcastTimer = setTimeout(async () => {
        const topList = this._getLeaderboard(20);
        try {
          await chrome.storage.local.set({ [STORAGE_KEY_LEADERBOARD]: topList });
        } catch (e) {}
      }, 500);
    }

    _scrollToTweet(tweetId) {
      if (!tweetId) return false;
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (const article of articles) {
        if (this._getTweetIdFromArticle(article) === tweetId) {
          article.scrollIntoView({ behavior: 'smooth', block: 'center' });
          article.classList.add('superx-highlight-tweet');
          setTimeout(() => article.classList.remove('superx-highlight-tweet'), 2500);
          return true;
        }
      }
      return false;
    }

    _formatCompact(num) {
      if (!num) return '0';
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
      return String(num);
    }
  }

  const instance = new ViralMonitorFeature();
  if (window.__SuperX__ && window.__SuperX__.FeatureManager) {
    window.__SuperX__.FeatureManager.register(instance);
  }
})();
