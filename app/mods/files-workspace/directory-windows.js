import { exec } from "herdr";

export async function windowsDirectory(path, on) {
  // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
  // Links keep directory attributes even when dangling; check their target.
  // Other reparse points (OneDrive's folders) have no LinkType and are folders.
  // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
  const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const result = JSON.parse(r.stdout || "[]");
  return Array.isArray(result) ? result : [result];
}
