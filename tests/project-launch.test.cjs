const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function load(mod, env) {
  const file = path.join(__dirname, "../app/mods", mod, "main.js");
  const source = fs.readFileSync(file, "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace(/^export (?=function )/gm, "")
    .replace(/export default class (\w+)/, "globalThis.Mod = class $1");
  return vm.runInNewContext(source + "\nnew Mod()", { View: class {}, ...env });
}

test("right-click passes the clicked project's ID to the launcher", () => {
  let popup;
  const sidebar = load("spaces-with-folder-picker", { openOverlay: spec => { popup = spec; } });
  sidebar.menu({ id: "clicked" });
  assert.equal(popup.mod, "new-menu-with-folder-picker");
  assert.equal(popup.props.project, "clicked");
});

for (const ssh of [false, true]) {
  test(`project launcher routes terminal and Agent to the clicked ${ssh ? "SSH" : "local"} project`, () => {
    const clicks = new Map();
    const widget = () => {
      let id;
      const element = new Proxy({}, {
        get(_target, key) {
          if (key === "id") return value => { id = value; return element; };
          if (key === "when") return (condition, render) => condition ? render(element) : element;
          if (key === "on_click") return click => { if (id) clicks.set(id, click); return element; };
          return () => element;
        },
      });
      return element;
    };
    const agent = { key: "codex", name: "Codex", installed: true, run: ["codex"] };
    const target = { id: "clicked", folder: "/project/root", name: "Project" };
    if (ssh) target.ssh = { host: "example", folder: "/srv/project" };
    const actions = [];
    const launcher = load("new-menu-with-folder-picker", {
      div: widget, h_flex: widget, v_flex: widget, svg: widget, image: widget,
      props: () => ({ project: target.id, overlay: "menu" }),
      spaces: () => [{ id: "active", active: true, folder: "/different" }, target],
      keys: () => [], window: () => null, theme: () => ({}),
      shared: key => key === "workspace.reduce-motion" ? true : { "": [agent] },
      api: { sshAgents: () => [agent] }, closeOverlay: () => {},
      ScrollHandle: { new: () => ({}) }, run: (name, args) => actions.push([name, args]),
    });
    launcher.probe = () => {};
    launcher.init(null, { focus_handle: () => ({ focus() {} }) });
    launcher.render();
    clicks.get("terminal")(null, {});
    clicks.get("agent-codex")(null, {});
    const base = ssh ? { space: "clicked" } : { space: "clicked", folder: "/project/root" };
    assert.deepEqual(JSON.parse(JSON.stringify(actions)), [
      ["tab.new", base],
      ["tab.new", { ...base, name: "Codex", ...(ssh ? { agent: "codex" } : { argv: ["codex"] }) }],
    ]);
  });
}
