/**
 * SuperX Side Panel Controller
 */
document.addEventListener("DOMContentLoaded", async () => {
  const storage = window.__SuperX__.Storage;

  // 1. Tab 切换逻辑
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

  // 2. 加载大盘数据
  chrome.storage.sync.get(["blockedCount"], (data) => {
    const el = document.getElementById("stat-blocked-count");
    if (el) el.textContent = data.blockedCount || 0;
  });

  // 3. 评论净化配置绑定
  const cleanerHideMode = document.getElementById("cleaner-hide-mode");
  const cleanerAutoBlock = document.getElementById("cleaner-auto-block");
  const cleanerSimhash = document.getElementById("cleaner-filter-simhash");
  const cleanerHeuristics = document.getElementById("cleaner-filter-heuristics");
  const cleanerKeywords = document.getElementById("cleaner-custom-keywords");
  const cleanerWhitelist = document.getElementById("cleaner-whitelist");
  const btnSaveCleaner = document.getElementById("btn-save-cleaner");

  const cleanerConfig = await storage.getConfig("x-comment-cleaner", {
    hideMode: 'collapse',
    autoBlock: true,
    filterSimhash: true,
    filterHeuristics: true,
    customKeywords: [],
    whitelist: []
  });

  if (cleanerHideMode) cleanerHideMode.value = cleanerConfig.hideMode || "collapse";
  if (cleanerAutoBlock) cleanerAutoBlock.checked = !!cleanerConfig.autoBlock;
  if (cleanerSimhash) cleanerSimhash.checked = cleanerConfig.filterSimhash !== false;
  if (cleanerHeuristics) cleanerHeuristics.checked = cleanerConfig.filterHeuristics !== false;
  if (cleanerKeywords) cleanerKeywords.value = (cleanerConfig.customKeywords || []).join("\n");
  if (cleanerWhitelist) cleanerWhitelist.value = (cleanerConfig.whitelist || []).join("\n");

  if (btnSaveCleaner) {
    btnSaveCleaner.addEventListener("click", async () => {
      const customKeywords = cleanerKeywords.value.split("\n").map(s => s.trim()).filter(Boolean);
      const whitelist = cleanerWhitelist.value.split("\n").map(s => s.trim().replace(/^@+/, '')).filter(Boolean);

      const updated = {
        ...cleanerConfig,
        hideMode: cleanerHideMode.value,
        autoBlock: cleanerAutoBlock.checked,
        filterSimhash: cleanerSimhash.checked,
        filterHeuristics: cleanerHeuristics.checked,
        customKeywords,
        whitelist
      };

      await storage.setConfig("x-comment-cleaner", updated);
      btnSaveCleaner.textContent = "✓ 已成功保存！";
      setTimeout(() => btnSaveCleaner.textContent = "保存评论拦截配置", 1500);
    });
  }

  // 4. UI 定制配置绑定
  const uiHideTrends = document.getElementById("ui-hide-trends");
  const uiWiden = document.getElementById("ui-widen-timeline");
  const uiOutline = document.getElementById("ui-generate-outline");
  const btnSaveUI = document.getElementById("btn-save-ui");

  const uiConfig = await storage.getConfig("x-better-ui", {
    hideTrending: true,
    widenTimeline: true,
    generateOutline: true
  });

  if (uiHideTrends) uiHideTrends.checked = uiConfig.hideTrending !== false;
  if (uiWiden) uiWiden.checked = uiConfig.widenTimeline !== false;
  if (uiOutline) uiOutline.checked = uiConfig.generateOutline !== false;

  if (btnSaveUI) {
    btnSaveUI.addEventListener("click", async () => {
      const updatedUI = {
        hideTrending: uiHideTrends.checked,
        widenTimeline: uiWiden.checked,
        generateOutline: uiOutline.checked
      };
      await storage.setConfig("x-better-ui", updatedUI);
      btnSaveUI.textContent = "✓ 已成功保存！";
      setTimeout(() => btnSaveUI.textContent = "保存界面偏好", 1500);
    });
  }

  // 5. 备份管理
  const btnExport = document.getElementById("btn-export-config");
  const btnReset = document.getElementById("btn-reset-config");

  if (btnExport) {
    btnExport.addEventListener("click", async () => {
      const allData = await storage.exportAll();
      const blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `superx-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (btnReset) {
    btnReset.addEventListener("click", async () => {
      if (confirm("确定要重置所有 SuperX 配置为默认值吗？")) {
        await chrome.storage.local.clear();
        alert("已重置所有配置，请刷新页面。");
        location.reload();
      }
    });
  }
});
