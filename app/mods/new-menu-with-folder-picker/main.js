import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { workingRing } from "./status-ring.js";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  init(_props, cx) {
    this.space = spaces().find(s => s.active);
    this.machine = this.space?.machine;
    this.where = this.machine ?? "";
    this.agents = shared(KNOWN)?.[this.where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (!shared("workspace.reduce-motion")) cx.timer.after(30, cx => { this.ready = true; cx.notify(); });
    this.cursor = "terminal";
    this.scroll = ScrollHandle.new();
    this.probe(cx);
  }

  probe(cx) {
    if (this.loading) return;
    this.loading = true; this.error = false; cx.notify();
    cx.spawn(async cx => {
      try {
        const checked = await knownAgents({ on: this.machine });
        // Keep numeric chords stable during a single opening.
        const order = new Map(this.agents.map((a, i) => [a.key, i]));
        this.agents = [...checked].sort((a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity));
        setShared(KNOWN, { ...shared(KNOWN), [this.where]: checked });
      } catch { this.error = true; }
      finally { this.loading = false; cx.notify(); }
    });
  }

  launch(row, cx) {
    if (row.id === "retry") { this.probe(cx); return; }
    if (row.enabled === false) return;
    closeOverlay(props().overlay);
    row.action();
  }

  render() {
    const t = theme(), space = this.space, motion = !shared("workspace.reduce-motion");
    const installed = this.agents.filter(a => a.installed);
    const agentRows = [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)].map((a, i) => ({
      id: `agent-${a.key}`, title: a.name, enabled: a.installed,
      icon: a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14),
      hint: !a.installed ? "Missing" : i < 9 ? String(i + 1) : "",
      action: () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }),
    }));
    const worktree = (title, action) => ({ id: `worktree-${action}`, title, enabled: Boolean(space),
      icon: svg("mods/workspace-chrome/branch.svg").size(14), action: () => openOverlay({ mod: "worktree", kind: "dialog", width: action === "new" ? 460 : 560, height: action === "new" ? 280 : 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action } }) });
    const terminal = { id: "terminal", title: "Terminal", icon: svg("icons/shell.svg").size(14), hint: shortcut("tab.new"), action: () => run("tab.new", { space: space?.id }) };
    const footer = [
      { id: "space", title: space?.machine ? "New space" : "New space…", icon: div().w(14).child("+"), hint: shortcut("mod.open:choose-workspace-folder"), action: () => run("mod.open", { name: "choose-workspace-folder" }) },
      worktree("New worktree…", "new"), worktree("Open worktree…", "open"),
    ];
    const retry = { id: "retry", title: "Retry detection", hint: "", icon: div().w(14).child("↻") };
    const navigable = [terminal, ...agentRows, ...(this.error ? [retry] : []), ...footer].filter(r => r.enabled !== false);
    const row = r => h_flex().id(r.id).h(29).px(7).gap(8).rounded(6).items_center().flex_none()
      .bg(this.cursor === r.id ? t.selected : t.popover).text_color(r.enabled === false ? t.dim : t.foreground)
      .when(r.enabled !== false, el => el.cursor_pointer().hover(s => s.bg(t.hover)).active(s => s.opacity(0.78)).on_click((_e, cx) => this.launch(r, cx)))
      .child(div().id(`${r.id}-selection`).w(3).h(14).rounded(2).bg(t.accent).opacity(this.cursor === r.id ? 1 : 0)
        .when(motion, el => el.transition("opacity", { duration: 130, easing: "ease-out" })))
      .child(r.icon).child(div().flex_1().min_w(0).truncate().child(r.title)).child(div().text_size(11).text_color(t.muted).child(r.hint ?? ""));
    return v_flex().w_full().max_h(510).bg(t.popover).p(5).text_size(12.8).id("new-menu").track_focus(this.handle)
      .opacity(motion && !this.ready ? 0.58 : 1)
      .when(motion, el => el.transition("opacity", { duration: 135, easing: "ease-out" }))
      .on_key_down((e, cx) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        if (e.key === "escape") { closeOverlay(props().overlay); return; }
        const current = navigable.findIndex(r => r.id === this.cursor);
        if (["up", "down", "home", "end"].includes(e.key)) {
          const index = e.key === "home" ? 0 : e.key === "end" ? navigable.length - 1 : (current + (e.key === "up" ? -1 : 1) + navigable.length) % navigable.length;
          this.cursor = navigable[index].id;
          const rowIndex = agentRows.findIndex(r => r.id === this.cursor);
          if (rowIndex >= 0) this.scroll.scroll_to_item(rowIndex);
          cx.stop_propagation(); cx.notify(); return;
        }
        const item = e.key === "enter" ? navigable[current] : /^[1-9]$/.test(e.key) ? agentRows[Number(e.key) - 1] : null;
        if (item) { cx.stop_propagation(); this.launch(item, cx); }
      })
      .child(div().px(8).py(5).text_size(11).text_color(t.muted).truncate().tooltip(space?.folder ?? "Local")
        .child(space ? `${space.name}${this.machine ? ` · ${this.machine}` : ""}` : "This computer"))
      .child(row(terminal))
      .child(h_flex().px(8).pt(5).pb(2).gap(6).items_center().text_size(11).text_color(t.muted)
        .when(this.loading, el => el.child(workingRing("launcher-probe", t, 20)))
        .child(this.loading ? "Checking agents…" : this.error ? "Detection unavailable" : installed.length ? "Start an agent" : "No installed agents"))
      .child(v_flex().id("launchers").max_h(240).overflow_y_scrollbar().track_scroll(this.scroll).children(agentRows.map(row)))
      .when(this.error, el => el.child(row(retry)))
      .child(div().h(1).mx(4).my(4).bg(t.border))
      .children(footer.map(row));
  }
}
