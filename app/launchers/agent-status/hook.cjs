const net = require('node:net');

const events = new Set([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreCompact',
  'PostCompact',
  'PreToolUse',
  'Notification',
  'Elicitation',
  'ElicitationResult',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
]);

const readPayload = new Set(['SessionStart', 'PreCompact', 'PostCompact', 'Notification', 'PostToolUse', 'PostToolUseFailure']);
const notificationKinds = new Set(['permission_prompt', 'idle_prompt', 'elicitation_dialog']);
const pipePrefix = '\\\\.\\pipe\\';
const maxInputBytes = 256 * 1024;

// Windows hands out a named pipe; macOS and Linux a Unix domain socket path.
function isStatusAddress(value) {
  if (typeof value !== 'string' || !value) return false;
  if (process.platform === 'win32') {
    return value.startsWith(pipePrefix)
      && /^[\w.-]{1,200}$/u.test(value.slice(pipePrefix.length));
  }
  return value.startsWith('/') && Buffer.byteLength(value) <= 100 && !value.includes('\u0000');
}

async function readHookInput(collect) {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (collect && total <= maxInputBytes) chunks.push(chunk);
  }
  if (!collect || !total || total > maxInputBytes) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

function sendReport(pipe, report) {
  return new Promise((resolve) => {
    const client = net.createConnection(pipe);
    client.once('error', error => {
      if (process.env.HERDR_STATUS_DEBUG === '1') console.error(`[Herdr status] Hook delivery failed (${error.code ?? error.message})`);
      client.destroy();
    });
    client.once('close', resolve);
    client.once('connect', () => {
      client.end(`${JSON.stringify(report)}\n`);
    });
  });
}

async function main() {
  const event = process.argv[2];
  const { HC_TERMINAL_ID: terminalId, HERDR_AGENT_STATUS_PIPE: pipe } = process.env;
  if (!terminalId || !events.has(event) || !isStatusAddress(pipe)) return;

  const timeout = setTimeout(() => process.exit(0), 900);
  try {
    const report = { event };
    const input = await readHookInput(readPayload.has(event));
    if (event === 'SessionStart' && input?.source === 'compact') report.source = 'compact';
    if ((event === 'PreCompact' || event === 'PostCompact') && (input?.trigger === 'manual' || input?.trigger === 'auto')) {
      report.trigger = input.trigger;
    }
    if (event === 'Notification') {
      if (!notificationKinds.has(input?.notification_type)) return;
      const asksQuestion = input.notification_type === 'permission_prompt'
        && input.message === 'needs your permission to use AskUserQuestion';
      report.kind = asksQuestion ? 'elicitation_dialog' : input.notification_type;
    }
    if ((event === 'PostToolUse' || event === 'PostToolUseFailure') && input?.tool_name === 'AskUserQuestion') {
      report.kind = 'question';
    }
    if (event === 'PostToolUseFailure' && input?.is_interrupt === true) {
      report.kind = 'interrupt';
    }
    await sendReport(pipe, report);
  } finally {
    clearTimeout(timeout);
  }
}

main().catch(() => {});
