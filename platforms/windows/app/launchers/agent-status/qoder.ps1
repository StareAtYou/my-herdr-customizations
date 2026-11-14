$qoder = Join-Path $env:USERPROFILE '.qoder/bin/qodercli/qodercli.exe'
$previous = $env:QODER_PROGRAM_STATUS
try {
    $env:QODER_PROGRAM_STATUS = '1'
    & $qoder @args
    $code = $LASTEXITCODE
} finally {
    $env:QODER_PROGRAM_STATUS = $previous
}
exit $code
