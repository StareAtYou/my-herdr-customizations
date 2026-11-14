import { exec } from "herdr";

export async function importImage(source, home, relative) {
  if (!source.startsWith("/")) throw new Error("Use an absolute image path");
  const folder = await exec("/bin/mkdir", ["-p", home + "/backgrounds"]);
  if (folder.code !== 0) throw new Error("Could not create the backgrounds folder");
  const converted = await exec("/usr/bin/sips", ["-s", "format", "jpeg", "-Z", "2560", source, "--out", home + "/" + relative]);
  if (converted.code !== 0) throw new Error("Could not read this background image");
  return relative;
}
