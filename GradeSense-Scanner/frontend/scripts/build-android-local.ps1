param(
  [switch]$Arm64Only
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$AndroidDir = Join-Path $ProjectRoot "android"
$CredentialsPath = Join-Path $ProjectRoot "credentials.json"
$BundlePath = Join-Path $AndroidDir "app\build\outputs\bundle\release\app-release.aab"
$EnvPath = Join-Path $ProjectRoot ".env"
$EnvBackupPath = Join-Path $ProjectRoot ".env.local-build-backup"
$ReleaseEnvContent = @"
EXPO_PUBLIC_BACKEND_URL="https://gradesense-scanner-backend.onrender.com"
EXPO_PUBLIC_WEBAPP_URL="https://app.gradesense.in"
EXPO_PUBLIC_GOOGLE_CLIENT_ID="952978433882-f15al0p4202d9m5lj7n7c1n1j25o7pcg.apps.googleusercontent.com"
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID="952978433882-paueq6l9gqjgioc5f22nlrggt9dp29o0.apps.googleusercontent.com"
"@

if (-not (Test-Path $CredentialsPath)) {
  throw "Missing credentials.json. Export or download the Android upload keystore credentials before building."
}

if (-not $env:JAVA_HOME) {
  $DefaultJavaHome = "F:\Android\jbr"
  if (Test-Path $DefaultJavaHome) {
    $env:JAVA_HOME = $DefaultJavaHome
  }
}

if (-not $env:ANDROID_HOME) {
  $DefaultAndroidHome = "F:\sdk"
  if (Test-Path $DefaultAndroidHome) {
    $env:ANDROID_HOME = $DefaultAndroidHome
  }
}

if (-not $env:ANDROID_SDK_ROOT -and $env:ANDROID_HOME) {
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
}

$Credentials = Get-Content $CredentialsPath | ConvertFrom-Json
$KeystorePath = Resolve-Path (Join-Path $ProjectRoot $Credentials.android.keystore.keystorePath)

$env:GRADESENSE_UPLOAD_STORE_FILE = $KeystorePath.Path
$env:GRADESENSE_UPLOAD_STORE_PASSWORD = $Credentials.android.keystore.keystorePassword
$env:GRADESENSE_UPLOAD_KEY_ALIAS = $Credentials.android.keystore.keyAlias
$env:GRADESENSE_UPLOAD_KEY_PASSWORD = $Credentials.android.keystore.keyPassword
$env:NODE_ENV = "production"
$env:GRADLE_OPTS = "-Dfile.encoding=UTF-8"
$env:EXPO_PUBLIC_BACKEND_URL = "https://gradesense-scanner-backend.onrender.com"
$env:EXPO_PUBLIC_WEBAPP_URL = "https://app.gradesense.in"
$env:EXPO_PUBLIC_GOOGLE_CLIENT_ID = "952978433882-f15al0p4202d9m5lj7n7c1n1j25o7pcg.apps.googleusercontent.com"
$env:EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID = "952978433882-paueq6l9gqjgioc5f22nlrggt9dp29o0.apps.googleusercontent.com"

$GradleArgs = @("--no-daemon", "--no-parallel", "--max-workers=1")
if ($Arm64Only) {
  $GradleArgs += "-PreactNativeArchitectures=arm64-v8a"
}
$GradleArgs += ":app:bundleRelease"

if (Test-Path $EnvBackupPath) {
  Remove-Item -Force $EnvBackupPath
}

$HadEnvFile = Test-Path $EnvPath
if ($HadEnvFile) {
  Move-Item -Force $EnvPath $EnvBackupPath
}

Push-Location $AndroidDir
try {
  Set-Content -NoNewline -Path $EnvPath -Value $ReleaseEnvContent
  & ".\gradlew.bat" @GradleArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle bundleRelease failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
  Remove-Item -Force $EnvPath -ErrorAction SilentlyContinue
  if ($HadEnvFile -and (Test-Path $EnvBackupPath)) {
    Move-Item -Force $EnvBackupPath $EnvPath
  }
}

if (-not (Test-Path $BundlePath)) {
  throw "Build completed but app-release.aab was not found at $BundlePath."
}

$Bundle = Get-Item $BundlePath
Write-Host "Android App Bundle ready:"
Write-Host $Bundle.FullName
Write-Host ("Size: {0:N2} MB" -f ($Bundle.Length / 1MB))
