/**
 * 站点适配器注册表。
 * 新站点 / 新页面类型：实现 adapter 并 register()，无需改 bootstrap。
 *
 * adapter 约定：
 * - id, hosts[]
 * - detectContext(): XCF.CONTEXT.* | null
 * - isContextEnabled(ctx, settings): boolean
 * - findArticles(root): HTMLElement[]
 * - isMainPost(article, ctx): boolean  // 主帖不过滤
 * - extractMeta(article): { handle, displayName, text }
 */
const XcfRegistry = (() => {
  const adapters = [];

  function register(adapter) {
    adapters.push(adapter);
  }

  function getForHost(hostname) {
    const host = (hostname || '').toLowerCase();
    return adapters.find((a) =>
      (a.hosts || []).some((h) => host === h || host.endsWith('.' + h))
    );
  }

  return { register, getForHost, _adapters: adapters };
})();
