/**
 * SuperX Feature - Better UI (阅读体验与界面增强)
 * 借鉴 Better-X 优秀体验，提供纯净阅读、长文大纲与去干扰
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
  let outlineCheckTimer = null;
  let isOutlineCollapsed = false;

  function applyStyles() {
    if (!active) {
      document.documentElement.removeAttribute("data-superx-hide-trends");
      document.documentElement.removeAttribute("data-superx-widen");
      removeOutline();
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

    if (config.generateOutline && !isOutlineCollapsed) {
      checkAndBuildOutline();
    } else {
      removeOutline();
    }
  }

  function removeOutline() {
    const el = document.getElementById("superx-article-outline");
    if (el) el.remove();
  }

  function getSidebarCardsWrapper(sidebar) {
    const searchInput = sidebar.querySelector('input[data-testid="SearchBox_Search_Input"], form[role="search"]');
    if (searchInput) {
      let el = searchInput;
      while (el && el.parentElement && el.parentElement !== sidebar) {
        const parent = el.parentElement;
        if (parent.children.length > 1) {
          return { cardsWrapper: parent, searchCard: el };
        }
        el = parent;
      }
    }
    return { cardsWrapper: sidebar.firstElementChild?.firstElementChild || sidebar, searchCard: null };
  }

  function checkAndBuildOutline() {
    if (!active || !config.generateOutline || isOutlineCollapsed) {
      removeOutline();
      return;
    }

    // 仅在单篇推文详情页或长文/文章页扫描大纲
    const isStatus = /\/[^/]+\/status\/\d+/.test(window.location.pathname);
    const isArticle = /\/article\//.test(window.location.pathname);
    if (!isStatus && !isArticle) {
      removeOutline();
      return;
    }

    const sidebar = document.querySelector('div[data-testid="sidebarColumn"]');
    if (!sidebar) return;

    const headings = [];

    // 1. 查找标准标题元素 (h1, h2, h3, [role="heading"])
    const rawHeadings = Array.from(document.querySelectorAll('main h1, main h2, main h3, main [role="heading"]'));
    rawHeadings.forEach((h) => {
      if (h.closest('header, [role="banner"], [data-testid="TopNavBar"]')) return;
      const text = (h.innerText || h.textContent || '').trim();
      if (text && text.length >= 2 && text.length <= 60 && !headings.some(item => item.text === text)) {
        headings.push({
          element: h,
          text,
          level: h.tagName === 'H3' ? 3 : (h.tagName === 'H2' ? 2 : 1)
        });
      }
    });

    // 2. 如果缺少原生标题标签，从正文段落中识别序号与小标题 (如 1. / 【...】 / Skill 1 / ##)
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
          if (headings.length >= 20) break;
        }
      }
    }

    if (headings.length < 2) {
      removeOutline();
      return;
    }

    // 3. 构建或更新大纲面板
    let outlinePanel = document.getElementById("superx-article-outline");
    if (!outlinePanel) {
      outlinePanel = document.createElement("div");
      outlinePanel.id = "superx-article-outline";

      const { cardsWrapper, searchCard } = getSidebarCardsWrapper(sidebar);
      if (searchCard && searchCard.nextSibling) {
        cardsWrapper.insertBefore(outlinePanel, searchCard.nextSibling);
      } else {
        cardsWrapper.prepend(outlinePanel);
      }
    }

    outlinePanel.innerHTML = `
      <div class="superx-outline-title">
        <div class="superx-outline-title-left">
          <span>📑 文章大纲目录</span>
          <span class="superx-outline-count">(${headings.length} 节)</span>
        </div>
        <button type="button" class="superx-outline-close-btn" title="收起大纲">✕</button>
      </div>
      <ul class="superx-outline-list"></ul>
    `;

    const closeBtn = outlinePanel.querySelector(".superx-outline-close-btn");
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        isOutlineCollapsed = true;
        removeOutline();
      };
    }

    const list = outlinePanel.querySelector(".superx-outline-list");

    headings.forEach((item) => {
      const li = document.createElement("li");
      li.className = "superx-outline-item";
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
          target.style.backgroundColor = "rgba(29, 155, 240, 0.2)";
          setTimeout(() => {
            target.style.backgroundColor = origBg;
          }, 1500);
        }
      };

      list.appendChild(li);
    });
  }

  const FeatureInstance = {
    id: "x-better-ui",
    name: "Better UI (阅读与界面优化)",
    description: "长文大纲目录生成、隐藏侧边栏趋势推荐、时间线自适应加宽",
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
      isOutlineCollapsed = false;
      applyStyles();
    },

    async disable() {
      active = false;
      applyStyles();
    },

    onRouteChange(newUrl, prevUrl) {
      if (active) {
        isOutlineCollapsed = false;
        setTimeout(applyStyles, 250);
      }
    },

    onDOMNodes() {
      if (active && config.generateOutline && !isOutlineCollapsed) {
        if (outlineCheckTimer) clearTimeout(outlineCheckTimer);
        outlineCheckTimer = setTimeout(checkAndBuildOutline, 300);
      }
    }
  };

  window.__SuperX__.FeatureManager.register(FeatureInstance);
})();
