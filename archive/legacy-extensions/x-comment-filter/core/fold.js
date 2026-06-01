/** @file 折叠 UI：默认折叠，可展开 / 屏蔽 / 加白 */
const XcfFold = (() => {
  const articleToBar = new WeakMap();
  let foldedCount = 0;
  let summaryEl = null;

  function getTweetRow(article) {
    return article?.closest?.('[data-testid="cellInnerDiv"]') || article;
  }

  function getPrimaryColumn() {
    return document.querySelector('[data-testid="primaryColumn"]');
  }

  function applyHide(article) {
    const row = getTweetRow(article);
    row.classList.add('xcf-hidden-article');
    article.classList.add('xcf-hidden-article');
  }

  function applyShow(article) {
    const row = getTweetRow(article);
    row.classList.remove('xcf-hidden-article');
    article.classList.remove('xcf-hidden-article');
  }

  function ensureSummaryHost() {
    const col = getPrimaryColumn();
    if (!col) return null;
    let host = col.querySelector('.xcf-summary-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'xcf-summary-host';
      const conv = col.querySelector('[data-testid="conversation"]') || col;
      conv.appendChild(host);
    }
    return host;
  }

  function ensureSummary() {
    const host = ensureSummaryHost();
    if (!host) return null;
    if (summaryEl && summaryEl.isConnected) return summaryEl;

    summaryEl = document.createElement('div');
    summaryEl.className = 'xcf-summary';
    summaryEl.hidden = true;
    host.appendChild(summaryEl);
    return summaryEl;
  }

  function onSummaryShowAll(e) {
    e.preventDefault();
    e.stopPropagation();
    document
      .querySelectorAll('article[data-testid="tweet"][data-xcf-folded="1"]')
      .forEach((node) => unfoldArticle(node, { keepOverride: true }));
  }

  function onSummaryHideAll(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof window.__xcfRefoldAllNoise === 'function') {
      window.__xcfRefoldAllNoise();
    }
  }

  function ensureSummaryActions(el) {
    if (el.querySelector('.xcf-summary-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'xcf-summary-actions';

    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.className = 'xcf-btn xcf-btn-solid';
    showAll.textContent = '全部显示';
    showAll.addEventListener('click', onSummaryShowAll, true);

    const hideAll = document.createElement('button');
    hideAll.type = 'button';
    hideAll.className = 'xcf-btn xcf-btn-solid xcf-btn-warn';
    hideAll.textContent = '全部隐藏';
    hideAll.addEventListener('click', onSummaryHideAll, true);

    actions.appendChild(showAll);
    actions.appendChild(hideAll);
    el.appendChild(actions);
  }

  function refreshSummary() {
    const el = ensureSummary();
    if (!el) return;
    if (foldedCount <= 0) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    let countEl = el.querySelector('.xcf-summary-count');
    if (!countEl) {
      countEl = document.createElement('span');
      countEl.className = 'xcf-summary-count';
      el.insertBefore(countEl, el.firstChild);
      ensureSummaryActions(el);
    }
    countEl.textContent = `已折叠 ${foldedCount} 条噪音`;
  }

  function unfoldArticle(article, { keepOverride = true } = {}) {
    if (!article?.dataset?.xcfFolded) return;
    applyShow(article);
    delete article.dataset.xcfFolded;
    if (keepOverride) article.dataset.xcfOverride = '1';

    const bar = articleToBar.get(article);
    if (bar) {
      bar.remove();
      articleToBar.delete(article);
    }
    recountFolded();
    refreshSummary();
  }

  function createBar(article, meta, match, handlers) {
    const bar = document.createElement('div');
    bar.className = 'xcf-fold-bar';
    bar.setAttribute('role', 'note');
    const tid = article.dataset.xcfTweetId || '';
    if (tid) bar.dataset.xcfTweetId = tid;
    if (meta.handle) bar.dataset.xcfHandle = meta.handle;

    const main = document.createElement('div');
    main.className = 'xcf-fold-main';

    const label = document.createElement('span');
    label.className = 'xcf-fold-label';
    label.textContent =
      typeof XcfRules?.foldBarText === 'function'
        ? XcfRules.foldBarText(meta, match)
        : `已过滤 · ${match.label || match.reason}`;

    const actions = document.createElement('div');
    actions.className = 'xcf-fold-actions';

    const btnShow = document.createElement('button');
    btnShow.type = 'button';
    btnShow.className = 'xcf-btn';
    btnShow.textContent = '显示';
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    btnShow.addEventListener('click', (e) => {
      stop(e);
      handlers.onShow(article);
    });

    const btnBlock = document.createElement('button');
    btnBlock.type = 'button';
    btnBlock.className = 'xcf-btn xcf-btn-warn';
    btnBlock.textContent = '屏蔽此用户';
    btnBlock.addEventListener('click', (e) => {
      stop(e);
      handlers.onBlock(meta.handle, article);
    });

    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = 'xcf-btn xcf-btn-link';
    btnOk.textContent = '误杀';
    btnOk.addEventListener('click', (e) => {
      stop(e);
      handlers.onWhitelist(meta.handle, article);
    });

    actions.appendChild(btnShow);
    actions.appendChild(btnBlock);
    actions.appendChild(btnOk);
    main.appendChild(label);
    main.appendChild(actions);
    bar.appendChild(main);
    return bar;
  }

  function updateBarReason(article, meta, match) {
    const bar = articleToBar.get(article);
    if (!bar) return;
    const label = bar.querySelector('.xcf-fold-label');
    if (label) {
      label.textContent =
        typeof XcfRules?.foldBarText === 'function'
          ? XcfRules.foldBarText(meta, match)
          : `已过滤 · ${match.label || match.reason}`;
    }
  }

  function isBarLinkedToArticle(bar, article) {
    if (!bar || !article) return false;
    const row = getTweetRow(article);
    let next = bar.nextElementSibling;
    if (next === row || next === article) return true;
    if (next?.contains?.(article)) return true;
    return false;
  }

  function getThreadRootArticle() {
    const fn = window.__xcfAdapter?.getThreadRootArticle;
    if (typeof fn === 'function') return fn();
    const col = document.querySelector('[data-testid="primaryColumn"]');
    return col?.querySelector('article[data-testid="tweet"]') || null;
  }

  function cleanupOrphanBars() {
    const root = getThreadRootArticle();
    document.querySelectorAll('.xcf-fold-bar').forEach((bar) => {
      if (
        root &&
        root.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_PRECEDING
      ) {
        bar.remove();
        return;
      }
      const next = bar.nextElementSibling;
      const article =
        next?.matches?.('article[data-testid="tweet"]') ?
          next
        : next?.querySelector?.('article[data-testid="tweet"]');
      if (article?.dataset?.xcfMainPost === '1') {
        bar.remove();
        return;
      }
      const ok =
        article &&
        article.dataset.xcfFolded === '1' &&
        article.classList.contains('xcf-hidden-article') &&
        isBarLinkedToArticle(bar, article);
      if (!ok) bar.remove();
    });
    recountFolded();
  }

  function recountFolded() {
    foldedCount = document.querySelectorAll(
      'article[data-testid="tweet"][data-xcf-folded="1"]'
    ).length;
  }

  function removeLooseBarAbove(article) {
    for (const node of [article, getTweetRow(article)]) {
      const prev = node?.previousElementSibling;
      if (prev?.classList?.contains('xcf-fold-bar')) prev.remove();
    }
  }

  function fold(article, meta, match, handlers) {
    if (article.dataset.xcfOverride || article.dataset.xcfMainPost === '1') return;

    if (article.dataset.xcfFolded && article.classList.contains('xcf-hidden-article')) {
      const bar = articleToBar.get(article);
      if (bar?.isConnected && isBarLinkedToArticle(bar, article)) {
        updateBarReason(article, meta, match);
        return;
      }
      delete article.dataset.xcfFolded;
      applyShow(article);
    }

    removeLooseBarAbove(article);

    article.dataset.xcfFolded = '1';
    applyHide(article);

    if (settingsDisplayMode() === XCF.DISPLAY_MODE.HIDE) {
      recountFolded();
      refreshSummary();
      return;
    }

    const bar = createBar(article, meta, match, {
      onShow: (el) => {
        if (handlers.onShow) handlers.onShow(el);
        else unfoldArticle(el);
      },
      onBlock: handlers.onBlock,
      onWhitelist: handlers.onWhitelist
    });

    const host = article.parentNode || getTweetRow(article).parentNode;
    host?.insertBefore(bar, article);
    articleToBar.set(article, bar);
    recountFolded();
    refreshSummary();
  }

  function settingsDisplayMode() {
    return window.__xcfSettings?.displayMode || XCF.DISPLAY_MODE.FOLD;
  }

  function resetPageState() {
    document.querySelectorAll('.xcf-fold-bar, .xcf-summary, .xcf-summary-host').forEach((n) =>
      n.remove()
    );
    document.querySelectorAll('article[data-xcf-folded]').forEach((a) => {
      applyShow(a);
      delete a.dataset.xcfFolded;
      delete a.dataset.xcfProcessed;
      delete a.dataset.xcfOverride;
      delete a.dataset.xcfLogged;
      delete a.dataset.xcfLogKey;
      delete a.dataset.xcfTweetId;
      delete a.dataset.xcfMainPost;
    });
    document.querySelectorAll('[data-testid="cellInnerDiv"].xcf-hidden-article').forEach((row) => {
      row.classList.remove('xcf-hidden-article');
    });
    foldedCount = 0;
    summaryEl = null;
  }

  function getStats() {
    return { foldedCount };
  }

  return {
    fold,
    unfoldArticle,
    updateBarReason,
    cleanupOrphanBars,
    recountFolded,
    resetPageState,
    getStats,
    refreshSummary,
    getTweetRow,
    applyHide
  };
})();
