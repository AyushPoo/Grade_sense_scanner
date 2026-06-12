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

$BuildGradlePath = Join-Path $AndroidDir "app\build.gradle"
$BuildGradleContent = Get-Content $BuildGradlePath -Raw

$VersionCode = [regex]::Match($BuildGradleContent, 'versionCode\s+(\d+)').Groups[1].Value
$VersionName = [regex]::Match($BuildGradleContent, 'versionName\s+"([^"]+)"').Groups[1].Value

if (-not $VersionCode -or -not $VersionName) {
  throw "Failed to parse versionCode or versionName from $BuildGradlePath"
}

# Automatically auto-increment version code and name for the next build
$NewVersionCode = [int]$VersionCode + 1
$VersionParts = $VersionName.Split('.')
if ($VersionParts.Length -eq 3) {
  $NewPatch = [int]$VersionParts[2] + 1
  $NewVersionName = "$($VersionParts[0]).$($VersionParts[1]).$NewPatch"
} else {
  $NewVersionName = $VersionName
}

Write-Host "Auto-incrementing build versions in build.gradle:"
Write-Host "  Version Code: $VersionCode -> $NewVersionCode"
Write-Host "  Version Name: $VersionName -> $NewVersionName"

$BuildGradleContent = $BuildGradleContent -replace "versionCode\s+$VersionCode", "versionCode $NewVersionCode"
$BuildGradleContent = $BuildGradleContent -replace "versionName\s+`"$VersionName`"", "versionName `"$NewVersionName`""
Set-Content -Path $BuildGradlePath -Value $BuildGradleContent

# Update local script variables with the newly incremented values
$VersionCode = $NewVersionCode
$VersionName = $NewVersionName


$env:GRADESENSE_UPLOAD_STORE_FILE = $KeystorePath.Path
$env:GRADESENSE_UPLOAD_STORE_PASSWORD = $Credentials.android.keystore.keystorePassword
$env:GRADESENSE_UPLOAD_KEY_ALIAS = $Credentials.android.keystore.keyAlias
$env:GRADESENSE_UPLOAD_KEY_PASSWORD = $Credentials.android.keystore.keyPassword
$env:NODE_ENV = "production"
$env:GRADLE_OPTS = "-Dfile.encoding=UTF-8"
$env:CMAKE_BUILD_PARALLEL_LEVEL = "1"
$env:EXPO_PUBLIC_BACKEND_URL = "https://gradesense-scanner-backend.onrender.com"
$env:EXPO_PUBLIC_WEBAPP_URL = "https://app.gradesense.in"
$env:EXPO_PUBLIC_GOOGLE_CLIENT_ID = "952978433882-f15al0p4202d9m5lj7n7c1n1j25o7pcg.apps.googleusercontent.com"
$env:EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID = "952978433882-paueq6l9gqjgioc5f22nlrggt9dp29o0.apps.googleusercontent.com"

$GradleArgs = @("--no-daemon", "--no-parallel", "--max-workers=1", "-PreactNativeParallelCxxBuilds=false", "-Pandroid.cxxFlags=-g0")
if ($Arm64Only) {
  $GradleArgs += "-PreactNativeArchitectures=arm64-v8a"
}
$GradleArgs += ":app:bundleRelease"

Write-Host "Pre-cleaning build caches and C++ .cxx build directories for the app module to ensure compile accuracy..."
Remove-Item -Path (Join-Path $AndroidDir "app\build"), (Join-Path $AndroidDir "app\.cxx"), (Join-Path $AndroidDir ".gradle"), (Join-Path $AndroidDir "build") -Recurse -Force -ErrorAction SilentlyContinue


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
$OriginalBundleName = $Bundle.FullName
$OriginalSize = ($Bundle.Length / 1MB)

# Create the builds directory if it doesn't exist
$BuildsDir = Join-Path $ProjectRoot "builds"
if (-not (Test-Path $BuildsDir)) {
  New-Item -ItemType Directory -Path $BuildsDir -Force | Out-Null
}

# Copy the file to builds folder using the convention: GradeSense-<version>-<versionCode>-release-bundle-new.aab
$DestAabName = "GradeSense-$VersionName-$VersionCode-release-bundle-new.aab"
$DestAabPath = Join-Path $BuildsDir $DestAabName
Copy-Item -Path $OriginalBundleName -Destination $DestAabPath -Force

if (-not (Test-Path $DestAabPath)) {
  throw "Failed to copy AAB bundle to destination $DestAabPath."
}

Write-Host "Android App Bundle copied and ready:"
Write-Host $DestAabPath
Write-Host ("Size: {0:N2} MB" -f $OriginalSize)

# Clean up build caches to prevent bloat
Write-Host "Cleaning up Gradle build caches and temporary files to prevent bloat..."
Remove-Item -Path (Join-Path $AndroidDir "app\build"), (Join-Path $AndroidDir "app\.cxx"), (Join-Path $AndroidDir ".gradle"), (Join-Path $AndroidDir "build") -Recurse -Force -ErrorAction SilentlyContinue

Get-ChildItem -Path (Join-Path $ProjectRoot "node_modules") -Filter "build" -Directory -Recurse -ErrorAction SilentlyContinue | 
  Where-Object { $_.Parent.Name -eq "android" } | 
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Get-ChildItem -Path (Join-Path $ProjectRoot "node_modules") -Filter ".cxx" -Directory -Recurse -ErrorAction SilentlyContinue | 
  Where-Object { $_.Parent.Name -eq "android" } | 
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue


$ScannerRoot = Resolve-Path (Join-Path $ProjectRoot "..")
Remove-Item -Path (Join-Path $ScannerRoot "hs_err_pid*.log"), (Join-Path $ScannerRoot "replay_pid*.log") -Force -ErrorAction SilentlyContinue

Write-Host "Cleanup complete! All stale build caches purged."
