/** @file 折叠 UI：默认折叠，可展开 / 屏蔽 / 加白 */
const XcfFold = (() => {
  const articleToBar = new WeakMap();
  let foldedCount = 0;
  let summaryEl = null;

  function getPrimaryColumn() {
    return document.querySelector('[data-testid="primaryColumn"]');
  }

  function ensureSummary() {
    const col = getPrimaryColumn();
    if (!col) return null;
    if (summaryEl && summaryEl.isConnected) return summaryEl;

    summaryEl = document.createElement('div');
    summaryEl.className = 'xcf-summary';
    summaryEl.hidden = true;
    col.appendChild(summaryEl);
    return summaryEl;
  }

  function refreshSummary() {
    const el = ensureSummary();
    if (!el) return;
    if (foldedCount <= 0) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = '';
    const text = document.createElement('span');
    text.textContent = `已过滤 ${foldedCount} 条评论`;
    const showAll = document.createElement('button');
    showAll.type = 'button';
    showAll.className = 'xcf-btn xcf-btn-link';
    showAll.textContent = '全部显示';
    showAll.addEventListener('click', () => {
      document.querySelectorAll('[data-xcf-folded="1"]').forEach((node) => {
        if (node.matches('article')) unfoldArticle(node, { keepOverride: false });
      });
    });
    el.appendChild(text);
    el.appendChild(showAll);
  }

  function unfoldArticle(article, { keepOverride = true } = {}) {
    if (!article?.dataset?.xcfFolded) return;
    article.classList.remove('xcf-hidden-article');
    delete article.dataset.xcfFolded;
    if (keepOverride) article.dataset.xcfOverride = '1';

    const bar = articleToBar.get(article);
    if (bar) {
      bar.remove();
      articleToBar.delete(article);
    }
    foldedCount = Math.max(0, foldedCount - 1);
    refreshSummary();
  }

  function createBar(article, meta, match, handlers) {
    const bar = document.createElement('div');
    bar.className = 'xcf-fold-bar';
    bar.setAttribute('role', 'note');

    const main = document.createElement('div');
    main.className = 'xcf-fold-main';

    const label = document.createElement('span');
    label.className = 'xcf-fold-label';
    label.textContent = `已过滤 @${meta.handle || '未知'} · ${match.reason}`;

    const actions = document.createElement('div');
    actions.className = 'xcf-fold-actions';

    const btnShow = document.createElement('button');
    btnShow.type = 'button';
    btnShow.className = 'xcf-btn';
    btnShow.textContent = '显示';
    btnShow.addEventListener('click', () => handlers.onShow(article));

    const btnBlock = document.createElement('button');
    btnBlock.type = 'button';
    btnBlock.className = 'xcf-btn xcf-btn-warn';
    btnBlock.textContent = '屏蔽此用户';
    btnBlock.addEventListener('click', () => handlers.onBlock(meta.handle));

    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = 'xcf-btn xcf-btn-link';
    btnOk.textContent = '误杀';
    btnOk.addEventListener('click', () => handlers.onWhitelist(meta.handle, article));

    actions.appendChild(btnShow);
    actions.appendChild(btnBlock);
    actions.appendChild(btnOk);
    main.appendChild(label);
    main.appendChild(actions);
    bar.appendChild(main);
    return bar;
  }

  function fold(article, meta, match, handlers) {
    if (article.dataset.xcfFolded || article.dataset.xcfOverride) return;
    if (settingsDisplayMode() === XCF.DISPLAY_MODE.HIDE) {
      article.classList.add('xcf-hidden-article');
      article.dataset.xcfFolded = '1';
      foldedCount += 1;
      refreshSummary();
      return;
    }

    article.classList.add('xcf-hidden-article');
    article.dataset.xcfFolded = '1';

    const bar = createBar(article, meta, match, {
      onShow: (el) => unfoldArticle(el),
      onBlock: handlers.onBlock,
      onWhitelist: handlers.onWhitelist
    });

    article.parentNode?.insertBefore(bar, article);
    articleToBar.set(article, bar);
    foldedCount += 1;
    refreshSummary();
  }

  function settingsDisplayMode() {
    return window.__xcfSettings?.displayMode || XCF.DISPLAY_MODE.FOLD;
  }

  function resetPageState() {
    document.querySelectorAll('.xcf-fold-bar, .xcf-summary').forEach((n) => n.remove());
    document.querySelectorAll('article[data-xcf-folded]').forEach((a) => {
      a.classList.remove('xcf-hidden-article');
      delete a.dataset.xcfFolded;
      delete a.dataset.xcfProcessed;
      delete a.dataset.xcfOverride;
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
    resetPageState,
    getStats,
    refreshSummary
  };
})();
