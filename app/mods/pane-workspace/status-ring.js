import { image } from "gpui-kit";
import { shared } from "herdr";

export function workingRing(id, t, size = 24) {
  const hex = t.background ?? "#18181b";
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  const shade = r * 0.2126 + g * 0.7152 + b * 0.0722 > 145 ? "light" : "dark";
  const ext = shared("workspace.reduce-motion") ? "png" : "webp";
  return image(`my-icons/working-ring-${shade}.${ext}`).id(id).size(size).flex_none();
}

export function isCompacting(report) {
  return report?.state === "working" && report.msg === "Compacting context";
}
