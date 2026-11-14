import { View, div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import * as api from "herdr";
import { closeOverlay, exec, focused, pickFolder, props, run, setShared, shared, spaces, theme, window } from "herdr";

const RECENT = "workspace.recent-folders";

export default class ChooseWorkspaceFolder extends View {
  init(_props, cx) {
    const args = props() ?? {};
    const active = spaces().find(space => space.active);
    const terminal = focused();
    this.machine = args.machine ?? "";
    this.remote = Boolean(this.machine);
    this.sshAvailable = typeof api.sshAgents === "function";
    this.host = InputState.new({ placeholder: "SSH alias or user@host", value: this.machine });
    this.path = InputState.new({ placeholder: "/absolute/project/path" });
    this.create = false;
    this.overlay = args.overlay;
    this.current = active?.machine || active?.ssh ? null : (terminal?.terminal?.includes("/") ? active?.folder : terminal?.cwd || active?.folder);
    this.path.on("submit", (_e, cx) => this.openRemote(cx));
    this.cursor = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (!shared("workspace.reduce-motion")) cx.timer.after(30, cx => { this.ready = true; cx.notify(); });
  }

  finish(folder) {
    if (folder) {
      setShared(RECENT, [folder, ...(shared(RECENT) ?? []).filter(path => path !== folder)].slice(0, 5));
      const projects = shared("workspace.project-folders") ?? [];
      setShared("workspace.project-folders", [folder, ...projects.filter(path => path !== folder)].slice(0, 100));
    }
    run("space.new", { folder, machine: "" });
    closeOverlay(this.overlay);
  }

  options() {
    const recent = (shared(RECENT) ?? []).filter(path => path !== this.current).slice(0, 5);
    return [
      ...(this.current ? [{ title: "Use current terminal folder", detail: this.current }] : []),
      ...recent.map(path => ({ title: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path, detail: path })),
      { title: "Choose a folder…" },
    ];
  }

  choose(option, cx) {
    if (!option || this.busy) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const folder = option.detail ?? await pickFolder({ prompt: "Open workspace" });
        if (!folder || this.closed) return;
        if (window()?.platform !== "windows" && (await exec("/bin/test", ["-d", folder], { timeout: 3000 })).code !== 0) {
          this.error = "That folder is unavailable. Choose another folder.";
          return;
        }
        if (!this.closed) this.finish(folder);
      } catch (error) {
        this.error = String(error);
      } finally {
        this.busy = false;
        if (!this.closed) { this.handle.focus(); cx.notify(); }
      }
    });
  }

  openRemote(cx) {
    const host = this.host.value().trim(), folder = this.path.value().trim();
    if (!folder.startsWith("/") || /[\x00-\x1f\x7f]/.test(folder)) {
      this.error = "Enter an absolute remote path.";
    } else if (this.sshAvailable && (!/^[A-Za-z0-9_@.:[\]-]+$/.test(host) || host.startsWith("-") || host.length > 255)) {
      this.error = "Enter an SSH config alias, hostname, or user@host.";
    } else {
      run("space.new", this.sshAvailable
        ? { machine: "", ssh: { host, folder, create: this.create } }
        : { machine: this.machine, folder });
      closeOverlay(this.overlay);
      return;
    }
    cx.notify();
  }

  remoteForm(t) {
    const field = input => Input.new(input).w_full().h(30).px(8).rounded(6).bg(t.surface).text_color(t.foreground);
    return v_flex().gap(6)
      .when(this.sshAvailable, el => el.child(div().text_color(t.muted).child("SSH destination")).child(field(this.host)))
      .child(div().text_color(t.muted).child("Remote directory"))
      .child(field(this.path))
      .when(this.sshAvailable, el => el.child(div().id("create-remote-folder").p(6).rounded(5).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => { this.create = !this.create; cx.notify(); })
        .child(this.create ? "✓ Create directory if missing" : "Create directory if missing")))
      .child(div().id("open-remote-project").p(8).rounded(6).bg(t.selected).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.openRemote(cx)).child("Open remote project"));
  }

  close() { this.closed = true; }

  render() {
    const t = theme(), options = this.options();
    const motion = !shared("workspace.reduce-motion");
    return v_flex().id("workspace-picker").track_focus(this.handle).w_full().gap(5).p(10).bg(t.popover)
      .opacity(motion && !this.ready ? 0.58 : 1)
      .when(motion, el => el.transition("opacity", { duration: 135, easing: "ease-out" }))
      .on_key_down((e, cx) => {
        if (e.key === "escape") { closeOverlay(this.overlay); return; }
        if (this.remote) return;
        if (e.key === "up" || e.key === "down") {
          this.cursor = (this.cursor + (e.key === "up" ? -1 : 1) + options.length) % options.length;
          cx.stop_propagation(); cx.notify();
        }
        if (e.key === "enter") { cx.stop_propagation(); this.choose(options[this.cursor], cx); }
      })
      .child(div().px(7).py(4).text_color(t.foreground).font_semibold().child("New project"))
      .when(this.sshAvailable || Boolean(this.machine), el => el.child(h_flex().gap(6)
        .children([["Local", false], ["Remote", true]].map(([label, remote]) =>
          div().id("place-" + label).px(10).py(5).rounded(5).bg(this.remote === remote ? t.selected : t.surface)
            .cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => {
              this.remote = remote; this.error = null; cx.notify();
            }).child(label)))))
      .when(this.remote, el => el.child(this.remoteForm(t)))
      .when(!this.remote, el => el
      .children(options.map((option, index) => h_flex().id(`folder-${index}`).rounded(7).h(option.detail ? 43 : 34).px(8)
        .items_center().gap(9).cursor_pointer().hover(s => s.bg(t.hover)).active(s => s.opacity(0.75))
        .on_click((_e, cx) => this.choose(option, cx))
        .child(div().id(`folder-selection-${index}`).w(3).h(18).rounded(2).bg(t.accent).opacity(this.cursor === index ? 1 : 0)
          .when(motion, el => el.transition("opacity", 130)))
        .child(v_flex().flex_1().min_w(0).text_color(this.cursor === index ? t.foreground : t.muted)
          .child(div().text_size(13).truncate().child(option.title))
          .when(Boolean(option.detail), el => el.child(div().text_size(11).truncate().text_color(t.muted).tooltip(option.detail).child(option.detail)))))))
      .child(div().px(8).pb(3).text_size(11).text_color(this.error ? t.ansi1 : t.muted)
        .child(this.error ?? (this.remote ? (this.sshAvailable ? "Uses your local SSH configuration." : "") : this.busy ? "Opening folder…" : "↑↓ Select  ·  ↵ Open  ·  Esc Cancel")));
  }
}
