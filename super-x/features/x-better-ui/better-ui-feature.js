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
      hideTrendsInDOM();
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

  function hideTrendsInDOM() {
    if (!active || !config.hideTrending) return;
    const sidebar = document.querySelector('div[data-testid="sidebarColumn"]');
    if (!sidebar) return;

    const elements = sidebar.querySelectorAll('[aria-label], h2, span');
    for (const el of elements) {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const text = (el.innerText || el.textContent || '').trim();

      const isTrending = /新鲜事|当前趋势|正在发生|今日热点|trending|what’s happening|what's happening/i.test(label) ||
                         /^(?:有什么新鲜事|当前趋势|正在发生|今日热点|what’s happening|what's happening)$/i.test(text);

      if (isTrending) {
        let card = el.closest('div.css-175oi2r[style*="border"], div.css-175oi2r:has(h2)') || el.closest('div:has(> h2)') || el;
        if (card && card !== sidebar && card.parentElement) {
          card.style.setProperty('display', 'none', 'important');
        }
      }
    }
  }

  function removeOutline() {
    const el = document.getElementById("superx-article-outline");
    if (el) el.remove();
  }

  function insertOutlinePanel(sidebar, outlinePanel) {
    // 检查是否已经在正常的位置 (不能在搜索栏内部)
    if (outlinePanel.parentElement) {
      const searchBox = outlinePanel.parentElement.querySelector('form[role="search"]');
      if (!searchBox) return; // 位置正常，无需重放
      outlinePanel.remove();
    }

    // 1. 寻找侧边栏内的搜索栏表单
    const searchForm = sidebar.querySelector('form[role="search"]');
    if (searchForm) {
      let curr = searchForm;
      while (curr && curr.parentElement && curr.parentElement !== sidebar) {
        const p = curr.parentElement;
        const siblings = Array.from(p.children).filter(c => c !== curr);
        // 如果该父级容器中不仅有搜索栏，还包含了后续的卡片元素，说明 curr 就是整个搜索栏顶层卡片
        if (siblings.length > 0) {
          p.insertBefore(outlinePanel, curr.nextSibling);
          return;
        }
        curr = p;
      }
    }

    // 2. 备选：查找侧边栏中的已有卡片（如相关用户、趋势等），插入在第一个卡片前面
    const firstCard = sidebar.querySelector('[aria-label*="用户"], [aria-label*="People"], [aria-label*="新鲜事"], [aria-label*="趋势"], [aria-label*="Trending"], aside')?.closest('div.css-175oi2r');
    if (firstCard && firstCard.parentElement && firstCard.parentElement !== sidebar) {
      firstCard.parentElement.insertBefore(outlinePanel, firstCard);
      return;
    }

    // 3. 兜底插入
    sidebar.prepend(outlinePanel);
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

    const opMatch = window.location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    const opHandle = opMatch ? opMatch[1].toLowerCase() : null;
    const opStatusId = opMatch ? opMatch[2] : null;

    const headings = [];

    // 1. 查找标准标题元素 (h1, h2, h3, [role="heading"])
    const domHeadings = Array.from(document.querySelectorAll(
      'main[role="main"] h1, main[role="main"] h2, main[role="main"] h3, main[role="main"] [role="heading"], article[data-testid="tweet"] h1, article[data-testid="tweet"] h2, article[data-testid="tweet"] h3, [data-testid="twitterArticle"] h1, [data-testid="twitterArticle"] h2, [data-testid="twitterArticle"] h3, [data-testid="articleContent"] h1, [data-testid="articleContent"] h2, [data-testid="articleContent"] h3'
    ));

    domHeadings.forEach((h) => {
      // 过滤掉页面导航级别的标题（例如顶部的 "文章"、"返回"）
      if (h.closest('div[data-testid="TopNavBar"], header, div[role="banner"]')) return;
      const text = (h.innerText || h.textContent || '').trim();
      if (text && text.length >= 2 && text.length <= 80 && !headings.some(item => item.text === text)) {
        headings.push({
          element: h,
          text,
          level: h.tagName === 'H3' ? 3 : (h.tagName === 'H2' ? 2 : 1)
        });
      }
    });

    // 2. 如果缺少原生标题标签，智能识别文章与推文中的段落要点
    if (headings.length < 2) {
      const allTweets = Array.from(document.querySelectorAll('article[data-testid="tweet"], [data-testid="articleContent"]'));
      let opTweets = [];

      for (const t of allTweets) {
        const link = t.querySelector('a[href*="/status/"]');
        const href = link ? link.getAttribute('href') : '';
        const isTargetPost = opStatusId && href.includes(`/status/${opStatusId}`);
        const userLinks = Array.from(t.querySelectorAll('div[data-testid="User-Name"] a[href^="/"]'));
        const handle = userLinks[0] ? userLinks[0].getAttribute('href').replace('/', '').toLowerCase() : '';
        const isOpAuthor = opHandle && handle === opHandle;

        if (isTargetPost || isOpAuthor || isArticle) {
          opTweets.push(t);
        }
      }

      if (opTweets.length === 0 && allTweets.length > 0) {
        opTweets = [allTweets[0]];
      }

      const HEADING_PATTERNS = [
        /^(#{1,4})\s+(.+)$/,
        /^(?:skill|技能|step|步骤)\s*([0-9]{1,2})[:：\s]\s*(.+)$/i,
        /^([0-9]{1,2}|[一二三四五六七八九十]{1,2})[、.．:：)）/]\s*(.+)$/,
        /^[【\[［]([^】\]］]{2,30})[】\]］]\s*(.*)$/,
        /^([📌💡🚀🔥👉✅✨🎯📖🔍🏷️1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟])\s*(.+)$/u,
        /^(?:part|chapter|section)\s*([0-9a-z]+)[:：\s]\s*(.+)$/i
      ];

      for (let tIdx = 0; tIdx < opTweets.length; tIdx++) {
        const t = opTweets[tIdx];
        const textContainer = t.querySelector('div[data-testid="tweetText"]') || t;
        const rawText = textContainer.innerText || textContainer.textContent || '';
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

        for (const line of lines) {
          for (const pattern of HEADING_PATTERNS) {
            const m = line.match(pattern);
            if (m) {
              const title = (m[2] ? `${m[1]} ${m[2]}` : line).slice(0, 45);
              if (!headings.some(item => item.text === title)) {
                const spans = Array.from(textContainer.querySelectorAll('span, p, div'));
                const targetNode = spans.find(s => (s.innerText || '').includes(line.slice(0, 15))) || textContainer;
                headings.push({
                  element: targetNode,
                  text: title,
                  level: 2
                });
              }
              break;
            }
          }
        }

        // 推文串 (Thread) 备用目录
        if (opTweets.length >= 2 && headings.length < 2) {
          const firstLine = lines[0] || '';
          const summary = firstLine.slice(0, 30) || `推文 ${tIdx + 1}`;
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

    // 3. 构建或更新大纲面板
    let outlinePanel = document.getElementById("superx-article-outline");
    if (!outlinePanel) {
      outlinePanel = document.createElement("div");
      outlinePanel.id = "superx-article-outline";
    }

    insertOutlinePanel(sidebar, outlinePanel);

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

        // 导航高亮提示
        const target = item.element instanceof HTMLElement ? item.element : item.element.parentElement;
        if (target) {
          target.style.transition = "background-color 0.4s ease, outline 0.4s ease";
          const origBg = target.style.backgroundColor;
          const origOutline = target.style.outline;
          target.style.backgroundColor = "rgba(29, 155, 240, 0.18)";
          target.style.outline = "2px solid #1d9bf0";
          setTimeout(() => {
            target.style.backgroundColor = origBg;
            target.style.outline = origOutline;
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
        setTimeout(applyStyles, 200);
      }
    },

    onDOMNodes() {
      if (active) {
        if (config.hideTrending) {
          hideTrendsInDOM();
        }
        if (config.generateOutline && !isOutlineCollapsed) {
          if (outlineCheckTimer) clearTimeout(outlineCheckTimer);
          outlineCheckTimer = setTimeout(checkAndBuildOutline, 250);
        }
      }
    }
  };

  window.__SuperX__.FeatureManager.register(FeatureInstance);
})();
