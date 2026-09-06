/**
 * @file Reddit DOM 提取器 (Reddit DOM Extractor)
 * 采用指纹比对式遥测日志与 MutationObserver 防抖机制，
 * 支持 Reddit Feed、Subreddit 与 Search 结果页的高穿透力帖子元数据抽取。
 */
const RedditExtractor = (() => {
  const reportedUrls = new Set();
  let observer = null;
  let debounceTimer = null;
  let lastScanSignature = '';
  let isRunning = false;

  function debugLog(msg, data) {
    console.log(`%c[OmniRelay-Reddit]%c ${msg}`, 'color: #ff4500; font-weight: bold;', 'color: inherit;', data || '');
  }

  function isExtensionContextValid() {
    try {
      return typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id;
    } catch {
      return false;
    }
  }

  function extractPosts() {
    if (!isRunning || !isExtensionContextValid()) return;

    const currentUrl = window.location.href;
    const newPosts = [];
    const selectors = [
      'shreddit-post',
      'article',
      '[data-testid="post-container"]',
      'faceplate-tracker[source="search"] shreddit-post'
    ].join(', ');

    const containers = document.querySelectorAll(selectors);
    const stats = {
      total: containers.length,
      extracted: 0,
      skipped_dup: 0,
      skipped_ads: 0,
      skipped_invalid: 0
    };

    containers.forEach((container) => {
      try {
        const isShreddit = container.tagName.toLowerCase() === 'shreddit-post';

        // 1. 标题与链接
        let title = isShreddit ? container.getAttribute('post-title') : null;
        let permalink = isShreddit ? container.getAttribute('permalink') : null;
        let link = permalink ? new URL(permalink, window.location.origin).href : null;

        if (!title || !link) {
          const titleEl = container.querySelector('[slot="title"], h2, h3, a[data-testid="post-title"]');
          const linkEl = container.querySelector('a[slot="full-post-link"], a[href*="/comments/"], a[data-testid="post-title"]');
          title = title || (titleEl ? titleEl.textContent : null);
          link = link || (linkEl ? linkEl.href : null);
        }

        if (!title || !link) {
          stats.skipped_invalid++;
          return;
        }

        title = title.trim();
        if (title.length < 2) {
          stats.skipped_invalid++;
          return;
        }

        // 2. 广告与去重过滤
        const isAds = link.includes('/promoted/') || link.includes('ads_') || container.getAttribute('is-sponsored') === 'true';
        if (isAds) {
          stats.skipped_ads++;
          return;
        }

        if (reportedUrls.has(link)) {
          stats.skipped_dup++;
          return;
        }

        // 3. 作者、点赞、评论数、标签
        let author = isShreddit ? container.getAttribute('author') : null;
        if (!author) {
          const authorEl = container.querySelector('a[href*="/user/"], [author]');
          author = authorEl ? authorEl.textContent.trim().replace(/^u\//, '') : 'unknown';
        }

        let score = isShreddit ? container.getAttribute('score') : null;
        if (!score) {
          const scoreEl = container.querySelector('[id^="vote-arrows-"], [class*="score"]');
          score = scoreEl ? scoreEl.textContent.trim() : '0';
        }

        let comments = isShreddit ? container.getAttribute('comment-count') : null;
        if (!comments) {
          const commentEl = container.querySelector('[id^="comment-button-"], a[href*="comments"]');
          const match = commentEl ? commentEl.textContent.match(/\d+/) : null;
          comments = match ? match[0] : '0';
        }

        let flair = '';
        const flairEl = container.querySelector('shreddit-post-flair, [class*="flair"]');
        if (flairEl) flair = flairEl.textContent.trim();

        // 4. 入库
        reportedUrls.add(link);
        newPosts.push({
          title,
          link,
          author,
          flair: flair || '无标签',
          score: score || '0',
          comments: comments || '0',
          sourcePageUrl: currentUrl,
          capturedAt: new Date().toISOString()
        });
        stats.extracted++;
      } catch {
        stats.skipped_invalid++;
      }
    });

    const signature = `${stats.total}|${stats.extracted}|${stats.skipped_dup}|${stats.skipped_ads}|${stats.skipped_invalid}`;
    if (signature !== lastScanSignature || stats.extracted > 0) {
      debugLog(`扫描概况 | 视野总数: ${stats.total} | 成功提取: ${stats.extracted} | 去重拦截: ${stats.skipped_dup} | 广告丢弃: ${stats.skipped_ads}`);
      lastScanSignature = signature;
    }

    if (newPosts.length > 0) {
      chrome.runtime.sendMessage({
        action: 'DOM_DATA_EXTRACTED',
        siteId: 'reddit',
        extractType: 'batch_posts',
        sourceUrl: currentUrl,
        data: newPosts
      }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[OmniRelay-Reddit] 上报消息异常:', chrome.runtime.lastError.message);
        }
      });
    }
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    lastScanSignature = '';
    debugLog('🚀 Reddit DOM 提取器已启动');
    extractPosts();

    observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(extractPosts, 750);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stop() {
    if (!isRunning) return;
    isRunning = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    debugLog('💤 Reddit DOM 提取器已停止');
  }

  return { start, stop, extractPosts };
})();

if (typeof window !== 'undefined') {
  window.RedditExtractor = RedditExtractor;
}
