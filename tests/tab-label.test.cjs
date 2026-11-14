const assert = require("node:assert/strict");
const { test } = require("node:test");
const { tabLabel } = require("../app/mods/tabs-with-folder-picker/tab-label.js");

const agent = { program: { name: "CodeBuddy Code", agent: true } };
const tab = { name: "1", named: false };
const home = "/home/user";

test("project tabs pair the agent name with the workspace name", () => {
  const space = { folder: "/projects/demo", name: "Demo", branch: "main" };
  const pane = { ...agent, cwd: "/projects/demo/subfolder", branch: "main" };
  assert.deepEqual(tabLabel(tab, space, pane, home), {
    label: "CodeBuddy Code", detail: "Demo", tooltip: "CodeBuddy Code · Demo · /projects/demo",
  });
  assert.equal(tabLabel({ name: "Review", named: true }, space, pane, home).label, "Review");
});

test("a Git workspace can be identified without a branch", () => {
  const space = { folder: "/projects/demo", name: "Demo" };
  assert.equal(tabLabel(tab, space, agent, home, [], true).detail, "Demo");
});

test("standalone sessions show just the native agent name", () => {
  const space = { folder: "/tmp/scratch", name: "scratch" };
  assert.deepEqual(tabLabel({ name: "Temporary", named: true }, space, agent, home), {
    label: "CodeBuddy Code", detail: null, tooltip: "CodeBuddy Code",
  });
  assert.equal(tabLabel(tab, { folder: home, name: "~", branch: "main" }, agent, home).detail, null);
});

test("an explicitly selected Windows folder can be a project without Git", () => {
  const space = { folder: "C:\\Projects\\Demo", name: "Demo" };
  assert.equal(tabLabel(tab, space, agent, "C:\\Home", ["c:/projects/demo/"]).detail, "Demo");
});

test("non-agent labels retain their names", () => {
  assert.equal(tabLabel({ name: "Logs", named: true }, null, { program: { name: "Shell" } }, home).label, "Logs");
});
