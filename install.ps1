param(
    [string]$Version = '1.0.0',
    [string]$CodexHome = '',
    [string]$SourceDirectory = '',
    [switch]$NoSkill
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version.' }
if (-not $CodexHome) {
    if ($env:CODEX_HOME) { $CodexHome = $env:CODEX_HOME }
    else { $CodexHome = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex' }
}
$node = (Get-Command node -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
& $node -e "const [a,b,c]=process.versions.node.split('.').map(Number);if(!((a===22&&(b>23||b===23&&c>=4))||(a===24&&(b>22||b===22&&c>=1))||(a===26&&(b>12||b===12&&c>=1))||a>26)){console.error('Install Node.js 24.22.1+ LTS first.');process.exit(1)}"
if ($LASTEXITCODE -ne 0) { throw 'Unsupported Node.js version.' }
$taskTemp = Join-Path ([IO.Path]::GetTempPath()) ('rea-light-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskTemp | Out-Null
try {
    if (-not $SourceDirectory) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $asset = "rea-light-mcp-v$Version.zip"
        $release = "https://github.com/funkeyyou/rea-light-mcp/releases/download/v$Version"
        $zipPath = Join-Path $taskTemp $asset
        $sumPath = Join-Path $taskTemp 'SHA256SUMS'
        Invoke-WebRequest "$release/$asset" -OutFile $zipPath -UseBasicParsing
        Invoke-WebRequest "$release/SHA256SUMS" -OutFile $sumPath -UseBasicParsing
        $matching = @(Get-Content -LiteralPath $sumPath | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+\*?' + [regex]::Escape($asset) + '$') })
        if ($matching.Count -ne 1) { throw 'Release checksum entry is missing or ambiguous.' }
        $expected = ($matching[0] -split '\s+')[0].ToLowerInvariant()
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw 'Release checksum mismatch.' }
        $SourceDirectory = Join-Path $taskTemp 'source'
        Expand-Archive -LiteralPath $zipPath -DestinationPath $SourceDirectory
    }
    $installRoot = Join-Path (Join-Path (Join-Path $CodexHome 'rea-light') 'versions') ("v$Version-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    $files = @('sdk.mjs','gateway.mjs','server.mjs','install.mjs','verify.mjs','package.json','package-lock.json','skill-overlay.md','LICENSE','THIRD_PARTY.md','README.md','README.zh-Hant.md','README.en.md')
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $SourceDirectory $file) -Destination (Join-Path $installRoot $file) }
    Push-Location $installRoot
    try {
        & $npm ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Codex configuration was not changed.' }
        & $node verify.mjs
        if ($LASTEXITCODE -ne 0) { throw 'MCP verification failed. Codex configuration was not changed.' }
        $installArgs = @('install.mjs','--codex-home',$CodexHome)
        if ($NoSkill) { $installArgs += '--no-skill' }
        & $node @installArgs
        if ($LASTEXITCODE -ne 0) { throw 'Codex registration failed. Check the reported backup path.' }
        Write-Host "Installed at: $installRoot"
        Write-Host 'Restart Codex and open a new task.'
    } finally { Pop-Location }
} finally {
    if (Test-Path -LiteralPath $taskTemp) { Remove-Item -LiteralPath $taskTemp -Recurse -Force }
}
