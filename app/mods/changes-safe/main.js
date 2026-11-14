import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, shared } from "herdr";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  if (space?.ssh) return { ssh: true, space: space.id };
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
const statusEntries = raw => raw.split("\0").filter(Boolean);
const samePaths = (a, b) => JSON.stringify(a.toSorted()) === JSON.stringify(b.toSorted());
const conflicts = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const isStaged = xy => /^[MADRCT]/.test(xy) && !conflicts.has(xy);
const pendingPaths = (raw, mode) => statusEntries(raw).filter(entry => mode === "all" || isStaged(entry.slice(0, 2)))
  .map(entry => entry.slice(3));
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Changes extends View {
  init(_props, cx) {
    this.panelOpening = undefined;
    this.panelReady = false;
    this.files = []; this.rows = []; this.staged = []; this.preview = "staged"; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.filter = InputState.new({ placeholder: "Filter changed files…" });
    this.filter.on("change", (_e, cx) => cx.notify());
    this.grouped = true;
    this.expanded = false;
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => { if (!this.confirmAll && this.staged.length) this.commit(cx); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null;
      this.expanded = false; this.filter.set_value("");
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.confirmAll = null; this.staged = []; this.rawStatus = ""; this.branch = ""; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const [head, branch] = await Promise.all([
          git(["rev-parse", "--verify", "HEAD"]), git(["symbolic-ref", "--quiet", "--short", "HEAD"]),
        ]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = conflicts.has(xy);
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, staged: isStaged(xy), ...stat });
        }
        if (key() !== context) return;
        if (this.rawStatus !== status.stdout) this.confirmAll = null;
        this.rawStatus = status.stdout;
        this.staged = pendingPaths(status.stdout, "staged");
        this.branch = branch.code === 0 ? branch.stdout.trim() : `Detached ${head.stdout.trim().slice(0, 8)}`;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.expanded = false; this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && files.length) this.open = (files.find(f => f.staged) ?? files[0]).path;
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    const staged = file.staged && this.preview === "staged";
    if (!staged && (file.fresh || (!this.hasHead && file.status === "A"))) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "--literal-pathspecs", "diff", ...(staged ? ["--cached"] : this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path && staged === (file.staged && this.preview === "staged")) this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...this.rows.map(row => (row.text.length + 1) * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]);
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx, mode = "staged") {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    const expected = mode === "all" ? this.confirmAll : this.rawStatus;
    if (mode === "all" && !expected) return;
    this.confirmAll = null;
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      const git = async args => {
        const result = await exec("git", args, { cwd: root, on });
        if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim());
        return result.stdout;
      };
      let added = false;
      try {
        const raw = await git([...READ, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        const paths = pendingPaths(raw, mode);
        if (statusEntries(raw).some(entry => conflicts.has(entry.slice(0, 2)))) throw new Error("Resolve merge conflicts before committing.");
        if (!paths.length) throw new Error("No staged files. Stage the files you want to commit first.");
        if (expected !== undefined && (mode === "all" ? expected !== raw : !samePaths(pendingPaths(expected, mode), paths))) {
          throw new Error("The file list changed. Review the updated selection before committing.");
        }
        if (this.branch) {
          const branch = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => null);
          const current = branch?.trim() ?? `Detached ${(await git(["rev-parse", "HEAD"])).trim().slice(0, 8)}`;
          if (current !== this.branch) throw new Error("The branch changed. Review the repository before committing.");
        }
        if (mode === "all") {
          // Treat names shown in the confirmation as literal paths, including brackets and colons.
          // Using an explicit list also excludes new files created by another terminal after review.
          const unstaged = statusEntries(raw).filter(entry => entry[1] !== " ").map(entry => entry.slice(3));
          const batchSize = 128;
          for (let i = 0; i < unstaged.length; i += batchSize) {
            added = true;
            await git(["--literal-pathspecs", "add", "-A", "--", ...unstaged.slice(i, i + batchSize)]);
          }
          const staged = await git([...READ, "diff", "--cached", "--no-renames", "--name-only", "-z"]);
          if (!samePaths(staged.split("\0").filter(Boolean), paths)) {
            throw new Error("The staged file list changed. Review the staged files before continuing.");
          }
        }
        await git(["commit", "-m", message]);
        if (key() === context) {
          this.message = ""; this.input.set_value("");
          this.note = `Committed ${paths.length} ${paths.length === 1 ? "file" : "files"}.`;
          this.success = true;
        }
      } catch (e) {
        if (key() === context) {
          this.success = false;
          this.note = `Commit failed: ${e.message}${added ? " Review the current staged files before retrying." : ""}`;
        }
      } finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  scope(t, enabled, cx) {
    const all = this.confirmAll !== null && this.confirmAll !== undefined;
    const paths = all ? pendingPaths(this.confirmAll, "all") : this.staged;
    const label = all ? "Confirm all files" : "Commit staged";
    const button = (id, title, callback, available = true) => div().id(id).h(30).px(10).flex().items_center()
      .rounded(7).text_size(11).text_color(available ? t.foreground : t.dim)
      .when(available, el => el.cursor_pointer().hover(s => s.bg(t.hover)).active(s => s.opacity(0.75)).on_click(callback))
      .child(title);
    return v_flex().flex_none().gap(5).p(9).border_t(1).border_color(t.border)
      .child(div().text_size(11).text_color(t.muted).truncate().tooltip(this.root ?? "No repository")
        .child(this.root ? `${this.root.split("/").at(-1)} · ${this.branch} · ${paths.length} ${all ? "to stage" : "staged"}` : "No repository"))
      .when(paths.length > 0, el => el.child(v_flex().id("commit-scope").max_h(64).overflow_y_scrollbar()
        .children(paths.map(path => div().h(18).flex_none().text_size(11).text_color(t.muted).truncate().tooltip(path).child(path)))))
      .child(h_flex().gap(5).items_center()
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(9).flex().items_center().rounded(7).border_1()
          .border_color(this.typing ? t.accent : t.border).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(button("commit", this.busy ? "Committing…" : label, () => this.commit(cx, all ? "all" : "staged"), enabled && paths.length > 0)))
      .child(button("commit-scope-toggle", all ? "Cancel all-files commit" : "Stage all and commit…", () => {
        this.confirmAll = all ? null : this.rawStatus;
        cx.notify();
      }, all || (enabled && this.files.length > 0)));
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  render(cx) {
    const opening = shared("workspace.panel-opening");
    if (opening?.panel === "changes" && opening.at !== this.panelOpening) {
      const stamp = opening.at;
      this.panelOpening = stamp;
      this.panelReady = Boolean(shared("workspace.reduce-motion"));
      if (!this.panelReady) cx.timer.after(30, cx => {
        if (this.panelOpening === stamp) { this.panelReady = true; cx.notify(); }
      });
    }
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    const opened = this.files.find(file => file.path === this.open);
    const query = this.filter.value().trim().toLowerCase();
    const visible = this.files.filter(file => file.path.toLowerCase().includes(query));
    const group = (label, files) => files.length ? [{ label, key: label }, ...files] : [];
    const entries = this.grouped ? [
      ...group("Staged", visible.filter(file => file.staged)),
      ...group("Unstaged and untracked", visible.filter(file => !file.staged)),
    ] : visible;
    const button = (id, text, action) => div().id(id).px(7).py(4).rounded(5).cursor_pointer()
      .text_size(11).text_color(t.accent).hover(style => style.bg(t.hover)).on_click(action).child(text);
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .opacity(this.panelReady || !this.panelOpening || shared("workspace.reduce-motion") ? 1 : 0.45)
      .when(!shared("workspace.reduce-motion"), el => el.transition("opacity", { duration: 150, easing: "ease-out" })).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.expanded) { this.expanded = false; cx.stop_propagation(); cx.notify(); }
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .when(!this.expanded, el => el.child(h_flex().h(37).px(9).gap(6).items_center().flex_none()
        .child(Input.new(this.filter).flex_1().min_w(0).h(27).px(7).rounded(5).bg(t.surface).text_color(t.foreground))
        .child(button("changes-group", this.grouped ? "Ungroup" : "Group", (_e, cx) => { this.grouped = !this.grouped; cx.notify(); }))))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .when(!this.expanded, el => el.child(div().flex_1().min_h(44).max_h(entries.length * 28 + 12).relative().border_b(1).border_color(t.border)
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(entries.map((f) => {
        if (f.label) return div().id("group-" + f.key).px(8).h(24).flex_none().text_size(11).font_semibold().text_color(t.muted).child(f.label);
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().active(s => s.opacity(0.8)).when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
          .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.staged, e => e.child(div().text_size(10).text_color(t.accent).child("Staged")))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      })).when(!visible.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (location().ssh ? "Use Git in the project terminal for SSH changes." : this.loading ? "Loading changes…" : query ? "No matching files" : this.root ? "No uncommitted changes" : "No folder")))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0())))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .when(Boolean(opened), el => el.child(h_flex().id("diff-mode").h(26).px(10).gap(9).flex_none().items_center().text_size(11)
        .child(div().text_color(t.muted).child(opened.staged && this.preview === "staged" ? "Staged diff" : "All changes to file"))
        .when(opened.staged, bar => bar.child(div().id("toggle-diff").cursor_pointer().text_color(t.accent).on_click(() => {
          this.preview = this.preview === "staged" ? "all" : "staged";
          const context = this.context, preview = this.preview;
          this.setLines([]); cx.spawn(async cx => {
            try { await this.load(opened.path, context); }
            catch { if (key() === context && this.open === opened.path && this.preview === preview) this.setLines(["Cannot preview this diff"]); }
            cx.notify();
          }); cx.notify();
        }).child(opened.staged && this.preview === "staged" ? "Show all" : "Show staged")))
        .child(div().flex_1())
        .child(button("expand-diff", this.expanded ? "Back to list" : "Expand diff", (_e, cx) => { this.expanded = !this.expanded; this.handle.focus(); cx.notify(); }))))
      .child(div().id("changes-preview").flex_1().min_h(0).relative().opacity(this.open ? 1 : 0.55)
        .when(!shared("workspace.reduce-motion"), el => el.transition("opacity", { duration: 140, easing: "ease-out" })).font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes"))))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(5).text_size(11).text_color(this.success ? t.ansi2 : t.ansi1).child(this.note)))
      .when(!this.expanded, el => el.child(this.scope(t, enabled, cx)));
  }
}
