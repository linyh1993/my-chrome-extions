/**
 * Google SERP & SEO Extractor - Content Script Entry Point
 * Manages DOM observation, pagination tracking, and multi-page session accumulation.
 */

(function() {
  const SESSION_KEY = 'gse_serp_accum_session';
  const MODE_KEY = 'gse_accum_mode_enabled';

  let lastData = null;
  let debounceTimer = null;
  let observer = null;
  let lastUrl = window.location.href;

  function getStoredSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveStoredSession(session) {
    try {
      if (session) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch (e) {}
  }

  function isAccumulateEnabled() {
    try {
      const flag = sessionStorage.getItem(MODE_KEY);
      return flag === null ? true : flag === 'true';
    } catch (e) {
      return true;
    }
  }

  function setAccumulateEnabled(val) {
    try {
      sessionStorage.setItem(MODE_KEY, val ? 'true' : 'false');
    } catch (e) {}
  }

  function doScan() {
    try {
      const pageData = globalThis.GseParser.parseCurrentPage(document, { currentUrl: window.location.href });
      const query = (pageData.query || '').trim().toLowerCase();

      const accEnabled = isAccumulateEnabled();
      let effectiveData = pageData;

      if (accEnabled) {
        let stored = getStoredSession();
        // If search query changed to a different topic, reset session
        if (stored && stored.query && query && stored.query.toLowerCase() !== query) {
          stored = null;
          saveStoredSession(null);
        }

        if (globalThis.GseParser.mergeMultiPageData) {
          effectiveData = globalThis.GseParser.mergeMultiPageData(stored, pageData);
        }
        saveStoredSession(effectiveData);
      } else {
        saveStoredSession(null);
      }

      lastData = effectiveData;

      const callbacks = {
        onExtract: doScan,
        isAccumulateMode: accEnabled,
        onToggleAccumulate: (enabled) => {
          setAccumulateEnabled(enabled);
          if (!enabled) {
            saveStoredSession(null);
          }
          doScan();
        },
        onClearAccumulate: () => {
          saveStoredSession(null);
          doScan();
        }
      };

      // Update in-page floating capsule
      if (globalThis.GseFloatingUI) {
        globalThis.GseFloatingUI.updateStatus(effectiveData, callbacks);
      }

      // Notify background service worker to update extension badge
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({
          cmd: 'UPDATE_BADGE',
          count: effectiveData.totalFound,
          ready: effectiveData.isFullyReady
        }).catch(() => {});
      }

      return effectiveData;
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

            const txt = added.textContent || '';
            const cls = added.className || '';
            const id = added.id || '';
            if (
              txt.includes('AITDK') ||
              txt.includes('Monthly Visits') ||
              txt.includes('MOZ DA') ||
              (typeof cls === 'string' && (cls.includes('xt-') || cls.includes('aitdk') || cls.includes('g ') || cls.includes('MjjYud'))) ||
              (typeof id === 'string' && (id.includes('xt-') || id.includes('aitdk') || id.includes('rso'))) ||
              added.querySelector?.('[class*="aitdk"], [class*="xt-"], .g, .MjjYud')
            ) {
              shouldRescan = true;
              break;
            }
          }
        }
        if (shouldRescan) break;
      }

      if (shouldRescan) {
        scheduleScan(500);
      }
    });

    observer.observe(targetNode, {
      childList: true,
      subtree: true,
      characterData: true
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

    if (request.cmd === 'CLEAR_ACCUMULATE') {
      saveStoredSession(null);
      const data = doScan();
      sendResponse({ ok: true, data });
      return true;
    }

    if (request.cmd === 'TOGGLE_ACCUMULATE') {
      setAccumulateEnabled(Boolean(request.enabled));
      if (!request.enabled) saveStoredSession(null);
      const data = doScan();
      sendResponse({ ok: true, data });
      return true;
    }

    if (request.cmd === 'OPEN_PREVIEW') {
      if (globalThis.GseFloatingUI) {
        globalThis.GseFloatingUI.openPreviewModal({
          onExtract: doScan,
          isAccumulateMode: isAccumulateEnabled(),
          onToggleAccumulate: (enabled) => {
            setAccumulateEnabled(enabled);
            if (!enabled) saveStoredSession(null);
            doScan();
          },
          onClearAccumulate: () => {
            saveStoredSession(null);
            doScan();
          }
        });
      }
      sendResponse({ ok: true });
      return true;
    }
  });

  // Track URL changes (Google SPA navigation or pagination anchor clicks)
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      scheduleScan(400);
    }
  }, 1000);

  window.addEventListener('popstate', () => {
    scheduleScan(400);
  });

  // Start initialization
  function init() {
    if (globalThis.GseFloatingUI) {
      globalThis.GseFloatingUI.initFloatingUI({
        onExtract: doScan,
        isAccumulateMode: isAccumulateEnabled(),
        onToggleAccumulate: (enabled) => {
          setAccumulateEnabled(enabled);
          if (!enabled) saveStoredSession(null);
          doScan();
        },
        onClearAccumulate: () => {
          saveStoredSession(null);
          doScan();
        }
      });
    }

    // Initial scan
    doScan();

    // Secondary scans to catch async AITDK and KE renders
    setTimeout(doScan, 600);
    setTimeout(doScan, 1500);
    setTimeout(doScan, 2800);
    setTimeout(doScan, 4500);

    initObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
