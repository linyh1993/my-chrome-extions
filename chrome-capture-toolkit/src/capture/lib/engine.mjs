import {
  buildAggregatePath,
  buildFilters,
  buildRouteFilePath,
  buildSplitTarget,
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
    splitTarget: buildSplitTarget(args, target.title, aggregatePath),
    splitWriters: new Map(),
    stopping: false,
  };
}

function wireNetworkEvents(cdp, state) {
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

  await Promise.all([
    ...(state.aggregateStream ? [closeWriter(state.aggregateStream)] : []),
    ...[...state.splitWriters.values()].map(closeWriter),
  ]);
  state.cdp.close();

  console.log(`Captured ${state.requestCount} requests.`);
  if (state.aggregatePath) {
    console.log(`Output: ${state.aggregatePath}`);
  }
  if (state.splitTarget.mode !== "none") {
    console.log(`${state.adapter?.shutdownLabel || "Split files"}: ${state.splitTarget.root}`);
  }
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
