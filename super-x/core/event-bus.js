/**
 * SuperX Core - EventBus
 * 轻量发布-订阅调度器
 */
(function() {
  window.__SuperX__ = window.__SuperX__ || {};

  class EventBus {
    constructor() {
      this.listeners = new Map();
    }

    on(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set());
      }
      this.listeners.get(event).add(callback);
      return () => this.off(event, callback);
    }

    off(event, callback) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).delete(callback);
      }
    }

    emit(event, data) {
      if (!this.listeners.has(event)) return;
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[SuperX EventBus] Error in event '${event}':`, err);
        }
      }
    }
  }

  window.__SuperX__.EventBus = new EventBus();
})();
