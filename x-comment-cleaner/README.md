# X 垃圾评论拦截助手 (X Spam Reply Cleaner) v2.0

一个独立、轻量、高效率且功能强大的 Chrome 扩展（Manifest V3），专为拦截和折叠 X (Twitter) 帖子下方泛滥的黄推、引流号、诈骗 Bot 与刷屏垃圾评论，并支持**一键原生拉黑（全端同步生效）**。

---

## 🌟 核心特性 (v2.0 升级版)

1. **8 大行业分类词库 + 有序词距 (`max_gap`) 匹配**：
   - **黄推 / 成人引流**：福利隐语、同城约会、骚话诱导、主页相册、微密圈等。
   - **投资 / 带单诈骗**：内幕消息、稳赚不赔、带单老师、包赚返利等。
   - **加密货币 / 空投骗局**：虚假 Giveaway、免费领取 USDT/BTC/SOL、钓鱼空投等。
   - **兼职刷单 / 任务诈骗**：点赞佣金、日结手工、打字兼职、充值解锁等。
   - **贷款 / 解冻诈骗**：黑白户可下、不查征信、卡单解冻、无门槛秒批等。
   - **博彩 / 赌场引流**：彩票计划、百家乐、开奖网、真人视讯、澳门威尼斯人等。
   - **互动诱导 / 钓鱼**：互关必回、回关秒关、留号必发等。
   - **通用营销 / 私域引流**：加微信、私域变现、引流脚本、群发软件等。
   - 支持**多词有序近距离匹配**（例如 `同城 + 上门` $\le 14$ 字符），大幅提高召回率并彻底杜绝泛词误杀。
   - Popup 提供 8 大分类独立开关，按需启闭。

2. **64 位 SimHash 模糊指纹（识别同款话术变体）**：
   - 自动将评论文本降维为 64 位 SimHash 位向量。
   - 通过汉明距离（Hamming Distance $\le 2$）自动识别 Bot 团伙通过插入随机字符、换词、颠倒句序制作的**刷屏话术变体**。

3. **账号与外链启发式识别 (Account & Domain Heuristics)**：
   - **默认数字号检测**：识别 `user\d{5,}` 默认昵称 + 短字母长数字 handle（批量注册典型形态）。
   - **可疑推广外链识别**：检测推文或简介中指向 `giveaway`, `airdrop`, `freecrypto` 等可疑域名的链接。
   - **多擦边词组合加权**：单个词不误杀，多个擦边特征组合时精准判定。

4. **X 原生拉黑与一键放回 (Native Block & Unblock)**：
   - 基于浏览器当前已登录会话，利用 X 原生接口调用拉黑。
   - **全端生效**：手机 App 同步消失，彻底阻断 Bot 回复、@ 提及与关注互动。
   - 折叠条中直接提供 **「顺手拉黑」** 与 **「一键放回 (Unblock)」**。

5. **本地保护层与防误伤机制**：
   - **白名单保护**：支持在评论区一键「加白」或在设置面板手动管理白名单账号，绝对不拦截、不拉黑。
   - **OP 保护**：主推作者（楼主）的所有后续连推 100% 豁免。
   - **可解释性理由**：折叠条清晰展示拦截的具体原因与分类。

6. **轻量、安全与性能**：
   - 纯原生 JavaScript + CSS，零打包构建，零外部依赖。
   - 采用防抖 `MutationObserver` 监听 SPA 流式渲染，零性能损耗。
   - 数据完全保留在本地 `chrome.storage`，绝不上传任何个人隐私。

---

## 🧩 模块解耦与独立复用

本扩展将所有垃圾识别规则、8 大分类词库、SimHash 位向量算法与启发式判定统一收敛在独立纯 JS 模块 [`shared/rules.js`](shared/rules.js) 中（零 DOM / 零 Chrome API 依赖）。

可在任意 Node.js 服务、油猴脚本 (Userscript) 或其他爬虫/后端项目中直接引用：

```javascript
// Node.js / CommonJS
const { evaluateReplySpam, textToSimhash, hammingDistance } = require('./shared/rules.js');

const result = evaluateReplySpam({
  text: '同城美女支持随时上门服务哦，私信发福利',
  authorHandle: 'bot_user123',
  displayName: '用户95270'
});
console.log(result);
// { isSpam: true, reason: '黄推 / 成人引流 · 组合(同城+上门)', packId: 'adult_gray_traffic' }
```

---

## 🚀 安装使用指南

1. 打开 Chrome 浏览器，访问 `chrome://extensions`。
2. 打开页面右上角的 **「开发者模式」** (Developer mode) 开关。
3. 点击左上角的 **「加载已解压的扩展程序」** (Load unpacked)。
4. 选择当前扩展目录：`x-comment-cleaner`。
5. 打开任意 [X (Twitter)](https://x.com) 帖子详情页，即可自动生效！点击扩展图标可打开设置面板自定义分类开关、白名单与模式。


