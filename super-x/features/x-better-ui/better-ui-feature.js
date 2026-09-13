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
  let isPopupOpen = false;
  let currentHeadingsSignature = "";

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
    currentHeadingsSignature = "";
    isPopupOpen = false;
  }

  /**
   * 从当前页面提取文章总标题与正文各章节
   */
  function extractHeadings() {
    const headings = [];

    // 0. 优先提取文章大标题 (Title)
    const titleCandidates = Array.from(document.querySelectorAll(
      '[data-testid="twitterArticleTitle"], [data-testid="articleTitle"], h1, div[data-testid="primaryColumn"] h1'
    ));
    let mainTitleEl = null;
    for (const el of titleCandidates) {
      if (el.closest('header, [role="banner"], [data-testid="TopNavBar"], nav, [data-testid="sidebarColumn"]')) continue;
      const text = (el.innerText || el.textContent || '').trim();
      // 过滤掉导航栏的“文章 / 帖子 / Home / 探索”等通用系统字样
      if (text && !['文章', '帖子', '主页', '探索', '通知', '私信', 'Post', 'Article', 'Home', 'Explore'].includes(text) && text.length >= 3 && text.length <= 100) {
        mainTitleEl = el;
        headings.push({
          element: el,
          text: `📌 ${text}`,
          level: 1,
          isMainTitle: true
        });
        break;
      }
    }

    // 1. 原生 DOM 标题 (h1, h2, h3, h4, h5, h6, [role="heading"])
    const rawHeadings = Array.from(document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6, main [role="heading"]'));
    rawHeadings.forEach((h) => {
      if (mainTitleEl && (h === mainTitleEl || mainTitleEl.contains(h) || h.contains(mainTitleEl))) return;
      if (h.closest('header, [role="banner"], [data-testid="TopNavBar"], nav, [data-testid="sidebarColumn"]')) return;
      const text = (h.innerText || h.textContent || '').trim();
      if (!text || ['文章', '帖子', '对话', '相关用户', '有什么新鲜事', '推荐', '关注', 'Who to follow', 'Trends'].includes(text)) return;
      if (text.length < 2 || text.length > 80) return;

      // 准确判断标题级别 (aria-level 或 tagName)
      let level = 2;
      const ariaLevel = parseInt(h.getAttribute('aria-level'), 10);
      if (!isNaN(ariaLevel) && ariaLevel >= 1 && ariaLevel <= 6) {
        level = ariaLevel;
      } else {
        const tag = h.tagName.toUpperCase();
        if (tag === 'H1') level = 1;
        else if (tag === 'H2') level = 2;
        else if (tag === 'H3') level = 3;
        else if (tag === 'H4' || tag === 'H5' || tag === 'H6') level = 4;
      }

      if (!headings.some(item => item.text === text || (item.element && item.element === h))) {
        headings.push({
          element: h,
          text,
          level
        });
      }
    });

    // 2. 长文段落中的多级序号、Markdown与结构化小标题
    if (headings.length < 3) {
      const articleEl = document.querySelector('[data-testid="twitterArticle"], [data-testid="articleContent"], main article') || document.querySelector('div[data-testid="primaryColumn"]');
      if (articleEl) {
        const paragraphs = Array.from(articleEl.querySelectorAll('p, div[data-testid="tweetText"], div[dir="auto"]'));

        for (const p of paragraphs) {
          const rawText = (p.innerText || p.textContent || '').trim();
          const firstLine = rawText.split('\n')[0].trim();
          if (!firstLine || firstLine.length < 2 || firstLine.length > 60) continue;

          // 2.1 Markdown 标题格式 (# 一级, ## 二级, ### 三级, #### 四级)
          const mdMatch = firstLine.match(/^(#{1,4})\s+(.+)$/);
          if (mdMatch) {
            const mdLevel = mdMatch[1].length;
            const cleanText = mdMatch[2].trim().slice(0, 50);
            if (!headings.some(item => item.text === cleanText || item.text === firstLine)) {
              headings.push({ element: p, text: cleanText, level: mdLevel });
            }
            continue;
          }

          // 2.2 三级数字序号 (如 1.1.1 细节或 ①)
          const subSubNumMatch = firstLine.match(/^(\d+\.\d+\.\d+|[①②③④⑤⑥⑦⑧⑨⑩])[、.．\s]\s*(.+)$/);
          if (subSubNumMatch) {
            const cleanText = firstLine.slice(0, 50);
            if (!headings.some(item => item.text === cleanText)) {
              headings.push({ element: p, text: cleanText, level: 3 });
            }
            continue;
          }

          // 2.3 二级数字/带括号序号 (如 1.1 背景, (1) 步骤一, （一）分析)
          const subNumMatch = firstLine.match(/^(?:(\d+\.\d+)[、.．\s]|[(（](?:[0-9一二三四五六七八九十]{1,2})[)）])\s*(.+)$/);
          if (subNumMatch) {
            const cleanText = firstLine.slice(0, 50);
            if (!headings.some(item => item.text === cleanText)) {
              headings.push({ element: p, text: cleanText, level: 2 });
            }
            continue;
          }

          // 2.4 中文一级序号 (如 一、二、三、)
          const cnLevel1Match = firstLine.match(/^([一二三四五六七八九十]{1,2})[、.．]\s*(.+)$/);
          if (cnLevel1Match) {
            const cleanText = firstLine.slice(0, 50);
            if (!headings.some(item => item.text === cleanText)) {
              headings.push({ element: p, text: cleanText, level: 1 });
            }
            continue;
          }

          // 2.5 其它序号与小标题 (1. / Skill 1 / 【...】 / 步骤 / Emoji)
          const OTHER_PATTERNS = [
            /^(?:skill|技能|step|步骤|第[一二三四五六七八九十0-9]+[步节讲个])\s*([0-9]{1,2})?[:：\s]\s*(.+)$/i,
            /^([0-9]{1,2})[、.．:：)）/]\s*(.+)$/,
            /^[【\[［]([^】\]］]{2,30})[】\]］]\s*(.*)$/,
            /^([📌💡🚀🔥👉✅✨🎯📖🔍🏷️1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟])\s*(.+)$/u
          ];

          for (const pattern of OTHER_PATTERNS) {
            if (pattern.test(firstLine)) {
              const cleanText = firstLine.slice(0, 50);
              if (!headings.some(item => item.text === cleanText)) {
                headings.push({
                  element: p,
                  text: cleanText,
                  level: 2
                });
              }
              break;
            }
          }

          if (headings.length >= 35) break;
        }
      }
    }

    return headings;
  }

  /**
   * 扫描并安全更新 TOC 悬浮面板（绝不重复重置 innerHTML 避免闪烁）
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

    // 通过标题指纹对比，内容完全一致时绝不重绘 DOM，彻底解决弹窗闪烁与重新展开
    const signature = headings.map(h => h.text).join("||");
    if (signature === currentHeadingsSignature) {
      return;
    }
    currentHeadingsSignature = signature;

    renderTOCWidget(headings);
  }

  /**
   * 创建或就地更新 TOC 结构
   */
  function renderTOCWidget(headings) {
    let container = document.getElementById("superx-toc-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "superx-toc-container";
      container.innerHTML = `
        <div id="superx-toc-fab" title="点击展开/收起文章大纲目录 (TOC)">
          <span class="superx-toc-fab-icon">📑</span>
          <span class="superx-toc-fab-text">TOC</span>
          <span class="superx-toc-fab-badge">0</span>
        </div>
        <div id="superx-toc-popup">
          <div class="superx-toc-header">
            <div class="superx-toc-title">
              <span>📑 文章大纲目录</span>
              <span class="superx-toc-count"></span>
            </div>
            <button type="button" class="superx-toc-close" title="收起目录">✕</button>
          </div>
          <ul class="superx-toc-list"></ul>
        </div>
      `;

      const fab = container.querySelector("#superx-toc-fab");
      const popup = container.querySelector("#superx-toc-popup");
      const closeBtn = container.querySelector(".superx-toc-close");

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

      document.body.appendChild(container);
    }

    // 更新角标与总数文本
    const badge = container.querySelector(".superx-toc-fab-badge");
    const count = container.querySelector(".superx-toc-count");
    if (badge) badge.textContent = headings.length;
    if (count) count.textContent = `(${headings.length} 节)`;

    // 仅增量刷新章节列表
    const list = container.querySelector(".superx-toc-list");
    if (list) {
      list.innerHTML = "";
      headings.forEach((item) => {
        const li = document.createElement("li");
        li.className = "superx-toc-item";
        if (item.isMainTitle) {
          li.classList.add("main-title");
        } else {
          li.classList.add(`level-${item.level || 2}`);
          if (item.level === 1) li.classList.add("h1");
          else if (item.level === 2) li.classList.add("h2");
          else if (item.level === 3) li.classList.add("h3");
          else if (item.level >= 4) li.classList.add("h4");
        }
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
  }

  // 点击空白处仅收起 popup，绝不重构 DOM
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
        currentHeadingsSignature = "";
        isPopupOpen = false;
        setTimeout(applyStyles, 350);
      }
    },

    onDOMNodes() {
      if (active && config.generateOutline) {
        if (scanTimer) clearTimeout(scanTimer);
        scanTimer = setTimeout(scanAndRenderTOC, 500);
      }
    }
  };

  window.__SuperX__.FeatureManager.register(FeatureInstance);
})();
