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
      this.activeEnrichJob = null;
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
            if (u && u.id) {
              // 兼容与清洗历史脏数据
              if (u.statsFetched === undefined) {
                u.statsFetched = Boolean((u.followers && u.followers > 0) || (u.following && u.following > 0));
              }
              if (u.location === "[object Object]") {
                u.location = "";
              }
              this.usersMap.set(String(u.id), u);
            }
          });
        }
      } catch (err) {
        console.warn("[SuperX FollowList] Failed to read stored state:", err);
      }

      // 2. 监听来自 EventBus 的添加与数据补全结果
      if (this.context && this.context.eventBus) {
        this.context.eventBus.on("list:add_result", (result) => {
          this._handleAddResult(result);
        });
        this.context.eventBus.on("user:stats_result", (result) => {
          this._handleEnrichResult(result);
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
            } : null,
            enrichJob: this.activeEnrichJob ? {
              running: this.activeEnrichJob.running,
              total: this.activeEnrichJob.total,
              processed: this.activeEnrichJob.processed,
              successCount: this.activeEnrichJob.successCount,
              failedCount: this.activeEnrichJob.failedCount,
              currentHandle: this.activeEnrichJob.currentHandle,
              statusText: this.activeEnrichJob.statusText
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

        if (message.type === "SUPERX_FOLLOW_LIST_START_ENRICH") {
          const { userIds } = message;
          this.startEnrichStatsJob(userIds)
            .then(res => sendResponse(res))
            .catch(err => sendResponse({ success: false, error: err.message }));
          return true;
        }

        if (message.type === "SUPERX_FOLLOW_LIST_STOP_ENRICH") {
          this.stopEnrichStatsJob();
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
      this._scanDOMUserCells();
    }

    onDOMNodes(nodes) {
      this._updateFloatingBadge();
      this._scanDOMUserCells();
    }

    /**
     * DOM 兜底扫描：若页面已渲染关注者卡片直接提取
     */
    _scanDOMUserCells() {
      const isFollowingPage = location.pathname.includes("/following") ||
                              location.pathname.includes("/followers") ||
                              location.pathname.includes("/verified_followers");
      if (!isFollowingPage) return;

      const cells = document.querySelectorAll('div[data-testid="UserCell"]');
      if (cells.length === 0) return;

      let newCount = 0;
      cells.forEach(cell => {
        try {
          const link = cell.querySelector('a[href^="/"][role="link"]');
          if (!link) return;
          const href = link.getAttribute("href") || "";
          const handle = href.replace(/^\//, "").split("/")[0].trim();
          if (!handle || handle === "i" || handle === "home" || handle === "explore" || handle === "messages") return;

          // 检查是否已有该 handle 的账号
          let exists = false;
          for (const u of this.usersMap.values()) {
            if (u.handle && u.handle.toLowerCase() === handle.toLowerCase()) {
              exists = true;
              break;
            }
          }

          if (!exists) {
            const nameEl = cell.querySelector('div[dir="ltr"] span');
            const name = nameEl ? nameEl.textContent.trim() : handle;
            const img = cell.querySelector('img[src*="profile_images"]');
            const avatar = img ? img.src : "";
            const isMutual = cell.textContent.includes("互相关注") || cell.textContent.includes("Follows you");

            const pseudoUser = {
              id: `dom_${handle}`,
              handle,
              name,
              bio: "",
              location: "",
              avatar,
              followers: 0,
              following: 0,
              posts: 0,
              verified: false,
              mutual: isMutual,
              capturedAt: Date.now()
            };

            this.usersMap.set(pseudoUser.id, pseudoUser);
            newCount++;
          }
        } catch (_) {}
      });

      if (newCount > 0) {
        this._schedulePersistUsers();
        this._updateFloatingBadge();
      }
    }

    /**
     * 响应底座网络劫持捕获的 GraphQL 响应
     */
    onGraphQLResponse(endpoint, data) {
      if (!data) return;

      // 仅在符合关注/粉丝/用户关系的端点下解析
      const ep = String(endpoint || "").toLowerCase();
      const isRelevant = ep.includes("following") || ep.includes("followers") ||
                         ep.includes("userbyscreenname") || ep.includes("userbyrestid") ||
                         ep.includes("userhovercard") || ep.includes("profilespotlights") ||
                         ep.includes("tweetdetail") || ep.includes("listmembers");

      if (isRelevant || this._containsUserData(data)) {
        const extracted = this._extractUsersFromPayload(data);
        if (extracted.length > 0) {
          let newCount = 0;
          let updatedCount = 0;

          for (const user of extracted) {
            const existing = this.usersMap.get(user.id);
            if (!existing) {
              newCount++;
              this.usersMap.set(user.id, user);
            } else {
              // 智能合并：保留已有的真实粉丝数与关注数，防止被关注列表的空数据覆盖
              const statsFetched = Boolean(user.statsFetched || existing.statsFetched);
              const followers = user.statsFetched ? user.followers : (existing.statsFetched ? existing.followers : (user.followers || existing.followers || 0));
              const following = user.statsFetched ? user.following : (existing.statsFetched ? existing.following : (user.following || existing.following || 0));
              const posts = user.statsFetched ? user.posts : (existing.statsFetched ? existing.posts : (user.posts || existing.posts || 0));

              const merged = {
                ...existing,
                ...user,
                followers,
                following,
                posts,
                statsFetched,
                bio: user.bio || existing.bio || "",
                avatar: user.avatar || existing.avatar || "",
                location: user.location || existing.location || "",
                verified: Boolean(user.verified || existing.verified),
                mutual: Boolean(user.mutual || existing.mutual),
                capturedAt: Math.max(user.capturedAt || 0, existing.capturedAt || 0)
              };

              this.usersMap.set(user.id, merged);
              updatedCount++;
            }
          }

          // 保持上限不超过 MAX_USERS
          if (this.usersMap.size > MAX_USERS) {
            const keys = Array.from(this.usersMap.keys());
            const removeCount = keys.length - MAX_USERS;
            for (let i = 0; i < removeCount; i++) {
              this.usersMap.delete(keys[i]);
            }
          }

          if (newCount > 0 || updatedCount > 0) {
            this._schedulePersistUsers();
            this._updateFloatingBadge();
            if (newCount > 0) {
              console.log(`[SuperX FollowList] Captured ${newCount} new accounts (Total: ${this.usersMap.size})`);
            }
          }
        }
      }
    }

    _containsUserData(payload) {
      if (!payload || typeof payload !== "object") return false;
      const json = JSON.stringify(payload).slice(0, 2000);
      return json.includes('"screen_name"') || json.includes('"rest_id"') ||
             json.includes('"relationship_counts"') || json.includes('"user_results"');
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

      const getLocation = (node, leg) => {
        const loc = leg?.location ?? node?.location;
        if (!loc) return "";
        if (typeof loc === "string") return loc.trim();
        if (typeof loc === "object") {
          return text(loc.location || loc.name || loc.city || "");
        }
        return "";
      };

      const getFollowers = (node, leg) => {
        const val = node?.relationship_counts?.followers ??
                    leg?.relationship_counts?.followers ??
                    leg?.followers_count ??
                    node?.followers_count ??
                    node?.public_metrics?.followers_count ??
                    node?.followers ??
                    leg?.normal_followers_count ??
                    null;
        return val != null ? (Number(val) || 0) : null;
      };

      const getFollowing = (node, leg) => {
        const val = node?.relationship_counts?.following ??
                    leg?.relationship_counts?.following ??
                    leg?.friends_count ??
                    node?.friends_count ??
                    node?.following_count ??
                    node?.public_metrics?.following_count ??
                    node?.following ??
                    null;
        return val != null ? (Number(val) || 0) : null;
      };

      const getPosts = (node, leg) => {
        const val = node?.tweet_counts?.tweets ??
                    leg?.tweet_counts?.tweets ??
                    leg?.statuses_count ??
                    node?.statuses_count ??
                    node?.public_metrics?.tweet_count ??
                    node?.posts ??
                    null;
        return val != null ? (Number(val) || 0) : null;
      };

      const isUser = (obj) => {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
        const id = getId(obj);
        const handle = getHandle(obj);
        return Boolean(id && handle && (obj.legacy || obj.core || obj.profile_image_url_https || obj.user_results || obj.relationship_counts));
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
            const rawFollowers = getFollowers(node, leg);
            const rawFollowing = getFollowing(node, leg);
            const rawPosts = getPosts(node, leg);
            const statsFetched = rawFollowers !== null || rawFollowing !== null;

            found.push({
              id,
              handle: getHandle(node),
              name: getName(node),
              bio: text(node?.profile_bio?.description || leg?.description || node?.description),
              location: getLocation(node, leg),
              avatar: getAvatar(node),
              followers: rawFollowers != null ? rawFollowers : 0,
              following: rawFollowing != null ? rawFollowing : 0,
              posts: rawPosts != null ? rawPosts : 0,
              statsFetched,
              verified: Boolean(node?.is_blue_verified || node?.verification?.verified || leg?.verified || leg?.is_blue_verified || node?.is_identity_verified),
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

      if (!isFollowingPage || !this.config.showFloatingBadge) {
        if (this.badgeElement) {
          this.badgeElement.remove();
          this.badgeElement = null;
        }
        return;
      }

      if (!document.body) return;

      if (!this.badgeElement) {
        this.badgeElement = document.createElement("div");
        this.badgeElement.className = "superx-follow-badge";
        this.badgeElement.title = "点击在 SuperX 侧边栏中管理已捕获关注与批量加入列表";
        this.badgeElement.addEventListener("click", () => {
          chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL", tab: "tab-follow-list" });
        });
        document.body.appendChild(this.badgeElement);
      }

      const count = this.usersMap.size;
      this.badgeElement.innerHTML = `
        <span class="superx-follow-badge-icon">👥</span>
        <span>SuperX 关注转列表</span>
        <span class="superx-follow-badge-count">${count > 0 ? `${count} 人` : "向下滚动抓取"}</span>
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

    async startEnrichStatsJob(userIds) {
      if (this.activeEnrichJob && this.activeEnrichJob.running) {
        return { success: false, error: "已有补全任务在进行中" };
      }

      let targets = [];
      if (Array.isArray(userIds) && userIds.length > 0) {
        targets = userIds.map(id => this.usersMap.get(String(id))).filter(Boolean);
      } else {
        // 补全所有未获取统计数据的账号，单次最多 100 个
        targets = Array.from(this.usersMap.values()).filter(u => !u.statsFetched).slice(0, 100);
      }

      if (targets.length === 0) {
        return { success: false, error: "当前没有需要补全粉丝数的账号" };
      }

      const job = {
        running: true,
        total: targets.length,
        processed: 0,
        successCount: 0,
        failedCount: 0,
        currentHandle: "",
        statusText: `就绪，准备补全 ${targets.length} 个账号...`,
        queue: [...targets]
      };

      this.activeEnrichJob = job;
      this._runEnrichLoop(job);
      return { success: true, total: job.total };
    }

    stopEnrichStatsJob() {
      if (this.activeEnrichJob) {
        this.activeEnrichJob.running = false;
        this.activeEnrichJob.statusText = "补全任务已停止";
      }
    }

    async _runEnrichLoop(job) {
      while (job.running && job.queue.length > 0) {
        const user = job.queue.shift();
        if (!user || !user.handle) {
          job.processed++;
          continue;
        }

        job.currentHandle = `@${user.handle}`;
        job.statusText = `正在补全 ${job.currentHandle} 粉丝数据 (${job.processed + 1}/${job.total})...`;

        const res = await this._fetchUserStatsWithProxy(user.handle);
        job.processed++;

        if (res.ok) {
          job.successCount++;
        } else {
          job.failedCount++;
          if (res.status === 429) {
            job.statusText = `触发 X 官方频率限制 (429)，冷却退避 40 秒中...`;
            await this._sleep(40000);
          }
        }

        if (job.queue.length > 0) {
          // 防风控安全间隔 1.2s ~ 2.2s
          const delay = Math.floor(Math.random() * 1000) + 1200;
          await this._sleep(delay);
        }
      }

      if (job.running) {
        job.running = false;
        job.statusText = `补全完成！成功 ${job.successCount}，失败 ${job.failedCount}`;
        this._schedulePersistUsers();
      }
    }

    _fetchUserStatsWithProxy(handle) {
      return new Promise((resolve) => {
        const requestId = "req_stat_" + Math.random().toString(36).slice(2, 10);
        const timer = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          resolve({ ok: false, status: 0, message: "请求超时 (12s)" });
        }, 12000);

        this.pendingRequests.set(requestId, { resolve, timer });

        window.postMessage({
          source: "superx-content",
          type: "SUPERX_FETCH_USER_STATS",
          requestId,
          handle
        }, "*");
      });
    }

    _handleEnrichResult(result) {
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
