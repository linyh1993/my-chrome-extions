// REFACTOR: 引入带版本控制的持久化存储管理器，新增全链路可观测探针以穿透 SW 黑盒

const SERVER_URL = 'http://127.0.0.1:8000/api/v1/reddit/batch';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const REQUEST_TIMEOUT_MS = 6000;
const STORAGE_SCHEMA_VERSION = 1;

/**
 * 结构化分级日志 (可观测性驱动)
 */
function logEvent(level, message, context = {}) {
    const timestamp = new Date().toISOString();
    const payload = {
        timestamp,
        level: level.toUpperCase(),
        message,
        ...context
    };
    
    // 采用对象透传以保障在控制台的展开阅读体验
    if (level === 'error') {
        console.error(`[Scraper-SW] [${payload.level}] ${message}`, payload);
    } else if (level === 'warn') {
        console.warn(`[Scraper-SW] [${payload.level}] ${message}`, payload);
    } else {
        console.log(`[Scraper-SW] [${payload.level}] ${message}`, payload);
    }
}

/**
 * 升级与初始化存储结构（Storage Versioning）
 */
chrome.runtime.onInstalled.addListener(async (details) => {
    try {
        const data = await chrome.storage.local.get(['schemaVersion']);
        const currentVersion = data.schemaVersion || 0;

        if (currentVersion < STORAGE_SCHEMA_VERSION) {
            const defaults = {
                schemaVersion: STORAGE_SCHEMA_VERSION,
                isActive: false,       
                totalScrapedCount: 0   
            };
            
            if (currentVersion === 0) {
                await chrome.storage.local.set(defaults);
                logEvent('info', '成功初始化持久化数据存储', { version: STORAGE_SCHEMA_VERSION });
            } else {
                logEvent('info', '执行存储 Schema 增量升级', { from: currentVersion, to: STORAGE_SCHEMA_VERSION });
            }
        }
    } catch (err) {
        logEvent('error', '存储初始化迁移失败', { error: err.message });
    }
});

/**
 * 弹性网络发送函数（带指数退避和超时机制）
 */
async function sendToLocalServerWithRetry(data, attempt = 0) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    logEvent('info', `发起网络数据同步请求 (尝试: ${attempt + 1})`, { 
        url: SERVER_URL, 
        payloadSize: data.length, 
        firstItemPreview: data.length > 0 ? data[0].title : 'N/A' 
    });

    try {
        const response = await fetch(SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ posts: data }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            logEvent('info', '✅ 数据同步成功', { count: data.length, status: response.status });
            return true;
        } else {
            throw new Error(`HTTP 响应异常: ${response.status}`);
        }
    } catch (error) {
        clearTimeout(timeoutId);
        const isTimeout = error.name === 'AbortError';
        logEvent('warn', '⚠️ 网络通道受阻，准备重试', { 
            attempt: attempt + 1, 
            reason: isTimeout ? '请求超时' : error.message 
        });

        if (attempt < MAX_RETRIES - 1) {
            const nextDelay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, nextDelay));
            return sendToLocalServerWithRetry(data, attempt + 1);
        } else {
            logEvent('error', '❌ 重试次数耗尽，本次传输放弃', { count: data.length });
            return false;
        }
    }
}

/**
 * 消息路由接收器
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'POSTS_EXTRACTED') {
        logEvent('info', '📥 收到来自 Content Script 的新数据', { count: message.data.length, tabId: sender.tab?.id });
        
        sendToLocalServerWithRetry(message.data)
            .then(async (success) => {
                if (success) {
                    const store = await chrome.storage.local.get(['totalScrapedCount']);
                    const currentCount = store.totalScrapedCount || 0;
                    await chrome.storage.local.set({ totalScrapedCount: currentCount + message.data.length });
                }
                sendResponse({ success });
            })
            .catch(error => {
                logEvent('error', '数据流处理发生未捕获异常', { error: error.message });
                sendResponse({ success: false, error: error.message });
            });
        return true; 
    }
});