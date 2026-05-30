export async function fetchTargets(baseUrl) {
  const response = await fetch(`${baseUrl}/json/list`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return data.filter((target) => target.type === "page");
}

export function listTargets(targets) {
  if (!targets.length) {
    console.log("No page targets found.");
    return;
  }

  targets.forEach((target, index) => {
    console.log(`id: ${target.id}`);
    console.log(`index: ${index + 1}`);
    console.log(`title: ${target.title || "(no title)"}`);
    console.log(`url: ${target.url}`);
    console.log("");
  });
}

export function pickTarget(targets, args) {
  if (args.targetId) {
    return targets.find((target) => target.id === args.targetId);
  }
  if (args.hostContains) {
    const needle = String(args.hostContains).toLowerCase();
    return targets.find((target) => {
      try {
        return new URL(target.url).host.toLowerCase().includes(needle);
      } catch {
        return false;
      }
    });
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
    "More than one tab is available. Use --list and then pass --target-id, --host-contains, --url-contains, or --title-contains.",
  );
}

export function createCDP(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let seq = 1;
  const pending = new Map();
  const listeners = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id);
      if (!task) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        task.reject(new Error(`${task.method}: ${message.error.message}`));
      } else {
        task.resolve(message.result);
      }
      return;
    }

    const handlers = listeners.get(message.method) || [];
    for (const handler of handlers) {
      handler(message.params || {});
    }
  });

  socket.addEventListener("close", () => {
    for (const task of pending.values()) {
      task.reject(new Error(`WebSocket closed before "${task.method}" completed.`));
    }
    pending.clear();
  });

  return {
    async open() {
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
    },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = seq++;
        pending.set(id, { method, resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, handler) {
      const handlers = listeners.get(method) || [];
      handlers.push(handler);
      listeners.set(method, handlers);
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };
}
