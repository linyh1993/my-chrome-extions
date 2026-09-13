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

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add("active");
    });
  });

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
    if (area === "local" && changes.blockedAccountsCache) {
      updateOverviewStats();
    }
  });

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
