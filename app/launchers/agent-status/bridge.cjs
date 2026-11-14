const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { createServer } = require("node:net");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");

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
  let compacting = false;
  let manualCompact = false;
  const compactMessage = "Compacting context";

  function report(state, kind, title, message) {
    kind = state === "blocked" && kinds.has(kind) ? kind : undefined;
    title = safeTitle(title);
    if (current.state === state && current.kind === kind && current.title === title && current.message === message) return;
    current = { state, kind, title, message };
    if (process.env.HERDR_STATUS_DEBUG === "1") {
      console.error(`[Herdr status] ${new Date().toISOString()} ${app}: ${state}${kind ? ` (${kind})` : ""}`);
    }

    const fields = ["state=" + state];
    if (state !== "clear") {
      fields.push("app=" + app);
      if (kind) fields.push("kind=" + kind);
      if (title) fields.push("title=" + Buffer.from(title, "utf8").toString("base64"));
      if (message) fields.push("msg=" + Buffer.from(message, "utf8").toString("base64"));
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
        if (value.source === "compact") {
          // CodeBuddy emits this before continuing an automatic turn or resetting a manual one.
          compacting = false;
          if (current.state !== "blocked") report(manualCompact ? "idle" : "working");
        } else {
          compacting = false;
          manualCompact = false;
          if (!["working", "blocked"].includes(current.state) || current.message === compactMessage) report("idle");
        }
        break;
      case "UserPromptSubmit":
        compacting = false;
        manualCompact = false;
        report("working");
        break;
      case "PreCompact":
        compacting = true;
        manualCompact = value.trigger === "manual";
        report("working", undefined, undefined, compactMessage);
        break;
      case "PostCompact":
        compacting = false;
        if (value.trigger) manualCompact = value.trigger === "manual";
        if (current.state !== "blocked") report(manualCompact ? "idle" : "working");
        break;
      case "PreToolUse":
        if (!compacting && current.state !== "blocked") {
          manualCompact = false;
          report("working");
        }
        break;
      case "Elicitation": report("blocked", "question"); break;
      case "ElicitationResult":
        if (current.kind === "question") report("working", undefined, undefined, compacting ? compactMessage : undefined);
        break;
      case "Notification":
        if (value.kind === "permission_prompt") report("blocked", "permission");
        if (value.kind === "elicitation_dialog") report("blocked", "question");
        if (value.kind === "idle_prompt" && !compacting && current.state === "working") report("idle");
        break;
      case "PostToolUse":
      case "PostToolUseFailure":
        if (value.kind === "interrupt" && ["working", "blocked"].includes(current.state)) {
          compacting = false;
          manualCompact = false;
          report("idle");
        } else if (current.kind === "permission" || (current.kind === "question" && value.kind === "question")) {
          report("working", undefined, undefined, compacting ? compactMessage : undefined);
        }
        break;
      case "Stop":
        compacting = false;
        report(manualCompact ? "idle" : "done");
        break;
      case "StopFailure":
        compacting = false;
        manualCompact = false;
        report("error");
        break;
      case "SessionEnd":
        compacting = false;
        manualCompact = false;
        report("clear");
        break;
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
  // Keep the Unix address short for macOS, inside a private directory.
  const windows = process.platform === "win32";
  let relay;
  let socketDir;
  if (env.HC_TERMINAL_ID) {
    try {
      if (!windows) socketDir = mkdtempSync("/tmp/herdr-agent-");
      const address = windows ? "\\\\.\\pipe\\herdr-agent-" + randomUUID() : join(socketDir, "relay.sock");
      relay = createRelay(reporter.receive);
      await new Promise((resolve, reject) => {
        relay.server.once("error", reject);
        relay.server.listen(address, resolve);
      });
      env.HERDR_AGENT_STATUS_PIPE = address;
    } catch (error) {
      console.error(`[Herdr status] Relay unavailable (${error.code ?? error.message}). The terminal can still run.`);
    }
  }

  // The interactive child handles console interrupt keys.
  const ignoreInterrupt = () => {};
  process.on("SIGINT", ignoreInterrupt);
  try {
    return await runChild(program, args, env);
  } finally {
    relay?.close();
    if (socketDir) {
      try { rmSync(socketDir, { recursive: true, force: true }); } catch {}
    }
    reporter.clear();
    process.off("SIGINT", ignoreInterrupt);
  }
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
