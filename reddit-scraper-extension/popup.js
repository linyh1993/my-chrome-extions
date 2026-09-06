// popup.js: 异步状态防抖加载与乐观 UI 更新控制

document.addEventListener('DOMContentLoaded', async () => {
    const engineSwitch = document.getElementById('engineSwitch');
    const statusIndicator = document.getElementById('statusIndicator');
    const countDisplay = document.getElementById('countDisplay');
    const uiSkeleton = document.getElementById('uiSkeleton');
    const metricsContent = document.getElementById('metricsContent');

    /**
     * 更新状态机的视觉反馈
     */
    function updateUIState(isActive, count) {
        if (isActive) {
            statusIndicator.textContent = '运行中';
            statusIndicator.className = 'status-text text-active';
            engineSwitch.checked = true;
            engineSwitch.setAttribute('aria-checked', 'true');
        } else {
            statusIndicator.textContent = '已暂停';
            statusIndicator.className = 'status-text text-inactive';
            engineSwitch.checked = false;
            engineSwitch.setAttribute('aria-checked', 'false');
        }
        
        countDisplay.textContent = Number(count || 0).toLocaleString();
    }

    /**
     * 极简初始化流程
     */
    async function init() {
        try {
            // 从持久层并行提取运行参数
            const store = await chrome.storage.local.get(['isActive', 'totalScrapedCount']);
            const isActive = store.isActive || false;
            const count = store.totalScrapedCount || 0;

            // 更新 UI 状态
            updateUIState(isActive, count);

            // 彻底移除骨架屏占位，显示真实高保真面板
            uiSkeleton.classList.add('hidden');
            metricsContent.classList.remove('hidden');
            engineSwitch.removeAttribute('disabled');
        } catch (err) {
            statusIndicator.textContent = '配置损坏';
            statusIndicator.className = 'status-text text-inactive';
            console.error('[Scraper-Popup] 本地初始化参数读取异常:', err);
        }
    }

    /**
     * 处理交互控制开关（乐观更新及防抖机制）
     */
    engineSwitch.addEventListener('change', async () => {
        const nextState = engineSwitch.checked;
        
        // 临时的 optimistic UI 交互锁定，防止频繁点击造成存储竞争与冲突
        engineSwitch.disabled = true;

        try {
            // 写入持久化存储，触发跨标签页运行环境广播（storage.onChanged）
            await chrome.storage.local.set({ isActive: nextState });
            
            // 获取最新计数值，同步更新视觉状态
            const store = await chrome.storage.local.get(['totalScrapedCount']);
            updateUIState(nextState, store.totalScrapedCount || 0);
        } catch (err) {
            // 出错时自动回滚交互反馈
            engineSwitch.checked = !nextState;
            updateUIState(!nextState, 0);
            console.error('[Scraper-Popup] 设定持久化引擎状态失败:', err);
        } finally {
            // 给用户 100ms 的物理保护，100ms 内禁用重复按压
            setTimeout(() => {
                engineSwitch.removeAttribute('disabled');
                engineSwitch.focus();
            }, 100);
        }
    });

    init();
});