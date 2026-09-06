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

  async function runNativeAction(type, userId) {
    const csrf = readCsrfToken();
    if (!csrf) return { ok: false, error: '未读取到 ct0 会话，请确认已登录 X' };
    const endpoint = type === 'block'
      ? 'https://x.com/i/api/1.1/blocks/create.json'
      : 'https://x.com/i/api/1.1/blocks/destroy.json';

    try {
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
        body: `user_id=${encodeURIComponent(userId)}`
      });
      if (res.ok) return { ok: true };
      if (res.status === 429) return { ok: false, error: '操作过快限流 (429)' };
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: e.message || '网络请求异常' };
    }
  }

  async function blockUser(handle) {
    const userId = await resolveUserIdByHandle(handle);
    if (!userId) return { ok: false, error: '无法解析账号 ID' };
    return runNativeAction('block', userId);
  }

  async function unblockUser(handle) {
    const userId = await resolveUserIdByHandle(handle);
    if (!userId) return { ok: false, error: '无法解析账号 ID' };
    return runNativeAction('unblock', userId);
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
