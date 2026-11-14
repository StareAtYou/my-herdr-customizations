import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { hc, readTextFile, spaces, theme, run, panes, window } from "herdr";

import { npmCommand } from "./npm-windows.js";

const presets = new Set(["dev", "test", "build"]);
const same = (left, right) => left?.id === right?.id && left?.folder === right?.folder && left?.machine === right?.machine;

function argvOf(value) {
  if (Array.isArray(value) && value.length && value.every(arg => typeof arg === "string" && !arg.includes("\0")) && value[0].trim()) {
    return value;
  }
  return null;
}

async function commands(space) {
  if (!space?.folder) return [];
  const read = path => readTextFile(space.folder + "/" + path, { on: space.machine });
  const config = await read(".herdr/tasks.json");
  if (config !== null) {
    const doc = JSON.parse(config);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("Expected named tasks in .herdr/tasks.json");
    return Object.entries(doc).slice(0, 30).map(([name, value]) => {
      const argv = argvOf(value);
      if (!argv || !name.trim()) throw new Error("Each task must be a named array of command arguments");
      return { name, argv };
    });
  }
  const pkg = await read("package.json");
  if (pkg === null) return [];
  return Object.keys(JSON.parse(pkg).scripts ?? {}).filter(name => presets.has(name))
    .map(name => ({ name, argv: ["npm", "run", name], npmPreset: true }));
}

export default class Tasks extends View {
  init(_props, cx) {
    this.space = spaces().find(space => space.active);
    this.runs = JSON.parse(localStorage.getItem("runs") ?? "[]");
    this.refresh(cx);
    cx.timer.every(2200, cx => this.refresh(cx));
  }

  save() {
    localStorage.setItem("runs", JSON.stringify(this.runs.slice(0, 50)));
  }

  refresh(cx) {
    const space = spaces().find(space => space.active);
    if (!same(this.space, space)) {
      this.commands = []; this.selected = null; this.logs = ""; this.problem = null;
      this.space = space;
    }
    if (!space?.folder || this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async cx => {
      try {
        const [list, terminalList] = await Promise.all([commands(space), hc(["ls", "--all", "--json"])]);
        if (!same(this.space, space)) return;
        this.commands = list;
        this.problem = null;
        if (terminalList.code !== 0) throw new Error("Could not read tasks from Core");
        this.live = new Map(JSON.parse(terminalList.stdout).terminals.map(term => [term.address, term]));
        const selected = this.selected;
        if (selected) {
          const result = await hc(["read", selected, "--lines", "35", "--json"]);
          if (this.selected === selected && same(this.space, space)) {
            this.logs = result.code === 0 ? JSON.parse(result.stdout).text?.slice(-14000) ?? "" : "Output unavailable";
          }
        }
      } catch (error) {
        if (same(this.space, space)) this.problem = String(error);
      } finally {
        this.refreshing = false; cx.notify();
      }
    });
  }

  launch(entry, cx) {
    const space = this.space;
    if (!space?.folder || this.starting) return;
    this.problem = null; this.starting = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const args = ["run", "--bg", "--no-parent", "--no-notify", "--json", "--cwd", space.folder];
        if (space.machine) args.push("--on", space.machine);
        const argv = entry.npmPreset && !space.machine && window()?.platform === "windows"
          ? npmCommand(entry.name)
          : entry.argv;
        const result = await hc([...args, "--", ...argv]);
        if (result.code !== 0) throw new Error(result.stderr.trim() || "Task could not start");
        const { address } = JSON.parse(result.stdout);
        if (!address) throw new Error("Core did not return a terminal");
        this.runs = [{ address, name: entry.name, space: space.id, launched: Date.now() }, ...this.runs].slice(0, 50);
        this.save();
        if (same(this.space, space)) { this.selected = address; this.logs = ""; }
      } catch (error) {
        if (same(this.space, space)) this.problem = String(error);
      } finally {
        this.starting = false; this.refresh(cx); cx.notify();
      }
    });
  }

  render(cx) {
    const t = theme(), button = (id, text, click, on = false) => div().id(id).px(8).py(5)
      .rounded(6).bg(on ? t.selected : t.surface).cursor_pointer().hover(s => s.bg(t.hover))
      .active(s => s.opacity(.8)).text_color(t.foreground).on_click(click).child(text);
    const rows = this.runs.filter(task => task.space === this.space?.id);
    return v_flex().size_full().min_h(0).gap(9).p(12).rounded(10).border_1().border_color(t.border)
      .bg(t.background).text_color(t.foreground).text_size(12)
      .child(div().font_semibold().text_size(14).child("Tasks and logs"))
      .child(h_flex().gap(6).flex_wrap().children((this.commands ?? []).map(task =>
        button("run-" + task.name, "Run " + task.name, (_e, cx) => this.launch(task, cx)))))
      .when(Boolean(this.problem), el => el.child(div().text_color(t.blocked).child(this.problem)))
      .when(!this.commands?.length && !this.problem, el => el.child(div().text_color(t.muted).child(
        this.space?.folder ? "Add .herdr/tasks.json or a dev, test, or build package script." : "Open a project folder to see its tasks.")))
      .child(v_flex().max_h(178).min_h(0).overflow_y_scroll().gap(4).children(rows.map(task => {
        const state = this.live?.get(task.address);
        const running = state?.state === "live";
        const status = running ? "Running" : state?.exit_code != null ? "Exit " + state.exit_code : "Unavailable";
        return h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).child(button("logs-" + task.address, task.name + " · " + status, (_e, cx) => {
            this.selected = task.address; this.logs = ""; this.refresh(cx); cx.notify();
          }, this.selected === task.address)))
          .when(running, el => el.child(button("open-" + task.address, "Terminal", () => {
            run(panes().some(pane => pane.terminal === task.address) ? "pane.focus" : "terminal.keep", { terminal: task.address });
          })));
      })))
      .when(Boolean(this.selected), el => el.child(div().id("task-log").flex_1().min_h(0).overflow_y_scroll()
        .p(8).rounded(6).bg(t.surface).font_family("JetBrains Mono").text_size(11).child(this.logs || "Waiting for output…")));
  }
}
