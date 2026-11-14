const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');

const launcher = path.resolve(__dirname, '../app/launchers/agent-status');
const replay = path.join(__dirname, 'replay-codebuddy-hooks.cjs');

function reports(events) {
  const child = spawnSync(process.execPath, [path.join(launcher, 'bridge.cjs'), 'codebuddy-code', process.execPath, replay,
    path.join(launcher, 'hook.cjs'), JSON.stringify(events)], {
    env: { ...process.env, HC_TERMINAL_ID: 'test', HERDR_STATUS_DEBUG: '0' }, encoding: 'utf8', timeout: 7000,
  });
  assert.equal(child.status, 0, child.stderr || String(child.error ?? ''));
  return [...child.stdout.matchAll(/\x1b\]7501;(.*?)\x1b\\/g)].map(match => {
    const fields = Object.fromEntries(match[1].split(':').map(field => field.split(/=(.*)/s).slice(0, 2)));
    return fields.msg ? `${fields.state}: ${Buffer.from(fields.msg, 'base64').toString()}` : fields.state;
  });
}

test('automatic compaction stays busy and resumes working without a user prompt', () => {
  assert.deepEqual(reports([['SessionStart', { source: 'startup' }], ['UserPromptSubmit'], ['PreCompact', { trigger: 'auto' }],
    ['Notification', { notification_type: 'idle_prompt' }], ['PreToolUse'], ['PostCompact', { trigger: 'auto' }],
    ['SessionStart', { source: 'compact' }], ['Stop']]),
  ['idle', 'working', 'working: Compacting context', 'working', 'done', 'clear']);
});

test('manual compaction returns to idle and the next turn goes back to working', () => {
  assert.deepEqual(reports([['SessionStart', { source: 'startup' }], ['PreCompact', { trigger: 'manual' }],
    ['PostCompact', { trigger: 'manual' }], ['SessionStart', { source: 'compact' }], ['Stop'],
    ['UserPromptSubmit'], ['Stop']]),
  ['idle', 'working: Compacting context', 'idle', 'working', 'done', 'clear']);
});

test('an automatically continued tool call recovers a stale idle report', () => {
  assert.deepEqual(reports([['UserPromptSubmit'], ['Notification', { notification_type: 'idle_prompt' }], ['PreToolUse'], ['Stop']]),
    ['working', 'idle', 'working', 'done', 'clear']);
});

test('a failed compaction clears its activity and can start another turn', () => {
  assert.deepEqual(reports([['UserPromptSubmit'], ['PreCompact', { trigger: 'auto' }], ['StopFailure'],
    ['UserPromptSubmit'], ['Stop']]), ['working', 'working: Compacting context', 'error', 'working', 'done', 'clear']);
});

test('a compact session start can finish compaction for clients omitting PostCompact', () => {
  assert.deepEqual(reports([['UserPromptSubmit'], ['PreCompact', { trigger: 'auto' }], ['SessionStart', { source: 'compact' }],
    ['Notification', { notification_type: 'permission_prompt' }], ['PreToolUse'], ['PostToolUse'], ['Stop']]),
  ['working', 'working: Compacting context', 'working', 'blocked', 'working', 'done', 'clear']);
});
