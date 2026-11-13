import { View, div } from "gpui-kit";
import { closeOverlay, notify, pickFolder, props, run, spaces, theme } from "herdr";

export default class ChooseWorkspaceFolder extends View {
  init(_props, cx) {
    const { machine, overlay } = props() ?? {};
    const targetMachine = machine ?? spaces().find(space => space.active)?.machine ?? "";

    cx.spawn(async () => {
      try {
        if (targetMachine) {
          run("space.new", { machine: targetMachine });
          return;
        }

        const folder = await pickFolder({ prompt: "Open workspace" });
        if (folder) run("space.new", { folder, machine: "" });
      } catch (error) {
        notify({ title: "Could not open workspace", body: String(error), level: "error" });
      } finally {
        if (overlay) closeOverlay(overlay);
      }
    });
  }

  render() {
    return div().px(14).py(12).text_color(theme().muted).child("Choose a workspace folder…");
  }
}
