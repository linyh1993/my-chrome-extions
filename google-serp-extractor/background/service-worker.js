/**
 * Background Service Worker for Google SERP & SEO Extractor
 * Manifest V3 compliant
 * Handles badge updates and proxy-server relay synchronization
 */

try {
  importScripts('../shared/relay-client.js');
} catch (e) {
  console.error('[GSE] Failed to import relay-client.js in service worker:', e);
}

const STORAGE_KEYS = {
  ENDPOINT_URL: 'gse_relay_endpoint_url',
  AUTO_SYNC: 'gse_relay_auto_sync_enabled',
  LAST_SYNC: 'gse_relay_last_sync_info'
};

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[GSE] Google SERP & SEO Extractor installed successfully.');
  // Set default settings if not configured
  const stored = await chrome.storage.local.get([STORAGE_KEYS.ENDPOINT_URL, STORAGE_KEYS.AUTO_SYNC]);
  if (!stored[STORAGE_KEYS.ENDPOINT_URL]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.ENDPOINT_URL]: globalThis.GseRelayClient?.DEFAULT_RELAY_ENDPOINT || 'http://127.0.0.1:9090/relay',
      [STORAGE_KEYS.AUTO_SYNC]: false
    });
  }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Badge update
  if (request.cmd === 'UPDATE_BADGE') {
    const tabId = sender.tab ? sender.tab.id : undefined;
    if (tabId) {
      const count = request.count || 0;
      const text = count > 0 ? String(count) : '';
      chrome.action.setBadgeText({ text, tabId });

      // Green if all ready, orange if pending
      const color = request.ready ? '#059669' : '#d97706';
      chrome.action.setBadgeBackgroundColor({ color, tabId });
    }
    sendResponse({ ok: true });
    return false;
  }

  // 2. Ping local proxy-server
  if (request.cmd === 'RELAY_PING') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(STORAGE_KEYS.ENDPOINT_URL);
        const endpoint = request.endpointUrl || stored[STORAGE_KEYS.ENDPOINT_URL] || 'http://127.0.0.1:9090/relay';
        const result = await globalThis.GseRelayClient.pingRelay(endpoint);
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, message: err.message || 'Ping failed' });
      }
    })();
    return true; // async sendResponse
  }

  // 3. Send SERP data to proxy-server relay
  if (request.cmd === 'RELAY_SYNC_DATA') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(STORAGE_KEYS.ENDPOINT_URL);
        const endpoint = request.endpointUrl || stored[STORAGE_KEYS.ENDPOINT_URL] || 'http://127.0.0.1:9090/relay';
        const sourceUrl = request.sourceUrl || (sender.tab ? sender.tab.url : '');
        const envelope = globalThis.GseRelayClient.createSerpEnvelope(request.data, { sourceUrl });
        const result = await globalThis.GseRelayClient.sendSerpEnvelope(endpoint, envelope);

        const syncInfo = {
          time: new Date().toISOString(),
          query: request.data?.query || '',
          itemCount: (request.data?.items || []).length,
          ok: result.ok,
          message: result.message || result.error || ''
        };
        await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SYNC]: syncInfo });

        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: err.message || 'Sync failed' });
      }
    })();
    return true; // async sendResponse
  }

  // 4. Get relay settings
  if (request.cmd === 'GET_RELAY_SETTINGS') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get([
          STORAGE_KEYS.ENDPOINT_URL,
          STORAGE_KEYS.AUTO_SYNC,
          STORAGE_KEYS.LAST_SYNC
        ]);
        sendResponse({
          ok: true,
          endpointUrl: stored[STORAGE_KEYS.ENDPOINT_URL] || 'http://127.0.0.1:9090/relay',
          autoSync: Boolean(stored[STORAGE_KEYS.AUTO_SYNC]),
          lastSync: stored[STORAGE_KEYS.LAST_SYNC] || null
        });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  // 5. Save relay settings
  if (request.cmd === 'SAVE_RELAY_SETTINGS') {
    (async () => {
      try {
        const updates = {};
        if (typeof request.endpointUrl === 'string') {
          updates[STORAGE_KEYS.ENDPOINT_URL] = request.endpointUrl.trim();
        }
        if (typeof request.autoSync === 'boolean') {
          updates[STORAGE_KEYS.AUTO_SYNC] = request.autoSync;
        }
        await chrome.storage.local.set(updates);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});
