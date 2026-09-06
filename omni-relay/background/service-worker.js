/**
 * @file Omni Relay 后台服务工作进程 (Extension Service Worker)
 * 聚合中继协议、存储配置、平台注册中心、网络/WS追踪器与编排系统。
 */
importScripts(
  '../shared/protocol.js',
  '../shared/settings.js',
  '../core/sites-registry.js',
  '../core/debugger-session.js',
  '../core/http-relay.js',
  '../core/network-tracker.js',
  '../core/websocket-tracker.js',
  '../core/relay-orchestrator.js'
);

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[OmniRelay] 扩展已安装/更新:', details.reason);
  const cfg = await RelaySettings.loadSettings();
  console.log('[OmniRelay] 当前配置已载入, 本地 Endpoint:', cfg.endpointUrl);
  RelayOrchestrator.scanAndRestoreTabs();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[OmniRelay] 浏览器启动，开始扫描并挂载受支持站点...');
  RelayOrchestrator.scanAndRestoreTabs();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  return RelayOrchestrator.handleMessage(msg, sender, sendResponse);
});

// 启动编排器监听
RelayOrchestrator.start();
