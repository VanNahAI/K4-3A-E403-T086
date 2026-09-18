$ErrorActionPreference = 'Stop'

$dockerBin = 'C:\Users\PC\AppData\Local\Programs\DockerDesktop\resources\bin'
$dockerExe = Join-Path $dockerBin 'docker.exe'
$dockerCredentialHelper = Join-Path $dockerBin 'docker-credential-desktop.exe'
$publicUrl = 'https://heftiness-ship-laboring.ngrok-free.dev'

if (-not (Test-Path -LiteralPath $dockerExe)) {
  throw "Khong tim thay Docker CLI tai: $dockerExe"
}
if (-not (Test-Path -LiteralPath $dockerCredentialHelper)) {
  throw "Khong tim thay Docker credential helper tai: $dockerCredentialHelper"
}

# docker.exe invokes helper programs by name, so its complete bin directory
# must be in PATH even when docker.exe itself is called by absolute path.
$env:Path = "$dockerBin;$env:Path"

Write-Host 'Dang build va khoi dong ung dung tren 127.0.0.1:3000...'
& $dockerExe compose `
  -f (Join-Path $PSScriptRoot 'docker-compose.production.yml') `
  -f (Join-Path $PSScriptRoot 'docker-compose.ngrok.yml') `
  up -d --build --force-recreate workshop-curator

if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose ket thuc voi ma loi $LASTEXITCODE."
}

Write-Host 'Dang cho health endpoint san sang...'
$health = $null
for ($attempt = 1; $attempt -le 30; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2
    if ($health.status -eq 'ok') {
      break
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $health -or $health.status -ne 'ok') {
  throw 'Ung dung khong san sang tai http://127.0.0.1:3000/api/health sau 30 giay.'
}
if ($null -eq $health.zoomWebhook) {
  throw 'Ung dung dang chay van la ban cu. Hay dung container workshop-curator cu roi chay lai script de rebuild image moi.'
}

Write-Host "Ung dung da san sang. Dang mo ngrok tai $publicUrl"
Write-Host "Webhook: $publicUrl/api/zoom/webhook"
Write-Host "Zoom App: $publicUrl/zoom-app"
Write-Host 'Giu cua so nay mo trong suot luc thu Zoom App.'

# Reuse an already-running tunnel when possible. This prevents the common
# "endpoint already online" error after rebuilding the Docker container.
$existingTunnel = $null
try {
  $existingTunnel = (Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2).tunnels |
    Where-Object { $_.public_url -eq $publicUrl } |
    Select-Object -First 1
} catch {
  # The inspector is optional; ngrok below will be started if it is absent.
}

if ($existingTunnel) {
  Write-Host "Ngrok da dang chay va dang tro toi $($existingTunnel.config.addr)."
  Write-Host 'Chi rebuild ung dung; giu cua so ngrok hien tai mo.'
  exit 0
}

$ngrokCommand = Get-Command ngrok.exe -ErrorAction SilentlyContinue
if (-not $ngrokCommand) {
  $ngrokCommand = Get-Command ngrok -ErrorAction SilentlyContinue
}
if (-not $ngrokCommand) {
  throw 'Khong tim thay ngrok trong PATH va khong co tunnel ngrok dang chay.'
}

# Use the explicit IPv4 address. On this machine, localhost resolves to ::1,
# where another process answers with 404 instead of the Docker-published app.
& $ngrokCommand.Source http 'http://127.0.0.1:3000' --url $publicUrl

if ($LASTEXITCODE -ne 0) {
  throw "ngrok ket thuc voi ma loi $LASTEXITCODE. Neu endpoint dang online, hay tat cua so ngrok cu roi chay lai script."
}
