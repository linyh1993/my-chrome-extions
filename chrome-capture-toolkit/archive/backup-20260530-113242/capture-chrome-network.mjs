#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function printHelp() {
  console.log(`Capture Chrome requests and responses through the DevTools Protocol.

Usage:
  node capture-chrome-network.mjs [options]

Options:
  --port <number>            Remote debugging port. Default: 9222
  --host <host>              Remote debugging host. Default: 127.0.0.1
  --list                     List available tabs and exit
  --target-id <id>           Capture a specific tab by target id
  --url-contains <text>      Pick the first tab whose URL contains text
  --title-contains <text>    Pick the first tab whose title contains text
  --navigate <url>           Navigate the chosen tab after capture starts
  --stop-after-ms <number>   Stop automatically after the given duration
  --output-dir <dir>         Base directory for capture files
  --output <file>            Output NDJSON path. Default: ./network-capture-<timestamp>.ndjson
  --session-name <name>      Folder name for this page or menu capture
  --split-dir <dir>          Directory for per-route files. Default: sibling "<output>-by-route"
  --menu-root-dir <dir>      Root directory for dynamic menu folders
  --menu-group <name>        Manual top-level menu name or auto-menu fallback
  --menu-name <name>         Manual leaf menu name or auto-menu fallback
  --auto-menu                Detect menu changes from the page and route files dynamically
  --menu-poll-ms <number>    Poll interval for menu detection. Default: 500
  --route-layout <mode>      Split file layout: "flat" or "nested". Default: flat
  --split-only               Only write split files and skip the aggregate file
  --no-split                 Disable per-domain and per-path split files
  --include-base64           Keep binary response bodies as base64 instead of skipping them
  --help                     Show this help

Examples:
  node capture-chrome-network.mjs --list
  node capture-chrome-network.mjs --url-contains example.com
  node capture-chrome-network.mjs --target-id 3C1... --navigate https://example.com --stop-after-ms 5000
  node capture-chrome-network.mjs --url-contains example.com --output capture.ndjson --split-dir by-route
  node capture-chrome-network.mjs --target-id 3C1... --output-dir captures --session-name menu-a --split-only
  node capture-chrome-network.mjs --target-id 3C1... --auto-menu --menu-root-dir captures --split-only
  node capture-chrome-network.mjs --target-id 3C1C1D3D9E0A91E9AA1C3AE7317A0A55 --output out.ndjson
`);
}

function parseArgs(argv) {
  const args = {
    host: "127.0.0.1",
    port: 9222,
    includeBase64: false,
    split: true,
    writeAggregate: true,
    routeLayout: "flat",
    autoMenu: false,
    menuPollMs: 500,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--help":
        args.help = true;
        break;
      case "--list":
        args.list = true;
        break;
      case "--include-base64":
        args.includeBase64 = true;
        break;
      case "--host":
        args.host = next;
        index += 1;
        break;
      case "--port":
        args.port = Number(next);
        index += 1;
        break;
      case "--target-id":
        args.targetId = next;
        index += 1;
        break;
      case "--url-contains":
        args.urlContains = next;
        index += 1;
        break;
      case "--title-contains":
        args.titleContains = next;
        index += 1;
        break;
      case "--output":
        args.output = next;
        index += 1;
        break;
      case "--output-dir":
        args.outputDir = next;
        index += 1;
        break;
      case "--session-name":
        args.sessionName = next;
        index += 1;
        break;
      case "--split-dir":
        args.splitDir = next;
        index += 1;
        break;
      case "--menu-root-dir":
        args.menuRootDir = next;
        index += 1;
        break;
      case "--menu-group":
        args.menuGroup = next;
        index += 1;
        break;
      case "--menu-name":
        args.menuName = next;
        index += 1;
        break;
      case "--auto-menu":
        args.autoMenu = true;
        break;
      case "--menu-poll-ms":
        args.menuPollMs = Number(next);
        index += 1;
        break;
      case "--route-layout":
        args.routeLayout = next;
        index += 1;
        break;
      case "--split-only":
        args.writeAggregate = false;
        args.split = true;
        break;
      case "--no-split":
        args.split = false;
        break;
      case "--navigate":
        args.navigate = next;
        index += 1;
        break;
      case "--stop-after-ms":
        args.stopAfterMs = Number(next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.port) || args.port <= 0) {
    throw new Error("The --port value must be a positive number.");
  }

  if (
    args.stopAfterMs !== undefined &&
    (!Number.isFinite(args.stopAfterMs) || args.stopAfterMs <= 0)
  ) {
    throw new Error("The --stop-after-ms value must be a positive number.");
  }

  if (!["flat", "nested"].includes(args.routeLayout)) {
    throw new Error('The --route-layout value must be either "flat" or "nested".');
  }

  if (!Number.isFinite(args.menuPollMs) || args.menuPollMs <= 0) {
    throw new Error("The --menu-poll-ms value must be a positive number.");
  }

  return args;
}

function toAbsoluteOutputPath(filePath) {
  if (filePath) {
    return path.resolve(process.cwd(), filePath);
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return path.resolve(process.cwd(), `network-capture-${timestamp}.ndjson`);
}

function toDefaultSplitDir(outputPath) {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}-by-route`);
}

function buildAggregateOutputPath(args) {
  if (args.output) {
    return toAbsoluteOutputPath(args.output);
  }

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  if (args.outputDir) {
    return path.resolve(process.cwd(), args.outputDir, `network-capture-${timestamp}.ndjson`);
  }

  return toAbsoluteOutputPath();
}

function sanitizePathPart(value, fallback = "_") {
  const sanitized = String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  return sanitized || fallback;
}

function shortHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function compactPathPart(value, fallback = "_") {
  const sanitized = sanitizePathPart(value, fallback);
  if (sanitized.length <= 80) {
    return sanitized;
  }
  return `${sanitized.slice(0, 48)}__${shortHash(sanitized)}`;
}

function buildFlatRouteFileName(url) {
  const hostPart = compactPathPart(url.host, "_unknown-host");
  const pathSegments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => compactPathPart(segment));

  if (!pathSegments.length) {
    pathSegments.push("_root");
  }

  const fileStem = [hostPart, ...pathSegments].join("__");
  return `${compactPathPart(fileStem)}.ndjson`;
}

function normalizeMenuContext(context, fallbackTitle) {
  const rawGroup = context?.groupName ?? context?.menuGroup ?? null;
  const rawName = context?.menuName ?? context?.name ?? context?.sessionName ?? fallbackTitle ?? "untitled-page";
  const groupName = sanitizePathPart(rawGroup || "未分组", "未分组");
  const menuName = sanitizePathPart(rawName || fallbackTitle || "untitled-page", "untitled-page");
  return {
    groupName,
    menuName,
  };
}

function menuDirForContext(rootDir, menuContext) {
  return path.join(rootDir, menuContext.groupName, menuContext.menuName);
}

function getRouteFilePath(splitDir, urlString, routeLayout) {
  try {
    const url = new URL(urlString);
    if (!["http:", "https:"].includes(url.protocol)) {
      return path.join(
        splitDir,
        `${compactPathPart(url.protocol.replace(":", ""), "unknown-protocol")}__${shortHash(urlString)}.ndjson`,
      );
    }

    if (routeLayout === "flat") {
      return path.join(splitDir, buildFlatRouteFileName(url));
    }

    const hostPart = compactPathPart(url.host, "_unknown-host");
    const pathSegments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => compactPathPart(segment));

    if (!pathSegments.length) {
      pathSegments.push("_root");
    }

    const lastIndex = pathSegments.length - 1;
    pathSegments[lastIndex] = `${compactPathPart(pathSegments[lastIndex])}.ndjson`;

    return path.join(splitDir, hostPart, ...pathSegments);
  } catch {
    return path.join(splitDir, `_unknown__${shortHash(urlString)}.ndjson`);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function listTargets(targets) {
  if (!targets.length) {
    console.log("No page targets found.");
    return;
  }

  for (const target of targets) {
    console.log(`id: ${target.id}`);
    console.log(`title: ${target.title || "(no title)"}`);
    console.log(`url: ${target.url}`);
    console.log("");
  }
}

function pickTarget(targets, args) {
  if (!targets.length) {
    throw new Error("No page targets found on the remote debugging endpoint.");
  }

  if (args.targetId) {
    return targets.find((target) => target.id === args.targetId);
  }

  if (args.urlContains) {
    return targets.find((target) => target.url.includes(args.urlContains));
  }

  if (args.titleContains) {
    return targets.find((target) => (target.title || "").includes(args.titleContains));
  }

  if (targets.length === 1) {
    return targets[0];
  }

  throw new Error(
    "More than one tab is available. Use --list and then pass --target-id, --url-contains, or --title-contains.",
  );
}

function parseQueryParams(urlString) {
  try {
    const url = new URL(urlString);
    const result = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (!(key in result)) {
        result[key] = value;
        continue;
      }

      if (Array.isArray(result[key])) {
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

function tryParseJson(text) {
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

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const eventHandlers = new Map();
  let nextId = 1;

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id) {
      const task = pending.get(payload.id);
      if (!task) {
        return;
      }
      pending.delete(payload.id);
      if (payload.error) {
        task.reject(new Error(`${task.method}: ${payload.error.message}`));
      } else {
        task.resolve(payload.result);
      }
      return;
    }

    if (!payload.method) {
      return;
    }

    const handlers = eventHandlers.get(payload.method) || [];
    for (const handler of handlers) {
      handler(payload.params || {});
    }
  });

  socket.addEventListener("close", () => {
    for (const { reject, method } of pending.values()) {
      reject(new Error(`WebSocket closed before "${method}" completed.`));
    }
    pending.clear();
  });

  return {
    socket,
    send,
    on(method, handler) {
      const handlers = eventHandlers.get(method) || [];
      handlers.push(handler);
      eventHandlers.set(method, handlers);
    },
    onceOpen() {
      return new Promise((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", (error) => reject(error), { once: true });
      });
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };
}

function ensureEntry(entries, requestId) {
  if (!entries.has(requestId)) {
    entries.set(requestId, {
      requestId,
      startedAt: null,
      finishedAt: null,
      request: {},
      response: {},
      failure: null,
    });
  }
  return entries.get(requestId);
}

function writeNdjson(stream, record) {
  stream.write(`${JSON.stringify(record)}\n`);
}

function buildMenuExtractionExpression() {
  return `(() => {
    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const linesOf = (value) =>
      String(value || "")
        .split(/\\n+/)
        .map((item) => clean(item))
        .filter(Boolean);
    const firstElement = (selectors) => {
      for (const selector of selectors) {
        const elements = [...document.querySelectorAll(selector)];
        for (const element of elements) {
          const lines = linesOf(element.innerText || element.textContent || "");
          if (lines.length) {
            return { selector, lines, className: String(element.className || ""), element };
          }
        }
      }
      return null;
    };

    const leafInfo = firstElement([
      ".bestqi-menu-item-selected",
      ".ant-menu-item-selected",
      "[class*=menu-item-selected]",
      "[class*=menu] [class*=item-selected]",
      "[class*=menu] [class*=active]"
    ]);

    let groupName = null;
    let menuName = null;
    let source = "fallback";

    if (leafInfo) {
      menuName = leafInfo.lines[0] || null;
      let parentElement = leafInfo.element.closest("ul");
      parentElement = parentElement ? parentElement.closest("li") : null;
      if (parentElement) {
        const parentLines = linesOf(parentElement.innerText || parentElement.textContent || "");
        if (parentLines.length) {
          groupName = parentLines[0] || null;
        }
      }

      if (!groupName || groupName === menuName) {
        const groupInfo = firstElement([
          ".bestqi-menu-submenu.bestqi-menu-opened",
          ".bestqi-menu-child-item-active",
          ".ant-menu-submenu-selected",
          "[class*=submenu][class*=selected]",
          "[class*=submenu][class*=active]"
        ]);
        if (groupInfo) {
          groupName = groupInfo.lines[0] || null;
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
      const url = location.pathname || "";
      const segments = url.split("/").filter(Boolean);
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
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const baseUrl = `http://${args.host}:${args.port}`;
  const targets = (await fetchJson(`${baseUrl}/json/list`)).filter((target) => target.type === "page");

  if (args.list) {
    listTargets(targets);
    return;
  }

  const target = pickTarget(targets, args);
  if (!target) {
    throw new Error("No tab matched the given filters.");
  }

  const inferredSessionName = sanitizePathPart(args.sessionName || target.title || "untitled-page", "untitled-page");
  const outputPath = buildAggregateOutputPath(args);
  const splitBaseDir = args.outputDir ? path.resolve(process.cwd(), args.outputDir) : path.dirname(outputPath);
  const splitDirPath = args.split && !args.autoMenu
    ? path.resolve(
        process.cwd(),
        args.splitDir || path.join(splitBaseDir, inferredSessionName),
      )
    : null;
  const menuRootDirPath = args.split && args.autoMenu
    ? path.resolve(process.cwd(), args.menuRootDir || args.splitDir || splitBaseDir)
    : null;
  if (args.writeAggregate) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }
  if (splitDirPath) {
    fs.mkdirSync(splitDirPath, { recursive: true });
  }
  if (menuRootDirPath) {
    fs.mkdirSync(menuRootDirPath, { recursive: true });
  }
  const outputStream = args.writeAggregate ? fs.createWriteStream(outputPath, { flags: "a" }) : null;
  const client = createCdpClient(target.webSocketDebuggerUrl);
  const entries = new Map();
  const splitStreams = new Map();
  let finalizedCount = 0;
  let shuttingDown = false;
  let menuPollTimer = null;
  let currentMenuContext = normalizeMenuContext(
    {
      groupName: args.menuGroup,
      menuName: args.menuName || args.sessionName,
    },
    inferredSessionName,
  );
  let currentMenuMeta = {
    source: args.autoMenu ? "fallback" : "manual",
    title: target.title || "",
    url: target.url,
  };

  function getRouteDirectory(menuContext) {
    if (menuRootDirPath) {
      return menuDirForContext(menuRootDirPath, menuContext);
    }
    return splitDirPath;
  }

  function getSplitStream(urlString, menuContext) {
    const routeDirectory = getRouteDirectory(menuContext);
    const routeFilePath = getRouteFilePath(routeDirectory, urlString, args.routeLayout);
    if (!splitStreams.has(routeFilePath)) {
      fs.mkdirSync(path.dirname(routeFilePath), { recursive: true });
      splitStreams.set(routeFilePath, fs.createWriteStream(routeFilePath, { flags: "a" }));
    }
    return {
      routeFilePath,
      stream: splitStreams.get(routeFilePath),
    };
  }

  async function finalizeEntry(requestId) {
    const entry = entries.get(requestId);
    if (!entry || entry._written) {
      return;
    }

    entry._written = true;
    finalizedCount += 1;
    const record = { ...entry };
    delete record._written;
    if (outputStream) {
      writeNdjson(outputStream, record);
    }
    if (splitDirPath || menuRootDirPath) {
      const effectiveMenuContext = normalizeMenuContext(entry.menuContext, inferredSessionName);
      record.menuContext = effectiveMenuContext;
      const { routeFilePath, stream } = getSplitStream(
        entry.request.url || entry.response.url || "",
        effectiveMenuContext,
      );
      record.routeFile = routeFilePath;
      writeNdjson(stream, record);
    }
    entries.delete(requestId);
  }

  async function flushAllAndExit(exitCode) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (menuPollTimer) {
      clearInterval(menuPollTimer);
      menuPollTimer = null;
    }

    for (const requestId of [...entries.keys()]) {
      await finalizeEntry(requestId);
    }

    if (outputStream) {
      await new Promise((resolve) => outputStream.end(resolve));
    }
    await Promise.all(
      [...splitStreams.values()].map(
        (stream) =>
          new Promise((resolve) => {
            stream.end(resolve);
          }),
      ),
    );
    client.close();

    console.log(`Captured ${finalizedCount} requests.`);
    if (outputStream) {
      console.log(`Output: ${outputPath}`);
    }
    if (splitDirPath) {
      console.log(`Split files: ${splitDirPath}`);
    }
    if (menuRootDirPath) {
      console.log(`Menu root: ${menuRootDirPath}`);
    }

    process.exit(exitCode);
  }

  process.on("SIGINT", () => {
    console.log("\nStopping capture...");
    flushAllAndExit(0).catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  });

  async function refreshMenuContext(reason = "poll") {
    if (!args.autoMenu) {
      return;
    }

    try {
      const result = await client.send("Runtime.evaluate", {
        expression: buildMenuExtractionExpression(),
        returnByValue: true,
        awaitPromise: true,
      });
      const value = result.result?.value ?? {};
      const nextMenuContext = normalizeMenuContext(value, inferredSessionName);
      const changed =
        nextMenuContext.groupName !== currentMenuContext.groupName ||
        nextMenuContext.menuName !== currentMenuContext.menuName;

      currentMenuContext = nextMenuContext;
      currentMenuMeta = {
        source: value.source || reason,
        title: value.title || "",
        url: value.url || "",
      };

      if (changed) {
        console.log(
          `Menu switched: ${currentMenuContext.groupName} / ${currentMenuContext.menuName} (${currentMenuMeta.source})`,
        );
      }
    } catch (error) {
      console.error(`Menu detection failed (${reason}): ${error.message}`);
    }
  }

  client.on("Network.requestWillBeSent", (params) => {
    const entry = ensureEntry(entries, params.requestId);
    entry.startedAt = params.wallTime
      ? new Date(params.wallTime * 1000).toISOString()
      : new Date().toISOString();
    entry.documentURL = params.documentURL;
    entry.type = params.type;
    entry.loaderId = params.loaderId;
    entry.frameId = params.frameId;
    entry.menuContext = currentMenuContext;
    entry.menuSource = currentMenuMeta;
    entry.request = {
      url: params.request.url,
      method: params.request.method,
      headers: params.request.headers,
      hasPostData: Boolean(params.request.hasPostData),
      postData: params.request.postData ?? null,
      postDataJson: tryParseJson(params.request.postData ?? null),
      queryParams: parseQueryParams(params.request.url),
      mixedContentType: params.request.mixedContentType ?? null,
      referrerPolicy: params.request.referrerPolicy ?? null,
    };
    if (params.redirectResponse) {
      entry.redirectResponse = params.redirectResponse;
    }
  });

  client.on("Network.requestWillBeSentExtraInfo", (params) => {
    const entry = ensureEntry(entries, params.requestId);
    entry.requestExtraInfo = {
      headers: params.headers,
      associatedCookies: params.associatedCookies,
      clientSecurityState: params.clientSecurityState ?? null,
      siteHasCookieInOtherPartition: params.siteHasCookieInOtherPartition ?? null,
      connectTiming: params.connectTiming ?? null,
    };
  });

  client.on("Network.responseReceived", (params) => {
    const entry = ensureEntry(entries, params.requestId);
    entry.response = {
      url: params.response.url,
      status: params.response.status,
      statusText: params.response.statusText,
      mimeType: params.response.mimeType,
      headers: params.response.headers,
      remoteIPAddress: params.response.remoteIPAddress ?? null,
      remotePort: params.response.remotePort ?? null,
      fromDiskCache: Boolean(params.response.fromDiskCache),
      fromServiceWorker: Boolean(params.response.fromServiceWorker),
      fromPrefetchCache: Boolean(params.response.fromPrefetchCache),
      encodedDataLength: params.response.encodedDataLength ?? null,
      timing: params.response.timing ?? null,
      protocol: params.response.protocol ?? null,
      securityState: params.response.securityState ?? null,
    };
  });

  client.on("Network.responseReceivedExtraInfo", (params) => {
    const entry = ensureEntry(entries, params.requestId);
    entry.responseExtraInfo = {
      statusCode: params.statusCode,
      headers: params.headers,
      headersText: params.headersText ?? null,
      blockedCookies: params.blockedCookies,
      cookiePartitionKey: params.cookiePartitionKey ?? null,
      resourceIPAddressSpace: params.resourceIPAddressSpace ?? null,
    };
  });

  client.on("Network.loadingFinished", async (params) => {
    const entry = ensureEntry(entries, params.requestId);
    entry.finishedAt = new Date().toISOString();
    entry.response = {
      ...entry.response,
      encodedDataLength: params.encodedDataLength,
    };

    try {
      if (!entry.request.postData && entry.request.hasPostData) {
        const postDataResult = await client.send("Network.getRequestPostData", {
          requestId: params.requestId,
        });
        entry.request.postData = postDataResult.postData;
        entry.request.postDataJson = tryParseJson(postDataResult.postData);
      }
    } catch (error) {
      entry.request.postDataError = error.message;
    }

    try {
      const bodyResult = await client.send("Network.getResponseBody", {
        requestId: params.requestId,
      });

      if (bodyResult.base64Encoded && !args.includeBase64) {
        entry.response.body = null;
        entry.response.bodyEncoding = "base64";
        entry.response.bodySkipped = true;
        entry.response.bodySkippedReason = "Binary response omitted. Re-run with --include-base64 to keep it.";
      } else {
        entry.response.body = bodyResult.body;
        entry.response.bodyEncoding = bodyResult.base64Encoded ? "base64" : "text";
        entry.response.bodyJson = bodyResult.base64Encoded ? null : tryParseJson(bodyResult.body);
      }
    } catch (error) {
      entry.response.body = null;
      entry.response.bodyError = error.message;
    }

    await finalizeEntry(params.requestId);
  });

  client.on("Network.loadingFailed", async (params) => {
    const entry = ensureEntry(entries, params.requestId);
    entry.finishedAt = new Date().toISOString();
    entry.failure = {
      errorText: params.errorText,
      canceled: Boolean(params.canceled),
      blockedReason: params.blockedReason ?? null,
      corsErrorStatus: params.corsErrorStatus ?? null,
    };
    await finalizeEntry(params.requestId);
  });

  await client.onceOpen();
  await client.send("Network.enable", {
    maxTotalBufferSize: 104857600,
    maxResourceBufferSize: 10485760,
    maxPostDataSize: 10485760,
  });
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await refreshMenuContext("initial");

  if (args.autoMenu) {
    menuPollTimer = setInterval(() => {
      refreshMenuContext("poll").catch(() => {});
    }, args.menuPollMs);
    client.on("Page.frameNavigated", () => {
      refreshMenuContext("frameNavigated").catch(() => {});
    });
    client.on("Page.navigatedWithinDocument", () => {
      refreshMenuContext("navigatedWithinDocument").catch(() => {});
    });
    client.on("Page.loadEventFired", () => {
      refreshMenuContext("loadEvent").catch(() => {});
    });
  }

  console.log(`Connected to tab: ${target.title || "(no title)"}`);
  console.log(`URL: ${target.url}`);
  if (outputStream) {
    console.log(`Capturing to: ${outputPath}`);
  }
  if (splitDirPath) {
    console.log(`Splitting by route to: ${splitDirPath}`);
    console.log(`Route layout: ${args.routeLayout}`);
  }
  if (menuRootDirPath) {
    console.log(`Menu root: ${menuRootDirPath}`);
    console.log(`Current menu: ${currentMenuContext.groupName} / ${currentMenuContext.menuName}`);
    console.log(`Route layout: ${args.routeLayout}`);
  }
  console.log("Press Ctrl+C to stop.\n");

  if (args.navigate) {
    await client.send("Page.navigate", { url: args.navigate });
    console.log(`Navigating to: ${args.navigate}\n`);
  }

  if (args.stopAfterMs) {
    setTimeout(() => {
      console.log(`Stopping after ${args.stopAfterMs} ms...`);
      flushAllAndExit(0).catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
    }, args.stopAfterMs);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
