const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const modPath = path.join(__dirname, '../app/mods/changes-safe/main.js');
const source = fs.readFileSync(modPath, 'utf8').replace(/^import .*;\n/gm, '').replace('export default class Changes', 'globalThis.Changes = class Changes');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-git-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (args, cwd = root) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  for (const args of [['init', '-q'], ['config', 'user.name', 'Test'], ['config', 'user.email', 'test@example.invalid']]) assert.equal(git(args).code, 0);
  fs.writeFileSync(path.join(root, 'staged.txt'), 'reviewed\n');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'other agent\n');
  assert.equal(git(['add', 'staged.txt']).code, 0);
  const env = { View: class {}, spaces: () => [{ active: true, folder: root }], panes: () => [], focused: () => null,
    exec: async (_command, args, { cwd }) => git(args, cwd), terminals: () => [], shared: () => false };
  vm.createContext(env);
  vm.runInContext(source, env);
  const view = Object.assign(new env.Changes(), { root, context: JSON.stringify({ cwd: root, on: null }), message: 'Reviewed', input: { set_value() {} }, refresh() {} });
  const tasks = [];
  const cx = { spawn(fn) { tasks.push(fn(cx)); }, notify() {} };
  const settle = () => Promise.all(tasks.splice(0));
  return { root, git, view, cx, settle };
}

test('the ordinary Commit action leaves an unrelated untracked file out of an initial commit', async t => {
  const { git, view, cx, settle } = fixture(t);
  view.commit(cx);
  await settle();
  assert.equal(git(['show', '--pretty=format:', '--name-only', 'HEAD']).stdout.trim(), 'staged.txt');
  assert.match(git(['status', '--short']).stdout, /^\?\? untracked.txt/m);
});

test('a rejecting hook leaves unrelated files untracked', async t => {
  const { root, git, view, cx, settle } = fixture(t);
  fs.writeFileSync(path.join(root, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  view.commit(cx);
  await settle();
  assert.match(view.note, /Commit failed/);
  assert.match(git(['status', '--short']).stdout, /^\?\? untracked.txt/m);
});

test('confirming all checks the reviewed list again before staging', async t => {
  const { git, view, cx, settle, root } = fixture(t);
  view.confirmAll = git(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']).stdout;
  fs.writeFileSync(path.join(root, 'later.txt'), 'new change');
  view.commit(cx, 'all');
  await settle();
  assert.match(view.note, /file list changed/);
  assert.equal(git(['diff', '--cached', '--name-only']).stdout.trim(), 'staged.txt');
});

test('confirming all stages exactly the reviewed literal paths', async t => {
  const { git, view, cx, settle, root } = fixture(t);
  const name = 'brackets[1].txt';
  fs.writeFileSync(path.join(root, name), 'literal path');
  view.confirmAll = git(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']).stdout;
  view.commit(cx, 'all');
  await settle();
  assert.equal(view.success, true, view.note);
  assert.deepEqual(git(['show', '--pretty=format:', '--name-only', 'HEAD']).stdout.trim().split('\n'), [name, 'staged.txt', 'untracked.txt']);
});

test('confirming all retains already staged deletions while staging other reviewed files', async t => {
  const { git, view, cx, settle } = fixture(t);
  assert.equal(git(['commit', '-m', 'Base']).code, 0);
  assert.equal(git(['rm', 'staged.txt']).code, 0);
  view.confirmAll = git(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']).stdout;
  view.commit(cx, 'all');
  await settle();
  assert.equal(view.success, true, view.note);
  assert.equal(git(['status', '--short']).stdout, '');
  assert.match(git(['show', '--name-status', '--format=', 'HEAD']).stdout, /^D\tstaged.txt/m);
});
