# ==============================================================================
# Handsfree Local AI Setup Script - Qwen2.5-1.5B-Instruct (Windows PowerShell)
# ==============================================================================
# Sets up and runs Qwen2.5-1.5B-Instruct locally for Handsfree natural-language
# command interpretation using either Ollama (recommended) or llama.cpp (GGUF).
# ==============================================================================

param(
    [string]$Runtime = "ollama",          # "ollama" or "llama.cpp"
    [string]$Model = "qwen2.5:1.5b",       # Model tag or GGUF filename
    [int]$Port = 11434,                   # 11434 for Ollama, 8080 for llama-server
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Handsfree Local AI Setup: Qwen2.5-1.5B-Instruct" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Target Model: Qwen2.5-1.5B-Instruct (4-bit quantized)"
Write-Host "Runtime: $Runtime"
Write-Host ""

# 1. System Memory & Disk Check
Write-Host "[1/4] Checking system resources..." -ForegroundColor Yellow
try {
    $os = Get-CimInstance Win32_OperatingSystem
    $freeRamGb = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
    $totalRamGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
    Write-Host "  RAM: ${freeRamGb} GB free out of ${totalRamGb} GB" -ForegroundColor Green

    if ($freeRamGb -lt 2.0) {
        Write-Warning "Available RAM is below 2.0 GB. Qwen2.5-1.5B (4-bit) requires ~1.2 GB of RAM."
    }

    $drive = Get-PSDrive C
    $freeDiskGb = [math]::Round($drive.Free / 1GB, 2)
    Write-Host "  Disk (C:): ${freeDiskGb} GB free" -ForegroundColor Green

    if ($freeDiskGb -lt 3.0) {
        Write-Error "Insufficient disk space: At least 3.0 GB free disk space is required."
    }
} catch {
    Write-Host "  Could not inspect full hardware telemetry: $_" -ForegroundColor DarkGray
}

# 2. Runtime Detection
Write-Host "`n[2/4] Detecting runtime ($Runtime)..." -ForegroundColor Yellow

if ($Runtime -eq "ollama") {
    $ollamaCmd = Get-Command "ollama" -ErrorAction SilentlyContinue

    if (-not $ollamaCmd) {
        # Check standard installation directory
        $userOllama = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
        if (Test-Path $userOllama) {
            $ollamaCmd = $userOllama
            $env:Path += ";$(Split-Path $userOllama)"
        }
    }

    if (-not $ollamaCmd) {
        Write-Host "  Ollama was not detected in PATH." -ForegroundColor Red
        Write-Host "  Please install Ollama from https://ollama.com/download/windows" -ForegroundColor Yellow
        Write-Host "  After installation, re-run this script."
        exit 1
    }

    Write-Host "  Found Ollama executable: $ollamaCmd" -ForegroundColor Green

    # Verify if Ollama daemon is active
    $serverRunning = $false
    try {
        $res = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($res) { $serverRunning = $true }
    } catch {
        $serverRunning = $false
    }

    if (-not $serverRunning) {
        Write-Host "  Starting Ollama local server in background..." -ForegroundColor Yellow
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
        Start-Sleep -Seconds 3
    }

    # 3. Pull / Verify Model
    Write-Host "`n[3/4] Checking model presence: $Model..." -ForegroundColor Yellow
    try {
        $tags = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 5
        $hasModel = ($tags.models | Where-Object { $_.name -like "*$Model*" })
        if ($hasModel) {
            Write-Host "  Model '$Model' is already installed!" -ForegroundColor Green
        } else {
            Write-Host "  Pulling Qwen2.5-1.5B ($Model)... This may take 1-3 minutes (~1.0 GB download)." -ForegroundColor Cyan
            & ollama pull $Model
            Write-Host "  Model download completed successfully!" -ForegroundColor Green
        }
    } catch {
        Write-Warning "Could not query /api/tags directly. Attempting 'ollama pull $Model' directly..."
        & ollama pull $Model
    }

    # 4. Verification Test
    Write-Host "`n[4/4] Verifying inference endpoint..." -ForegroundColor Yellow
    try {
        $testPayload = @{
            model = $Model
            prompt = 'Output valid JSON: {"status": "ready"}'
            format = "json"
            stream = $false
        } | ConvertTo-Json

        $testRes = Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method Post -Body $testPayload -ContentType "application/json" -TimeoutSec 10
        Write-Host "  Local AI endpoint test response received:" -ForegroundColor Green
        Write-Host "  $($testRes.response)" -ForegroundColor Gray
        Write-Host "`n>> Qwen2.5-1.5B is UP and RUNNING on http://localhost:11434 <<" -ForegroundColor Green
    } catch {
        Write-Warning "Test query note: $_"
    }

} elseif ($Runtime -eq "llama.cpp") {
    $llamaServer = Get-Command "llama-server" -ErrorAction SilentlyContinue
    if (-not $llamaServer) {
        Write-Host "  llama-server not found in PATH." -ForegroundColor Yellow
        Write-Host "  To use llama.cpp on Windows:"
        Write-Host "    1. Download llama.cpp binaries from: https://github.com/ggerganov/llama.cpp/releases"
        Write-Host "    2. Download Qwen2.5-1.5B-Instruct GGUF (e.g. qwen2.5-1.5b-instruct-q4_k_m.gguf) into ./models/"
        Write-Host "    3. Run: llama-server -m ./models/qwen2.5-1.5b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 8080 -c 4096"
        exit 1
    }

    Write-Host "  Found llama-server at: $llamaServer" -ForegroundColor Green
    Write-Host "  Launch command:" -ForegroundColor Cyan
    Write-Host "    llama-server -m ./models/$Model --host 127.0.0.1 --port $Port -c 4096"
}

Write-Host "`nHandsfree Extension Configuration:" -ForegroundColor Cyan
Write-Host "  1. In Chrome, open Handsfree Settings -> AI Brain"
Write-Host "  2. Provider: Ollama (or OpenAI-Compatible)"
Write-Host "  3. Endpoint: http://localhost:11434 (or http://127.0.0.1:8080)"
Write-Host "  4. Model: $Model"
Write-Host "  5. Click 'Test Connection & Detect Models' button."
Write-Host "==========================================================" -ForegroundColor Cyan
