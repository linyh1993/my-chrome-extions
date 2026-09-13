/**
 * SuperX Core - DOMObserver
 * 全局统一防抖 DOM 观察器与 SPA 路由变化感知
 */
(function() {
  window.__SuperX__ = window.__SuperX__ || {};

  class DOMObserver {
    constructor() {
      this.observer = null;
      this.listeners = new Set();
      this.routeListeners = new Set();
      this.debounceTimer = null;
      this.currentUrl = location.href;
      this.isRunning = false;
      this.intervalId = null;
    }

    start() {
      if (this.isRunning) return;
      this.isRunning = true;

      // 1. 监控路由变化 (SPA URL Change)
      this._monitorUrl();

      // 2. 观察全局 DOM (包含 characterData，及时捕获推文文字渲染)
      this.observer = new MutationObserver((mutations) => {
        let shouldProcess = false;
        for (const m of mutations) {
          // 过滤掉扩展内部 UI 变动（避免扩展自己修改 DOM 导致无限重复循环扫描与按钮闪烁）
          let hasExternalChange = false;
          for (let i = 0; i < m.addedNodes.length; i++) {
            const node = m.addedNodes[i];
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node;
              if (
                el.classList?.contains('x-spam-inner-banner') ||
                el.classList?.contains('superx-viral-badge') ||
                el.classList?.contains('superx-viral-tooltip') ||
                el.classList?.contains('superx-bookmark-count') ||
                el.classList?.contains('superx-copy-md-btn') ||
                el.closest?.('.x-spam-inner-banner, .superx-viral-badge, .superx-viral-tooltip')
              ) {
                continue;
              }
            }
            hasExternalChange = true;
            break;
          }

          if (hasExternalChange) {
            shouldProcess = true;
            break;
          }

          if (m.type === 'characterData') {
            const parent = m.target?.parentElement;
            if (parent && !parent.closest?.('.x-spam-inner-banner, .superx-viral-badge, .superx-viral-tooltip')) {
              shouldProcess = true;
              break;
            }
          }
        }
        if (shouldProcess) {
          this.scheduleScan(80);
        }
      });

      this.observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });

      // 3. 滚动监听：向下滚动时快速扫描新曝光推文
      window.addEventListener('scroll', () => {
        this.scheduleScan(100);
      }, { passive: true });

      // 4. 定时巡检兜底：状态页每 800ms 检查一次
      this.intervalId = setInterval(() => {
        if (/\/status\/\d+/.test(location.pathname)) {
          this.scheduleScan(100);
        }
      }, 800);

      // 初始执行一次扫描
      setTimeout(() => this._processMutations(), 300);
    }

    stop() {
      if (!this.isRunning) return;
      this.isRunning = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    }

    scheduleScan(delayMs = 80) {
      if (!this.isRunning) return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this._processMutations();
      }, delayMs);
    }

    /**
     * 注册推文节点监听
     */
    onTweets(callback) {
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }

    /**
     * 注册路由变化监听
     */
    onRouteChange(callback) {
      this.routeListeners.add(callback);
      return () => this.routeListeners.delete(callback);
    }

    _processMutations() {
      if (!this.isRunning) return;

      // 查验 URL 是否发生改变
      if (location.href !== this.currentUrl) {
        const prev = this.currentUrl;
        this.currentUrl = location.href;
        for (const cb of this.routeListeners) {
          try {
            cb(this.currentUrl, prev);
          } catch (e) {
            console.error("[SuperX DOMObserver] Route callback error:", e);
          }
        }
      }

      // 获取当前页面上所有推文元素
      const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      if (tweets.length === 0) return;

      for (const cb of this.listeners) {
        try {
          cb(tweets);
        } catch (e) {
          console.error("[SuperX DOMObserver] Tweet listener error:", e);
        }
      }
    }

    _monitorUrl() {
      const notifyUrlChange = () => {
        if (location.href !== this.currentUrl) {
          const prev = this.currentUrl;
          this.currentUrl = location.href;
          for (const cb of this.routeListeners) {
            try {
              cb(this.currentUrl, prev);
            } catch (e) {
              console.error("[SuperX DOMObserver] Route callback error:", e);
            }
          }
          this.scheduleScan(150);
        }
      };

      // Hook pushState & replaceState for instant SPA transition detection
      const origPush = history.pushState;
      const origReplace = history.replaceState;

      history.pushState = function(...args) {
        const res = origPush.apply(this, args);
        notifyUrlChange();
        return res;
      };

      history.replaceState = function(...args) {
        const res = origReplace.apply(this, args);
        notifyUrlChange();
        return res;
      };

      window.addEventListener('popstate', notifyUrlChange);
      setInterval(notifyUrlChange, 250);
    }
  }

  window.__SuperX__.DOMObserver = new DOMObserver();
})();
