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
    }

    start() {
      if (this.isRunning) return;
      this.isRunning = true;

      // 1. 监控路由变化 (SPA URL Change)
      this._monitorUrl();

      // 2. 观察全局 DOM
      this.observer = new MutationObserver((mutations) => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this._processMutations();
        }, 120);
      });

      this.observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });

      // 初始执行一次扫描
      setTimeout(() => this._processMutations(), 500);
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
      const check = () => {
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
      };

      window.addEventListener('popstate', check);
      // 定期兜底检测 pushState
      setInterval(check, 1000);
    }
  }

  window.__SuperX__.DOMObserver = new DOMObserver();
})();
