// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Input, InputState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, shared } from "herdr";

import { unixDirectory } from "./directory-unix.js";
import { windowsDirectory } from "./directory-windows.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
const generated = new Set(["node_modules", "dist", "build", "coverage", "test-results", ".next", "__pycache__", ".venv"]);
const normalizedPath = path => {
  const normalized = path.replace(/\/$/, "");
  return /^(?:[A-Za-z]:|\\\\)/.test(path) ? normalized.replace(/\\/g, "/").replace(/\/$/, "") : normalized;
};
const hiddenPath = path => path.split("/").some(part => generated.has(part));

async function directory(path, on) {
  if (!on && window()?.platform === "windows") return windowsDirectory(path, on);
  try { return await unixDirectory(path, on); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory(path, on);
    throw e;
  }
}

export default class Files extends View {
  init(_props, cx) {
    this.panelOpening = undefined;
    this.panelReady = false;
    this.saved = new Map();
    this.search = InputState.new({ placeholder: "Find a file…" });
    this.search.on("change", (_e, cx) => cx.notify());
    this.modifiedOnly = false;
    this.hideGenerated = true;
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false; this.inventory = null; this.search.set_value("");
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        let inventory = null;
        if (top?.code === 0) {
          const list = await exec("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."], { cwd, on }).catch(() => null);
          if (list?.code === 0) inventory = [...new Set(list.stdout.split("\0").filter(Boolean))].slice(0, TOTAL);
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${normalizedPath(top.stdout.trim())}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.inventory = inventory; this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${normalizedPath(this.root)}/${path}`];
      if (this.hideGenerated && hiddenPath(path)) continue;
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover)).active(s => s.opacity(0.78))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  results(t, query) {
    const inventory = this.inventory ?? [...this.entries].flatMap(([folder, entries]) =>
      entries.filter(entry => !entry.dir).map(entry => folder ? folder + "/" + entry.name : entry.name));
    const prefix = normalizedPath(this.root ?? "") + "/";
    const changed = Object.keys(this.marks).filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length));
    const candidates = this.modifiedOnly ? changed : [...new Set([...inventory, ...changed])];
    return candidates.filter(path => (!this.hideGenerated || !hiddenPath(path)) && path.toLowerCase().includes(query))
      .slice(0, 200).map(path => h_flex().id("result-" + path).h(28).flex_none().px(8).items_center().gap(8)
        .rounded(5).cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => this.show(path, cx))
        .child(svg("mods/files/file.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().tooltip(path).child(path))
        .when(Boolean(this.marks[prefix + path]), el => el.child(div().text_color(t.blocked).child(this.marks[prefix + path]))));
  }

  render(cx) {
    const opening = shared("workspace.panel-opening");
    if (opening?.panel === "files" && opening.at !== this.panelOpening) {
      const stamp = opening.at;
      this.panelOpening = stamp;
      this.panelReady = Boolean(shared("workspace.reduce-motion"));
      if (!this.panelReady) cx.timer.after(30, cx => {
        if (this.panelOpening === stamp) { this.panelReady = true; cx.notify(); }
      });
    }
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), query = this.search.value().trim().toLowerCase();
    const searching = Boolean(query || this.modifiedOnly);
    const results = searching ? this.results(t, query) : this.rows("", 0, [], t);
    const toggle = (id, label, active, click) => div().id(id).px(6).py(4).rounded(5).flex_none()
      .text_size(10).text_color(active ? t.accent : t.muted).cursor_pointer()
      .hover(s => s.bg(t.hover)).on_click(click).child(label);
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .opacity(this.panelReady || !this.panelOpening || shared("workspace.reduce-motion") ? 1 : 0.45)
      .when(!shared("workspace.reduce-motion"), el => el.transition("opacity", { duration: 150, easing: "ease-out" })).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .when(!this.file, el => el.child(h_flex().h(37).px(8).gap(4).flex_none().items_center()
        .child(Input.new(this.search).flex_1().min_w(0).h(26).px(7).rounded(5).bg(t.surface).text_color(t.foreground))
        .child(toggle("only-changed", "Changed", this.modifiedOnly, (_e, cx) => { this.modifiedOnly = !this.modifiedOnly; cx.notify(); }))
        .child(toggle("hide-generated", this.hideGenerated ? "Show build files" : "Hide build files", false, (_e, cx) => { this.hideGenerated = !this.hideGenerated; cx.notify(); }))))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(results)
        .when(Boolean(this.error) || !results.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : searching ? "No matching files" : this.root ? "No files" : "No folder"))))
        .when(searching && Boolean(query) && this.inventory === null && !this.loading, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("Search covers loaded folders")))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
