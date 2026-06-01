/** @file 对元数据执行规则引擎 */
const XcfFilterEngine = {
  evaluate(meta, settings) {
    if (!settings.enabled) return null;
    return XcfRules.evaluate(meta, settings);
  },

  /** @returns {{ kind: 'noise'|'signal', match: object|null }} */
  classify(meta, settings) {
    if (!settings?.enabled) return { kind: 'signal', match: null };
    const match = XcfRules.evaluate(meta, settings);
    return match ? { kind: 'noise', match } : { kind: 'signal', match: null };
  }
};
