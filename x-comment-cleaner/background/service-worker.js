/**
 * X Spam Reply Cleaner - Extension Service Worker (Manifest V3)
 */

const DEFAULT_KEYWORDS = [
  // 截图与高频引流话术 / 谐音变体
  "比她好看", "没她骚", "比我玩的开", "比我玩得开", "玩的开", "玩得开", "玩的嗨", "玩得嗨", "放得开", "放的开",
  "福不黑", "服不黑", "批不黑", "逼不黑", "鲍不黑", "粉嫩", "不信你看", "不信看", "信不信你看",
  // 引流与主页/相册
  "看主页", "看主頁", "看置顶", "看置頂", "看头像", "点头像", "点主页", "看动态", "看相册", "私密相册",
  // 私信与社交引导
  "私信", "私聊", "私我", "斯我", "斯聊", "丝我", "丝聊", "私发", "私密",
  // 微信/联系方式变体与通假字
  "加v", "加V", "加vx", "加VX", "加微", "加🛰", "加卫星", "卫星：", "卫星号", "威信", "薇信", "唯心",
  "＋v", "＋V", "➕v", "➕V", "➕vx", "➕微", "🛰️", "🛰",
  // 门槛与群
  "门槛", "门槛群", "門檻", "门卡", "门坎", "无门槛", "进群", "进裙", "入群", "入裙", "裙内", "群内看",
  // 福利与资源
  "福利", "福力", "资源群", "微密圈", "无圣光", "秀人", "麻豆", "反差", "反差婊", "反差女",
  "吃瓜群", "黑料", "大瓜", "夸克网盘", "夸克", "度盘", "合集", "约拍", "同城"
];

const DEFAULT_SETTINGS = {
  enabled: true,
  hideMode: "collapse", // "collapse" or "hide"
  groupConsecutive: true, // Group consecutive spam replies into a single aggregate card
  filterKeywords: true,
  filterHomophones: true, // Enable symbol & homophone normalization
  filterMentionSpam: true,
  filterDuplicates: true,
  keywords: DEFAULT_KEYWORDS,
  blockedCount: 0
};

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const current = await chrome.storage.sync.get(null);
    const toSet = {};

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (current[key] === undefined) {
        toSet[key] = value;
      }
    }

    if (Object.keys(toSet).length > 0) {
      await chrome.storage.sync.set(toSet);
    }
  } catch (err) {
    console.error("[X Cleaner SW] Error initializing defaults:", err);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "INCREMENT_BLOCKED_COUNT") {
    const delta = typeof request.delta === "number" ? request.delta : 1;
    chrome.storage.sync.get(["blockedCount"]).then((data) => {
      const newCount = (data.blockedCount || 0) + delta;
      chrome.storage.sync.set({ blockedCount: newCount });
      sendResponse({ success: true, count: newCount });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.type === "GET_SETTINGS") {
    chrome.storage.sync.get(null).then((settings) => {
      sendResponse({ success: true, settings: { ...DEFAULT_SETTINGS, ...settings } });
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
});
