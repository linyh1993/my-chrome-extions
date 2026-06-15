import fs from "node:fs";
import path from "node:path";

import {
  buildAggregatePath,
  buildFilters,
  buildRouteFilePath,
  buildSplitTarget,
  buildWebSocketSessionDirectory,
  buildWebSocketTarget,
  closeWriter,
  createWriter,
  hasFilters,
  matchesFilters,
  routeRootFor,
  sanitizePart,
} from "./core.mjs";
import { createCDP, fetchTargets, listTargets, pickTarget } from "./cdp.mjs";
import { parseMaybeJson, queryParams } from "./record-utils.mjs";

export async function runCapture(args, adapter = null) {
  const baseUrl = `http://${args.host}:${args.port}`;
  const targets = await fetchTargets(baseUrl);
  if (args.list) {
    listTargets(targets);
    return;
  }

  const target = pickTarget(targets, args);
  if (!target) {
    throw new Error("No tab matched the given filters.");
  }

  const state = createState(args, target, adapter);
  const cdp = createCDP(target.webSocketDebuggerUrl);
  state.cdp = cdp;

  wireNetworkEvents(cdp, state);

  await cdp.open();
  await cdp.send("Network.enable", {
    maxTotalBufferSize: 104857600,
    maxResourceBufferSize: 10485760,
    maxPostDataSize: 10485760,
  });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  if (adapter?.initialize) {
    await adapter.initialize(state);
  }
  if (adapter?.start) {
    state.adapterCleanup = await adapter.start(state);
  }

  printStartup(target, state);

  process.on("SIGINT", () => {
    console.log("\nStopping capture...");
    shutdown(state, 0).catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  });

  if (args.navigate) {
    await cdp.send("Page.navigate", { url: args.navigate });
    console.log(`Navigating to: ${args.navigate}\n`);
  }
  if (args.stopAfterMs) {
    setTimeout(() => {
      console.log(`Stopping after ${args.stopAfterMs} ms...`);
      shutdown(state, 0).catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
    }, args.stopAfterMs);
  }
}

function createState(args, target, adapter) {
  const aggregatePath = buildAggregatePath(args);
  const splitTarget = buildSplitTarget(args, target.title, aggregatePath);
  return {
    adapter,
    adapterCleanup: null,
    adapterState: adapter?.createState ? adapter.createState(args, target) : null,
    aggregatePath,
    aggregateStream: aggregatePath ? createWriter(aggregatePath) : null,
    args,
    cdp: null,
    entries: new Map(),
    fallbackName: sanitizePart(args.sessionName || target.title || "untitled-page", "untitled-page"),
    filters: buildFilters(args),
    requestCount: 0,
    splitTarget,
    splitWriters: new Map(),
    stopping: false,
    target,
    wsConnectionCount: 0,
    wsMessageCount: 0,
    wsSessions: new Map(),
    wsTarget: buildWebSocketTarget(args, target, aggregatePath, splitTarget),
  };
}

function wireNetworkEvents(cdp, state) {
  wireHttpNetworkEvents(cdp, state);
  wireWebSocketEvents(cdp, state);
}

function wireHttpNetworkEvents(cdp, state) {
  cdp.on("Network.requestWillBeSent", (params) => {
    const entry = ensureEntry(state, params.requestId);
    entry.startedAt = params.wallTime ? new Date(params.wallTime * 1000).toISOString() : new Date().toISOString();
    entry.documentURL = params.documentURL;
    entry.type = params.type;
    entry.loaderId = params.loaderId;
    entry.frameId = params.frameId;
    entry.contextSnapshot = state.adapter?.captureContext ? state.adapter.captureContext(state) : null;
    entry.request = {
      url: params.request.url,
      method: params.request.method,
      headers: params.request.headers,
      hasPostData: Boolean(params.request.hasPostData),
      postData: params.request.postData ?? null,
      postDataJson: parseMaybeJson(params.request.postData ?? null),
      queryParams: queryParams(params.request.url),
      mixedContentType: params.request.mixedContentType ?? null,
      referrerPolicy: params.request.referrerPolicy ?? null,
    };
    if (params.redirectResponse) {
      entry.redirectResponse = params.redirectResponse;
    }
  });

  cdp.on("Network.requestWillBeSentExtraInfo", (params) => {
    const entry = ensureEntry(state, params.requestId);
    entry.requestExtraInfo = {
      headers: params.headers,
      associatedCookies: params.associatedCookies,
      clientSecurityState: params.clientSecurityState ?? null,
      siteHasCookieInOtherPartition: params.siteHasCookieInOtherPartition ?? null,
      connectTiming: params.connectTiming ?? null,
    };
  });

  cdp.on("Network.responseReceived", (params) => {
    const entry = ensureEntry(state, params.requestId);
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

  cdp.on("Network.responseReceivedExtraInfo", (params) => {
    const entry = ensureEntry(state, params.requestId);
    entry.responseExtraInfo = {
      statusCode: params.statusCode,
      headers: params.headers,
      headersText: params.headersText ?? null,
      blockedCookies: params.blockedCookies,
      cookiePartitionKey: params.cookiePartitionKey ?? null,
      resourceIPAddressSpace: params.resourceIPAddressSpace ?? null,
    };
  });

  cdp.on("Network.loadingFinished", async (params) => {
    const entry = ensureEntry(state, params.requestId);
    entry.finishedAt = new Date().toISOString();
    entry.response = { ...entry.response, encodedDataLength: params.encodedDataLength };

    try {
      if (!entry.request.postData && entry.request.hasPostData) {
        const result = await cdp.send("Network.getRequestPostData", { requestId: params.requestId });
        entry.request.postData = result.postData;
        entry.request.postDataJson = parseMaybeJson(result.postData);
      }
    } catch (error) {
      entry.request.postDataError = error.message;
    }

    try {
      const body = await cdp.send("Network.getResponseBody", { requestId: params.requestId });
      if (body.base64Encoded && !state.args.includeBase64) {
        entry.response.body = null;
        entry.response.bodyEncoding = "base64";
        entry.response.bodySkipped = true;
        entry.response.bodySkippedReason =
          "Binary response omitted. Re-run with --include-base64 to keep it.";
      } else {
        entry.response.body = body.body;
        entry.response.bodyEncoding = body.base64Encoded ? "base64" : "text";
        entry.response.bodyJson = body.base64Encoded ? null : parseMaybeJson(body.body);
      }
    } catch (error) {
      entry.response.body = null;
      entry.response.bodyError = error.message;
    }

    await finalize(state, params.requestId);
  });

  cdp.on("Network.loadingFailed", async (params) => {
    const entry = ensureEntry(state, params.requestId);
    entry.finishedAt = new Date().toISOString();
    entry.failure = {
      errorText: params.errorText,
      canceled: Boolean(params.canceled),
      blockedReason: params.blockedReason ?? null,
      corsErrorStatus: params.corsErrorStatus ?? null,
    };
    await finalize(state, params.requestId);
  });
}

function wireWebSocketEvents(cdp, state) {
  cdp.on("Network.webSocketCreated", (params) => {
    const session = ensureWebSocketSession(state, params.requestId, params.url);
    if (!session) {
      return;
    }

    session.createdAt = session.createdAt || new Date().toISOString();
    session.createdTimestamp = params.timestamp ?? null;
    session.initiator = params.initiator ?? null;
    writeWebSocketMetadata(session);
  });

  cdp.on("Network.webSocketWillSendHandshakeRequest", (params) => {
    const session = ensureWebSocketSession(state, params.requestId);
    if (!session) {
      return;
    }

    session.openedAt = params.wallTime ? new Date(params.wallTime * 1000).toISOString() : session.openedAt;
    session.handshake.request = {
      headers: params.request.headers,
      wallTime: params.wallTime ?? null,
      timestamp: params.timestamp ?? null,
    };
    writeWebSocketMetadata(session);
  });

  cdp.on("Network.webSocketHandshakeResponseReceived", (params) => {
    const session = ensureWebSocketSession(state, params.requestId);
    if (!session) {
      return;
    }

    session.handshake.response = {
      status: params.response.status,
      statusText: params.response.statusText,
      headers: params.response.headers,
      headersText: params.response.headersText ?? null,
      requestHeaders: params.response.requestHeaders ?? null,
      requestHeadersText: params.response.requestHeadersText ?? null,
      timestamp: params.timestamp ?? null,
    };
    writeWebSocketMetadata(session);
  });

  cdp.on("Network.webSocketFrameSent", (params) => {
    appendWebSocketFrame(state, params, "sent");
  });

  cdp.on("Network.webSocketFrameReceived", (params) => {
    appendWebSocketFrame(state, params, "received");
  });

  cdp.on("Network.webSocketFrameError", (params) => {
    const session = ensureWebSocketSession(state, params.requestId);
    if (!session) {
      return;
    }

    session.seq += 1;
    session.errorCount += 1;
    session.messageCount += 1;
    state.wsMessageCount += 1;
    session.messagesStream.write(
      `${JSON.stringify({
        requestId: session.requestId,
        seq: session.seq,
        event: "frame-error",
        timestamp: params.timestamp ?? null,
        errorMessage: params.errorMessage,
      })}\n`,
    );
    writeWebSocketSummary(session);
  });

  cdp.on("Network.webSocketClosed", (params) => {
    const session = ensureWebSocketSession(state, params.requestId);
    if (!session) {
      return;
    }

    session.closedAt = new Date().toISOString();
    session.closeTimestamp = params.timestamp ?? null;
    session.active = false;
    finalizeWebSocketSession(state, session).catch((error) => {
      console.error(error.message);
    });
  });
}

function ensureEntry(state, requestId) {
  if (!state.entries.has(requestId)) {
    state.entries.set(requestId, {
      requestId,
      request: {},
      response: {},
      failure: null,
    });
  }
  return state.entries.get(requestId);
}

async function finalize(state, requestId) {
  const entry = state.entries.get(requestId);
  if (!entry || entry.written) {
    return;
  }
  state.entries.delete(requestId);

  if (!matchesFilters(entry, state.filters)) {
    return;
  }

  entry.written = true;
  state.requestCount += 1;
  const record = { ...entry };
  delete record.written;

  if (state.adapter?.decorateRecord) {
    state.adapter.decorateRecord(record, state);
  }

  if (state.aggregateStream) {
    state.aggregateStream.write(`${JSON.stringify(record)}\n`);
  }
  if (state.splitTarget.mode === "none") {
    return;
  }

  const routeRoot = state.adapter?.resolveRouteRoot
    ? state.adapter.resolveRouteRoot(state, record)
    : routeRootFor(state.splitTarget);
  const routeFile = buildRouteFilePath(
    routeRoot,
    record.request.url || record.response.url || "",
    state.args.routeLayout,
  );
  record.routeFile = routeFile;
  splitWriterFor(state, routeFile).write(`${JSON.stringify(record)}\n`);
}

function splitWriterFor(state, filePath) {
  if (!state.splitWriters.has(filePath)) {
    state.splitWriters.set(filePath, createWriter(filePath));
  }
  return state.splitWriters.get(filePath);
}

function ensureWebSocketSession(state, requestId, urlString = null) {
  if (state.wsSessions.has(requestId)) {
    const session = state.wsSessions.get(requestId);
    if (urlString && !session.url) {
      session.url = urlString;
      session.host = safeHost(urlString);
      session.requestUrlPath = safePathname(urlString);
    }
    return session;
  }

  const filterRecord = {
    type: "WebSocket",
    request: {
      method: "GET",
      url: urlString || "",
    },
    response: {},
  };
  if (!matchesFilters(filterRecord, state.filters)) {
    return null;
  }

  const sessionDir = buildWebSocketSessionDirectory(state.wsTarget.root, state.target, urlString || "", requestId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const session = {
    active: true,
    binaryCount: 0,
    closeTimestamp: null,
    closedAt: null,
    createdAt: null,
    createdTimestamp: null,
    errorCount: 0,
    finalized: false,
    handshake: {
      request: null,
      response: null,
    },
    host: safeHost(urlString),
    initiator: null,
    messageCount: 0,
    messagesPath: path.join(sessionDir, "messages.ndjson"),
    messagesStream: createWriter(path.join(sessionDir, "messages.ndjson")),
    openedAt: null,
    page: {
      title: state.target.title || null,
      url: state.target.url || null,
    },
    receivedCount: 0,
    requestId,
    requestMethod: "GET",
    requestUrlPath: safePathname(urlString),
    sentCount: 0,
    seq: 0,
    sessionPath: path.join(sessionDir, "session.json"),
    summaryPath: path.join(sessionDir, "summary.json"),
    textCount: 0,
    url: urlString || null,
  };

  state.wsSessions.set(requestId, session);
  state.wsConnectionCount += 1;
  writeWebSocketMetadata(session);
  writeWebSocketSummary(session);
  return session;
}

function appendWebSocketFrame(state, params, direction) {
  const session = ensureWebSocketSession(state, params.requestId);
  if (!session) {
    return;
  }

  const frame = params.response || {};
  const opcode = Number(frame.opcode);
  const isBinary = opcode === 2;
  const isText = opcode === 1;
  const payload =
    isBinary && !state.args.includeBase64
      ? null
      : frame.payloadData ?? null;

  session.seq += 1;
  session.messageCount += 1;
  state.wsMessageCount += 1;
  if (direction === "sent") {
    session.sentCount += 1;
  } else {
    session.receivedCount += 1;
  }
  if (isBinary) {
    session.binaryCount += 1;
  }
  if (isText) {
    session.textCount += 1;
  }

  session.messagesStream.write(
    `${JSON.stringify({
      requestId: session.requestId,
      seq: session.seq,
      direction,
      event: "frame",
      timestamp: params.timestamp ?? null,
      opcode,
      opcodeName: opcodeName(opcode),
      payloadEncoding: isBinary ? "base64" : "utf8",
      payload,
      payloadJson: isText ? parseMaybeJson(frame.payloadData ?? null) : null,
      payloadSize: typeof frame.payloadData === "string" ? frame.payloadData.length : null,
      payloadSkipped: isBinary && !state.args.includeBase64,
      payloadSkippedReason:
        isBinary && !state.args.includeBase64
          ? "Binary websocket frame omitted. Re-run with --include-base64 to keep it."
          : null,
    })}\n`,
  );

  writeWebSocketSummary(session);
}

async function finalizeWebSocketSession(state, session) {
  if (session.finalized) {
    return;
  }

  session.finalized = true;
  state.wsSessions.delete(session.requestId);
  await closeWriter(session.messagesStream);
  writeWebSocketMetadata(session);
  writeWebSocketSummary(session);
}

async function shutdown(state, code) {
  if (state.stopping) {
    return;
  }
  state.stopping = true;

  if (state.adapterCleanup) {
    state.adapterCleanup();
    state.adapterCleanup = null;
  }

  for (const requestId of [...state.entries.keys()]) {
    await finalize(state, requestId);
  }
  for (const session of [...state.wsSessions.values()]) {
    if (!session.closedAt) {
      session.closedAt = new Date().toISOString();
      session.active = false;
    }
    await finalizeWebSocketSession(state, session);
  }

  await Promise.all([
    ...(state.aggregateStream ? [closeWriter(state.aggregateStream)] : []),
    ...[...state.splitWriters.values()].map(closeWriter),
  ]);
  state.cdp.close();

  console.log(`Captured ${state.requestCount} requests.`);
  console.log(`Captured ${state.wsConnectionCount} websocket sessions and ${state.wsMessageCount} websocket messages.`);
  if (state.aggregatePath) {
    console.log(`Output: ${state.aggregatePath}`);
  }
  if (state.splitTarget.mode !== "none") {
    console.log(`${state.adapter?.shutdownLabel || "Split files"}: ${state.splitTarget.root}`);
  }
  console.log(`WebSocket files: ${state.wsTarget.root}`);
  process.exit(code);
}

function printStartup(target, state) {
  console.log(`Connected to tab: ${target.title || "(no title)"}`);
  console.log(`URL: ${target.url}`);

  if (state.aggregatePath) {
    console.log(`Capturing to: ${state.aggregatePath}`);
  }
  if (state.splitTarget.mode !== "none") {
    console.log(`${state.adapter?.startupLabel || "Split files"}: ${state.splitTarget.root}`);
  }
  console.log(`WebSocket files: ${state.wsTarget.root}`);
  if (state.adapter?.startupLines) {
    for (const line of state.adapter.startupLines(state)) {
      console.log(line);
    }
  }

  console.log(`Route layout: ${state.args.routeLayout}`);
  if (hasFilters(state.filters)) {
    console.log(`Filters: ${JSON.stringify(state.filters)}`);
  }
  console.log("Press Ctrl+C to stop.\n");
}

function writeWebSocketMetadata(session) {
  fs.writeFileSync(
    session.sessionPath,
    `${JSON.stringify(
      {
        requestId: session.requestId,
        url: session.url,
        host: session.host,
        requestUrlPath: session.requestUrlPath,
        requestMethod: session.requestMethod,
        page: session.page,
        initiatedAt: session.createdAt,
        createdTimestamp: session.createdTimestamp,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        closeTimestamp: session.closeTimestamp,
        active: session.active,
        initiator: session.initiator,
        handshake: session.handshake,
      },
      null,
      2,
    )}\n`,
  );
}

function writeWebSocketSummary(session) {
  fs.writeFileSync(
    session.summaryPath,
    `${JSON.stringify(
      {
        requestId: session.requestId,
        url: session.url,
        host: session.host,
        page: session.page,
        active: session.active,
        initiatedAt: session.createdAt,
        createdTimestamp: session.createdTimestamp,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        closeTimestamp: session.closeTimestamp,
        messageCount: session.messageCount,
        sentCount: session.sentCount,
        receivedCount: session.receivedCount,
        textCount: session.textCount,
        binaryCount: session.binaryCount,
        errorCount: session.errorCount,
        files: {
          session: path.basename(session.sessionPath),
          messages: path.basename(session.messagesPath),
          summary: path.basename(session.summaryPath),
        },
      },
      null,
      2,
    )}\n`,
  );
}

function opcodeName(opcode) {
  switch (opcode) {
    case 0:
      return "continuation";
    case 1:
      return "text";
    case 2:
      return "binary";
    case 8:
      return "close";
    case 9:
      return "ping";
    case 10:
      return "pong";
    default:
      return "unknown";
  }
}

function safeHost(urlString) {
  try {
    return new URL(urlString).host;
  } catch {
    return null;
  }
}

function safePathname(urlString) {
  try {
    return new URL(urlString).pathname;
  } catch {
    return null;
  }
}
