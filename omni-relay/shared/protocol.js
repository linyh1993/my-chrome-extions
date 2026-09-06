/**
 * @file 统一中继协议信封封装 (Unified Relay Envelope Protocol)
 * 规范化所有站点（X, Reddit, 其它）及所有通道（Network HTTP, WebSocket, DOM Extractor）投递给本地服务的数据包格式。
 */
const RelayProtocol = (() => {
  const PROTOCOL_VERSION = '1.0';

  /**
   * 通道类型定义
   */
  const CHANNELS = {
    NETWORK_HTTP: 'network_http',       // 拦截到的 HTTP/GraphQL/REST 响应
    NETWORK_WS: 'network_ws',           // 拦截到的 WebSocket 帧或生命周期事件
    DOM_EXTRACTED: 'dom_extracted',     // 页面 Content Script 结构化提取的数据
    SYSTEM_PING: 'system_ping'          // 连通性测试包
  };

  /**
   * 构建标准化信封数据包
   * @param {Object} options
   * @param {string} options.siteId - 平台标识 (如 'x', 'reddit', 'universal')
   * @param {string} options.siteLabel - 平台可读名称 (如 'X / Twitter', 'Reddit')
   * @param {string} options.channel - 采集通道类型 (CHANNELS)
   * @param {string} [options.sourceUrl] - 产生数据的页面 URL
   * @param {string} [options.action] - 操作类型（如 'batch_posts', 'graphql_response', 'ws_frame'）
   * @param {*} options.payload - 核心业务数据负载
   * @param {Object} [options.metadata] - 附加元数据 (如 tabId, latency, headers 等)
   */
  function createEnvelope({
    siteId = 'universal',
    siteLabel = 'Universal',
    channel = CHANNELS.NETWORK_HTTP,
    sourceUrl = '',
    action = 'data',
    payload = null,
    metadata = {}
  }) {
    return {
      version: PROTOCOL_VERSION,
      relaySource: 'omni-relay',
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      site: {
        id: siteId,
        label: siteLabel
      },
      channel,
      action,
      sourceUrl,
      metadata: {
        ...metadata
      },
      payload
    };
  }

  return {
    PROTOCOL_VERSION,
    CHANNELS,
    createEnvelope
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RelayProtocol;
}
