/**
 * X Spam Reply Cleaner - X Web Action Adapter
 * 
 * Encapsulates:
 * - CSRF (ct0) cookie retrieval from document.cookie
 * - GraphQL UserByScreenName resolution (handle -> rest_id)
 * - Native Block / Unblock via official X endpoints (1.1/blocks/create.json, 1.1/blocks/destroy.json)
 */

(function () {
  'use strict';

  const X_WEB_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const USER_BY_SCREEN_NAME_QUERY_ID = '32pL5BWe9WKeSK1MoPvFQQ';
  const USER_FEATURES = encodeURIComponent('{"hidden_profile_subscriptions_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"rweb_tipjar_consumption_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"subscriptions_verification_info_is_identity_verified_enabled":true,"subscriptions_verification_info_verified_since_enabled":true,"highlights_tweets_tab_ui_enabled":true,"responsive_web_twitter_article_notes_tab_enabled":true,"subscriptions_feature_can_gift_premium":true,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true,"longform_notetweets_inline_media_enabled":false,"longform_notetweets_rich_text_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":false,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":false,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"tweet_awards_web_tipping_enabled":false,"articles_preview_enabled":false,"responsive_web_jetfuel_frame":false,"responsive_web_enhance_cards_enabled":false,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":false,"creator_subscriptions_quote_tweet_preview_enabled":false,"standardized_nudges_misinfo":false,"view_counts_everywhere_api_enabled":false,"rweb_video_timestamps_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":false,"longform_notetweets_consumption_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":false,"responsive_web_grok_share_attachment_enabled":false,"responsive_web_grok_image_annotation_enabled":false,"c9s_tweet_anatomy_moderator_badge_enabled":false,"responsive_web_grok_analysis_button_from_backend":false,"responsive_web_edit_tweet_api_enabled":false,"premium_content_api_read_enabled":false,"responsive_web_twitter_article_tweet_consumption_enabled":false}');
  const FIELD_TOGGLES = encodeURIComponent('{"withAuxiliaryUserLabels":false}');

  const userIdCache = new Map(); // handle -> rest_id

  function readCsrfToken() {
    if (typeof document === 'undefined' || !document.cookie) return null;
    for (const part of document.cookie.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('ct0=')) {
        return trimmed.substring('ct0='.length) || null;
      }
    }
    return null;
  }

  async function resolveUserIdByHandle(handle) {
    const norm = (handle || '').trim().replace(/^@+/, '').toLowerCase();
    if (!norm) return null;
    if (userIdCache.has(norm)) {
      return userIdCache.get(norm);
    }

    const csrf = readCsrfToken();
    if (!csrf) return null;

    const variables = encodeURIComponent(JSON.stringify({ screen_name: norm, withSafetyModeUserFields: true }));
    const url = `https://x.com/i/api/graphql/${USER_BY_SCREEN_NAME_QUERY_ID}/UserByScreenName?variables=${variables}&features=${USER_FEATURES}&fieldToggles=${FIELD_TOGGLES}`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Authorization: X_WEB_BEARER,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Csrf-Token': csrf
        }
      });
      if (!res.ok) return null;
      const body = await res.json();
      const result = body.data?.user?.result;
      if (result?.__typename === 'UserUnavailable' || !result?.rest_id) return null;
      const uid = String(result.rest_id);
      userIdCache.set(norm, uid);
      return uid;
    } catch {
      return null;
    }
  }

  async function runNativeAction(type, target, isScreenName = false) {
    const csrf = readCsrfToken();
    if (!csrf) {
      console.warn('[X Cleaner] 未检测到登录会话 cookie (ct0)，请确保已登录 X/Twitter 账号');
      return { ok: false, error: '未读取到 ct0 会话，请确认已登录 X' };
    }
    const endpoint = type === 'block'
      ? 'https://x.com/i/api/1.1/blocks/create.json'
      : 'https://x.com/i/api/1.1/blocks/destroy.json';

    const body = isScreenName
      ? `screen_name=${encodeURIComponent(target)}`
      : `user_id=${encodeURIComponent(target)}`;

    try {
      console.log(`[X Cleaner] 发起官方 ${type === 'block' ? '拉黑' : '解封'} API 请求 -> ${endpoint} (${body})`);
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          Authorization: X_WEB_BEARER,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Twitter-Active-User': 'yes',
          'X-Csrf-Token': csrf
        },
        body
      });

      if (res.ok) {
        console.log(`[X Cleaner] 接口请求成功: ${type === 'block' ? '拉黑' : '解封'} ${target} (HTTP ${res.status})`);
        return { ok: true, status: res.status };
      }
      if (res.status === 429) {
        console.warn(`[X Cleaner] 触发 X 官方频率限制 (HTTP 429): ${target}`);
        return { ok: false, status: 429, error: '操作过快限流 (429)' };
      }

      const errText = await res.text().catch(() => '');
      console.warn(`[X Cleaner] X 接口返回异常 HTTP ${res.status}:`, errText);
      return { ok: false, status: res.status, error: `HTTP ${res.status}: ${errText}` };
    } catch (e) {
      console.error(`[X Cleaner] 接口网络请求异常:`, e);
      return { ok: false, error: e.message || '网络请求异常' };
    }
  }

  async function blockUser(handle) {
    const norm = (handle || '').trim().replace(/^@+/, '').toLowerCase();
    if (!norm) return { ok: false, error: '账号为空' };

    // 1. 若有缓存的 userId，直接调用
    const cachedUid = userIdCache.get(norm);
    if (cachedUid) {
      const res = await runNativeAction('block', cachedUid, false);
      if (res.ok || res.status === 429) return res;
    }

    // 2. 优先直接使用 screen_name 发送 1.1/blocks/create.json（单次快速往返，官方端点原生支持）
    const directRes = await runNativeAction('block', norm, true);
    if (directRes.ok || directRes.status === 429) {
      return directRes;
    }

    // 3. 兜底：若 direct 请求异常，尝试通过 GraphQL 解析 userId 再次提交
    const userId = await resolveUserIdByHandle(norm);
    if (userId && userId !== cachedUid) {
      return runNativeAction('block', userId, false);
    }

    return directRes;
  }

  async function unblockUser(handle) {
    const norm = (handle || '').trim().replace(/^@+/, '').toLowerCase();
    if (!norm) return { ok: false, error: '账号为空' };

    const cachedUid = userIdCache.get(norm);
    if (cachedUid) {
      const res = await runNativeAction('unblock', cachedUid, false);
      if (res.ok || res.status === 429) return res;
    }

    const directRes = await runNativeAction('unblock', norm, true);
    if (directRes.ok || directRes.status === 429) {
      return directRes;
    }

    const userId = await resolveUserIdByHandle(norm);
    if (userId && userId !== cachedUid) {
      return runNativeAction('unblock', userId, false);
    }

    return directRes;
  }

  const XActionAdapter = {
    readCsrfToken,
    resolveUserIdByHandle,
    runNativeAction,
    blockUser,
    unblockUser
  };

  if (typeof globalThis !== 'undefined') {
    globalThis.XActionAdapter = XActionAdapter;
  }
})();
