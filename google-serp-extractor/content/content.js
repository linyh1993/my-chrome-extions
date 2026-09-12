/**
 * Google SERP & SEO Extractor - Content Script Entry Point
 */

(function() {
  let lastData = null;
  let debounceTimer = null;
  let observer = null;

  function doScan() {
    try {
      const data = globalThis.GseParser.parseCurrentPage(document);
      lastData = data;

      // Update in-page floating capsule
      if (globalThis.GseFloatingUI) {
        globalThis.GseFloatingUI.updateStatus(data, {
          onExtract: doScan
        });
      }

      // Notify background service worker to update extension badge
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({
          cmd: 'UPDATE_BADGE',
          count: data.totalFound,
          ready: data.isFullyReady
        }).catch(() => {});
      }

      return data;
    } catch (err) {
      console.error('[GSE] Scan error:', err);
      return null;
    }
  }

  function scheduleScan(delay = 600) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      doScan();
    }, delay);
  }

  function initObserver() {
    if (observer) observer.disconnect();

    const targetNode = document.getElementById('search') ||
                       document.getElementById('rcnt') ||
                       document.body;

    if (!targetNode) return;

    observer = new MutationObserver((mutations) => {
      let shouldRescan = false;
      for (const m of mutations) {
        for (const added of m.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE) {
            // Check if added node belongs to our floating UI; ignore if so
            if (added.id === 'gse-root' || added.closest?.('#gse-root')) continue;

            // Check if added node is from AITDK or Keywords Everywhere
            const cls = added.className || '';
            const id = added.id || '';
            if (
              (typeof cls === 'string' && (cls.includes('xt-') || cls.includes('aitdk') || cls.includes('g '))) ||
              (typeof id === 'string' && (id.includes('xt-') || id.includes('aitdk')))
            ) {
              shouldRescan = true;
              break;
            }
          }
        }
        if (shouldRescan) break;
      }

      if (shouldRescan) {
        scheduleScan(800);
      }
    });

    observer.observe(targetNode, {
      childList: true,
      subtree: true
    });
  }

  // Handle messages from Popup or Background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.cmd === 'GET_SERP_DATA') {
      const data = lastData || doScan();
      sendResponse({ ok: true, data });
      return true;
    }

    if (request.cmd === 'TRIGGER_EXTRACT') {
      const data = doScan();
      sendResponse({ ok: true, data });
      return true;
    }

    if (request.cmd === 'OPEN_PREVIEW') {
      if (globalThis.GseFloatingUI) {
        globalThis.GseFloatingUI.openPreviewModal({ onExtract: doScan });
      }
      sendResponse({ ok: true });
      return true;
    }
  });

  // Start initialization
  function init() {
    if (globalThis.GseFloatingUI) {
      globalThis.GseFloatingUI.initFloatingUI({
        onExtract: doScan
      });
    }

    // Initial scan
    doScan();

    // Secondary scans to catch async AITDK and KE renders
    setTimeout(doScan, 1500);
    setTimeout(doScan, 3500);

    initObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
