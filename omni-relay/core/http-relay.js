/**
 * @file 弹性本地 HTTP 中继投递器 (Resilient Local HTTP Relay)
 * 负责将标准信封数据包发送到本地接收服务，提供超时控制、指数退避重试与投递状态监控。
 */
const HttpRelay = (() => {
  const DEFAULT_TIMEOUT_MS = 5000;
  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF_MS = 600;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 投递数据包（带重试与退避）
   * @param {string} endpointUrl
   * @param {Object} envelope - 标准 RelayProtocol 信封对象
   * @param {number} [attempt=0]
   */
  async function postEnvelope(endpointUrl, envelope, attempt = 0) {
    const body = JSON.stringify(envelope);
    let lastError = null;

    try {
      const response = await fetchWithTimeout(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Relay-Source': 'omni-relay',
          'X-Relay-Site': envelope.site?.id || 'unknown'
        },
        body
      });

      if (response.ok) {
        const count = Array.isArray(envelope.payload) ? envelope.payload.length : 1;
        await RelaySettings.recordSuccess(envelope.site?.id || 'universal', envelope.channel, count);
        return { ok: true, status: response.status, count };
      }

      lastError = `HTTP ${response.status} ${response.statusText}`.trim();
    } catch (err) {
      lastError = err?.name === 'AbortError' ? '请求超时 (Timeout)' : (err?.message || String(err));
    }

    // 重试判断
    if (attempt < MAX_RETRIES - 1) {
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      await sleep(delay);
      return postEnvelope(endpointUrl, envelope, attempt + 1);
    }

    await RelaySettings.recordFailure(lastError);
    console.warn(`[HttpRelay] 本地中继投递失败 (${endpointUrl}):`, lastError);
    return { ok: false, error: lastError };
  }

  /**
   * 发送连通性测试 Ping
   * @param {string} endpointUrl
   */
  async function pingEndpoint(endpointUrl) {
    const pingEnvelope = RelayProtocol.createEnvelope({
      siteId: 'system',
      siteLabel: 'System',
      channel: RelayProtocol.CHANNELS.SYSTEM_PING,
      action: 'ping',
      payload: { message: 'Ping test from omni-relay' }
    });

    try {
      const res = await fetchWithTimeout(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pingEnvelope)
      }, 3000);

      if (res.ok) {
        return { ok: true, status: res.status, message: '连接成功 (Server OK)' };
      }
      return { ok: false, status: res.status, message: `服务响应异常: HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        message: err?.name === 'AbortError' ? '连接超时' : `无法连接服务 (${err?.message || 'Network error'})`
      };
    }
  }

  return {
    postEnvelope,
    pingEndpoint
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HttpRelay;
}
