/**
 * @file 弹性本地 HTTP 中继客户端 (Resilient Local Relay Client)
 * 负责统一信封打包与带超时/重试机制的 HTTP 传输。
 */

import { recordRelaySuccess, recordRelayFailure } from './storage.js';

const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;

export function createEnvelope({ siteId, siteLabel, channel, sourceUrl = '', action = 'data', payload = null }) {
  return {
    version: '1.0',
    relaySource: 'omni-relay',
    timestamp: new Date().toISOString(),
    site: { id: siteId, label: siteLabel },
    channel, // 'network_http' | 'network_ws' | 'dom_extracted' | 'system_ping'
    action,
    sourceUrl,
    payload
  };
}

async function fetchWithTimeout(url, options, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 投递数据包至本地接收端
 */
export async function sendEnvelope(endpointUrl, envelope, attempt = 1) {
  const body = JSON.stringify(envelope);
  let lastError = null;

  try {
    const res = await fetchWithTimeout(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Relay-Site': envelope.site?.id || 'unknown',
        'X-Relay-Channel': envelope.channel || 'unknown'
      },
      body
    });

    if (res.ok) {
      const count = Array.isArray(envelope.payload) ? envelope.payload.length : 1;
      await recordRelaySuccess(envelope.site?.id || 'unknown', count);
      return { ok: true, status: res.status };
    }

    lastError = `HTTP ${res.status} ${res.statusText}`;
  } catch (err) {
    lastError = err?.name === 'AbortError' ? 'Timeout (5s)' : (err?.message || 'Network error');
  }

  if (attempt < MAX_ATTEMPTS) {
    await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
    return sendEnvelope(endpointUrl, envelope, attempt + 1);
  }

  await recordRelayFailure(lastError);
  console.warn(`[RelayClient] 投递失败 (${endpointUrl}):`, lastError);
  return { ok: false, error: lastError };
}

/**
 * 连通性测试 (Ping)
 */
export async function ping(endpointUrl) {
  const pingEnvelope = createEnvelope({
    siteId: 'system',
    siteLabel: 'System',
    channel: 'system_ping',
    action: 'ping',
    payload: { message: 'Ping test from omni-relay' }
  });

  try {
    const res = await fetchWithTimeout(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pingEnvelope)
    }, 2500);

    if (res.ok) {
      return { ok: true, message: '连接成功 (Server OK)' };
    }
    return { ok: false, message: `服务响应异常: HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      message: err?.name === 'AbortError' ? '连接超时 (Timeout)' : `连接失败: ${err?.message || 'Network error'}`
    };
  }
}
