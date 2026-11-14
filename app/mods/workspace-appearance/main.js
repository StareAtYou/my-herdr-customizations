import { View, div } from "gpui-kit";
import { closeOverlay, props, run } from "herdr";

export default class AppearanceShortcut extends View {
  init(_props, cx) {
    cx.timer.after(0, () => {
      closeOverlay(props()?.overlay);
      run("app.settings", { section: "look" });
    });
  }

  render() { return div(); }
}
