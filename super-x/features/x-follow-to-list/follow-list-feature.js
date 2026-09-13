/**
 * SuperX Feature: x-follow-to-list (Follow 批量转列表)
 * 基于底座 GraphQL 拦截无感知提取关注/粉丝列表，并支持多维筛选与防封流控批量加入指定 X List
 */
(function() {
  window.__SuperX__ = window.__SuperX__ || {};

  const FEATURE_ID = "x-follow-to-list";
  const MAX_USERS = 5000;
  const STORAGE_KEY_USERS = "superx_follow_list_captured_users";
  const STORAGE_KEY_CONFIG = "superx_follow_list_config";

  const DEFAULT_CONFIG = {
    enabled: true,
    targetListId: "",
    targetListUrl: "",
    betweenMin: 2.5,
    betweenMax: 4.5,
    batchSize: 20,
    pauseBetweenBatches: 15,
    showFloatingBadge: true
  };

  class FollowListFeature {
    constructor() {
      this.id = FEATURE_ID;
      this.name = "Follow 批量转列表";
      this.defaultEnabled = true;

      this.context = null;
      this.config = { ...DEFAULT_CONFIG };
      this.usersMap = new Map(); // id -> user object
      this.activeJob = null;
      this.pendingRequests = new Map(); // requestId -> { resolve, reject, timer }
      this.saveDebounceTimer = null;
      this.badgeElement = null;
    }

    async init(context) {
      this.context = context;

      // 1. 读取持久化配置与已捕获账号
      try {
        const stored = await chrome.storage.local.get([STORAGE_KEY_CONFIG, STORAGE_KEY_USERS]);
        if (stored[STORAGE_KEY_CONFIG]) {
          this.config = { ...DEFAULT_CONFIG, ...stored[STORAGE_KEY_CONFIG] };
        }
        if (Array.isArray(stored[STORAGE_KEY_USERS])) {
          stored[STORAGE_KEY_USERS].forEach(u => {
            if (u && u.id) this.usersMap.set(String(u.id), u);
          });
        }
      } catch (err) {
        console.warn("[SuperX FollowList] Failed to read stored state:", err);
      }

      // 2. 监听来自 EventBus 的添加结果
      if (this.context && this.context.eventBus) {
        this.context.eventBus.on("list:add_result", (result) => {
          this._handleAddResult(result);
        });
      }

      // 3. 监听扩展内部通信（来自 SidePanel / Popup）
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message !== "object") return;

        if (message.type === "SUPERX_FOLLOW_LIST_GET_STATE") {
          sendResponse({
            success: true,
            totalUsers: this.usersMap.size,
            users: Array.from(this.usersMap.values()).slice(-2000),
            config: this.config,
            job: this.activeJob ? {
              running: this.activeJob.running,
              paused: this.activeJob.paused,
              total: this.activeJob.total,
              processed: this.activeJob.processed,
              successCount: this.activeJob.successCount,
              failedCount: this.activeJob.failedCount,
              currentHandle: this.activeJob.currentHandle,
              statusText: this.activeJob.statusText
            } : null
          });
          return true;
        }

        if (message.type === "SUPERX_FOLLOW_LIST_CLEAR") {
          this.usersMap.clear();
          chrome.storage.local.remove([STORAGE_KEY_USERS]);
          this._updateFloatingBadge();
          sendResponse({ success: true, count: 0 });
          return true;
        }

        if (message.type === "SUPERX_FOLLOW_LIST_SAVE_CONFIG") {
          this.config = { ...this.config, ...(message.config || {}) };
          chrome.storage.local.set({ [STORAGE_KEY_CONFIG]: this.config });
          sendResponse({ success: true });
          return true;
        }

        if (message.type === "SUPERX_FOLLOW_LIST_START_JOB") {
          const { listId, userIds, settings } = message;
          this.startBatchAddJob(listId, userIds, settings)
            .then(res => sendResponse(res))
            .catch(err => sendResponse({ success: false, error: err.message }));
          return true;
        }

        if (message.type === "SUPERX_FOLLOW_LIST_STOP_JOB") {
          this.stopBatchAddJob();
          sendResponse({ success: true });
          return true;
        }
      });

      console.log(`[SuperX FollowList] Initialized. Loaded ${this.usersMap.size} accounts.`);
    }

    async enable() {
      this._updateFloatingBadge();
    }

    async disable() {
      if (this.badgeElement) {
        this.badgeElement.remove();
        this.badgeElement = null;
      }
      this.stopBatchAddJob();
    }

    onRouteChange(newUrl) {
      this._updateFloatingBadge();
    }

    /**
     * 响应底座网络劫持捕获的 GraphQL 响应
     */
    onGraphQLResponse(endpoint, data) {
      if (!data) return;

      // 仅在符合关注/粉丝/用户关系的端点下解析
      const ep = String(endpoint || "").toLowerCase();
      const isRelevant = ep.includes("following") || ep.includes("followers") ||
                         ep.includes("userbyscreenname") || ep.includes("listmembers");

      if (isRelevant || this._containsUserData(data)) {
        const extracted = this._extractUsersFromPayload(data);
        if (extracted.length > 0) {
          let newCount = 0;
          for (const user of extracted) {
            if (!this.usersMap.has(user.id)) {
              newCount++;
            }
            this.usersMap.set(user.id, user);
          }

          // 保持上限不超过 MAX_USERS
          if (this.usersMap.size > MAX_USERS) {
            const keys = Array.from(this.usersMap.keys());
            const removeCount = keys.length - MAX_USERS;
            for (let i = 0; i < removeCount; i++) {
              this.usersMap.delete(keys[i]);
            }
          }

          if (newCount > 0) {
            this._schedulePersistUsers();
            this._updateFloatingBadge();
            console.log(`[SuperX FollowList] Captured ${newCount} new accounts (Total: ${this.usersMap.size})`);
          }
        }
      }
    }

    _containsUserData(payload) {
      if (!payload || typeof payload !== "object") return false;
      const json = JSON.stringify(payload).slice(0, 1000);
      return json.includes('"screen_name"') || json.includes('"rest_id"');
    }

    /**
     * 深度遍历 GraphQL JSON 提取标准化用户结构
     */
    _extractUsersFromPayload(payload) {
      const found = [];
      const seen = new Set();

      const text = (v) => (v == null ? "" : String(v));
      const getId = (obj) => text(obj?.rest_id || obj?.id_str || obj?.id || obj?.user_id);
      const getLegacy = (obj) => obj?.legacy || obj?.user_results?.result?.legacy || obj;
      const getHandle = (obj) => {
        const leg = getLegacy(obj);
        return text(obj?.core?.screen_name || leg?.screen_name || obj?.screen_name || obj?.username);
      };
      const getName = (obj) => {
        const leg = getLegacy(obj);
        return text(obj?.core?.name || leg?.name || obj?.name);
      };
      const getAvatar = (obj) => {
        const leg = getLegacy(obj);
        return text(obj?.avatar?.image_url || obj?.profile_image_url_https || leg?.profile_image_url_https);
      };

      const isUser = (obj) => {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
        const id = getId(obj);
        const handle = getHandle(obj);
        return Boolean(id && handle && (obj.legacy || obj.core || obj.profile_image_url_https || obj.user_results));
      };

      const walk = (node, depth) => {
        if (!node || depth > 16 || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (const item of node) walk(item, depth + 1);
          return;
        }

        if (isUser(node)) {
          const id = getId(node);
          if (!seen.has(id)) {
            seen.add(id);
            const leg = getLegacy(node);
            found.push({
              id,
              handle: getHandle(node),
              name: getName(node),
              bio: text(node?.profile_bio?.description || leg?.description || node?.description),
              location: text(leg?.location || node?.location),
              avatar: getAvatar(node),
              followers: Number(leg?.followers_count ?? node?.public_metrics?.followers_count ?? 0) || 0,
              following: Number(leg?.friends_count ?? node?.public_metrics?.following_count ?? 0) || 0,
              posts: Number(leg?.statuses_count ?? node?.public_metrics?.tweet_count ?? 0) || 0,
              verified: Boolean(node?.verification?.verified || leg?.verified || leg?.is_blue_verified),
              mutual: Boolean(
                node?.relationship_perspectives?.followed_by ||
                node?.relationship?.source?.followed_by ||
                node?.relationship?.followed_by ||
                leg?.followed_by
              ),
              capturedAt: Date.now()
            });
          }
        }

        for (const val of Object.values(node)) {
          walk(val, depth + 1);
        }
      };

      walk(payload, 0);
      return found;
    }

    _schedulePersistUsers() {
      if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = setTimeout(() => {
        const list = Array.from(this.usersMap.values()).slice(-MAX_USERS);
        chrome.storage.local.set({ [STORAGE_KEY_USERS]: list }).catch(() => {});
      }, 1200);
    }

    /**
     * 页面悬浮小徽章
     */
    _updateFloatingBadge() {
      const isFollowingPage = location.pathname.includes("/following") ||
                              location.pathname.includes("/followers") ||
                              location.pathname.includes("/verified_followers");

      if (!isFollowingPage || !this.config.showFloatingBadge || this.usersMap.size === 0) {
        if (this.badgeElement) {
          this.badgeElement.remove();
          this.badgeElement = null;
        }
        return;
      }

      if (!this.badgeElement) {
        this.badgeElement = document.createElement("div");
        this.badgeElement.className = "superx-follow-badge";
        this.badgeElement.title = "点击在 SuperX 侧边栏中管理已捕获关注与批量加入列表";
        this.badgeElement.addEventListener("click", () => {
          chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL", tab: "tab-follow-list" });
        });
        document.body.appendChild(this.badgeElement);
      }

      this.badgeElement.innerHTML = `
        <span class="superx-follow-badge-icon">👥</span>
        <span>SuperX 捕获关注</span>
        <span class="superx-follow-badge-count">${this.usersMap.size}</span>
      `;
    }

    /**
     * 启动批量添加任务
     */
    async startBatchAddJob(listId, userIds, customSettings = {}) {
      if (!listId || !Array.isArray(userIds) || userIds.length === 0) {
        throw new Error("请提供有效的 List ID 和待添加账号列表");
      }

      if (this.activeJob && this.activeJob.running) {
        throw new Error("已有正在运行的添加任务，请先暂停或停止");
      }

      const settings = { ...this.config, ...customSettings };
      const job = {
        listId: String(listId),
        queue: [...userIds],
        total: userIds.length,
        processed: 0,
        successCount: 0,
        failedCount: 0,
        running: true,
        paused: false,
        currentHandle: "",
        statusText: "准备开始添加..."
      };
      this.activeJob = job;

      // 异步调度执行
      this._runJobLoop(job, settings);

      return { success: true, total: job.total };
    }

    stopBatchAddJob() {
      if (this.activeJob) {
        this.activeJob.running = false;
        this.activeJob.statusText = "任务已停止";
      }
    }

    async _runJobLoop(job, settings) {
      let batchCounter = 0;

      while (job.running && job.queue.length > 0) {
        if (job.paused) {
          await this._sleep(1000);
          continue;
        }

        const userId = job.queue.shift();
        const userObj = this.usersMap.get(String(userId));
        job.currentHandle = userObj ? `@${userObj.handle}` : String(userId);
        job.statusText = `正在添加 ${job.currentHandle} (${job.processed + 1}/${job.total})...`;

        const result = await this._addMemberWithProxy(job.listId, userId);
        job.processed++;

        if (result.ok) {
          job.successCount++;
        } else {
          job.failedCount++;
          if (result.status === 429) {
            job.statusText = `触发 X 官方频率限制 (429)，冷却退避 45 秒中...`;
            await this._sleep(45000);
          }
        }

        batchCounter++;
        if (settings.batchSize && batchCounter >= settings.batchSize && job.queue.length > 0) {
          batchCounter = 0;
          const pauseSec = settings.pauseBetweenBatches || 15;
          job.statusText = `已完成一轮批次，防风控休息 ${pauseSec} 秒...`;
          await this._sleep(pauseSec * 1000);
        } else if (job.queue.length > 0) {
          // 随机安全间隔 2.5s ~ 4.5s
          const min = (settings.betweenMin || 2.5) * 1000;
          const max = (settings.betweenMax || 4.5) * 1000;
          const delay = Math.floor(Math.random() * (max - min)) + min;
          await this._sleep(delay);
        }
      }

      if (job.running) {
        job.running = false;
        job.statusText = `批量导入完成！成功 ${job.successCount}，失败 ${job.failedCount}`;
      }
    }

    _addMemberWithProxy(listId, userId) {
      return new Promise((resolve) => {
        const requestId = "req_" + Math.random().toString(36).slice(2, 10);
        const timer = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          resolve({ ok: false, status: 0, message: "请求超时 (15s)" });
        }, 15000);

        this.pendingRequests.set(requestId, { resolve, timer });

        // 发送给 MAIN world 的 hook 执行
        window.postMessage({
          source: "superx-content",
          type: "SUPERX_ADD_LIST_MEMBER",
          requestId,
          listId,
          userId
        }, "*");
      });
    }

    _handleAddResult(result) {
      if (!result || !result.requestId) return;
      const pending = this.pendingRequests.get(result.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(result.requestId);
        pending.resolve(result);
      }
    }

    _sleep(ms) {
      return new Promise(r => setTimeout(r, ms));
    }
  }

  const instance = new FollowListFeature();
  if (window.__SuperX__ && window.__SuperX__.FeatureManager) {
    window.__SuperX__.FeatureManager.register(instance);
  }
})();
