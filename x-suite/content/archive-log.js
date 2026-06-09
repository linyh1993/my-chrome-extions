/** @file 评论入库与主推文记录 */
const XcfArchiveLog = (() => {
  const S = () => XcfContent;
  const TEXT_RETRY_MS = [120, 280, 520, 900];

  function getTweetId(article) {
    return S().adapter?.getTweetId ? S().adapter.getTweetId(article) : null;
  }

  function captureKey(article, meta) {
    const tid = getTweetId(article);
    if (tid) return `tw:${tid}`;
    const m = meta || S().adapter?.extractMeta?.(article);
    if (!m) return '';
    if (S().adapter?.getArchiveKey) return S().adapter.getArchiveKey(article, m);
    const h = XcfSettings.normalizeHandle(m.handle);
    return `fb:${h}|${(m.text || '').slice(0, 120)}`;
  }

  function buildEntry(article, meta, extra = {}) {
    const threadId = XcfRoute.pageThreadId() || '';
    const pageId = threadId;
    const tid = getTweetId(article) || '';
    return {
      at: Date.now(),
      tweetAt: S().adapter?.extractTweetTime?.(article) || undefined,
      handle: meta.handle,
      displayName: meta.displayName,
      text: meta.text,
      media: meta.media || undefined,
      references: meta.references || undefined,
      tweetId: tid && pageId && tid !== pageId ? tid : '',
      threadId,
      pageUrl: location.href,
      metrics: S().adapter?.extractMetrics?.(article) || undefined,
      ...extra
    };
  }

  function logNoise(article, meta, match) {
    if (!match) return;
    const key = captureKey(article, meta);
    if (!key) return;
    S().loggedArchiveKeys.add(key);
    XcfRuntime.sendMessage({
      type: XCF.MSG.LOG_FILTERED,
      entry: buildEntry(article, meta, {
        kind: XCF.COMMENT_KIND.NOISE,
        ruleId: match.ruleId,
        reason: match.label || match.reason,
        matchedKeyword: match.matchedKeyword || '',
        source: 'auto_noise'
      })
    });
  }

  function logSignal(article, meta) {
    const key = captureKey(article, meta);
    if (!key || S().loggedArchiveKeys.has(key)) return;
    S().loggedArchiveKeys.add(key);
    XcfRuntime.sendMessage({
      type: XCF.MSG.LOG_FILTERED,
      entry: buildEntry(article, meta, {
        kind: XCF.COMMENT_KIND.SIGNAL,
        ruleId: '',
        reason: '',
        matchedKeyword: '',
        source: 'auto_signal'
      })
    });
  }

  function commitRow(article, meta, fn, attempt = 0) {
    if (!article?.isConnected) return;
    const key = captureKey(article, meta);
    if (!key || S().loggedArchiveKeys.has(key)) return;

    const run = (m) => {
      const k = captureKey(article, m);
      if (!k || S().loggedArchiveKeys.has(k)) return;
      fn(article, m);
    };

    if ((meta.text || '').trim() || (meta.media || []).length > 0 || (meta.references || []).length > 0) {
      run(meta);
      return;
    }
    if (attempt >= TEXT_RETRY_MS.length) {
      return;
    }
    setTimeout(() => {
      if (!article.isConnected || !XcfRoute.isPostThreadActive()) return;
      const again = S().adapter.extractMeta(article);
      if ((again.text || '').trim() || (again.media || []).length > 0 || (again.references || []).length > 0) {
        run(again);
        return;
      }
      commitRow(article, again, fn, attempt + 1);
    }, TEXT_RETRY_MS[attempt]);
  }

  async function hydrateKeys() {
    if (!XcfRoute.isPostThreadActive()) return;
    const threadId = XcfRoute.pageThreadId();
    if (!threadId || S().hydratePromise) return S().hydratePromise;
    S().hydratePromise = XcfRuntime.sendMessage({
      type: XCF.MSG.GET_THREAD_CAPTURE_KEYS,
      threadId
    })
      .then((res) => {
        for (const key of res?.keys || []) S().loggedArchiveKeys.add(key);
      })
      .finally(() => {
        S().hydratePromise = null;
      });
    return S().hydratePromise;
  }

  function threadRootSnapshot(meta) {
    const text = String(meta?.text || '').trim();
    const media = Array.isArray(meta?.media) ? meta.media : [];
    const references = Array.isArray(meta?.references) ? meta.references : [];
    return JSON.stringify({
      text,
      media: media.map((item) => `${item.type}|${item.src || ''}|${item.poster || ''}`).sort(),
      references: references.map((item) => `${item.type}|${item.url || ''}|${item.title || ''}|${String(item.text || '').slice(0, 240)}`).sort()
    });
  }

  function maybeLogThreadRoot() {
    if (!XcfRoute.isPostThreadActive()) return;
    const adapter = S().adapter;
    if (!adapter?.getThreadRootArticle || !adapter?.extractMeta) return;
    const threadId = XcfRoute.pageThreadId();
    if (!threadId) return;
    const root = adapter.getThreadRootArticle();
    if (!root) return;
    const meta = adapter.extractMeta(root);
    if (!(meta.text || '').trim() && !(meta.media || []).length && !(meta.references || []).length) return;
    const snapshot = threadRootSnapshot(meta);
    if (S().threadRootSnapshots.get(threadId) === snapshot) return;
    S().threadRootSnapshots.set(threadId, snapshot);
    S().loggedThreadRoots.add(threadId);
    let pageUrl = location.href;
    try {
      pageUrl = new URL(location.href).origin + new URL(location.href).pathname;
    } catch {
      /* ignore */
    }
    XcfRuntime.sendMessage({
      type: XCF.MSG.LOG_THREAD_ROOT,
      entry: {
        at: Date.now(),
        tweetId: threadId,
        handle: meta.handle,
        displayName: meta.displayName,
        text: meta.text,
        media: meta.media || undefined,
        references: meta.references || undefined,
        pageUrl,
        metrics: adapter.extractMetrics?.(root) || undefined
      }
    });
  }

  function publishActiveThread() {
    const threadId = XcfRoute.pageThreadId();
    if (threadId) {
      XcfRuntime.safeSessionSet({ [XCF.SESSION.ACTIVE_THREAD]: threadId });
    }
  }

  return { captureKey, logNoise, logSignal, commitRow, hydrateKeys, maybeLogThreadRoot, publishActiveThread };
})();
