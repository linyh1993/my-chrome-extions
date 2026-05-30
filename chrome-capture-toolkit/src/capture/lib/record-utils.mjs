export const MENU_EXPRESSION = `(() => {
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const linesOf = (value) => String(value || "").split(/\\n+/).map(clean).filter(Boolean);
  const pick = (selectors) => {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const lines = linesOf(element.innerText || element.textContent || "");
        if (lines.length) {
          return { element, lines };
        }
      }
    }
    return null;
  };

  const leaf = pick([
    ".bestqi-menu-item-selected",
    ".ant-menu-item-selected",
    "[class*=menu-item-selected]",
    "[class*=menu] [class*=item-selected]",
    "[class*=menu] [class*=active]"
  ]);

  let groupName = null;
  let menuName = null;
  let source = "fallback";

  if (leaf) {
    menuName = leaf.lines[0] || null;
    let parent = leaf.element.closest("ul");
    parent = parent ? parent.closest("li") : null;
    if (parent) {
      const parentLines = linesOf(parent.innerText || parent.textContent || "");
      if (parentLines.length) {
        groupName = parentLines[0] || null;
      }
    }

    if (!groupName || groupName === menuName) {
      const group = pick([
        ".bestqi-menu-submenu.bestqi-menu-opened",
        ".bestqi-menu-child-item-active",
        ".ant-menu-submenu-selected",
        "[class*=submenu][class*=selected]",
        "[class*=submenu][class*=active]"
      ]);
      if (group) {
        groupName = group.lines[0] || null;
      }
    }

    source = "menu-active";
  }

  if (!menuName) {
    const titleParts = clean(document.title).split(/\\s+-\\s+/).filter(Boolean);
    menuName = titleParts[0] || clean(document.title) || null;
    source = source === "fallback" ? "title" : source;
  }

  if (!groupName) {
    const segments = location.pathname.split("/").filter(Boolean);
    groupName = segments[1] || segments[0] || null;
    source = source === "fallback" ? "url" : source;
  }

  return {
    groupName,
    menuName,
    source,
    title: document.title,
    url: location.href
  };
})()`;

export function parseMaybeJson(text) {
  if (typeof text !== "string") {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (!(trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed === "null")) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function queryParams(urlString) {
  try {
    const result = {};
    for (const [key, value] of new URL(urlString).searchParams.entries()) {
      if (!(key in result)) {
        result[key] = value;
      } else if (Array.isArray(result[key])) {
        result[key].push(value);
      } else {
        result[key] = [result[key], value];
      }
    }
    return result;
  } catch {
    return null;
  }
}
