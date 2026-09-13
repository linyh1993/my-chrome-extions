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

    if (config.generateOutline) {
      checkAndBuildOutline();
    } else {
      removeOutline();
    }
  }

  function removeOutline() {
    const el = document.getElementById("superx-article-outline");
    if (el) el.remove();
  }

  function checkAndBuildOutline() {
    // 仅在单篇推文/长文页面扫描大纲
    if (!/\/[^/]+\/status\/\d+/.test(window.location.pathname)) {
      removeOutline();
      return;
    }

    const sidebar = document.querySelector('div[data-testid="sidebarColumn"]');
    if (!sidebar) return;

    // 查找长文或正文标题
    const headings = Array.from(document.querySelectorAll(
      '[class*="longform-header"], article[data-testid="tweet"] h1, article[data-testid="tweet"] h2, article[data-testid="tweet"] h3'
    ));

    if (headings.length < 2) {
      // 标题少于2个时不打扰用户
      removeOutline();
      return;
    }

    let outlinePanel = document.getElementById("superx-article-outline");
    if (!outlinePanel) {
      outlinePanel = document.createElement("div");
      outlinePanel.id = "superx-article-outline";
      // 插入侧边栏顶部或搜索栏下方
      sidebar.prepend(outlinePanel);
    }

    outlinePanel.innerHTML = `
      <div class="superx-outline-title">
        <span>📑 文章大纲目录</span>
      </div>
      <ul class="superx-outline-list"></ul>
    `;

    const list = outlinePanel.querySelector(".superx-outline-list");

    headings.forEach((heading, idx) => {
      const text = (heading.innerText || heading.textContent || '').trim();
      if (!text) return;

      const li = document.createElement("li");
      li.className = "superx-outline-item";
      if (heading.tagName === "H2" || heading.className.includes("two")) li.classList.add("h2");
      if (heading.tagName === "H3" || heading.className.includes("three")) li.classList.add("h3");
      li.textContent = text;

      li.onclick = () => {
        heading.scrollIntoView({ behavior: "smooth", block: "center" });
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
        setTimeout(applyStyles, 300);
      }
    },

    onDOMNodes() {
      if (active && config.generateOutline) {
        if (outlineCheckTimer) clearTimeout(outlineCheckTimer);
        outlineCheckTimer = setTimeout(checkAndBuildOutline, 300);
      }
    }
  };

  window.__SuperX__.FeatureManager.register(FeatureInstance);
})();
