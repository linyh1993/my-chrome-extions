/** @file Bounded local HTTP delivery for mirrored traffic. */
const MirrorHttpRelay = (() => {
  const deliveryStateByTab = new Map();
  const postTimeoutMs = 5000;
  const postRetryDelayMs = 500;
  const postAttempts = 2;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function rememberDelivery(tabId, patch) {
    deliveryStateByTab.set(tabId, { at: Date.now(), ...patch });
  }

  function getDelivery(tabId) {
    return deliveryStateByTab.get(tabId) || null;
  }

  function clearTab(tabId) {
    deliveryStateByTab.delete(tabId);
  }

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), postTimeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function post(tabId, mirrorUrl, payload) {
    const body = JSON.stringify(payload);
    let lastError = null;

    // Keep delivery bounded: small retry, no unbounded queue inside the service worker.
    for (let attempt = 1; attempt <= postAttempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout(mirrorUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body
        });

        if (response.ok) {
          rememberDelivery(tabId, { ok: true, status: response.status });
          return true;
        }

        lastError = `HTTP ${response.status} ${response.statusText}`.trim();
      } catch (error) {
        lastError = error?.name === 'AbortError' ? 'timeout' : error?.message || String(error);
      }

      if (attempt < postAttempts) await sleep(postRetryDelayMs);
    }

    rememberDelivery(tabId, { ok: false, error: lastError || 'post_failed' });
    console.error(`[mirror Tab ${tabId}] local delivery failed:`, lastError);
    return false;
  }

  return { clearTab, getDelivery, post };
})();
