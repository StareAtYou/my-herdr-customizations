#requires -Version 7.3
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$ValidateMods,
    [switch]$SkipCoreShell,
    [string]$AppHome,
    [string]$CoreConfig,
    [string]$AppExe,
    [string]$NpmRoot,
    [string]$BackupRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'This snapshot restores the Windows Herdr setup.' }

$repo = $PSScriptRoot
$profileHome = [Environment]::GetFolderPath('UserProfile')
$programsHome = Join-Path $env:LOCALAPPDATA 'Programs'
if (-not $AppHome) {
    $AppHome = $env:HERDR_APP_HOME
    if (-not $AppHome) {
        $configHome = $env:XDG_CONFIG_HOME
        if (-not $configHome) { $configHome = Join-Path $profileHome '.config' }
        $AppHome = Join-Path $configHome 'herdr-app'
    }
}
if (-not $CoreConfig) {
    $configHome = $env:XDG_CONFIG_HOME
    if (-not $configHome) { $configHome = $env:APPDATA }
    $CoreConfig = Join-Path $configHome 'herdr-core/config.toml'
}
if (-not $BackupRoot) {
    $BackupRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'herdr-customizations/backups'
}
$AppHome = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($AppHome)
$CoreConfig = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($CoreConfig)
$BackupRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($BackupRoot)
$encoding = [System.Text.UTF8Encoding]::new($false)

function Find-File {
    param([string[]]$Candidates)
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Get-Item -LiteralPath $candidate).FullName
        }
    }
}

function Get-ApplicationPaths {
    param([string]$Name)
    Get-Command -Name $Name -CommandType Application -All -ErrorAction SilentlyContinue |
        ForEach-Object Source
}

function Read-Object {
    param([string]$Path)
    $value = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable -Depth 100
    if ($value -isnot [System.Collections.IDictionary]) { throw "Expected a JSON object at $Path" }
    return $value
}

function Merge-Object {
    param([System.Collections.IDictionary]$Target, [System.Collections.IDictionary]$Changes)
    foreach ($key in $Changes.Keys) {
        if ($Changes[$key] -is [System.Collections.IDictionary] -and
            $Target.Contains($key) -and $Target[$key] -is [System.Collections.IDictionary]) {
            Merge-Object $Target[$key] $Changes[$key]
        } else {
            $Target[$key] = $Changes[$key]
        }
    }
}

function Format-Json {
    param($Value)
    return (ConvertTo-Json -InputObject $Value -Depth 100) + [char]10
}

function Expand-Arguments {
    param([string[]]$Template, [hashtable]$Values)
    foreach ($argument in $Template) {
        if ($argument -match '^\{(?<key>\w+)\}(?<suffix>/.*)?$') {
            $root = $Values[$Matches['key']]
            if (-not $root) { throw "Unresolved launcher argument $argument" }
            $suffix = $Matches['suffix']
            if ($suffix) { Join-Path $root $suffix.TrimStart('/') } else { $root }
        } else {
            $argument
        }
    }
}

function Resolve-PowerShell {
    $candidates = @(
        (Join-Path $profileHome 'scoop/apps/pwsh/current/pwsh.exe')
        (Join-Path $env:ProgramFiles 'PowerShell/7/pwsh.exe')
        (Get-ApplicationPaths 'pwsh.exe')
        (Join-Path $PSHOME 'pwsh.exe')
    )
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Find-File $candidate)) { continue }
        $answer = & $candidate -NoLogo -NoProfile -NonInteractive -Command 'if ([Environment]::Is64BitProcess) { Join-Path $PSHOME "pwsh.exe" }' 2>$null
        if ($LASTEXITCODE -eq 0 -and $answer -is [string]) {
            $realPath = Find-File $answer
            if ($realPath) { return $realPath }
        }
    }
}

function Set-CoreShell {
    param([string]$ConfigText, [string]$ShellLine)
    $section = [regex]::Match($ConfigText, '(?m)^[ \t]*\[')
    $top = $ConfigText
    if ($section.Success) { $top = $ConfigText.Substring(0, $section.Index) }
    $pattern = '(?m)^[ \t]*(?:shell|"shell"|''shell'')[ \t]*='
    $matches = [regex]::Matches($top, $pattern)
    if ($matches.Count -gt 1) { throw "Multiple top-level shell keys in $CoreConfig" }

    $newline = [string][char]10
    if ($ConfigText.Contains(([string][char]13) + [char]10)) { $newline = ([string][char]13) + [char]10 }
    $otherKeys = $top
    if ($matches.Count -eq 1) {
        $key = $matches[0]
        $nextLine = $top.IndexOf([char]10, $key.Index)
        if ($nextLine -lt 0) { $nextLine = $top.Length }
        $original = $top.Substring($key.Index, $nextLine - $key.Index).TrimEnd([char]13)
        $otherKeys = $top.Remove($key.Index, $original.Length)
    }
    # The snapshot manages a one-line string array. Avoid treating a line
    # inside a separate multi-line value as a shell key or table boundary.
    if ($otherKeys -match '"""|\x27{3}') {
        throw "Ambiguous top-level TOML in $CoreConfig. Use -SkipCoreShell and migrate the shell entry manually."
    }
    if ($matches.Count -eq 0) { return $ShellLine + $newline + $ConfigText }

    $quoted = '"""(?:[^"\\]|\\.)*"""|\x27{3}.*?\x27{3}|"(?:(?:[^"\\])|\\.)*"|\x27[^\x27]*\x27'
    $oneLineArray = '\s*=\s*\[\s*(?:(?:' + $quoted + ')\s*(?:,\s*|(?=\])))*\][ \t]*(?<comment>#.*)?$'
    if ($original -notmatch $oneLineArray) {
        throw "The shell entry in $CoreConfig spans multiple lines or has an unexpected value. Use -SkipCoreShell and migrate it manually."
    }
    $comment = $Matches['comment']
    if ($comment) { $ShellLine += ' ' + $comment }
    return $ConfigText.Remove($key.Index, $original.Length).Insert($key.Index, $ShellLine)
}

function Add-PendingFile {
    param([string]$Destination, [string]$BackupName, [byte[]]$Content)
    $original = $null
    if (Test-Path -LiteralPath $Destination) {
        $original = [IO.File]::ReadAllBytes($Destination)
        if ([Convert]::ToBase64String($Content) -ceq [Convert]::ToBase64String($original)) { return }
    }
    $pending.Add([pscustomobject]@{ Path = $Destination; BackupName = $BackupName; Content = $Content; Original = $original })
}

function Add-PendingJson {
    param([string]$Relative, [System.Collections.IDictionary]$Changes, [string]$Baseline)
    $destination = Join-Path $AppHome $Relative
    $exists = Test-Path -LiteralPath $destination
    $value = [ordered]@{}
    if ($exists) {
        $value = Read-Object $destination
    } elseif ($Baseline) {
        $value = Read-Object $Baseline
    }
    $before = Format-Json $value
    Merge-Object $value $Changes
    $after = Format-Json $value
    if ($exists -and $before -ceq $after) { return }
    Add-PendingFile $destination "app/$Relative" ($encoding.GetBytes($after))
}

function Write-Atomic {
    param([string]$Path, [byte[]]$Content)
    $parent = [IO.Path]::GetDirectoryName($Path)
    [void][IO.Directory]::CreateDirectory($parent)
    $temporary = Join-Path $parent ('.herdr-restore-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllBytes($temporary, $Content)
        [IO.File]::Move($temporary, $Path, $true)
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

if (-not $AppExe) {
    $AppExe = Find-File @(
        Join-Path $programsHome 'herdr-app/herdr-app.exe'
        Get-ApplicationPaths 'herdr-app.exe'
    )
} else {
    $AppExe = Find-File $AppExe
    if (-not $AppExe) { throw 'The -AppExe path does not point to a file.' }
}

if ($ValidateMods) {
    if (-not $AppExe) { throw 'Install Herdr App or pass -AppExe to validate the mods.' }
    $previousHome = $env:HERDR_APP_HOME
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $checkHome = Join-Path $tempRoot ('herdr-mod-check-' + [guid]::NewGuid().ToString('N'))
    try {
        $env:HERDR_APP_HOME = Join-Path $checkHome 'home'
        [void][IO.Directory]::CreateDirectory($checkHome)
        foreach ($mod in Get-ChildItem -LiteralPath (Join-Path $repo 'app/mods') -Directory) {
            $testMod = Join-Path $checkHome $mod.Name
            Copy-Item -LiteralPath $mod.FullName -Destination $testMod -Recurse
            $arguments = 'check "' + $testMod + '"'
            $process = Start-Process -FilePath $AppExe -ArgumentList $arguments -NoNewWindow -Wait -PassThru
            if ($process.ExitCode -ne 0) { throw "Herdr rejected mod $($mod.Name), exit $($process.ExitCode)." }
            Write-Host "Validated mod $($mod.Name)"
        }
    } finally {
        $env:HERDR_APP_HOME = $previousHome
        $relative = [IO.Path]::GetRelativePath($tempRoot, [IO.Path]::GetFullPath($checkHome))
        if ($relative -match '^herdr-mod-check-[a-f0-9]{32}$' -and [IO.Directory]::Exists($checkHome)) {
            Remove-Item -LiteralPath $checkHome -Recurse -Force
        }
    }
}
if ($AppExe) {
    $version = (Get-Item -LiteralPath $AppExe).VersionInfo.ProductVersion
    if ($version) { Write-Host "Herdr App $version" }
    if ($version -ne '0.1.15') {
        Write-Warning 'This snapshot was captured on App 0.1.15. Review the upgrade guide before activating the layout.'
    }
}

$roots = [System.Collections.Generic.List[string]]::new()
if ($NpmRoot) {
    $roots.Add($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($NpmRoot))
} else {
    $npm = Get-ApplicationPaths 'npm.cmd' | Select-Object -First 1
    if ($npm) {
        $configuredRoot = & $npm root -g 2>$null | Select-Object -Last 1
        if ($LASTEXITCODE -eq 0 -and $configuredRoot) { $roots.Add($configuredRoot) }
    }
    $roots.Add((Join-Path $env:APPDATA 'npm/node_modules'))
    $roots.Add((Join-Path $profileHome 'scoop/persist/nodejs-lts/bin/node_modules'))
}

$codexBundles = Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/bin'
$codexCandidates = @(
    (Get-ApplicationPaths 'codex.exe')
    (Get-ChildItem -LiteralPath $codexBundles -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | ForEach-Object { Join-Path $_.FullName 'codex.exe' })
)
$values = @{
    appHome = $AppHome
    codex = Find-File $codexCandidates
    node = Find-File @(
        Join-Path $profileHome 'scoop/apps/nodejs-lts/current/node.exe'
        Get-ApplicationPaths 'node.exe'
    )
    opencode = Find-File @(
        $roots | ForEach-Object { Join-Path $_ '@opencode/cli/bin/opencode.exe' }
        Get-ApplicationPaths 'opencode.exe'
    )
    codebuddy = Find-File @($roots | ForEach-Object { Join-Path $_ '@tencent-ai/codebuddy-code/bin/codebuddy' })
    pi = Find-File @($roots | ForEach-Object { Join-Path $_ '@earendil-works/pi-coding-agent/dist/bundle/cli.js' })
    dsh = Find-File @($roots | ForEach-Object { Join-Path $_ '@deepseek-ai/dsh/lib/bin.js' })
    qoder = Find-File (Join-Path $profileHome '.qoder/bin/qodercli/qodercli.exe')
}
$dshHome = $env:DSH_HOME
if (-not $dshHome) { $dshHome = Join-Path $profileHome '.dsh' }
$dshPlugin = Join-Path $dshHome 'profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui/package.json'
$values['dshProfile'] = Find-File $dshPlugin
if ($values['dshProfile']) {
    $plugin = Read-Object $dshPlugin
    if ($plugin['version'] -ne '0.19.0') {
        Write-Warning "DeepSeek Harness TUI version $($plugin['version']) differs from the captured 0.19.0."
    }
}

$programTemplate = Read-Object (Join-Path $repo 'config/programs.json')
$requirements = @{
    codex = @('codex')
    'codebuddy-code' = @('node', 'codebuddy')
    opencode = @('opencode')
    pi = @('node', 'pi')
    'dsh-tui' = @('node', 'dsh', 'dshProfile')
    qoder = @('qoder')
}
$launchers = [ordered]@{}
$codeBuddyIconSource = $null
foreach ($id in $programTemplate['programs'].Keys) {
    $missing = @($requirements[$id] | Where-Object { -not $values[$_] })
    if ($missing.Count) {
        Write-Warning "Skipping launcher $id. Missing $($missing -join ', ')."
        continue
    }
    $entry = $programTemplate['programs'][$id]
    $entry['run'] = @(Expand-Arguments $entry['run'] $values)
    if ($id -eq 'codebuddy-code') {
        $packageRoot = Split-Path -Parent (Split-Path -Parent $values['codebuddy'])
        $codeBuddyIconSource = Find-File (Join-Path $packageRoot 'vendor/assets/icon.png')
        if (-not $codeBuddyIconSource -and -not (Find-File (Join-Path $AppHome $entry['icon']))) {
            [void]$entry.Remove('icon')
            Write-Warning 'CodeBuddy icon unavailable. Using the default icon for a fresh entry.'
        }
    }
    $launchers[$id] = $entry
    Write-Host "Resolved launcher $id"
}

$pending = [System.Collections.Generic.List[object]]::new()
$appSource = Join-Path $repo 'app'
foreach ($file in Get-ChildItem -LiteralPath $appSource -File -Recurse) {
    if ($file.Name -in @('gpui-kit.d.ts', 'jsconfig.json')) { continue }
    $relative = [IO.Path]::GetRelativePath($appSource, $file.FullName)
    Add-PendingFile (Join-Path $AppHome $relative) "app/$relative" ([IO.File]::ReadAllBytes($file.FullName))
}
Add-PendingJson 'keys.json' (Read-Object (Join-Path $repo 'config/keys.json')) (Join-Path $repo 'baseline/keys.windows.json')
Add-PendingJson 'settings.json' (Read-Object (Join-Path $repo 'config/settings.json'))
if ($launchers.Count) { Add-PendingJson 'programs.json' ([ordered]@{ programs = $launchers }) }

if ($launchers.Contains('codebuddy-code')) {
    if ($codeBuddyIconSource) {
        $icon = $launchers['codebuddy-code']['icon']
        Add-PendingFile (Join-Path $AppHome $icon) "app/$icon" ([IO.File]::ReadAllBytes($codeBuddyIconSource))
    }
    $hooks = Read-Object (Join-Path $repo 'config/codebuddy-hooks.json')
    $node = $values['node'].Replace('\', '/')
    $hookHome = $AppHome.Replace('\', '/')
    foreach ($groups in $hooks['hooks'].Values) {
        foreach ($group in $groups) {
            foreach ($hook in $group['hooks']) {
                $hook['command'] = $hook['command'].Replace('{node}', $node).Replace('{appHome}', $hookHome)
            }
        }
    }
    $relative = 'launchers/agent-status/codebuddy-hooks.json'
    Add-PendingFile (Join-Path $AppHome $relative) "app/$relative" ($encoding.GetBytes((Format-Json $hooks)))
}
if (-not $SkipCoreShell) {
    $pwsh = Resolve-PowerShell
    if ($pwsh) {
        Write-Host "Resolved 64-bit PowerShell $pwsh"
        $shellTemplate = Get-Content -LiteralPath (Join-Path $repo 'config/core-shell.json') -Raw | ConvertFrom-Json
        $shell = @(Expand-Arguments $shellTemplate @{ pwsh = $pwsh })
        $tomlArray = ConvertTo-Json -InputObject $shell -Compress -EscapeHandling Default
        $original = ''
        if (Test-Path -LiteralPath $CoreConfig) { $original = [IO.File]::ReadAllText($CoreConfig) }
        $updated = Set-CoreShell $original "shell = $tomlArray"
        Add-PendingFile $CoreConfig 'core/config.toml' ($encoding.GetBytes($updated))
    } else {
        Write-Warning 'Skipping the Core shell. Install 64-bit PowerShell 7 and run again.'
    }
}

Write-Host "App home $AppHome"
Write-Host "Core config $CoreConfig"
foreach ($change in $pending) { Write-Host "Planned write $($change.Path)" }
if (-not $pending.Count) {
    Write-Host 'No changes needed.'
    return
}
if (-not $Apply) {
    Write-Host "Preview only. Pass -Apply to write the $($pending.Count) planned files."
    return
}

$backup = Join-Path $BackupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$manifest = foreach ($change in $pending) {
    $backupFile = $null
    if ($null -ne $change.Original) {
        $backupFile = $change.BackupName.Replace('\', '/')
        Write-Atomic (Join-Path $backup $backupFile) $change.Original
    }
    [ordered]@{ path = $change.Path; backup = $backupFile }
}
Write-Atomic (Join-Path $backup 'restore-manifest.json') ($encoding.GetBytes((Format-Json @($manifest))))
Write-Host "Backup and restore manifest $backup"

foreach ($change in $pending) {
    $exists = Test-Path -LiteralPath $change.Path
    if ($exists -ne ($null -ne $change.Original) -or ($exists -and
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($change.Path)) -cne [Convert]::ToBase64String($change.Original))) {
        throw "File changed during restore: $($change.Path). Review the backup and rerun."
    }
    Write-Atomic $change.Path $change.Content
}
Write-Host "Applied $($pending.Count) files."
