/** @file X / Twitter 站点适配器 */
(() => {
  const HOSTS = ['x.com', 'twitter.com'];
  const RESERVED = new Set(['status', 'i', 'search', 'home', 'explore', 'hashtag']);

  const SPAM_LABEL =
    /^(probable spam|possibly spam|likely spam|疑似垃圾|可能为垃圾|垃圾评论|spam)$/i;

  const REPLY_CTX =
    /^(replying to|replied to|回复|回覆)/i;

  function statusIdFromUrl() {
    const m = location.pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function detectContext() {
    if (statusIdFromUrl()) return XCF.CONTEXT.POST_THREAD;
    if (/^\/search\b/.test(location.pathname)) return XCF.CONTEXT.SEARCH;
    if (/^\/home\b/.test(location.pathname) || location.pathname === '/') {
      return XCF.CONTEXT.TIMELINE;
    }
    return null;
  }

  function isContextEnabled(ctx, settings) {
    return Boolean(settings.contexts?.[ctx]);
  }

  function findArticles(root = document) {
    const col = root.querySelector('[data-testid="primaryColumn"]') || root;
    return Array.from(col.querySelectorAll('article[data-testid="tweet"]'));
  }

  /** 时间戳链接上的 status id（不递归、不猜主帖） */
  function getTimeLinkStatusId(article) {
    const timeLink = article.querySelector('time')?.closest('a[href*="/status/"]');
    const href = (timeLink?.getAttribute('href') || '').trim();
    const m = href.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function collectStatusIds(article) {
    const ids = new Set();
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      const href = (a.getAttribute('href') || '').trim();
      const m = href.match(/\/status\/(\d+)/);
      if (m) ids.add(m[1]);
    }
    return ids;
  }

  /** 是否为「回复 @某人」类推文（与主推文区分） */
  function isLikelyReply(article) {
    const ctx = article.querySelector('[data-testid="socialContext"]');
    const t = (ctx?.textContent || '').trim();
    if (t && REPLY_CTX.test(t)) return true;
    return false;
  }

  /**
   * 评论唯一 id：优先取与当前页主推文不同的 status id；
   * 若只有主推文 id（回复时间链指向 thread），退回时间链 id，归档用 fb 键去重。
   */
  function getTweetId(article) {
    const pageId = statusIdFromUrl();
    for (const id of collectStatusIds(article)) {
      if (!pageId || id !== pageId) return id;
    }
    return getTimeLinkStatusId(article);
  }

  /** 归档去重键（与 getTweetId 分离，避免多条回复共用一个 tw:id） */
  function getArchiveKey(article, meta) {
    const pageId = statusIdFromUrl() || '';
    const distinct = getTweetId(article);
    if (distinct && (!pageId || distinct !== pageId)) {
      return `tw:${distinct}`;
    }
    const h = String(meta?.handle || '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase();
    const t = String(meta?.text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return `fb:${h}|${t}`;
  }

  /** 主推文 = 地址栏 id 对应、且非「回复」上下文的那条 */
  function getThreadRootArticle(root = document) {
    const pageId = statusIdFromUrl();
    const articles = findArticles(root);

    if (pageId) {
      for (const article of articles) {
        if (getTimeLinkStatusId(article) !== pageId) continue;
        if (!isLikelyReply(article)) return article;
      }
      for (const article of articles) {
        if (getTimeLinkStatusId(article) === pageId) return article;
      }
    }

    const col = root.querySelector('[data-testid="primaryColumn"]') || root;
    const conv = col.querySelector('[data-testid="conversation"]') || col;
    return conv.querySelector('article[data-testid="tweet"]');
  }

  function isMainPost(article, ctx) {
    if (ctx !== XCF.CONTEXT.POST_THREAD) return false;
    const root = getThreadRootArticle();
    return Boolean(root && root === article);
  }

  function findProbableSpamAnchor(root) {
    for (const el of root.querySelectorAll('span')) {
      if (el.closest('article[data-testid="tweet"]')) continue;
      if (el.children.length > 2) continue;
      const t = (el.textContent || '').trim();
      if (t.length > 0 && t.length < 48 && SPAM_LABEL.test(t)) return el;
    }
    return null;
  }

  function isInProbableSpamSection(article) {
    const col = document.querySelector('[data-testid="primaryColumn"]');
    if (!col || !col.contains(article)) return false;
    const anchor = findProbableSpamAnchor(col);
    if (!anchor) return false;
    return Boolean(anchor.compareDocumentPosition(article) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function pickHandle(links) {
    for (const a of links) {
      const href = (a.getAttribute('href') || '').trim();
      const m = href.match(/^\/([^/?#]+)\/?$/);
      if (!m || RESERVED.has(m[1])) continue;
      if ((a.textContent || '').trim().startsWith('@')) return m[1];
    }
    for (const a of links) {
      const href = (a.getAttribute('href') || '').trim();
      const m = href.match(/^\/([^/?#]+)\/?$/);
      if (m && !RESERVED.has(m[1])) return m[1];
    }
    return '';
  }

  function extractMeta(article) {
    let handle = '';
    let displayName = '';

    let userBlock =
      article.querySelector('[data-testid="User-Name"]') ||
      article.querySelector('[data-testid="User-Names"]');

    const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"]');
    if (avatar) {
      const row = avatar.closest('div');
      const near =
        row?.querySelector('[data-testid="User-Name"]') ||
        row?.parentElement?.querySelector('[data-testid="User-Name"]');
      if (near) userBlock = near;
    }

    if (userBlock) {
      handle = pickHandle(userBlock.querySelectorAll('a[href^="/"]'));
      const spans = userBlock.querySelectorAll('span');
      if (spans.length) displayName = spans[0].textContent?.trim() || '';
    }

    if (!handle) {
      handle = pickHandle(article.querySelectorAll('a[href^="/"]'));
    }

    const textNodes = article.querySelectorAll('[data-testid="tweetText"]');
    let textEl = textNodes[0] || null;
    if (!textEl) {
      textEl =
        article.querySelector('div[lang]') || article.querySelector('span[lang]');
    }
    const text = textEl ? textEl.innerText : '';

    return {
      handle,
      displayName,
      text,
      inProbableSpam: isInProbableSpamSection(article)
    };
  }

  function parseCount(raw) {
    const s = String(raw || '').trim();
    if (!s) return 0;
    const cleaned = s.replace(/,/g, '');
    const withUnit = cleaned.match(/(\d+(?:\.\d+)?)([KMB]|万|千|亿)/i);
    const n = Number(withUnit ? withUnit[1] : (cleaned.match(/(\d+(?:\.\d+)?)/) || [])[1]);
    if (!Number.isFinite(n)) return 0;
    const u = (withUnit?.[2] || '').toLowerCase();
    if (u === 'k' || u === '千') return Math.round(n * 1e3);
    if (u === 'm') return Math.round(n * 1e6);
    if (u === 'b') return Math.round(n * 1e9);
    if (u === '万') return Math.round(n * 1e4);
    if (u === '亿') return Math.round(n * 1e8);
    return Math.round(n);
  }

  function countFromTestId(article, testid) {
    const el = article.querySelector(`[data-testid="${testid}"]`);
    if (!el) return 0;
    const label = el.getAttribute('aria-label') || '';
    if (label) return parseCount(label);
    const t = (el.textContent || '').trim();
    return parseCount(t);
  }

  function extractMetrics(article) {
    return {
      reply: countFromTestId(article, 'reply'),
      repost: countFromTestId(article, 'retweet'),
      like: countFromTestId(article, 'like'),
      bookmark: countFromTestId(article, 'bookmark'),
      view: countFromTestId(article, 'analytics')
    };
  }

  XcfRegistry.register({
    id: 'x',
    hosts: HOSTS,
    detectContext,
    isContextEnabled,
    findArticles,
    getTweetId,
    getArchiveKey,
    getTimeLinkStatusId,
    statusIdFromUrl,
    getThreadRootArticle,
    isMainPost,
    isLikelyReply,
    extractMeta,
    extractMetrics
  });
})();
