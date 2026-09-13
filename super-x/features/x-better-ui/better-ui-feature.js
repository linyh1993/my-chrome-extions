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
    if (!active || !config.generateOutline) {
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

    const opMatch = window.location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    const opHandle = opMatch ? opMatch[1].toLowerCase() : null;
    const opStatusId = opMatch ? opMatch[2] : null;

    const headings = [];

    // 1. 查找标准标题元素 (h1, h2, h3, [role="heading"])
    const domHeadings = Array.from(document.querySelectorAll(
      'article[data-testid="tweet"] h1, article[data-testid="tweet"] h2, article[data-testid="tweet"] h3, [data-testid="twitterArticle"] h1, [data-testid="twitterArticle"] h2, [data-testid="twitterArticle"] h3, [data-testid="articleContent"] h1, [data-testid="articleContent"] h2, [data-testid="articleContent"] h3'
    ));

    domHeadings.forEach((h) => {
      const text = (h.innerText || h.textContent || '').trim();
      if (text && text.length >= 2 && text.length <= 100) {
        headings.push({
          element: h,
          text,
          level: h.tagName === 'H3' ? 3 : (h.tagName === 'H2' ? 2 : 1)
        });
      }
    });

    // 2. 如果缺少原生 HTML 标题标签，从主推文和 OP 推文串中智能提取要点/段落标题
    if (headings.length < 2) {
      const allTweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      let opTweets = [];

      for (const t of allTweets) {
        const link = t.querySelector('a[href*="/status/"]');
        const href = link ? link.getAttribute('href') : '';
        const isTargetPost = opStatusId && href.includes(`/status/${opStatusId}`);
        const userLinks = Array.from(t.querySelectorAll('div[data-testid="User-Name"] a[href^="/"]'));
        const handle = userLinks[0] ? userLinks[0].getAttribute('href').replace('/', '').toLowerCase() : '';
        const isOpAuthor = opHandle && handle === opHandle;

        if (isTargetPost || isOpAuthor) {
          opTweets.push(t);
        }
      }

      if (opTweets.length === 0 && allTweets.length > 0) {
        opTweets = [allTweets[0]];
      }

      const HEADING_PATTERNS = [
        /^(#{1,4})\s+(.+)$/,
        /^([0-9]{1,2}|[一二三四五六七八九十]{1,2})[、.．:：)）/]\s*(.+)$/,
        /^[【\[［]([^】\]］]{2,30})[】\]］]\s*(.*)$/,
        /^([📌💡🚀🔥👉✅✨🎯📖🔍🏷️1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟])\s*(.+)$/u,
        /^(?:part|chapter|step|section)\s*([0-9a-z]+)[:：\s]\s*(.+)$/i
      ];

      for (let tIdx = 0; tIdx < opTweets.length; tIdx++) {
        const t = opTweets[tIdx];
        const tweetTextEl = t.querySelector('div[data-testid="tweetText"]');
        if (!tweetTextEl) continue;

        const rawText = tweetTextEl.innerText || tweetTextEl.textContent || '';
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

        for (const line of lines) {
          for (const pattern of HEADING_PATTERNS) {
            const m = line.match(pattern);
            if (m) {
              const title = (m[2] ? `${m[1]} ${m[2]}` : line).slice(0, 50);
              const spans = Array.from(tweetTextEl.querySelectorAll('span'));
              const targetNode = spans.find(s => (s.innerText || '').includes(line.slice(0, 15))) || tweetTextEl;
              headings.push({
                element: targetNode,
                text: title,
                level: 2
              });
              break;
            }
          }
        }

        // 如果存在 OP 连续推文串 (Thread)，但各推文内没有明确数字小标题，则以各推文首句为章节
        if (opTweets.length >= 2 && headings.length < 2) {
          const firstLine = lines[0] || '';
          const summary = firstLine.slice(0, 35) || `推文 ${tIdx + 1}`;
          headings.push({
            element: t,
            text: `${tIdx + 1}/ ${summary}`,
            level: 1
          });
        }
      }
    }

    if (headings.length < 2) {
      removeOutline();
      return;
    }

    // 渲染或更新大纲面板
    let outlinePanel = document.getElementById("superx-article-outline");
    if (!outlinePanel) {
      outlinePanel = document.createElement("div");
      outlinePanel.id = "superx-article-outline";

      const searchBox = sidebar.querySelector('form[role="search"]') || sidebar.querySelector('[data-testid="SearchBox_Search_Input"]');
      const searchContainer = searchBox ? searchBox.closest('div.css-175oi2r') : null;
      if (searchContainer && searchContainer.parentElement) {
        searchContainer.parentElement.insertBefore(outlinePanel, searchContainer.nextSibling);
      } else {
        sidebar.prepend(outlinePanel);
      }
    }

    outlinePanel.innerHTML = `
      <div class="superx-outline-title">
        <span>📑 文章大纲目录</span>
        <span class="superx-outline-count">(${headings.length})</span>
      </div>
      <ul class="superx-outline-list"></ul>
    `;

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

      // 监听配置热更新（响应 Popup / SidePanel 开关变动）
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
        setTimeout(applyStyles, 200);
      }
    },

    onDOMNodes() {
      if (active && config.generateOutline) {
        if (outlineCheckTimer) clearTimeout(outlineCheckTimer);
        outlineCheckTimer = setTimeout(checkAndBuildOutline, 250);
      }
    }
  };

  window.__SuperX__.FeatureManager.register(FeatureInstance);
})();
