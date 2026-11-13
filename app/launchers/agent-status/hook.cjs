const net = require('node:net');

const events = new Set([
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Notification',
  'Elicitation',
  'ElicitationResult',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
]);

const notificationKinds = new Set(['permission_prompt', 'idle_prompt', 'elicitation_dialog']);
const pipePrefix = '\\\\.\\pipe\\';
const maxInputBytes = 256 * 1024;

async function readHookInput(collect) {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (collect && total <= maxInputBytes) chunks.push(chunk);
  }
  if (!collect || total > maxInputBytes) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendReport(pipe, report) {
  return new Promise((resolve) => {
    const client = net.createConnection(pipe);
    client.once('error', () => client.destroy());
    client.once('close', resolve);
    client.once('connect', () => {
      client.end(`${JSON.stringify(report)}\n`);
    });
  });
}

async function main() {
  const event = process.argv[2];
  const { HC_TERMINAL_ID: terminalId, HERDR_AGENT_STATUS_PIPE: pipe } = process.env;
  if (!terminalId || !events.has(event) || !pipe?.startsWith(pipePrefix)) return;
  if (!/^[\w.-]{1,200}$/u.test(pipe.slice(pipePrefix.length))) return;

  const timeout = setTimeout(() => process.exit(0), 900);
  try {
    const report = { event };
    const input = await readHookInput(event === 'Notification' || event === 'PostToolUse' || event === 'PostToolUseFailure');
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
