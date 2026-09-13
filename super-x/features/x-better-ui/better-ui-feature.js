/**
 * SuperX Feature - Better UI (阅读体验与界面增强)
 * 文章 TOC (Table of Contents) 悬浮快速导航目录、无损去干扰与自适应排版
 */
(function() {
  window.__SuperX__ = window.__SuperX__ || {};

  const DEFAULT_CONFIG = {
    hideTrending: true,
    widenTimeline: true,
    generateOutline: true
  };

  let config = { ...DEFAULT_CONFIG };
  let active = true;
  let scanTimer = null;
  let currentHeadings = [];
  let isPopupOpen = false;

  function applyStyles() {
    if (!active) {
      document.documentElement.removeAttribute("data-superx-hide-trends");
      document.documentElement.removeAttribute("data-superx-widen");
      removeTOC();
      return;
    }

    if (config.hideTrending) {
      document.documentElement.setAttribute("data-superx-hide-trends", "true");
    } else {
      document.documentElement.removeAttribute("data-superx-hide-trends");
    }

    if (config.widenTimeline) {
      document.documentElement.setAttribute("data-superx-widen", "true");
    } else {
      document.documentElement.removeAttribute("data-superx-widen");
    }

    if (config.generateOutline) {
      scanAndRenderTOC();
    } else {
      removeTOC();
    }
  }

  function removeTOC() {
    const el = document.getElementById("superx-toc-container");
    if (el) el.remove();
    currentHeadings = [];
    isPopupOpen = false;
  }

  /**
   * 从当前页面提取文章标题目录
   */
  function extractHeadings() {
    const headings = [];

    // 1. 原生文章标题 (Twitter Articles / h1, h2, h3, [role="heading"])
    const rawHeadings = Array.from(document.querySelectorAll('main h1, main h2, main h3, main [role="heading"]'));
    rawHeadings.forEach((h) => {
      if (h.closest('header, [role="banner"], [data-testid="TopNavBar"], nav, [data-testid="sidebarColumn"]')) return;
      const text = (h.innerText || h.textContent || '').trim();
      if (text && text.length >= 2 && text.length <= 60 && !headings.some(item => item.text === text)) {
        headings.push({
          element: h,
          text,
          level: h.tagName === 'H3' ? 3 : (h.tagName === 'H2' ? 2 : 1)
        });
      }
    });

    // 2. 长文段落中的序号与小标题 (如 1. / 【...】 / Skill 1 / ##)
    if (headings.length < 2) {
      const articleEl = document.querySelector('[data-testid="twitterArticle"], [data-testid="articleContent"], main article') || document.querySelector('div[data-testid="primaryColumn"]');
      if (articleEl) {
        const paragraphs = Array.from(articleEl.querySelectorAll('p, div[data-testid="tweetText"], div[dir="auto"]'));
        const HEADING_PATTERNS = [
          /^(#{1,4})\s+(.+)$/,
          /^(?:skill|技能|step|步骤|第[一二三四五六七八九十0-9]+[步节讲个])\s*([0-9]{1,2})?[:：\s]\s*(.+)$/i,
          /^([0-9]{1,2}|[一二三四五六七八九十]{1,2})[、.．:：)）/]\s*(.+)$/,
          /^[【\[［]([^】\]］]{2,30})[】\]］]\s*(.*)$/,
          /^([📌💡🚀🔥👉✅✨🎯📖🔍🏷️1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟])\s*(.+)$/u
        ];

        for (const p of paragraphs) {
          const rawText = (p.innerText || p.textContent || '').trim();
          const firstLine = rawText.split('\n')[0].trim();
          if (!firstLine || firstLine.length < 3 || firstLine.length > 50) continue;

          for (const pattern of HEADING_PATTERNS) {
            const m = firstLine.match(pattern);
            if (m) {
              const title = firstLine.slice(0, 45);
              if (!headings.some(item => item.text === title)) {
                headings.push({
                  element: p,
                  text: title,
                  level: 2
                });
              }
              break;
            }
          }
          if (headings.length >= 30) break;
        }
      }
    }

    return headings;
  }

  /**
   * 扫描并渲染 TOC 悬浮面板（挂在 document.body 上，绝不干扰 Twitter React DOM）
   */
  function scanAndRenderTOC() {
    if (!active || !config.generateOutline) {
      removeTOC();
      return;
    }

    const isStatus = /\/[^/]+\/status\/\d+/.test(window.location.pathname);
    const isArticle = /\/article\//.test(window.location.pathname);
    if (!isStatus && !isArticle) {
      removeTOC();
      return;
    }

    const headings = extractHeadings();
    if (headings.length < 2) {
      removeTOC();
      return;
    }

    currentHeadings = headings;
    renderTOCWidget();
  }

  /**
   * 创建或更新悬浮 TOC 导航器
   */
  function renderTOCWidget() {
    let container = document.getElementById("superx-toc-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "superx-toc-container";
      document.body.appendChild(container);
    }

    container.innerHTML = `
      <div id="superx-toc-fab" title="点击展开/收起文章大纲目录 (TOC)">
        <span class="superx-toc-fab-icon">📑</span>
        <span class="superx-toc-fab-text">TOC</span>
        <span class="superx-toc-fab-badge">${currentHeadings.length}</span>
      </div>
      <div id="superx-toc-popup" class="${isPopupOpen ? 'open' : ''}">
        <div class="superx-toc-header">
          <div class="superx-toc-title">
            <span>📑 文章大纲目录</span>
            <span class="superx-toc-count">(${currentHeadings.length} 节)</span>
          </div>
          <button type="button" class="superx-toc-close" title="收起目录">✕</button>
        </div>
        <ul class="superx-toc-list"></ul>
      </div>
    `;

    const fab = container.querySelector("#superx-toc-fab");
    const popup = container.querySelector("#superx-toc-popup");
    const closeBtn = container.querySelector(".superx-toc-close");
    const list = container.querySelector(".superx-toc-list");

    fab.onclick = (e) => {
      e.stopPropagation();
      isPopupOpen = !isPopupOpen;
      popup.classList.toggle("open", isPopupOpen);
    };

    closeBtn.onclick = (e) => {
      e.stopPropagation();
      isPopupOpen = false;
      popup.classList.remove("open");
    };

    currentHeadings.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "superx-toc-item";
      if (item.level === 2) li.classList.add("h2");
      if (item.level === 3) li.classList.add("h3");
      li.textContent = item.text;
      li.title = item.text;

      li.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        item.element.scrollIntoView({ behavior: "smooth", block: "center" });

        const target = item.element instanceof HTMLElement ? item.element : item.element.parentElement;
        if (target) {
          target.style.transition = "background-color 0.4s ease";
          const origBg = target.style.backgroundColor;
          target.style.backgroundColor = "rgba(29, 155, 240, 0.22)";
          setTimeout(() => {
            target.style.backgroundColor = origBg;
          }, 1500);
        }
      };

      list.appendChild(li);
    });
  }

  // 点击外部自动收起弹出目录
  document.addEventListener("click", (e) => {
    if (isPopupOpen) {
      const container = document.getElementById("superx-toc-container");
      if (container && !container.contains(e.target)) {
        isPopupOpen = false;
        const popup = document.getElementById("superx-toc-popup");
        if (popup) popup.classList.remove("open");
      }
    }
  });

  const FeatureInstance = {
    id: "x-better-ui",
    name: "Better UI (阅读与界面优化)",
    description: "长文大纲目录 (TOC)、隐藏侧边栏趋势推荐、时间线自适应加宽",
    version: "1.0.0",
    defaultEnabled: true,

    async init(context) {
      if (context.storage) {
        config = await context.storage.getConfig("x-better-ui", DEFAULT_CONFIG);
      }

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes["superx:feature:x-better-ui:config"]) {
          const newConfig = changes["superx:feature:x-better-ui:config"].newValue;
          if (newConfig) {
            config = { ...DEFAULT_CONFIG, ...newConfig };
            console.log("[SuperX BetterUI] Hot reloaded config:", config);
            applyStyles();
          }
        }
      });
    },

    async enable() {
      active = true;
      applyStyles();
    },

    async disable() {
      active = false;
      applyStyles();
    },

    onRouteChange(newUrl, prevUrl) {
      if (active) {
        isPopupOpen = false;
        setTimeout(applyStyles, 300);
      }
    },

    onDOMNodes() {
      if (active && config.generateOutline) {
        if (scanTimer) clearTimeout(scanTimer);
        scanTimer = setTimeout(scanAndRenderTOC, 400);
      }
    }
  };

  window.__SuperX__.FeatureManager.register(FeatureInstance);
})();
