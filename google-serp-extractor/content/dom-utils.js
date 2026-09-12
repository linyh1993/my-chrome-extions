/**
 * Google SERP & SEO Extractor - DOM & URL Utilities
 * Handles URL normalization, domain extraction, heading inspection, and string sanitization.
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.GseDomUtils = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  /**
   * Escape HTML special characters for safe template interpolation
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Clean third-party plugin injected text from organic snippets
   */
  function cleanInjectedText(text) {
    if (!text) return '';
    return text
      .replace(/AITDK\s*\|[\s\S]*?(Domain Created:[^\n\r]+|$)/gi, '')
      .replace(/MOZ DA:[\s\S]*?(Show backlinks|$)/gi, '')
      .replace(/Search traffic[\s\S]*?(Keywords[^\n\r]+|$)/gi, '')
      .replace(/See the top keywords this webpage ranks for[^\n\r]*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Detect whether heading belongs to special non-organic Google modules
   */
  function isSpecialModuleHeading(el) {
    if (!el) return false;
    const text = (el.textContent || '').trim().toLowerCase();
    return (
      text.includes('people also ask') ||
      text.includes('people also search') ||
      text.includes('related searches') ||
      text.includes('find related products') ||
      text.includes('popular products') ||
      text.includes('discussions and forums') ||
      text.includes('大家都在问') ||
      text.includes('相关搜索') ||
      text.includes('相关产品')
    );
  }

  /**
   * Normalize Google redirect URLs (/url?q=...) to direct destination URLs
   */
  function normalizeGoogleUrl(href) {
    if (!href) return '';
    try {
      const parsed = new URL(href, 'https://www.google.com');
      if (parsed.pathname === '/url' && parsed.searchParams.has('q')) {
        return parsed.searchParams.get('q');
      }
      return parsed.href;
    } catch (e) {
      return href;
    }
  }

  /**
   * Check if URL is an internal Google search/nav link
   */
  function isInternalGoogleUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      if (u.hostname.includes('google.') && (
        u.pathname.startsWith('/search') ||
        u.pathname.startsWith('/preferences') ||
        u.pathname.startsWith('/intl') ||
        u.pathname.startsWith('/imgres') ||
        u.pathname === '/'
      )) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Extract clean domain hostname from URL
   */
  function extractDomain(url) {
    if (!url) return '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  return {
    escapeHtml,
    cleanInjectedText,
    isSpecialModuleHeading,
    normalizeGoogleUrl,
    isInternalGoogleUrl,
    extractDomain
  };
});
