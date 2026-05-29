/** @file 对元数据执行规则引擎 */
const XcfFilterEngine = {
  evaluate(meta, settings) {
    if (!settings.enabled) return null;
    return XcfRules.evaluate(meta, settings);
  }
};
