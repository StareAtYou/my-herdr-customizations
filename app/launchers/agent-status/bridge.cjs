const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { createServer } = require("node:net");

const states = new Set(["idle", "working", "blocked", "done", "error", "clear"]);
const kinds = new Set(["permission", "question", "auth"]);

function safeTitle(value) {
  if (typeof value !== "string") return undefined;
  let result = "";
  let length = 0;
  for (const character of value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "")) {
    length += Buffer.byteLength(character);
    if (length > 192) break;
    result += character;
  }
  return result || undefined;
}

function createReporter(app) {
  let current = {};
  function report(state, kind, title) {
    kind = state === "blocked" && kinds.has(kind) ? kind : undefined;
    title = safeTitle(title);
    if (current.state === state && current.kind === kind && current.title === title) return;
    current = { state, kind, title };

    const fields = ["state=" + state];
    if (state !== "clear") {
      fields.push("app=" + app);
      if (kind) fields.push("kind=" + kind);
      if (title) fields.push("title=" + Buffer.from(title, "utf8").toString("base64"));
    }
    process.stdout.write("\x1b]7501;" + fields.join(":") + "\x1b\\");
  }

  function receive(value) {
    if (!value || typeof value !== "object") return;
    if (states.has(value.state)) {
      report(value.state, value.kind, value.title);
      return;
    }

    switch (value.event) {
      case "SessionStart":
        if (!["working", "blocked"].includes(current.state)) report("idle");
        break;
      case "UserPromptSubmit": report("working"); break;
      case "Elicitation": report("blocked", "question"); break;
      case "ElicitationResult":
        if (current.kind === "question") report("working");
        break;
      case "Notification":
        if (value.kind === "permission_prompt") report("blocked", "permission");
        if (value.kind === "elicitation_dialog") report("blocked", "question");
        if (value.kind === "idle_prompt" && ["working", "blocked"].includes(current.state)) report("idle");
        break;
      case "PostToolUse":
      case "PostToolUseFailure":
        if (value.kind === "interrupt" && ["working", "blocked"].includes(current.state)) {
          report("idle");
        } else if (current.kind === "permission" || (current.kind === "question" && value.kind === "question")) {
          report("working");
        }
        break;
      case "Stop": report("done"); break;
      case "StopFailure": report("error"); break;
      case "SessionEnd": report("clear"); break;
    }
  }

  return {
    receive,
    clear() {
      if (current.state && current.state !== "clear") report("clear");
    },
  };
}

function createRelay(receive) {
  const sockets = new Set();
  let closed = false;
  const server = createServer(socket => {
    if (closed) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    let data = "";
    socket.setEncoding("utf8");
    socket.setTimeout(1500, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", chunk => {
      data += chunk;
      if (data.length > 4096) socket.destroy();
    });
    socket.on("end", () => {
      if (closed) return;
      let event;
      try { event = JSON.parse(data); } catch { return; }
      receive(event);
    });
  });

  return {
    server,
    close() {
      closed = true;
      if (server.listening) server.close();
      for (const socket of sockets) socket.destroy();
    },
  };
}

function runChild(program, args, env) {
  return new Promise(resolve => {
    const child = spawn(program, args, { stdio: "inherit", env });
    child.once("error", error => {
      console.error("Could not start " + program + ": " + error.message);
      resolve(1);
    });
    child.once("close", (code, signal) => resolve(code ?? (signal === "SIGINT" ? 130 : 1)));
  });
}

async function main([app, program, ...args]) {
  if (!program || !/^[a-z0-9][a-z0-9_.-]{0,31}$/.test(app)) {
    console.error("Usage: node bridge.cjs <app-id> <executable> [arguments...]");
    return 2;
  }

  const env = { ...process.env };
  delete env.HERDR_AGENT_STATUS_PIPE;
  const reporter = createReporter(app);
  let relay;
  if (process.platform === "win32" && env.HC_TERMINAL_ID) {
    const address = "\\\\.\\pipe\\herdr-agent-" + randomUUID();
    relay = createRelay(reporter.receive);
    const listening = await new Promise(resolve => {
      relay.server.on("error", () => resolve(false));
      relay.server.listen(address, () => resolve(true));
    });
    if (listening) env.HERDR_AGENT_STATUS_PIPE = address;
  }

  // The interactive child handles console interrupt keys.
  const ignoreInterrupt = () => {};
  process.on("SIGINT", ignoreInterrupt);
  try {
    return await runChild(program, args, env);
  } finally {
    relay?.close();
    reporter.clear();
    process.off("SIGINT", ignoreInterrupt);
  }
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
