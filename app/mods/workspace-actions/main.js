import { View, div } from "gpui-kit";
import { v_flex, Input, InputState } from "gpui-base";
import { agents, spaces, layout, theme, run, props, closeOverlay, openOverlay } from "herdr";

export default class WorkspaceCommands extends View {
  init(_props, cx) {
    this.index = 0;
    this.query = InputState.new({ placeholder: "Search workspace commands…" });
    this.query.on("change", (_e, cx) => { this.index = 0; cx.notify(); });
    this.query.on("submit", () => this.activate(this.items()[this.index]));
    cx.timer.after(50, () => this.query.focus());
  }

  items() {
    const active = spaces().find(space => space.active);
    const panel = layout()?.children?.find(node => node.id === "work")?.children?.find(node => node.id === "work-body")?.children?.find(node => node.id === "panel");
    const items = [
      ["Workspace appearance", () => run("app.settings", { section: "look" })],
      ["All Herdr commands", () => run("app.palette")],
    ];
    if (panel) items.unshift(["Open tasks and logs", () => {
      run("layout.select", { stack: "panel-body", child: "tasks" });
      run("layout.show", { id: "panel" });
    }]);
    if (active?.folder) items.unshift(["Switch Git worktree…", () => openOverlay({
      kind: "dialog", mod: "worktree", width: 560, height: 480,
      props: { space: active.id, folder: active.folder, action: "open" },
    })]);
    if (agents().some(agent => agent.status === "blocked"))
      items.unshift(["Next agent that needs you", () => run("agents-workspace.next-blocked")]);
    const query = this.query.value().trim().toLowerCase();
    return items.filter(([name]) => name.toLowerCase().includes(query));
  }

  activate(item) {
    if (!item) return;
    closeOverlay(props().overlay);
    item[1]();
  }

  render(cx) {
    const t = theme(), items = this.items();
    return v_flex().size_full().p(14).gap(8).bg(t.background).text_color(t.foreground)
      .on_key_down((event, cx) => {
        if (!items.length || !["up", "down"].includes(event.key)) return;
        this.index = (this.index + (event.key === "down" ? 1 : -1) + items.length) % items.length;
        cx.stop_propagation(); cx.notify();
      })
      .child(Input.new(this.query).id("workspace-commands-input").h(34).px(9).rounded(6).bg(t.surface).text_color(t.foreground))
      .child(v_flex().min_h(0).overflow_y_scroll().gap(3).children(items.map((item, index) =>
        div().id("action-" + index).p(8).rounded(6).cursor_pointer().font_medium()
          .bg(index === this.index ? t.selected : t.background).hover(s => s.bg(t.hover))
          .on_click(() => this.activate(item)).child(item[0]))))
      .when(!items.length, el => el.child(div().p(8).text_color(t.dim).child("No matching commands")));
  }
}
