import { exec } from "herdr";

const script = `
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile($source)
try {
    $scale = [Math]::Min(1, 2560 / [Math]::Max($image.Width, $image.Height))
    $bitmap = [System.Drawing.Bitmap]::new($image, [Math]::Max(1, [int]($image.Width * $scale)), [Math]::Max(1, [int]($image.Height * $scale)))
    try {
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
        $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Jpeg)
        Write-Output 'imported'
    } finally { $bitmap.Dispose() }
} finally { $image.Dispose() }
`;

export async function importImage(source, home, relative) {
  if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(source)) throw new Error("Use an absolute image path");
  // The destination is local to Herdr. Quote both ASCII and typographic apostrophes.
  const literal = value => "'" + value.replace(/['‘’‚‛]/g, "$&$&") + "'";
  const result = await exec("powershell.exe", ["-NoProfile", "-STA", "-Command", "$ErrorActionPreference = 'Stop'; $source = " + literal(source) + "; $destination = " + literal(home + "/" + relative) + "\n" + script], { timeout: 180000 });
  if (result.code !== 0) throw new Error("Could not import this background image");
  return result.stdout.trim() === "imported" ? relative : null;
}
