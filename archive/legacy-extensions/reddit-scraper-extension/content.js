// REFACTOR: 引入指纹比对式遥测日志（Signature-based Telemetry Logging），彻底消除空转盲区；大幅强化 Search 页面的 DOM 提取穿透力。

(function () {
    if (window.__REDDIT_SCRAPER_INJECTED__) return;
    window.__REDDIT_SCRAPER_INJECTED__ = true;

    const reportedUrls = new Set();
    let scraperTimer = null;
    let mainObserver = null;
    let runState = false; 
    let uiRefs = { toggle: null, text: null };
    
    // 状态机指纹缓存（用于控制日志输出频率，拒绝刷屏）
    let lastScanSignature = ''; 

    /**
     * 富文本高亮打印
     */
    function debugLog(msg, data) {
        console.log(`%c[Scraper-CS]%c ${msg}`, 'color: #1a73e8; font-weight: bold;', 'color: inherit;', data || '');
    }

    /**
     * 【核心防腐层】检测 Chrome 扩展环境是否被刷新或销毁
     */
    function isExtensionContextValid() {
        try {
            return chrome.runtime && !!chrome.runtime.id;
        } catch (e) {
            return false;
        }
    }

    /**
     * 灾难降级：处理上下文销毁事件
     */
    function handleContextInvalidated() {
        stopScraperEngine();
        if (uiRefs.text && uiRefs.toggle) {
            uiRefs.text.textContent = '扩展已更新，请刷新网页恢复';
            uiRefs.text.className = 'status error';
            uiRefs.toggle.disabled = true;
        }
        console.warn('[Scraper-CS] 🚨 探测到旧版扩展环境已被销毁（Context Invalidated）。请刷新当前网页以加载最新 Content Script。');
    }

    /**
     * 动态拉取并注入隔离的原生浮动控制台
     */
    async function injectFloatingPanel() {
        if (document.getElementById('__reddit_scraper_host')) return;

        const host = document.createElement('div');
        host.id = '__reddit_scraper_host';
        host.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;';
        
        const shadow = host.attachShadow({ mode: 'closed' });
        
        try {
            const htmlUrl = chrome.runtime.getURL('panel.html');
            const cssUrl = chrome.runtime.getURL('panel.css');
            
            const [htmlRes, cssRes] = await Promise.all([fetch(htmlUrl), fetch(cssUrl)]);
            const htmlText = await htmlRes.text();
            const cssText = await cssRes.text();

            const style = document.createElement('style');
            style.textContent = cssText;
            
            const wrapper = document.createElement('div');
            wrapper.innerHTML = htmlText;

            shadow.appendChild(style);
            shadow.appendChild(wrapper);
            document.body.appendChild(host);

            uiRefs.toggle = shadow.getElementById('toggle');
            uiRefs.text = shadow.getElementById('status_text');
            uiRefs.toggle.disabled = false;

            if (isExtensionContextValid()) {
                chrome.storage.local.get(['isActive'], (res) => {
                    if (chrome.runtime.lastError) return handleContextInvalidated();
                    updateUI(!!res.isActive);
                });
            } else {
                handleContextInvalidated();
            }

            uiRefs.toggle.addEventListener('change', (e) => {
                if (!isExtensionContextValid()) return handleContextInvalidated();
                
                uiRefs.toggle.disabled = true;
                const nextState = e.target.checked;
                debugLog(nextState ? '🕹️ 触发 [启动] 指令' : '🕹️ 触发 [休眠] 指令');
                
                try {
                    chrome.storage.local.set({ isActive: nextState }, () => {
                        if (chrome.runtime.lastError) return handleContextInvalidated();
                        setTimeout(() => { 
                            if (uiRefs.toggle) uiRefs.toggle.disabled = false; 
                        }, 150);
                    });
                } catch (err) {
                    handleContextInvalidated();
                }
            });

        } catch (err) {
            console.error('[Scraper-CS] 面板 UI 资源加载失败:', err);
        }
    }

    function updateUI(isActive) {
        if (!uiRefs.text || !uiRefs.toggle) return;
        uiRefs.toggle.checked = isActive;
        if (isActive) {
            uiRefs.text.textContent = 'Scraper 运行中';
            uiRefs.text.className = 'status active';
        } else {
            uiRefs.text.textContent = 'Scraper 已暂停';
            uiRefs.text.className = 'status';
        }
    }

    /**
     * 核心提取逻辑：带可观测性探针的超级 DOM 矩阵
     */
    function scrapeAndReport() {
        if (!runState || !isExtensionContextValid()) return;

        const currentContainerUrl = window.location.href;
        const newPosts = [];
        
        // 更广泛的选择器，覆盖 Search 页面和 Feed 流
        const selectors = [
            'shreddit-post', 
            'article', 
            '[data-testid="post-container"]',
            'faceplate-tracker[source="search"] shreddit-post' // 搜索页特有
        ].join(', ');

        const postContainers = document.querySelectorAll(selectors);

        // 诊断数据统计机
        let stats = {
            total: postContainers.length,
            extracted: 0,
            skipped_dup: 0,
            skipped_ads: 0,
            skipped_invalid: 0
        };

        postContainers.forEach((container) => {
            try {
                const isShreddit = container.tagName.toLowerCase() === 'shreddit-post';
                
                // 1. 标题与链接提取 (兼容 Attribute 注入与深层 DOM 嵌套)
                let title = isShreddit ? container.getAttribute('post-title') : null;
                let permalink = isShreddit ? container.getAttribute('permalink') : null;
                let link = permalink ? new URL(permalink, window.location.origin).href : null;

                // 兜底寻找：专门针对 Reddit Search 结果页
                if (!title || !link) {
                    const titleEl = container.querySelector('[slot="title"], h2, h3, a[data-testid="post-title"]');
                    const linkEl = container.querySelector('a[slot="full-post-link"], a[href*="/comments/"], a[data-testid="post-title"]');
                    
                    title = title || (titleEl ? titleEl.textContent : null);
                    link = link || (linkEl ? linkEl.href : null);
                }

                // 节点有效性宣判
                if (!title || !link) {
                    stats.skipped_invalid++;
                    return;
                }

                title = title.trim();
                if (title.length < 2) {
                    stats.skipped_invalid++;
                    return;
                }

                // 2. 净化与查重拦截
                const isAds = link.includes('/promoted/') || link.includes('ads_') || container.getAttribute('is-sponsored') === 'true';
                if (isAds) {
                    stats.skipped_ads++;
                    return;
                }
                
                if (reportedUrls.has(link)) {
                    stats.skipped_dup++;
                    return; 
                }

                // 3. 元数据组装
                let author = isShreddit ? container.getAttribute('author') : null;
                if (!author) {
                    const authorEl = container.querySelector('a[href*="/user/"], [author]');
                    author = authorEl ? authorEl.textContent.trim().replace(/^u\//, '') : 'unknown';
                }

                let score = isShreddit ? container.getAttribute('score') : null;
                if (!score) {
                    const scoreEl = container.querySelector('[id^="vote-arrows-"], [class*="score"]');
                    score = scoreEl ? scoreEl.textContent.trim() : '0';
                }

                let comments = isShreddit ? container.getAttribute('comment-count') : null;
                if (!comments) {
                    const commentEl = container.querySelector('[id^="comment-button-"], a[href*="comments"]');
                    const match = commentEl ? commentEl.textContent.match(/\d+/) : null;
                    comments = match ? match[0] : '0';
                }

                let flair = '';
                const flairEl = container.querySelector('shreddit-post-flair, [class*="flair"]');
                if (flairEl) flair = flairEl.textContent.trim();

                // 4. 数据落地
                reportedUrls.add(link);
                newPosts.push({
                    title, link, author, flair: flair || "无标签", score: score || "0", comments: comments || "0",
                    sourcePageUrl: currentContainerUrl, capturedAt: new Date().toISOString()
                });
                stats.extracted++;

            } catch (err) {
                stats.skipped_invalid++;
            }
        });

        // 核心优化：指纹比对式打印。只有当这几个核心指标发生变化时，才输出日志。
        // 这既避免了用户滚动时的疯狂刷屏，又能在页面出现问题（如全部失效）时提供明确的感知。
        const scanSignature = `${stats.total}|${stats.extracted}|${stats.skipped_dup}|${stats.skipped_ads}|${stats.skipped_invalid}`;
        
        if (scanSignature !== lastScanSignature || stats.extracted > 0) {
            debugLog(`📊 扫描战报 | 视野总节点: ${stats.total} | 成功提取: ${stats.extracted} | 去重拦截: ${stats.skipped_dup} | 广告丢弃: ${stats.skipped_ads} | 无法解析: ${stats.skipped_invalid}`);
            lastScanSignature = scanSignature;
        }

        // 推送给后台
        if (newPosts.length > 0) {
            try {
                chrome.runtime.sendMessage({ type: 'POSTS_EXTRACTED', data: newPosts }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[Scraper-CS] ⚠️ Background 信道堵塞，它可能处于休眠态或已挂起。');
                    }
                });
            } catch (err) {
                handleContextInvalidated();
            }
        }
    }

    /**
     * 引擎启动器
     */
    function startScraperEngine() {
        if (runState) return;
        runState = true;
        lastScanSignature = ''; // 重置指纹
        
        scrapeAndReport();

        mainObserver = new MutationObserver(() => {
            if (scraperTimer) clearTimeout(scraperTimer);
            scraperTimer = setTimeout(scrapeAndReport, 800);
        });

        mainObserver.observe(document.body, { childList: true, subtree: true });
        debugLog('⚙️ 核心监听引擎已挂载并激活');
    }

    /**
     * 引擎停止器
     */
    function stopScraperEngine() {
        if (!runState) return;
        runState = false;

        if (mainObserver) {
            mainObserver.disconnect();
            mainObserver = null;
        }
        if (scraperTimer) {
            clearTimeout(scraperTimer);
            scraperTimer = null;
        }
        debugLog('💤 核心监听引擎已注销且释放内存');
    }

    /**
     * 核心初始化
     */
    async function initialize() {
        await injectFloatingPanel();

        if (!isExtensionContextValid()) return handleContextInvalidated();

        try {
            chrome.storage.local.get(['isActive'], (store) => {
                if (chrome.runtime.lastError) return handleContextInvalidated();
                if (store.isActive) startScraperEngine();
            });

            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName === 'local' && changes.isActive) {
                    if (!isExtensionContextValid()) return handleContextInvalidated();
                    
                    const nextActiveState = changes.isActive.newValue;
                    updateUI(nextActiveState);
                    if (nextActiveState) {
                        startScraperEngine();
                    } else {
                        stopScraperEngine();
                    }
                }
            });
        } catch (e) {
            handleContextInvalidated();
        }
    }

    initialize();
})();