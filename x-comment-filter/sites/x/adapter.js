/** @file X / Twitter 站点适配器 */
(() => {
  const HOSTS = ['x.com', 'twitter.com'];

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

  function isMainPost(article, ctx) {
    if (ctx !== XCF.CONTEXT.POST_THREAD) return false;
    const statusId = statusIdFromUrl();
    if (!statusId) return false;

    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (href.includes(`/status/${statusId}`)) {
        const time = article.querySelector('time');
        if (time && article.contains(time)) return true;
      }
    }

    const articles = findArticles();
    return articles[0] === article;
  }

  function extractMeta(article) {
    let handle = '';
    let displayName = '';

    const userBlock =
      article.querySelector('[data-testid="User-Name"]') ||
      article.querySelector('[data-testid="User-Names"]');

    if (userBlock) {
      const links = userBlock.querySelectorAll('a[href^="/"]');
      for (const a of links) {
        const href = (a.getAttribute('href') || '').trim();
        const m = href.match(/^\/([^/?#]+)\/?$/);
        if (m && !['status', 'i', 'search', 'home', 'explore'].includes(m[1])) {
          handle = m[1];
          break;
        }
      }
      const spans = userBlock.querySelectorAll('span');
      if (spans.length) displayName = spans[0].textContent?.trim() || '';
    }

    const textEl = article.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText : '';

    return { handle, displayName, text };
  }

  XcfRegistry.register({
    id: 'x',
    hosts: HOSTS,
    detectContext,
    isContextEnabled,
    findArticles,
    isMainPost,
    extractMeta
  });
})();
