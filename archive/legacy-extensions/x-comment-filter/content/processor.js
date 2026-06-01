/** @file 单条推文分类、折叠与用户操作 */
const XcfProcessor = (() => {
  const S = () => XcfContent;

  const foldHandlers = () => ({
    onShow: (article) => {
      XcfProcessor.rememberOverride(article);
      XcfFold.unfoldArticle(article);
    },
    onBlock: (handle, article) => XcfProcessor.blockHandle(handle, article),
    onWhitelist: (handle, article) => XcfProcessor.whitelistHandle(handle, article)
  });

  function rememberOverride(article) {
    const id = S().adapter?.getTweetId?.(article);
    if (id) S().overrideTweetIds.add(id);
    if (article) {
      article.dataset.xcfOverride = '1';
      article.dataset.xcfProcessed = '1';
    }
  }

  function isOverridden(article) {
    if (article.dataset.xcfOverride) return true;
    const id = S().adapter?.getTweetId?.(article);
    return Boolean(id && S().overrideTweetIds.has(id));
  }

  function foldIfMatch(article, meta, match) {
    if (isOverridden(article)) {
      if (article.dataset.xcfFolded) XcfFold.unfoldArticle(article);
      return;
    }
    const row = XcfFold.getTweetRow?.(article);
    if (
      article.dataset.xcfFolded &&
      article.classList.contains('xcf-hidden-article') &&
      row?.classList?.contains('xcf-hidden-article')
    ) {
      XcfFold.updateBarReason(article, meta, match);
      return;
    }
    if (article.dataset.xcfFolded) {
      delete article.dataset.xcfFolded;
      article.classList.remove('xcf-hidden-article');
      row?.classList?.remove('xcf-hidden-article');
    }
    const logKey = XcfArchiveLog.captureKey(article, meta);
    if (!S().loggedArchiveKeys.has(logKey) && article.dataset.xcfLogKey !== logKey) {
      XcfArchiveLog.commitRow(article, meta, (a, m) => {
        article.dataset.xcfLogKey = XcfArchiveLog.captureKey(a, m);
        XcfArchiveLog.logNoise(a, m, match);
      });
    } else if (!article.dataset.xcfLogKey) {
      article.dataset.xcfLogKey = logKey;
    }
    XcfFold.fold(article, meta, match, foldHandlers());
  }

  function processArticle(article) {
    const { adapter, context, settings } = S();
    if (!adapter || !settings?.enabled) return;

    const threadRoot = adapter.getThreadRootArticle?.();
    if (threadRoot && threadRoot === article) {
      article.dataset.xcfMainPost = '1';
      article.dataset.xcfProcessed = '1';
      delete article.dataset.xcfPendingText;
      if (article.dataset.xcfFolded) XcfFold.unfoldArticle(article);
      return;
    }

    if (adapter.isMainPost(article, context)) {
      article.dataset.xcfMainPost = '1';
      article.dataset.xcfProcessed = '1';
      delete article.dataset.xcfPendingText;
      if (article.dataset.xcfFolded) XcfFold.unfoldArticle(article);
      return;
    }
    delete article.dataset.xcfMainPost;

    if (isOverridden(article)) {
      article.dataset.xcfProcessed = '1';
      delete article.dataset.xcfPendingText;
      if (article.dataset.xcfFolded) XcfFold.unfoldArticle(article);
      return;
    }

    const meta = adapter.extractMeta(article);
    if (!meta.handle && !meta.text && !meta.inProbableSpam && !meta.profileBlob) {
      return;
    }

    const { kind, match } = XcfFilterEngine.classify(meta, settings);

    if (kind === XCF.COMMENT_KIND.NOISE && match) {
      if (
        XcfRules.needsTextForRule(match.ruleId) &&
        !(meta.text || '').trim()
      ) {
        article.dataset.xcfPendingText = '1';
        return;
      }
      delete article.dataset.xcfPendingText;
      article.dataset.xcfProcessed = '1';
      if (article.dataset.xcfSignalLogged && !article.dataset.xcfFolded) {
        delete article.dataset.xcfSignalLogged;
      }
      foldIfMatch(article, meta, match);
      return;
    }

    delete article.dataset.xcfPendingText;
    article.dataset.xcfProcessed = '1';
    XcfArchiveLog.commitRow(article, meta, (a, m) => {
      article.dataset.xcfLogKey = XcfArchiveLog.captureKey(a, m);
      article.dataset.xcfSignalLogged = '1';
      XcfArchiveLog.logSignal(a, m);
    });
  }

  function applyBlockToPage(handle) {
    XcfRoute.refreshAdapter();
    if (!handle || !XcfRoute.isPostThreadActive()) return;
    const h = XcfSettings.normalizeHandle(handle);
    const match = {
      ruleId: 'blocklist',
      reason: '屏蔽账号',
      label: `用户 @${handle}`
    };
    for (const article of S().adapter.findArticles()) {
      if (S().adapter.isMainPost(article, S().context)) continue;
      const meta = S().adapter.extractMeta(article);
      if (XcfSettings.normalizeHandle(meta.handle) !== h) continue;
      article.dataset.xcfProcessed = '1';
      foldIfMatch(article, meta, match);
    }
  }

  async function blockHandle(handle, article) {
    const meta = article && S().adapter?.extractMeta ? S().adapter.extractMeta(article) : {};
    await XcfRuntime.withPausedObserver(() =>
      XcfRuntime.withStorageEcho(async () => {
        const next = await XcfRuntime.sendMessage({
          type: XCF.MSG.BLOCK_HANDLE,
          handle,
          displayName: meta.displayName,
          text: meta.text,
          pageUrl: location.href
        });
        if (next) {
          S().settings = next;
          window.__xcfSettings = next;
        }
        XcfBootstrap.refreshPanel();
        applyBlockToPage(handle);
      })
    );
  }

  async function whitelistHandle(handle, article) {
    await XcfRuntime.withPausedObserver(() =>
      XcfRuntime.withStorageEcho(async () => {
        const next = await XcfRuntime.sendMessage({
          type: XCF.MSG.WHITELIST_HANDLE,
          handle
        });
        if (next) {
          S().settings = next;
          window.__xcfSettings = next;
        }
        XcfBootstrap.refreshPanel();
        if (article) {
          rememberOverride(article);
          XcfFold.unfoldArticle(article);
        }
      })
    );
  }

  function refoldAllNoise() {
    if (!XcfRoute.isPostThreadActive()) return;
    S().overrideTweetIds.clear();
    for (const article of S().adapter.findArticles()) {
      delete article.dataset.xcfOverride;
      delete article.dataset.xcfFolded;
      delete article.dataset.xcfProcessed;
      delete article.dataset.xcfSignalLogged;
      delete article.dataset.xcfCaptureObserved;
      article.classList.remove('xcf-hidden-article');
      XcfFold.getTweetRow?.(article)?.classList?.remove('xcf-hidden-article');
      processArticle(article);
    }
    XcfFold.cleanupOrphanBars();
    XcfFold.recountFolded();
    XcfFold.refreshSummary();
    XcfBootstrap.refreshPanel();
  }

  return {
    rememberOverride,
    isOverridden,
    processArticle,
    blockHandle,
    whitelistHandle,
    refoldAllNoise
  };
})();
