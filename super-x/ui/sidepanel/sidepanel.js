/**
 * SuperX Side Panel Controller
 * 包含完整的 X Comment Cleaner v2.0 与 Better UI 配置中枢
 */
document.addEventListener("DOMContentLoaded", async () => {
  const storage = window.__SuperX__.Storage;
  const rulesEngine = globalThis.XCleanerRules || {};
  const presetPacks = rulesEngine.KEYWORD_PACKS || [];
  const defaultCleanerSettings = rulesEngine.DEFAULT_CLEANER_SETTINGS || {
    enabled: true,
    hideMode: 'collapse',
    autoBlock: true,
    filterSimhash: true,
    filterHeuristics: true,
    filterPureNumbers: true,
    filterMentionSpam: true,
    filterDuplicates: true,
    packSettings: {},
    customKeywords: [],
    whitelist: [],
    blockedCount: 0
  };

  // --- 1. Tab 切换逻辑 ---
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  function switchTab(targetId) {
    tabBtns.forEach(b => b.classList.remove("active"));
    tabPanes.forEach(p => p.classList.remove("active"));

    const btn = document.querySelector(`.tab-btn[data-tab="${targetId}"]`);
    const targetPane = document.getElementById(targetId);
    if (btn) btn.classList.add("active");
    if (targetPane) targetPane.classList.add("active");
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");
      switchTab(targetId);
    });
  });

  // 检查是否从外部（Popup 或页面浮动徽章）指定跳转特定 Tab
  if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.get(["superx_active_sidepanel_tab"], (res) => {
      if (res && res.superx_active_sidepanel_tab) {
        switchTab(res.superx_active_sidepanel_tab);
        chrome.storage.session.remove(["superx_active_sidepanel_tab"]).catch(() => {});
      }
    });
  }

  // --- 2. 加载当前各模块配置 ---
  let cleanerConfig = await storage.getConfig("x-comment-cleaner", defaultCleanerSettings);
  cleanerConfig = {
    ...defaultCleanerSettings,
    ...cleanerConfig,
    packSettings: {
      ...(defaultCleanerSettings.packSettings || {}),
      ...(cleanerConfig.packSettings || {})
    }
  };

  let currentWhitelist = Array.isArray(cleanerConfig.whitelist) ? [...cleanerConfig.whitelist] : [];
  let currentCustomKeywords = Array.isArray(cleanerConfig.customKeywords) ? [...cleanerConfig.customKeywords] : [];

  // --- 3. 渲染 Tab 1: 监控大盘 ---
  const statBlockedCount = document.getElementById("stat-blocked-count");
  const statBlockedAccounts = document.getElementById("stat-blocked-accounts");
  const statWhiteCount = document.getElementById("stat-white-count");
  const statActivePacks = document.getElementById("stat-active-packs");
  const btnResetCounter = document.getElementById("btn-reset-counter");
  const btnClearCache = document.getElementById("btn-clear-cache");
  const recentBlockedList = document.getElementById("recent-blocked-list");

  async function updateOverviewStats() {
    // 拦截评论总计数
    chrome.storage.sync.get(["blockedCount"], (data) => {
      if (statBlockedCount) statBlockedCount.textContent = data.blockedCount || 0;
    });

    // 白名单数
    if (statWhiteCount) statWhiteCount.textContent = currentWhitelist.length;

    // 活跃词库数
    const totalPacks = presetPacks.length;
    let enabledPacks = 0;
    presetPacks.forEach(p => {
      if (cleanerConfig.packSettings[p.id] !== false) enabledPacks++;
    });
    if (statActivePacks) statActivePacks.textContent = `${enabledPacks} / ${totalPacks}`;

    // 拉黑缓存列表
    chrome.storage.local.get(["blockedAccountsCache"], (data) => {
      const list = Array.isArray(data.blockedAccountsCache) ? data.blockedAccountsCache : [];
      if (statBlockedAccounts) statBlockedAccounts.textContent = list.length;

      if (!recentBlockedList) return;
      recentBlockedList.innerHTML = "";

      if (list.length === 0) {
        recentBlockedList.innerHTML = `<div class="empty-hint">暂无最近拉黑记录</div>`;
        return;
      }

      const recentSlice = list.slice(-20).reverse();
      recentSlice.forEach((item) => {
        const handle = typeof item === "string" ? item : item.handle;
        const reason = typeof item === "object" ? (item.reason || "智能拉黑") : "智能拉黑";

        const row = document.createElement("div");
        row.className = "recent-item";
        row.innerHTML = `
          <div>
            <span class="recent-handle">@${escapeHtml(handle)}</span>
            <span class="recent-reason">(${escapeHtml(reason)})</span>
          </div>
          <button type="button" class="btn-text-action unblock-btn">加白</button>
        `;

        const unblockBtn = row.querySelector(".unblock-btn");
        unblockBtn.onclick = () => {
          if (!currentWhitelist.includes(handle)) {
            currentWhitelist.unshift(handle);
            saveCleanerConfig();
            renderWhitelist();
            updateOverviewStats();
          }
        };

        recentBlockedList.appendChild(row);
      });
    });
  }

  updateOverviewStats();

  if (btnResetCounter) {
    btnResetCounter.onclick = () => {
      chrome.storage.sync.set({ blockedCount: 0 });
      if (statBlockedCount) statBlockedCount.textContent = "0";
    };
  }

  if (btnClearCache) {
    btnClearCache.onclick = () => {
      chrome.storage.local.set({ blockedAccountsCache: [] }, () => {
        updateOverviewStats();
      });
    };
  }

  // --- 4. 渲染 Tab 2: 评论净化完整控制台 ---
  async function saveCleanerConfig() {
    cleanerConfig.whitelist = currentWhitelist;
    cleanerConfig.customKeywords = currentCustomKeywords;
    await storage.setConfig("x-comment-cleaner", cleanerConfig);
    updateOverviewStats();
  }

  // 4.1 展示形式
  const modeCollapse = document.getElementById("modeCollapse");
  const modeHide = document.getElementById("modeHide");
  if (cleanerConfig.hideMode === "hide") {
    if (modeHide) modeHide.checked = true;
  } else {
    if (modeCollapse) modeCollapse.checked = true;
  }

  if (modeCollapse) {
    modeCollapse.onchange = () => {
      if (modeCollapse.checked) {
        cleanerConfig.hideMode = "collapse";
        saveCleanerConfig();
      }
    };
  }
  if (modeHide) {
    modeHide.onchange = () => {
      if (modeHide.checked) {
        cleanerConfig.hideMode = "hide";
        saveCleanerConfig();
      }
    };
  }

  // 4.2 原生自动拉黑开关
  const autoBlockToggle = document.getElementById("cleaner-auto-block");
  if (autoBlockToggle) {
    autoBlockToggle.checked = cleanerConfig.autoBlock !== false;
    autoBlockToggle.onchange = () => {
      cleanerConfig.autoBlock = autoBlockToggle.checked;
      saveCleanerConfig();
    };
  }

  // 4.3 渲染 8 大行业分类词库卡片
  const packsGrid = document.getElementById("packsGrid");
  function renderPacksGrid() {
    if (!packsGrid) return;
    packsGrid.innerHTML = "";

    presetPacks.forEach((pack) => {
      const isChecked = cleanerConfig.packSettings[pack.id] !== false;

      const card = document.createElement("label");
      card.className = `pack-card ${isChecked ? "active" : ""}`;
      card.innerHTML = `
        <input type="checkbox" data-pack-id="${pack.id}" ${isChecked ? "checked" : ""}>
        <div class="pack-info">
          <div class="pack-name-row">
            <span class="pack-name">${escapeHtml(pack.name)}</span>
            <span class="pack-count">${pack.rules.length}词</span>
          </div>
          <div class="pack-desc" title="${escapeHtml(pack.description)}">${escapeHtml(pack.description)}</div>
        </div>
      `;

      const input = card.querySelector("input");
      input.onchange = () => {
        cleanerConfig.packSettings[pack.id] = input.checked;
        if (input.checked) {
          card.classList.add("active");
        } else {
          card.classList.remove("active");
        }
        saveCleanerConfig();
      };

      packsGrid.appendChild(card);
    });
  }
  renderPacksGrid();

  // 4.4 智能识别算法 5 大独立开关
  const filterSimhash = document.getElementById("cleaner-filter-simhash");
  const filterHeuristics = document.getElementById("cleaner-filter-heuristics");
  const filterPureNumbers = document.getElementById("cleaner-filter-purenumbers");
  const filterMentionSpam = document.getElementById("cleaner-filter-mentionspam");
  const filterDuplicates = document.getElementById("cleaner-filter-duplicates");

  if (filterSimhash) {
    filterSimhash.checked = cleanerConfig.filterSimhash !== false;
    filterSimhash.onchange = () => {
      cleanerConfig.filterSimhash = filterSimhash.checked;
      saveCleanerConfig();
    };
  }
  if (filterHeuristics) {
    filterHeuristics.checked = cleanerConfig.filterHeuristics !== false;
    filterHeuristics.onchange = () => {
      cleanerConfig.filterHeuristics = filterHeuristics.checked;
      saveCleanerConfig();
    };
  }
  if (filterPureNumbers) {
    filterPureNumbers.checked = cleanerConfig.filterPureNumbers !== false;
    filterPureNumbers.onchange = () => {
      cleanerConfig.filterPureNumbers = filterPureNumbers.checked;
      saveCleanerConfig();
    };
  }
  if (filterMentionSpam) {
    filterMentionSpam.checked = cleanerConfig.filterMentionSpam !== false;
    filterMentionSpam.onchange = () => {
      cleanerConfig.filterMentionSpam = filterMentionSpam.checked;
      saveCleanerConfig();
    };
  }
  if (filterDuplicates) {
    filterDuplicates.checked = cleanerConfig.filterDuplicates !== false;
    filterDuplicates.onchange = () => {
      cleanerConfig.filterDuplicates = filterDuplicates.checked;
      saveCleanerConfig();
    };
  }

  // 4.5 免杀白名单管理器
  const whitelistInput = document.getElementById("whitelistInput");
  const addWhitelistBtn = document.getElementById("addWhitelistBtn");
  const whitelistList = document.getElementById("whitelistList");
  const whiteCountEl = document.getElementById("whiteCount");

  function renderWhitelist() {
    if (!whitelistList) return;
    whitelistList.innerHTML = "";
    if (whiteCountEl) whiteCountEl.textContent = currentWhitelist.length;

    if (currentWhitelist.length === 0) {
      whitelistList.innerHTML = `<span style="color:#71767b;font-size:11px;padding:4px;">暂无白名单用户（可在推文评论区直接一键「加白」）</span>`;
      return;
    }

    currentWhitelist.forEach((handle, index) => {
      const tag = document.createElement("span");
      tag.className = "tag tag-white";
      tag.textContent = `@${handle}`;

      const removeBtn = document.createElement("span");
      removeBtn.className = "tag-remove";
      removeBtn.innerHTML = "&times;";
      removeBtn.title = "移除白名单";
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        currentWhitelist.splice(index, 1);
        saveCleanerConfig();
        renderWhitelist();
      };

      tag.appendChild(removeBtn);
      whitelistList.appendChild(tag);
    });
  }

  function handleAddWhitelist() {
    if (!whitelistInput) return;
    const raw = whitelistInput.value.trim();
    if (!raw) return;
    const norm = raw.replace(/^@+/, "").toLowerCase();
    if (norm.length >= 1 && !currentWhitelist.includes(norm)) {
      currentWhitelist.unshift(norm);
      saveCleanerConfig();
      renderWhitelist();
    }
    whitelistInput.value = "";
  }

  if (addWhitelistBtn) addWhitelistBtn.onclick = handleAddWhitelist;
  if (whitelistInput) {
    whitelistInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddWhitelist();
      }
    };
  }
  renderWhitelist();

  // 4.6 自定义补充关键词管理器
  const keywordInput = document.getElementById("keywordInput");
  const addKeywordBtn = document.getElementById("addKeywordBtn");
  const keywordsList = document.getElementById("keywordsList");
  const customKwCountEl = document.getElementById("customKwCount");

  function renderCustomKeywords() {
    if (!keywordsList) return;
    keywordsList.innerHTML = "";
    if (customKwCountEl) customKwCountEl.textContent = currentCustomKeywords.length;

    if (currentCustomKeywords.length === 0) {
      keywordsList.innerHTML = `<span style="color:#71767b;font-size:11px;padding:4px;">暂无自定义关键词</span>`;
      return;
    }

    currentCustomKeywords.forEach((kw, index) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = kw;

      const removeBtn = document.createElement("span");
      removeBtn.className = "tag-remove";
      removeBtn.innerHTML = "&times;";
      removeBtn.title = "删除关键词";
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        currentCustomKeywords.splice(index, 1);
        saveCleanerConfig();
        renderCustomKeywords();
      };

      tag.appendChild(removeBtn);
      keywordsList.appendChild(tag);
    });
  }

  function handleAddKeyword() {
    if (!keywordInput) return;
    const val = keywordInput.value.trim();
    if (!val || val.length < 2) return;
    if (!currentCustomKeywords.includes(val)) {
      currentCustomKeywords.unshift(val);
      saveCleanerConfig();
      renderCustomKeywords();
    }
    keywordInput.value = "";
  }

  if (addKeywordBtn) addKeywordBtn.onclick = handleAddKeyword;
  if (keywordInput) {
    keywordInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddKeyword();
      }
    };
  }
  renderCustomKeywords();

  // --- 5. 渲染 Tab 3: Better UI 定制 ---
  const uiHideTrends = document.getElementById("ui-hide-trends");
  const uiWiden = document.getElementById("ui-widen-timeline");
  const uiOutline = document.getElementById("ui-generate-outline");

  let uiConfig = await storage.getConfig("x-better-ui", {
    hideTrending: true,
    widenTimeline: true,
    generateOutline: true
  });

  if (uiHideTrends) {
    uiHideTrends.checked = uiConfig.hideTrending !== false;
    uiHideTrends.onchange = async () => {
      uiConfig.hideTrending = uiHideTrends.checked;
      await storage.setConfig("x-better-ui", uiConfig);
    };
  }

  if (uiWiden) {
    uiWiden.checked = uiConfig.widenTimeline !== false;
    uiWiden.onchange = async () => {
      uiConfig.widenTimeline = uiWiden.checked;
      await storage.setConfig("x-better-ui", uiConfig);
    };
  }

  if (uiOutline) {
    uiOutline.checked = uiConfig.generateOutline !== false;
    uiOutline.onchange = async () => {
      uiConfig.generateOutline = uiOutline.checked;
      await storage.setConfig("x-better-ui", uiConfig);
    };
  }

  // --- 6. 渲染 Tab 4: 备份管理 ---
  const btnExport = document.getElementById("btn-export-config");
  const btnReset = document.getElementById("btn-reset-config");

  if (btnExport) {
    btnExport.onclick = async () => {
      const allData = await storage.exportAll();
      const blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `superx-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  if (btnReset) {
    btnReset.onclick = async () => {
      if (confirm("确定要重置所有 SuperX 配置为默认值吗？")) {
        await chrome.storage.local.clear();
        await chrome.storage.sync.clear();
        alert("已重置所有配置为初始状态，请刷新网页查看。");
        location.reload();
      }
    };
  }

  // --- 7. 存储变化监听 ---
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.blockedCount) {
      if (statBlockedCount) statBlockedCount.textContent = changes.blockedCount.newValue || 0;
    }
    if (area === "local") {
      if (changes.blockedAccountsCache) {
        updateOverviewStats();
      }
      if (changes.superx_follow_list_captured_users) {
        loadFollowListUsers();
      }
    }
  });

  // --- 8. Tab 4: 关注转列表 (x-follow-to-list) 控制器 ---
  const inputTargetList = document.getElementById("input-target-list");
  const btnSaveTargetList = document.getElementById("btn-save-target-list");
  const followListIdBadge = document.getElementById("follow-list-id-badge");

  const btnSelectAllUsers = document.getElementById("btn-select-all-users");
  const btnInvertUsers = document.getElementById("btn-invert-users");
  const btnExportUsersCsv = document.getElementById("btn-export-users-csv");
  const btnClearCapturedUsers = document.getElementById("btn-clear-captured-users");

  const filterUserQuery = document.getElementById("filter-user-query");
  const filterMutualOnly = document.getElementById("filter-mutual-only");
  const filterVerifiedOnly = document.getElementById("filter-verified-only");
  const filterMinFollowers = document.getElementById("filter-min-followers");
  const filterMaxFollowers = document.getElementById("filter-max-followers");

  const followTotalCount = document.getElementById("follow-total-count");
  const followSelectedCount = document.getElementById("follow-selected-count");
  const curatorUsersContainer = document.getElementById("curator-users-container");

  const followTaskStatusPill = document.getElementById("follow-task-status-pill");
  const followTaskProgressFill = document.getElementById("follow-task-progress-fill");
  const followTaskProgressText = document.getElementById("follow-task-progress-text");
  const followTaskLog = document.getElementById("follow-task-log");
  const btnStartBatchAdd = document.getElementById("btn-start-batch-add");
  const btnStopBatchAdd = document.getElementById("btn-stop-batch-add");

  let allCapturedUsers = [];
  let selectedUserIds = new Set();
  let currentTargetListId = "";
  let isTaskRunning = false;
  let taskPollTimer = null;

  function extractListId(input) {
    const trimmed = (input || "").trim();
    const match = trimmed.match(/lists\/(\d+)/i);
    if (match) return match[1];
    if (/^\d{5,}$/.test(trimmed)) return trimmed;
    return "";
  }

  // 加载已保存的目标 List
  chrome.storage.local.get(["superx_follow_list_config"], (data) => {
    const cfg = data.superx_follow_list_config || {};
    if (cfg.targetListId) {
      currentTargetListId = cfg.targetListId;
      if (inputTargetList) inputTargetList.value = cfg.targetListUrl || cfg.targetListId;
      if (followListIdBadge) {
        followListIdBadge.textContent = `List ID: ${cfg.targetListId}`;
        followListIdBadge.style.color = "#00ba7c";
      }
    }
  });

  if (btnSaveTargetList && inputTargetList) {
    btnSaveTargetList.addEventListener("click", async () => {
      const raw = inputTargetList.value.trim();
      const parsedId = extractListId(raw);
      if (!parsedId) {
        alert("请输入有效的 X List 网址或纯数字 List ID！\n例如：https://x.com/i/lists/123456789");
        return;
      }
      currentTargetListId = parsedId;
      if (followListIdBadge) {
        followListIdBadge.textContent = `List ID: ${parsedId}`;
        followListIdBadge.style.color = "#00ba7c";
      }
      const data = await chrome.storage.local.get(["superx_follow_list_config"]);
      const cfg = { ...(data.superx_follow_list_config || {}), targetListId: parsedId, targetListUrl: raw };
      await chrome.storage.local.set({ superx_follow_list_config: cfg });
      alert(`目标 List 保存成功！(ID: ${parsedId})`);
    });
  }

  async function loadFollowListUsers() {
    const data = await chrome.storage.local.get(["superx_follow_list_captured_users"]);
    allCapturedUsers = Array.isArray(data.superx_follow_list_captured_users) ? data.superx_follow_list_captured_users : [];
    if (followTotalCount) followTotalCount.textContent = allCapturedUsers.length;
    renderCuratorUsers();
  }

  function getFilteredUsers() {
    const query = (filterUserQuery ? filterUserQuery.value.trim().toLowerCase() : "");
    const mutualOnly = filterMutualOnly ? filterMutualOnly.checked : false;
    const verifiedOnly = filterVerifiedOnly ? filterVerifiedOnly.checked : false;
    const minFollowers = filterMinFollowers && filterMinFollowers.value ? parseInt(filterMinFollowers.value, 10) : 0;
    const maxFollowers = filterMaxFollowers && filterMaxFollowers.value ? parseInt(filterMaxFollowers.value, 10) : Infinity;

    return allCapturedUsers.filter(u => {
      if (query) {
        const text = `${u.name} ${u.handle} ${u.bio || ""}`.toLowerCase();
        if (!text.includes(query)) return false;
      }
      if (mutualOnly && !u.mutual) return false;
      if (verifiedOnly && !u.verified) return false;
      if (u.followers < minFollowers) return false;
      if (u.followers > maxFollowers) return false;
      return true;
    });
  }

  function renderCuratorUsers() {
    if (!curatorUsersContainer) return;
    const filtered = getFilteredUsers();

    if (filtered.length === 0) {
      curatorUsersContainer.innerHTML = `<div class="empty-hint">${allCapturedUsers.length === 0 ? "暂无捕获的关注账号。请在 X 打开关注页滚动浏览。" : "没有匹配当前筛选条件的账号。"}</div>`;
      updateSelectionSummary();
      return;
    }

    curatorUsersContainer.innerHTML = "";
    filtered.slice(0, 150).forEach(u => {
      const card = document.createElement("div");
      card.className = "curator-user-card";

      const isChecked = selectedUserIds.has(u.id);
      card.innerHTML = `
        <input type="checkbox" class="user-check" data-id="${escapeHtml(u.id)}" ${isChecked ? "checked" : ""}>
        <img class="curator-avatar" src="${escapeHtml(u.avatar || '')}" alt="${escapeHtml(u.name)}" onerror="this.src='../../icons/icon48.png'">
        <div class="curator-info">
          <div class="curator-names">
            <span class="curator-name">${escapeHtml(u.name)}</span>
            <span class="curator-handle">@${escapeHtml(u.handle)}</span>
            ${u.verified ? '<span title="认证用户" style="color: #1d9bf0;">☑️</span>' : ''}
          </div>
          <div class="curator-meta-pills">
            <span>粉丝: <b>${formatCompact(u.followers)}</b></span>
            <span>关注: <b>${formatCompact(u.following)}</b></span>
            ${u.mutual ? '<span class="pill-mutual">互相关注</span>' : ''}
          </div>
          ${u.bio ? `<div class="curator-bio">${escapeHtml(u.bio)}</div>` : ''}
        </div>
      `;

      const chk = card.querySelector(".user-check");
      chk.addEventListener("change", (e) => {
        if (e.target.checked) selectedUserIds.add(u.id);
        else selectedUserIds.delete(u.id);
        updateSelectionSummary();
      });

      curatorUsersContainer.appendChild(card);
    });

    updateSelectionSummary();
  }

  function updateSelectionSummary() {
    if (followSelectedCount) followSelectedCount.textContent = selectedUserIds.size;
  }

  function formatCompact(num) {
    if (!num) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return String(num);
  }

  // 筛选事件绑定
  [filterUserQuery, filterMinFollowers, filterMaxFollowers].forEach(el => {
    if (el) el.addEventListener("input", renderCuratorUsers);
  });
  [filterMutualOnly, filterVerifiedOnly].forEach(el => {
    if (el) el.addEventListener("change", renderCuratorUsers);
  });

  // 全选
  if (btnSelectAllUsers) {
    btnSelectAllUsers.addEventListener("click", () => {
      const filtered = getFilteredUsers();
      filtered.forEach(u => selectedUserIds.add(u.id));
      renderCuratorUsers();
    });
  }

  // 反选
  if (btnInvertUsers) {
    btnInvertUsers.addEventListener("click", () => {
      const filtered = getFilteredUsers();
      filtered.forEach(u => {
        if (selectedUserIds.has(u.id)) selectedUserIds.delete(u.id);
        else selectedUserIds.add(u.id);
      });
      renderCuratorUsers();
    });
  }

  // 导出 CSV
  if (btnExportUsersCsv) {
    btnExportUsersCsv.addEventListener("click", () => {
      const target = selectedUserIds.size > 0 ?
        allCapturedUsers.filter(u => selectedUserIds.has(u.id)) :
        getFilteredUsers();

      if (target.length === 0) {
        alert("没有可导出的账号！");
        return;
      }

      let csv = "\uFEFFID,Handle,Name,Followers,Following,Posts,Mutual,Verified,Bio,ProfileURL\n";
      target.forEach(u => {
        const row = [
          u.id,
          `"${(u.handle || "").replace(/"/g, '""')}"`,
          `"${(u.name || "").replace(/"/g, '""')}"`,
          u.followers || 0,
          u.following || 0,
          u.posts || 0,
          u.mutual ? "Yes" : "No",
          u.verified ? "Yes" : "No",
          `"${(u.bio || "").replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`,
          `https://x.com/${u.handle}`
        ];
        csv += row.join(",") + "\n";
      });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `superx-following-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // 清空已捕获
  if (btnClearCapturedUsers) {
    btnClearCapturedUsers.addEventListener("click", async () => {
      if (confirm(`确定要清空全部已捕获的 ${allCapturedUsers.length} 个关注账号吗？`)) {
        await chrome.storage.local.remove(["superx_follow_list_captured_users"]);
        allCapturedUsers = [];
        selectedUserIds.clear();
        renderCuratorUsers();
      }
    });
  }

  // 启动批量添加任务
  if (btnStartBatchAdd) {
    btnStartBatchAdd.addEventListener("click", async () => {
      if (!currentTargetListId) {
        alert("请先设置并保存目标 X List！");
        inputTargetList?.focus();
        return;
      }

      const usersToAdd = Array.from(selectedUserIds);
      if (usersToAdd.length === 0) {
        alert("请先勾选需要添加到列表的账号！");
        return;
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        alert("未找到当前活动的 X 网页标签，请确保当前打开了 x.com！");
        return;
      }

      chrome.tabs.sendMessage(tab.id, {
        type: "SUPERX_FOLLOW_LIST_START_JOB",
        listId: currentTargetListId,
        userIds: usersToAdd
      }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          alert(`启动任务失败：${response?.error || chrome.runtime.lastError?.message || "请刷新目标网页后再试"}`);
          return;
        }

        isTaskRunning = true;
        if (followTaskStatusPill) {
          followTaskStatusPill.textContent = "执行中";
          followTaskStatusPill.className = "task-status-pill running";
        }
        btnStartBatchAdd.disabled = true;
        if (btnStopBatchAdd) btnStopBatchAdd.disabled = false;

        startTaskPolling(tab.id);
      });
    });
  }

  // 停止任务
  if (btnStopBatchAdd) {
    btnStopBatchAdd.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "SUPERX_FOLLOW_LIST_STOP_JOB" });
      }
      isTaskRunning = false;
      stopTaskPolling();
      if (followTaskStatusPill) {
        followTaskStatusPill.textContent = "已停止";
        followTaskStatusPill.className = "task-status-pill";
      }
      btnStartBatchAdd.disabled = false;
      btnStopBatchAdd.disabled = true;
    });
  }

  function startTaskPolling(tabId) {
    stopTaskPolling();
    taskPollTimer = setInterval(() => {
      chrome.tabs.sendMessage(tabId, { type: "SUPERX_FOLLOW_LIST_GET_STATE" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.job) {
          return;
        }
        const job = res.job;
        if (followTaskProgressFill && job.total) {
          const pct = Math.floor((job.processed / job.total) * 100);
          followTaskProgressFill.style.width = `${pct}%`;
        }
        if (followTaskProgressText) {
          followTaskProgressText.textContent = `进度：${job.processed} / ${job.total} (成功: ${job.successCount}, 失败: ${job.failedCount})`;
        }
        if (followTaskLog) {
          followTaskLog.textContent = job.statusText;
        }

        if (!job.running) {
          isTaskRunning = false;
          stopTaskPolling();
          if (followTaskStatusPill) {
            followTaskStatusPill.textContent = "已完成";
            followTaskStatusPill.className = "task-status-pill";
          }
          btnStartBatchAdd.disabled = false;
          if (btnStopBatchAdd) btnStopBatchAdd.disabled = true;
        }
      });
    }, 1500);
  }

  function stopTaskPolling() {
    if (taskPollTimer) {
      clearInterval(taskPollTimer);
      taskPollTimer = null;
    }
  }

  // 初始化加载已捕获用户
  loadFollowListUsers();

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
