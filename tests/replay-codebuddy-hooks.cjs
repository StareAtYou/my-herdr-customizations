const { spawnSync } = require('node:child_process');
const [hook, events] = process.argv.slice(2);
for (const [event, input = {}] of JSON.parse(events)) {
  const result = spawnSync(process.execPath, [hook, event], { input: JSON.stringify(input), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `Hook failed: ${event}`);
}
