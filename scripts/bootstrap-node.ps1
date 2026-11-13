# Downloads a portable Node.js (checksum-verified) into -Dest\node. No admin rights needed.
param([Parameter(Mandatory)][string]$Dest, [string]$Version = "22.12.0")
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$name = "node-v$Version-win-$arch"
$base = "https://nodejs.org/dist/v$Version"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$zip = Join-Path $Dest "$name.zip"
$ProgressPreference = "SilentlyContinue"
Write-Host "Скачиваю $name ..."
Invoke-WebRequest "$base/$name.zip" -OutFile $zip -UseBasicParsing
$sums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content -split "`n"
$line = $sums | Where-Object { $_ -match "\s$([regex]::Escape($name)).zip\s*$" } | Select-Object -First 1
if (-not $line) { throw "Контрольная сумма для $name.zip не найдена" }
$expected = ($line -split "\s+")[0].ToLower()
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { Remove-Item $zip -Force; throw "Контрольная сумма не совпала — файл удалён" }
Write-Host "Распаковываю ..."
$tmp = Join-Path $Dest "_extract"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip -DestinationPath $tmp -Force
$target = Join-Path $Dest "node"
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Move-Item (Join-Path $tmp $name) $target
Remove-Item $tmp, $zip -Recurse -Force
Write-Host "Готово: $target"
