/**
 * X Spam Reply Cleaner - Preset Keyword Packs & Static Definitions
 * Pure data module - Zero logic/DOM dependencies.
 */

const KEYWORD_PACKS = [
  {
    id: "adult_gray_traffic",
    name: "黄推 / 成人引流",
    description: "福利隐语、同城约会、骚话诱导、主页相册及微密圈等成人导流",
    enabled: true,
    rules: [
      "比她好看", "比她骚", "没她骚", "没她好看", "比我好看", "比我骚", "没我骚", "没我好看",
      "比我玩的开", "比我玩得开", "比我放得开", "比我放的开", "比我玩的大", "比我玩得大",
      "玩的开", "玩得开", "玩的嗨", "玩得嗨", "放得开", "放的开", "玩的大", "玩得大",
      "耐不住寂寞", "寂寞难耐", "空虚寂寞", "长夜漫漫", "深夜寂寞", "找个哥哥", "找哥哥", "有哥哥吗",
      "福不黑", "服不黑", "批不黑", "逼不黑", "鲍不黑", "不黑不信", "粉不粉", "黑不黑",
      "粉嫩", "水多", "耐操", "反差", "反差婊", "反差女", "反差母狗", "小母狗", "骚货", "骚逼", "发骚", "赔钱货",
      "约炮", "同城约", "可约", "线下约", "可线下", "线下吗", "线下找", "探花", "裸聊", "自慰", "情趣", "绿奴", "露出",
      "大秀", "福利姬", "微密圈", "无圣光", "秀人", "麻豆", "糖心", "91",
      "固泡", "急需一位固泡", "找固泡", "求固泡", "蹲固泡", "同城固",
      "主人任务", "接主人任务", "做主人任务", "认主人", "找主人",
      "男大来", "找男大", "男大进", "女大来", "找女大",
      "看主页", "看主頁", "看置顶", "看置頂", "看头像", "点头像", "点我头像", "点主页", "进主页",
      "看动态", "看相册", "私密相册", "私密视频", "精选相册", "置顶动态", "看置顶动态",
      "不信你看", "不信看", "信不信你看", "不信你来", "想看私", "想看的", "懂的都懂", "懂的来",
      "私信看福利", "私信发福利", "主页自取福利", "进主页看福利", "福利视频在主页", "福利在主页", "福利在简介",
      "全国空降", "同城空降", "同城上门", "真人上门", "少妇上门", "学生妹上门", "线下私约",
      "门槛群", "福利群", "吃瓜群", "黑料群", "大瓜", "瓜条", "夸克网盘", "解压码"
    ],
    gapRules: [
      { id: "adult-gap-door", terms: ["同城", "上门"], maxGap: 14 },
      { id: "adult-gap-hookup", terms: ["同城", "约炮"], maxGap: 14 },
      { id: "adult-gap-private", terms: ["同城", "私约"], maxGap: 14 },
      { id: "adult-gap-airdrop", terms: ["同城", "空降"], maxGap: 14 },
      { id: "adult-gap-profile", terms: ["福利", "主页"], maxGap: 10 },
      { id: "adult-gap-bio", terms: ["福利", "简介"], maxGap: 10 }
    ]
  },
  {
    id: "investment_scam",
    name: "投资 / 带单诈骗",
    description: "内幕消息、稳赚不赔、带单老师、包赚返利等金融理财诱导",
    enabled: true,
    rules: [
      "带单老师", "带单", "内幕消息", "稳赚不赔", "保本高息", "保本保息", "内部渠道",
      "包赚", "日入过万", "日收益", "跟单盈利", "一对一指导", "翻倍计划", "带你回血",
      "包赔", "高收益项目", "量化跟单", "投资回报率", "胜率99"
    ],
    gapRules: [
      { id: "invest-gap-follow", terms: ["老师", "带单"], maxGap: 12 },
      { id: "invest-gap-profit", terms: ["稳赚", "收益"], maxGap: 12 },
      { id: "invest-gap-recoup", terms: ["包赔", "回血"], maxGap: 12 }
    ]
  },
  {
    id: "crypto_scam",
    name: "加密货币 / 空投骗局",
    description: "虚假 Giveaway、免费领取 USDT/SOL/BTC、钓鱼空投与签名诈骗",
    enabled: true,
    rules: [
      "free crypto", "free bitcoin", "free eth", "free usdt", "free airdrop",
      "crypto giveaway", "usdt giveaway", "sol giveaway", "claim airdrop",
      "claim rewards", "airdrop claim", "free gift card", "免费领取usdt",
      "空投领取", "扫码领币", "钱包空投", "假空投"
    ],
    gapRules: [
      { id: "crypto-gap-giveaway", terms: ["giveaway", "usdt"], maxGap: 30 },
      { id: "crypto-gap-airdrop", terms: ["airdrop", "claim"], maxGap: 30 },
      { id: "crypto-gap-free", terms: ["free", "crypto"], maxGap: 20 }
    ]
  },
  {
    id: "task_scam",
    name: "兼职刷单 / 任务诈骗",
    description: "点赞佣金、日结手工、打字兼职、充值解锁与高薪副业诱饵",
    enabled: true,
    rules: [
      "刷单返利", "刷单", "兼职日结", "日结兼职", "佣金日结", "手工活外发",
      "点赞赚钱", "打字员", "高薪副业", "在家兼职", "无需押金", "一部手机日入",
      "动动手指", "任务佣金", "学生兼职", "宝妈兼职", "轻松日结"
    ],
    gapRules: [
      { id: "task-gap-daily", terms: ["兼职", "日结"], maxGap: 12 },
      { id: "task-gap-phone", terms: ["手机", "日入"], maxGap: 14 },
      { id: "task-gap-like", terms: ["点赞", "佣金"], maxGap: 12 }
    ]
  },
  {
    id: "loan_scam",
    name: "贷款 / 解冻诈骗",
    description: "黑白户可下、不查征信、免抵押秒批、卡单解冻等贷款话术",
    enabled: true,
    rules: [
      "黑白户", "包下款", "免抵押秒批", "征信修复", "无视征信", "秒批到账",
      "快速下款", "卡单解冻", "资金解冻", "流水不足包过", "无门槛下款", "小额贷款秒下"
    ],
    gapRules: [
      { id: "loan-gap-fast", terms: ["黑户", "下款"], maxGap: 12 },
      { id: "loan-gap-pass", terms: ["征信", "秒批"], maxGap: 12 }
    ]
  },
  {
    id: "gambling_traffic",
    name: "博彩 / 赌场引流",
    description: "彩票计划、百家乐、开奖网、真人视讯、澳门威尼斯人等引流",
    enabled: true,
    rules: [
      "百家乐", "彩票计划", "澳洲幸运", "极速赛车", "开奖网", "真人视讯",
      "威尼斯人", "太阳城", "彩票导师", "稳定出款", "大额无忧", "充值返利"
    ],
    gapRules: [
      { id: "gamble-gap-plan", terms: ["彩票", "计划"], maxGap: 12 },
      { id: "gamble-gap-cash", terms: ["稳定", "出款"], maxGap: 12 }
    ]
  },
  {
    id: "engagement_bait",
    name: "互动诱导 / 钓鱼",
    description: "互关必回、回关秒关、留号送等无意义骗粉骗互动话术",
    enabled: true,
    rules: [
      "互关必回", "回关必回", "秒关互粉", "互粉必回", "留号必发",
      "留邮箱送", "评论区抽", "转评赞送", "万粉互助"
    ],
    gapRules: [
      { id: "engage-gap-follow", terms: ["互关", "必回"], maxGap: 8 },
      { id: "engage-gap-email", terms: ["留", "邮箱"], maxGap: 8 }
    ]
  },
  {
    id: "general_marketing",
    name: "通用营销 / 私域引流",
    description: "加微信、私域变现、引流脚本、群发软件等营销广告",
    enabled: true,
    rules: [
      "加v", "加V", "加vx", "加VX", "加微", "加🛰", "加卫星", "卫星号", "卫星：",
      "威信", "薇信", "唯心", "维信", "v信", "➕v", "➕V", "➕vx", "➕微", "＋v", "＋V", "🛰️", "🛰",
      "私域流量", "引流脚本", "微信群发", "爆粉软件", "被动引流", "私我进群"
    ],
    gapRules: [
      { id: "mkt-gap-wechat", terms: ["微信", "私信"], maxGap: 12 },
      { id: "mkt-gap-group", terms: ["进群", "私我"], maxGap: 10 }
    ]
  }
];

const X_SPAM_PATTERNS = [
  /(?:没人|谁)比我.*(?:玩|骚|放|浪)/i,
  /(?:不黑|水多|粉嫩|耐操|反差|大瓜).*不信/i,
  /(?:看主页|看置顶|看相册|私信我|进群).*(?:福利|无门槛|吃瓜|资源|相册)/i,
  /@[\w_]{3,20}\s*[\p{Emoji}\u200d\uFE0F\d\s]{1,15}$/u,
  /(?:比她|好看|骚|看主|置顶|资源|私聊|福利|主页|吃瓜).*@[\w_]{3,20}/i,
  /\b(?:dm|pm)\s+(?:me|us)\b[\s\S]{0,40}\b(?:invest|crypto|profit|earn|signal)/i,
  /\b\d{1,7}\s*(?:usdt|usdc|btc|eth|sol|trx)\b[\s\S]{0,80}g[i1](?:v|w)?e?away/i
];

const DEFAULT_CLEANER_SETTINGS = {
  enabled: true,
  hideMode: "collapse",
  filterKeywords: true,
  filterHomophones: true,
  filterPureNumbers: true,
  filterMentionSpam: true,
  filterDuplicates: true,
  filterSimhash: true,
  filterHeuristics: true,
  packSettings: {
    adult_gray_traffic: true,
    investment_scam: true,
    crypto_scam: true,
    task_scam: true,
    loan_scam: true,
    gambling_traffic: true,
    engagement_bait: true,
    general_marketing: true
  },
  customKeywords: [],
  whitelist: [],
  blockedCount: 0,
  blockedAccountsHistory: []
};

const X_SPAM_DICTIONARY = KEYWORD_PACKS.flatMap(p => p.rules);

const XCleanerPacks = {
  KEYWORD_PACKS,
  X_SPAM_PATTERNS,
  DEFAULT_CLEANER_SETTINGS,
  X_SPAM_DICTIONARY
};

if (typeof globalThis !== 'undefined') {
  globalThis.KEYWORD_PACKS = KEYWORD_PACKS;
  globalThis.X_SPAM_PATTERNS = X_SPAM_PATTERNS;
  globalThis.DEFAULT_CLEANER_SETTINGS = DEFAULT_CLEANER_SETTINGS;
  globalThis.X_SPAM_DICTIONARY = X_SPAM_DICTIONARY;
  globalThis.XCleanerPacks = XCleanerPacks;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = XCleanerPacks;
}
