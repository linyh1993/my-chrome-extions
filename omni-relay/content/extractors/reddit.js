/**
 * @file Reddit DOM 提取器 (Reddit Content Extractor)
 * 提取 Shreddit Web Components 与 Feed 帖子元数据。
 */

const RedditExtractor = (() => {
  const visitedLinks = new Set();
  let observer = null;
  let timer = null;
  let running = false;

  function extract() {
    if (!running) return;

    const containers = document.querySelectorAll('shreddit-post, article, [data-testid="post-container"]');
    const newItems = [];

    containers.forEach((el) => {
      try {
        const isShreddit = el.tagName.toLowerCase() === 'shreddit-post';

        let title = isShreddit ? el.getAttribute('post-title') : null;
        let permalink = isShreddit ? el.getAttribute('permalink') : null;
        let link = permalink ? new URL(permalink, window.location.origin).href : null;

        if (!title || !link) {
          const titleEl = el.querySelector('[slot="title"], h2, h3, a[data-testid="post-title"]');
          const linkEl = el.querySelector('a[slot="full-post-link"], a[href*="/comments/"]');
          title = title || (titleEl ? titleEl.textContent : null);
          link = link || (linkEl ? linkEl.href : null);
        }

        if (!title || !link || title.trim().length < 2) return;

        // 过滤广告与去重
        if (link.includes('/promoted/') || el.getAttribute('is-sponsored') === 'true') return;
        if (visitedLinks.has(link)) return;

        let author = isShreddit ? el.getAttribute('author') : null;
        if (!author) {
          const authorEl = el.querySelector('a[href*="/user/"]');
          author = authorEl ? authorEl.textContent.trim().replace(/^u\//, '') : 'unknown';
        }

        let score = isShreddit ? el.getAttribute('score') : '0';
        let comments = isShreddit ? el.getAttribute('comment-count') : '0';

        let flair = '';
        const flairEl = el.querySelector('shreddit-post-flair, [class*="flair"]');
        if (flairEl) flair = flairEl.textContent.trim();

        visitedLinks.add(link);
        newItems.push({
          title: title.trim(),
          link,
          author,
          score: score || '0',
          comments: comments || '0',
          flair: flair || null,
          sourceUrl: window.location.href,
          capturedAt: new Date().toISOString()
        });
      } catch {
        // 忽略单节点提取异常
      }
    });

    if (newItems.length > 0) {
      chrome.runtime.sendMessage({
        action: 'DOM_EXTRACTED',
        siteId: 'reddit',
        siteLabel: 'Reddit',
        extractAction: 'posts_extracted',
        data: newItems
      });
    }
  }

  function start() {
    if (running) return;
    running = true;
    extract();

    observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(extract, 600);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log('[OmniRelay] Reddit DOM extractor started.');
  }

  function stop() {
    if (!running) return;
    running = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    console.log('[OmniRelay] Reddit DOM extractor stopped.');
  }

  return { start, stop };
})();

if (typeof window !== 'undefined') {
  window.RedditExtractor = RedditExtractor;
}
