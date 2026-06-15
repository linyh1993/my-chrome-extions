import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const GENERIC_HELP = `Capture Chrome requests and responses through the DevTools Protocol.

Usage:
  node capture-chrome-network.mjs [options]

Options:
  --port <number>            Remote debugging port. Default: 9222
  --host <host>              Remote debugging host. Default: 127.0.0.1
  --list                     List available tabs and exit
  --target-id <id>           Capture a specific tab by target id
  --host-contains <text>     Pick the first tab whose host contains text
  --url-contains <text>      Pick the first tab whose URL contains text
  --title-contains <text>    Pick the first tab whose title contains text
  --navigate <url>           Navigate the chosen tab after capture starts
  --stop-after-ms <number>   Stop automatically after the given duration
  --output-dir <dir>         Base directory for capture files
  --output <file>            Aggregate NDJSON output path
  --session-name <name>      Folder name for generic capture or manual fallback
  --split-dir <dir>          Target split directory
  --domain-include <csv>     Keep only requests whose host contains one of these values
  --domain-exclude <csv>     Exclude requests whose host contains one of these values
  --url-include <csv>        Keep only requests whose URL contains one of these values
  --url-exclude <csv>        Exclude requests whose URL contains one of these values
  --method-include <csv>     Keep only these HTTP methods, for example GET,POST
  --resource-type-include <csv>
                             Keep only these DevTools resource types, for example XHR,Fetch
  --mime-include <csv>       Keep only responses whose MIME type contains one of these values
  --route-layout <mode>      Split file layout: "flat" or "nested". Default: flat
  --split-only               Only write split files and skip the aggregate file
  --no-split                 Disable split files
  --include-base64           Keep binary response bodies as base64 instead of skipping them
  --help                     Show this help

Output:
  HTTP route files are written under the split directory as before.
  WebSocket sessions are written under:
    <split-dir>/ws/<host>/<pageKey>/<wsKey>/
      session.json
      messages.ndjson
      summary.json
`;

export const OPS_HELP = `Capture Chrome requests for the OPS system with menu-aware routing.

Usage:
  node capture-ops-network.mjs [options]

Options:
  --port <number>            Remote debugging port. Default: 9222
  --host <host>              Remote debugging host. Default: 127.0.0.1
  --list                     List available tabs and exit
  --target-id <id>           Capture a specific tab by target id
  --host-contains <text>     Pick the first tab whose host contains text
  --url-contains <text>      Pick the first tab whose URL contains text
  --title-contains <text>    Pick the first tab whose title contains text
  --menu-root-dir <dir>      Root directory for OPS menu folders
  --menu-group <name>        Manual top-level menu or auto-menu fallback
  --menu-name <name>         Manual leaf menu or auto-menu fallback
  --auto-menu                Detect menu changes from the page
  --menu-poll-ms <number>    Poll interval for menu detection. Default: 500
  --navigate <url>           Navigate the chosen tab after capture starts
  --stop-after-ms <number>   Stop automatically after the given duration
  --domain-include <csv>     Keep only requests whose host contains one of these values
  --domain-exclude <csv>     Exclude requests whose host contains one of these values
  --url-include <csv>        Keep only requests whose URL contains one of these values
  --url-exclude <csv>        Exclude requests whose URL contains one of these values
  --method-include <csv>     Keep only these HTTP methods, for example GET,POST
  --resource-type-include <csv>
                             Keep only these DevTools resource types, for example XHR,Fetch
  --mime-include <csv>       Keep only responses whose MIME type contains one of these values
  --route-layout <mode>      Split file layout: "flat" or "nested". Default: flat
  --split-only               Only write split files and skip the aggregate file
  --no-split                 Disable split files
  --include-base64           Keep binary response bodies as base64 instead of skipping them
  --help                     Show this help

Output:
  HTTP route files are written under the split directory as before.
  WebSocket sessions are written under:
    <split-dir>/ws/<host>/<pageKey>/<wsKey>/
      session.json
      messages.ndjson
      summary.json
`;

const VALUE_FLAGS = new Set([
  "--host",
  "--port",
  "--target-id",
  "--host-contains",
  "--url-contains",
  "--title-contains",
  "--navigate",
  "--stop-after-ms",
  "--output-dir",
  "--output",
  "--session-name",
  "--split-dir",
  "--menu-root-dir",
  "--menu-group",
  "--menu-name",
  "--menu-poll-ms",
  "--domain-include",
  "--domain-exclude",
  "--url-include",
  "--url-exclude",
  "--method-include",
  "--resource-type-include",
  "--mime-include",
  "--route-layout",
]);

const BOOLEAN_FLAGS = new Set([
  "--help",
  "--list",
  "--auto-menu",
  "--split-only",
  "--no-split",
  "--include-base64",
]);

export function parseArgs(argv) {
  const args = {
    host: "127.0.0.1",
    port: 9222,
    routeLayout: "flat",
    menuPollMs: 500,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (BOOLEAN_FLAGS.has(flag)) {
      args[toKey(flag)] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }

    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`);
    }
    args[toKey(flag)] = value;
    index += 1;
  }

  args.port = Number(args.port);
  args.menuPollMs = Number(args.menuPollMs);
  if (args.stopAfterMs !== undefined) {
    args.stopAfterMs = Number(args.stopAfterMs);
  }

  if (!Number.isFinite(args.port) || args.port <= 0) {
    throw new Error("The --port value must be a positive number.");
  }
  if (!Number.isFinite(args.menuPollMs) || args.menuPollMs <= 0) {
    throw new Error("The --menu-poll-ms value must be a positive number.");
  }
  if (args.stopAfterMs !== undefined && (!Number.isFinite(args.stopAfterMs) || args.stopAfterMs <= 0)) {
    throw new Error("The --stop-after-ms value must be a positive number.");
  }
  if (!["flat", "nested"].includes(args.routeLayout)) {
    throw new Error('The --route-layout value must be either "flat" or "nested".');
  }

  args.writeAggregate = !args.splitOnly;
  args.writeSplit = !args.noSplit;
  return args;
}

export function sanitizePart(value, fallback = "_") {
  const clean = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return clean || fallback;
}

export function normalizeMenuContext(raw, fallbackName) {
  return {
    groupName: sanitizePart(raw?.groupName || raw?.menuGroup || "ungrouped", "ungrouped"),
    menuName: sanitizePart(
      raw?.menuName || raw?.name || raw?.sessionName || fallbackName || "untitled-page",
      "untitled-page",
    ),
  };
}

export function buildAggregatePath(args) {
  if (args.output) {
    return path.resolve(process.cwd(), args.output);
  }
  if (!args.writeAggregate) {
    return null;
  }

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const baseDir = args.outputDir ? path.resolve(process.cwd(), args.outputDir) : process.cwd();
  return path.join(baseDir, `network-capture-${stamp}.ndjson`);
}

export function buildSplitTarget(args, targetTitle, aggregatePath) {
  if (!args.writeSplit) {
    return { mode: "none", root: null };
  }

  const fallbackName = sanitizePart(args.sessionName || targetTitle || "untitled-page", "untitled-page");
  let root = args.splitDir;
  if (!root && aggregatePath) {
    root = path.join(path.dirname(aggregatePath), `${path.parse(aggregatePath).name}-by-route`);
  }
  if (!root) {
    root = path.join(args.outputDir || process.cwd(), fallbackName);
  }

  return {
    mode: "fixed",
    root: path.resolve(process.cwd(), root),
  };
}

export function routeRootFor(splitTarget) {
  return splitTarget.root;
}

export function buildWebSocketTarget(args, target, aggregatePath, splitTarget) {
  if (splitTarget.mode !== "none" && splitTarget.root) {
    return {
      mode: "fixed",
      root: path.join(splitTarget.root, "ws"),
    };
  }

  if (aggregatePath) {
    return {
      mode: "fixed",
      root: path.join(path.dirname(aggregatePath), `${path.parse(aggregatePath).name}-ws`),
    };
  }

  const fallbackName = sanitizePart(args.sessionName || target.title || "untitled-page", "untitled-page");
  const baseDir = args.outputDir ? path.resolve(process.cwd(), args.outputDir) : process.cwd();
  return {
    mode: "fixed",
    root: path.join(baseDir, fallbackName, "ws"),
  };
}

export function buildWebSocketSessionDirectory(rootDir, target, urlString, requestId) {
  const host = hostPart(urlString);
  const pageKey = pageKeyForTarget(target);
  const pathHint = pathHintForUrl(urlString);
  const wsKey = `${pathHint}__${shortHash(`${urlString}::${requestId}`)}`;
  return path.join(rootDir, host, pageKey, wsKey);
}

export function buildRouteFilePath(rootDir, urlString, layout) {
  try {
    const url = new URL(urlString);
    if (!["http:", "https:"].includes(url.protocol)) {
      return path.join(
        rootDir,
        `${compactPart(url.protocol.replace(":", ""), "unknown-protocol")}__${shortHash(urlString)}.ndjson`,
      );
    }

    const host = compactPart(url.host, "_unknown-host");
    const segments = url.pathname.split("/").filter(Boolean).map((part) => compactPart(part));
    if (!segments.length) {
      segments.push("_root");
    }

    if (layout === "flat") {
      return path.join(rootDir, `${compactPart([host, ...segments].join("__"))}.ndjson`);
    }

    const nested = [...segments];
    nested[nested.length - 1] = `${nested[nested.length - 1]}.ndjson`;
    return path.join(rootDir, host, ...nested);
  } catch {
    return path.join(rootDir, `_unknown__${shortHash(urlString)}.ndjson`);
  }
}

export function buildFilters(args) {
  return {
    domainInclude: csv(args.domainInclude),
    domainExclude: csv(args.domainExclude),
    urlInclude: csv(args.urlInclude),
    urlExclude: csv(args.urlExclude),
    methodInclude: csv(args.methodInclude, true),
    resourceTypeInclude: csv(args.resourceTypeInclude, true),
    mimeInclude: csv(args.mimeInclude),
  };
}

export function hasFilters(filters) {
  return Object.values(filters).some((items) => items.length > 0);
}

export function matchesFilters(record, filters) {
  if (!hasFilters(filters)) {
    return true;
  }

  const urlString = String(record.request?.url || record.response?.url || "");
  const urlLower = urlString.toLowerCase();
  const method = String(record.request?.method || "").toUpperCase();
  const resourceType = String(record.type || "").toUpperCase();
  const mimeType = String(
    record.response?.mimeType ||
      record.response?.headers?.["Content-Type"] ||
      record.response?.headers?.["content-type"] ||
      "",
  ).toLowerCase();

  let hostLower = "";
  try {
    hostLower = new URL(urlString).host.toLowerCase();
  } catch {
    hostLower = "";
  }

  return (
    includesAny(hostLower, filters.domainInclude) &&
    !includesAny(hostLower, filters.domainExclude, false) &&
    includesAny(urlLower, filters.urlInclude) &&
    !includesAny(urlLower, filters.urlExclude, false) &&
    includesExact(method, filters.methodInclude) &&
    includesExact(resourceType, filters.resourceTypeInclude) &&
    includesAny(mimeType, filters.mimeInclude)
  );
}

export function createWriter(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return fs.createWriteStream(filePath, { flags: "a" });
}

export function closeWriter(stream) {
  return new Promise((resolve) => stream.end(resolve));
}

function toKey(flag) {
  return flag.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function csv(value, uppercase = false) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (uppercase ? item.toUpperCase() : item.toLowerCase()));
}

function shortHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function compactPart(value, fallback = "_") {
  const clean = sanitizePart(value, fallback);
  return clean.length <= 80 ? clean : `${clean.slice(0, 48)}__${shortHash(clean)}`;
}

function includesAny(value, terms, emptyMeansPass = true) {
  if (!terms.length) {
    return emptyMeansPass;
  }
  return terms.some((term) => value.includes(term));
}

function includesExact(value, terms) {
  return !terms.length || terms.includes(value);
}

function pageKeyForTarget(target) {
  const title = String(target?.title || "").trim();
  if (title) {
    return compactPart(title, "untitled-page");
  }

  try {
    const url = new URL(target?.url || "");
    const segments = url.pathname.split("/").filter(Boolean);
    const tail = segments.slice(-2).join("__");
    return compactPart(tail || url.host || "untitled-page", "untitled-page");
  } catch {
    return "untitled-page";
  }
}

function pathHintForUrl(urlString) {
  try {
    const url = new URL(urlString);
    const segments = url.pathname.split("/").filter(Boolean);
    return compactPart(segments[segments.length - 1] || "_root", "_root");
  } catch {
    return "_unknown";
  }
}

function hostPart(urlString) {
  try {
    return compactPart(new URL(urlString).host, "_unknown-host");
  } catch {
    return "_unknown-host";
  }
}
