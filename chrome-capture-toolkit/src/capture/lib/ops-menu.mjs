import path from "node:path";

import { normalizeMenuContext } from "./core.mjs";
import { MENU_EXPRESSION } from "./record-utils.mjs";

export function createOpsMenuAdapter() {
  return {
    startupLabel: "Menu root",
    shutdownLabel: "Menu root",
    createState(args, target) {
      const fallbackName = args.sessionName || target.title || "untitled-page";
      return {
        currentContext: normalizeMenuContext(
          { groupName: args.menuGroup, menuName: args.menuName || args.sessionName },
          fallbackName,
        ),
        currentMeta: {
          source: args.autoMenu ? "fallback" : "manual",
          title: target.title || "",
          url: target.url,
        },
      };
    },
    async initialize(state) {
      if (state.args.autoMenu) {
        await refreshMenu(state, "initial");
      }
    },
    async start(state) {
      if (!state.args.autoMenu) {
        return () => {};
      }

      const timer = setInterval(() => {
        refreshMenu(state, "poll").catch(() => {});
      }, state.args.menuPollMs);

      for (const eventName of ["Page.frameNavigated", "Page.navigatedWithinDocument", "Page.loadEventFired"]) {
        state.cdp.on(eventName, () => {
          refreshMenu(state, eventName).catch(() => {});
        });
      }

      return () => clearInterval(timer);
    },
    captureContext(state) {
      return {
        menuContext: state.adapterState.currentContext,
        menuSource: state.adapterState.currentMeta,
      };
    },
    decorateRecord(record, state) {
      const snapshot = record.contextSnapshot || {};
      const context = normalizeMenuContext(snapshot.menuContext, state.fallbackName);
      record.menuContext = context;
      record.menuSource = snapshot.menuSource || state.adapterState.currentMeta;
      delete record.contextSnapshot;
    },
    resolveRouteRoot(state, record) {
      const context = record.menuContext || state.adapterState.currentContext;
      return path.join(state.splitTarget.root, context.groupName, context.menuName);
    },
    startupLines(state) {
      const current = state.adapterState.currentContext;
      return [`Current menu: ${current.groupName} / ${current.menuName}`];
    },
  };
}

async function refreshMenu(state, reason) {
  try {
    const result = await state.cdp.send("Runtime.evaluate", {
      expression: MENU_EXPRESSION,
      returnByValue: true,
      awaitPromise: true,
    });
    const value = result.result?.value || {};
    const next = normalizeMenuContext(value, state.fallbackName);
    const current = state.adapterState.currentContext;
    const changed = next.groupName !== current.groupName || next.menuName !== current.menuName;

    state.adapterState.currentContext = next;
    state.adapterState.currentMeta = {
      source: value.source || reason,
      title: value.title || "",
      url: value.url || "",
    };

    if (changed) {
      console.log(`Menu switched: ${next.groupName} / ${next.menuName} (${state.adapterState.currentMeta.source})`);
    }
  } catch (error) {
    console.error(`Menu detection failed (${reason}): ${error.message}`);
  }
}
