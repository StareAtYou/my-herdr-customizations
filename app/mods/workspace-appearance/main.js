import { View, div, image } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { layout, shared, run, theme, window, appHome, closeOverlay, props } from "herdr";
import { importImage } from "./platform.js";

const darken = (t, value) => t.background.slice(0, 7) + Math.round(value * 255).toString(16).padStart(2, "0");
const defaults = { style: "solid", fit: "cover", shade: .84, terminal: 1, compact: false };
const find = (node, id) => node?.id === id ? node : node?.children?.map(child => find(child, id)).find(Boolean);
const wallPrefix = "backgrounds/workspace-";
const levels = [.6, .72, .84, .96, 1];
const glassLevels = [.25, .4, .6, .84, 1];

export default class WorkspaceAppearance extends View {
  init() {
    this.imagePath = InputState.new({ placeholder: "Local image path" });
    this.imagePath.on("submit", (_event, cx) => { if (!this.busy) cx.spawn(cx => this.choose(cx)); });
    const root = layout(), bg = root?.background;
    const sidebar = find(root, "sidebar"), pane = find(root, "main")?.content?.pane;
    const style = bg?.image ? "photo" : bg?.gradient ? "tinted" : bg === "#00000000" ? "glass" : "solid";
    this.draft = {
      ...defaults, style, image: bg?.image, fit: bg?.fit ?? "cover",
      shade: this.shadeOf(style === "glass" ? sidebar?.background : pane?.background),
      terminal: root?.terminal_opacity ?? (style === "solid" ? 1 : .72),
      compact: (sidebar?.size?.px ?? 268) < 230,
    };
  }

  shadeOf(background) {
    return /^#[0-9a-f]{8}$/i.test(background ?? "") ? parseInt(background.slice(7), 16) / 255 : .84;
  }

  async choose(cx) {
    this.busy = true; this.error = null; cx.notify();
    try {
      const source = this.imagePath.value().trim();
      if (!source) throw new Error("Enter the full path to an image");
      const path = await importImage(source, appHome(), wallPrefix + Date.now() + ".jpg");
      if (path) Object.assign(this.draft, { style: "photo", image: path });
    } catch (error) {
      this.error = String(error);
    } finally {
      this.busy = false; cx.notify();
    }
  }

  apply(t) {
    const active = layout();
    if (shared("layout") !== "workspace-folders") return;
    const next = JSON.parse(JSON.stringify(active));
    const sidebar = find(next, "sidebar"), pane = find(next, "main")?.content?.pane;
    const d = this.draft;
    if (!sidebar || !pane || (d.style === "photo" && !d.image)) return;
    next.background = d.style === "photo" ? { image: d.image, fit: d.fit }
      : d.style === "tinted" ? { gradient: ["canvas", "raised"], angle: 145 }
      : d.style === "glass" ? "#00000000" : "canvas";
    next.terminal_opacity = d.style === "glass" ? 1 : d.terminal;
    sidebar.size = { px: d.compact ? 208 : (sidebar.size?.px >= 230 && !d.reset ? sidebar.size.px : 268) };
    sidebar.background = d.style === "solid" ? "chrome" : darken(t, d.style === "glass" ? d.shade : Math.max(.82, d.shade));
    pane.background = ["solid", "glass"].includes(d.style) ? "background" : darken(t, d.shade);
    run("layout.set", { layout: next });
    closeOverlay(props().overlay);
  }

  render() {
    const t = theme(), d = this.draft;
    const button = (id, label, click, active = false, disabled = false) => div().id(id).px(10).py(5).rounded(6)
      .border_1().border_color(active ? t.accent : t.border).bg(active ? t.selected : t.surface)
      .text_size(12).text_color(disabled ? t.dim : t.foreground)
      .when(!disabled, el => el.cursor_pointer().hover(s => s.bg(t.hover)).active(s => s.opacity(.75)).on_click(click)).child(label);
    const set = (name, value, cx) => { d[name] = value; cx.notify(); };
    const row = (label, controls) => h_flex().gap(8).items_center()
      .child(div().w(126).flex_none().text_size(12).text_color(t.muted).child(label)).children(controls);
    const percent = (name, values = levels) => values.map(value => button(name + value, Math.round(value * 100) + "%", (_e, cx) => set(name, value, cx), Math.abs(d[name] - value) < .006));
    const glass = window()?.macos_glass === true;
    const ready = shared("layout") === "workspace-folders";
    return v_flex().id("appearance").size_full().min_h(0).overflow_y_scroll().p(20).gap(12).bg(t.background).text_color(t.foreground)
      .child(div().text_size(18).font_semibold().child("Workspace appearance"))
      .when(!ready, el => el.child(div().text_color(t.muted).child("Switch to workspace-folders to change its appearance.")))
      .when(ready, el => el
        .child(row("Background", [["solid", "Solid"], ["tinted", "Gradient"], ["photo", "Image"], ...(glass ? [["glass", "macOS Glass"]] : [])].map(([id, label]) =>
          button(id, label, (_e, cx) => {
            if (d.style !== id) d.shade = id === "glass" ? .6 : .84;
            set("style", id, cx);
          }, d.style === id))))
        .when(d.style === "photo", el => el.child(row("Image", [
          Input.new(this.imagePath).flex_1().min_w(0).h(28).px(7).rounded(6).bg(t.surface).text_color(t.foreground),
          button("choose-image", this.busy ? "Importing…" : "Import", (_e, cx) => cx.spawn(cx => this.choose(cx)), false, this.busy),
          button("cover", "Fill", (_e, cx) => set("fit", "cover", cx), d.fit === "cover"),
          button("contain", "Fit", (_e, cx) => set("fit", "contain", cx), d.fit === "contain"),
        ])))
        .when(Boolean(this.error), el => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
        .when(d.style !== "glass", el => el.child(row("Terminal background", percent("terminal"))))
        .when(d.style !== "solid", el => el.child(row("Background shade", percent("shade", d.style === "glass" ? glassLevels : levels))))
        .child(row("Sidebar", [
          button("comfortable", "Comfortable", (_e, cx) => set("compact", false, cx), !d.compact),
          button("compact", "Compact", (_e, cx) => set("compact", true, cx), d.compact),
        ]))
        .child(div().relative().h(116).flex_none().overflow_hidden().rounded(8).border_1().border_color(t.border)
          .bg(d.style === "solid" ? t.canvas : t.raised)
          .when(d.style === "photo" && Boolean(d.image), el => el.child(image(d.image).absolute().inset_0().size_full()))
          .child(h_flex().absolute().inset_0().p(10).gap(8)
            .child(div().w(d.compact ? 78 : 104).h_full().rounded(6).p(9).bg(d.style === "solid" ? t.chrome : darken(t, d.style === "glass" ? d.shade : Math.max(.82, d.shade)))
              .text_size(12).child("Spaces"))
            .child(div().flex_1().h_full().rounded(6).p(10).border_1().border_color(t.border)
              .bg(darken(t, ["solid", "glass"].includes(d.style) ? 1 : 1 - (1 - d.shade) * (1 - d.terminal))).text_size(13).child("Terminal"))))
        .child(h_flex().gap(8).justify_end().items_center()
          .child(button("reset", "Reset", (_e, cx) => { this.draft = { ...defaults, reset: true }; cx.notify(); }))
          .child(button("cancel", "Cancel", () => closeOverlay(props().overlay)))
          .child(button("apply", "Apply", () => this.apply(t), true, this.busy || (d.style === "photo" && !d.image)))));
  }
}
