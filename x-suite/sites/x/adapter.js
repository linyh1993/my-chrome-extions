/** @file X / Twitter 站点适配器 */
(() => {
  const HOSTS = ['x.com', 'twitter.com'];
  const RESERVED = new Set(['status', 'i', 'search', 'home', 'explore', 'hashtag']);

  const SPAM_LABEL =
    /^(probable spam|possibly spam|likely spam|疑似垃圾|可能为垃圾|垃圾评论|spam)$/i;

  const REPLY_CTX =
    /^(replying to|replied to|回复|回覆)/i;

  const EXCLUDED_TEXT_ANCESTORS =
    '[data-testid="quoteTweet"], [data-testid="card.wrapper"]';

  let cachedHref = '';
  let cachedPageId = null;
  let cachedThreadRoot = undefined;

  function invalidatePageCache() {
    cachedHref = '';
    cachedPageId = null;
    cachedThreadRoot = undefined;
  }

  function statusIdFromUrl() {
    const href = location.href;
    if (cachedHref === href) return cachedPageId;
    cachedHref = href;
    const m = location.pathname.match(/\/status\/(\d+)/);
    cachedPageId = m ? m[1] : null;
    cachedThreadRoot = undefined;
    return cachedPageId;
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

  const EXPAND_REPLY_RE =
    /(show|view|display|see)\s+.*(repl|reply|response|conversation|thread)|显示.*(更多|回复)|更多回复|查看.*回复|展开.*回复|probable spam|疑似垃圾|可能为垃圾/i;

  function findArticles(root = document) {
    const col = root.querySelector('[data-testid="primaryColumn"]') || root;
    const conv = col.querySelector('[data-testid="conversation"]') || col;
    return Array.from(conv.querySelectorAll('article[data-testid="tweet"]'));
  }

  /** 点击「显示更多回复」等折叠入口，便于 DOM 挂载更多 article */
  function expandCollapsedSections(root = document) {
    const col = root.querySelector('[data-testid="primaryColumn"]') || root;
    let clicks = 0;
    const MAX = 10;
    for (const el of col.querySelectorAll(
      '[role="button"], button, div[role="link"], span'
    )) {
      if (clicks >= MAX) break;
      if (el.closest('article[data-testid="tweet"]')) continue;
      if (el.closest('.xcf-fold-bar, .xcf-summary, .xcf-dock')) continue;
      const t = (el.textContent || '').trim();
      if (!t || t.length > 72 || t.length < 6) continue;
      if (!EXPAND_REPLY_RE.test(t)) continue;
      try {
        el.click();
        clicks += 1;
      } catch {
        /* ignore */
      }
    }
    return clicks;
  }

  function isNestedTweetSubtree(node) {
    return Boolean(
      node?.closest?.('[data-testid="quoteTweet"], [data-testid="card.wrapper"]')
    );
  }

  /** 时间戳链接上的 status id（排除引用推/卡片推内的时间链） */
  function getTimeLinkStatusId(article) {
    for (const time of article.querySelectorAll('time')) {
      if (isNestedTweetSubtree(time)) continue;
      const timeLink = time.closest('a[href*="/status/"]');
      const href = (timeLink?.getAttribute('href') || '').trim();
      const m = href.match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function collectStatusIds(article) {
    const ids = new Set();
    for (const a of article.querySelectorAll('a[href*="/status/"]')) {
      if (isNestedTweetSubtree(a)) continue;
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
   * 评论唯一 id：优先时间链；否则取与当前页主推文不同的 status id。
   */
  function getTweetId(article) {
    const fromTime = getTimeLinkStatusId(article);
    if (fromTime) return fromTime;
    const pageId = statusIdFromUrl();
    for (const id of collectStatusIds(article)) {
      if (!pageId || id !== pageId) return id;
    }
    return null;
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
    const timeEl = article.querySelector('time[datetime]');
    const dt = (timeEl?.getAttribute('datetime') || '').trim();
    if (dt) return `fb:${h}|${dt}`;
    const t = String(meta?.text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return `fb:${h}|${t}`;
  }

  /** 主推文 = 地址栏 id 对应、且非「回复」上下文的那条 */
  function getThreadRootArticle(root = document) {
    if (root === document && cachedHref === location.href && cachedThreadRoot !== undefined) {
      return cachedThreadRoot;
    }

    const pageId = statusIdFromUrl();
    const articles = findArticles(root);
    let found = null;

    if (pageId) {
      for (const article of articles) {
        if (getTimeLinkStatusId(article) !== pageId) continue;
        if (!isLikelyReply(article)) {
          found = article;
          break;
        }
      }
      if (!found) {
        for (const article of articles) {
          if (getTimeLinkStatusId(article) === pageId) {
            found = article;
            break;
          }
        }
      }
    }

    if (!found) {
      const col = root.querySelector('[data-testid="primaryColumn"]') || root;
      const conv = col.querySelector('[data-testid="conversation"]') || col;
      found = conv.querySelector('article[data-testid="tweet"]');
    }

    if (root === document) {
      cachedThreadRoot = found;
    }
    return found;
  }

  /** 主帖判定：时间链 id 或 conversation 内首条非回复 article */
  function isMainPost(article, ctx) {
    if (ctx !== XCF.CONTEXT.POST_THREAD) return false;
    const root = getThreadRootArticle();
    if (root && root === article) return true;
    const pageId = statusIdFromUrl();
    if (!pageId) return false;
    if (isLikelyReply(article)) return false;
    return getTimeLinkStatusId(article) === pageId;
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
    const root = getThreadRootArticle();
    if (root && root === article) return false;
    if (isMainPost(article, XCF.CONTEXT.POST_THREAD)) return false;
    const col = document.querySelector('[data-testid="primaryColumn"]');
    if (!col || !col.contains(article)) return false;
    const anchor = findProbableSpamAnchor(col);
    if (!anchor) return false;
    if (root && !(root.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      return false;
    }
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

  function profileLinksInHeader(article) {
    const stop =
      article.querySelector('[data-testid="tweetText"]') ||
      article.querySelector('[data-testid="card.wrapper"]');
    const links = [];
    for (const a of article.querySelectorAll('a[href^="/"]')) {
      const href = (a.getAttribute('href') || '').trim();
      if (!/^\/[^/?#]+\/?$/.test(href)) continue;
      const name = href.replace(/^\//, '').split('/')[0];
      if (RESERVED.has(name)) continue;
      if (
        stop &&
        !(stop.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)
      ) {
        continue;
      }
      links.push(a);
    }
    return links;
  }

  function resolveProfile(article) {
    let handle = '';
    const nameChunks = [];

    for (const a of profileLinksInHeader(article)) {
      const href = (a.getAttribute('href') || '').trim();
      const m = href.match(/^\/([^/?#]+)/);
      if (!m) continue;
      const uname = m[1];
      const t = (a.textContent || '').trim();
      const label = (a.getAttribute('aria-label') || '').trim();
      if (label) nameChunks.push(label);
      if (t.startsWith('@')) {
        if (!handle) handle = uname;
      } else if (t) {
        nameChunks.push(t);
        if (!handle) handle = uname;
      } else if (!handle) {
        handle = uname;
      }
    }

    if (!handle) {
      handle = pickHandle(article.querySelectorAll('a[href^="/"]'));
    }

    const userBlock = findUserBlock(article);
    const blobFromBlock = extractProfileBlob(article, handle, userBlock);
    const blobFromLinks = nameChunks.join(' ').replace(/\s+/g, ' ').trim();
    const profileBlob = [blobFromBlock, blobFromLinks]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const displayName =
      blobFromLinks ||
      blobFromBlock.split(/\s+/).slice(0, 10).join(' ').trim() ||
      '';

    return { handle, displayName, profileBlob };
  }

  function findUserBlock(article) {
    let userBlock =
      article.querySelector('[data-testid="User-Name"]') ||
      article.querySelector('[data-testid="User-Names"]');

    const avatar = article.querySelector('[data-testid="Tweet-User-Avatar"]');
    if (avatar) {
      const row = avatar.closest('div');
      const near =
        row?.querySelector('[data-testid="User-Name"]') ||
        row?.parentElement?.querySelector('[data-testid="User-Name"]') ||
        row?.closest('[data-testid="User-Name"]');
      if (near) userBlock = near;
      if (!userBlock) {
        userBlock =
          avatar.closest('[data-testid="UserCell"]') ||
          avatar.parentElement?.parentElement ||
          userBlock;
      }
    }
    return userBlock;
  }

  function extractProfileBlob(article, handle, userBlock) {
    const chunks = [];
    const block = userBlock || findUserBlock(article);
    const h = String(handle || '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase();

    if (block) {
      const raw = (block.innerText || block.textContent || '').trim();
      if (raw) chunks.push(raw);
      for (const a of block.querySelectorAll('a[href^="/"]')) {
        const label = (a.getAttribute('aria-label') || '').trim();
        const t = (a.textContent || '').trim();
        if (label) chunks.push(label);
        if (t && !t.startsWith('@')) chunks.push(t);
      }
    }

    const avatarImg = article.querySelector(
      '[data-testid="Tweet-User-Avatar"] img[alt]'
    );
    if (avatarImg?.alt) chunks.push(avatarImg.alt);

    const seen = new Set();
    const parts = [];
    for (const chunk of chunks.join('\n').split('\n')) {
      const t = chunk.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      const lower = t.toLowerCase();
      if (h && (lower === `@${h}` || lower === h)) continue;
      parts.push(t);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function isExcludedTweetText(el, excluded) {
    for (const node of excluded) {
      if (node.contains(el)) return true;
    }
    return false;
  }

  function extractDisplayName(article, userBlock, handle) {
    const blob = extractProfileBlob(article, handle, userBlock);
    if (blob) return blob.split(/\s+/).slice(0, 12).join(' ').trim();
    if (!userBlock) return '';
    const raw = (userBlock.innerText || userBlock.textContent || '').trim();
    if (!raw) return '';
    const h = String(handle || '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase();
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const lower = t.toLowerCase();
      if (h && (lower === `@${h}` || lower === h)) continue;
      if (h && lower.endsWith(`@${h}`) && t.length < h.length + 24) continue;
      return t;
    }
    return raw.split('\n')[0]?.trim() || '';
  }

  /** 主推文正文，排除引用推 / 卡片推内的 tweetText */
  function extractPrimaryTweetText(article) {
    const excluded = Array.from(article.querySelectorAll(EXCLUDED_TEXT_ANCESTORS));
    const parts = [];
    for (const el of article.querySelectorAll('[data-testid="tweetText"]')) {
      if (isExcludedTweetText(el, excluded)) continue;
      const text = (el.innerText || '').replace(/\n+/g, '\n').trim();
      if (text) parts.push(text);
    }
    if (parts.length) return parts.join('\n');
    return '';
  }

  function extractTweetTime(article) {
    const dt = article.querySelector('time[datetime]')?.getAttribute('datetime');
    if (!dt) return null;
    const ms = Date.parse(dt);
    return Number.isFinite(ms) ? ms : null;
  }

  function findMediaContainer(node) {
    return (
      node.closest('[data-testid="tweetPhoto"]') ||
      node.closest('[data-testid="videoComponent"]') ||
      node.closest('[data-testid="card.wrapper"]') ||
      node.closest('[aria-label*="Image"]') ||
      node.closest('[aria-label*="图片"]')
    );
  }

  function isExcludedMediaNode(node, article) {
    if (!node || !article?.contains(node)) return true;
    if (isNestedTweetSubtree(node)) return true;
    const container = findMediaContainer(node);
    if (!container) return true;
    if (isNestedTweetSubtree(container)) return true;
    return false;
  }

  function dedupeMediaItems(list) {
    const seen = new Set();
    const out = [];
    for (const item of list || []) {
      const type = String(item?.type || '').trim();
      const src = String(item?.src || '').trim();
      const poster = String(item?.poster || '').trim();
      const pageUrl = String(item?.pageUrl || '').trim();
      const key = `${type}|${src}|${poster}|${pageUrl}`;
      if (!type || seen.has(key)) continue;
      seen.add(key);
      out.push({
        type,
        src,
        poster,
        alt: String(item?.alt || '').trim(),
        pageUrl
      });
    }
    return out;
  }

  function extractMedia(article) {
    const items = [];

    for (const img of article.querySelectorAll('img')) {
      if (isExcludedMediaNode(img, article)) continue;
      const src = (img.currentSrc || img.src || '').trim();
      if (!src) continue;
      if (/profile_images|emoji|abs-0\.twimg\.com/i.test(src)) continue;
      const pageUrl =
        img.closest('a[href]')?.href ||
        article.querySelector('a[href*="/photo/"]')?.href ||
        '';
      items.push({
        type: 'image',
        src,
        alt: (img.alt || '').trim(),
        pageUrl
      });
    }

    for (const video of article.querySelectorAll('video')) {
      if (isExcludedMediaNode(video, article)) continue;
      const src = (video.currentSrc || video.src || '').trim();
      const poster = (video.poster || '').trim();
      const pageUrl =
        video.closest('a[href]')?.href ||
        article.querySelector('a[href*="/video/"]')?.href ||
        article.querySelector('a[href*="/status/"]')?.href ||
        '';
      items.push({
        type: 'video',
        src,
        poster,
        alt: '',
        pageUrl
      });
    }

    return dedupeMediaItems(items);
  }

  function isPromotedOrAd(article) {
    const ctx = article.querySelector('[data-testid="socialContext"]');
    const ctxText = (ctx?.textContent || '').trim();
    if (/^(Ad|广告|Promoted|推广)$/i.test(ctxText)) return true;
    if (article.querySelector('[data-testid="placementTracking"]')) return true;
    for (const span of article.querySelectorAll('span')) {
      const t = (span.textContent || '').trim();
      if (t === 'Ad' || t === '广告' || t === 'Promoted' || t === '推广') return true;
    }
    return false;
  }

  function extractMeta(article) {
    const profile = resolveProfile(article);
    const text = extractPrimaryTweetText(article);

    return {
      handle: profile.handle,
      displayName: profile.displayName,
      profileBlob: profile.profileBlob,
      text,
      media: extractMedia(article),
      isAd: isPromotedOrAd(article),
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
    extractMetrics,
    extractTweetTime,
    invalidatePageCache,
    expandCollapsedSections
  });
})();
