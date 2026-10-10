#!/usr/bin/env bash
# ==============================================================================
# Handsfree Local AI Setup Script - Qwen2.5-1.5B-Instruct (Linux/macOS)
# ==============================================================================

set -e

RUNTIME="${1:-ollama}"
MODEL="${2:-qwen2.5:1.5b}"
PORT="${3:-11434}"

echo "=========================================================="
echo "  Handsfree Local AI Setup: Qwen2.5-1.5B-Instruct"
echo "=========================================================="
echo "Target Model: Qwen2.5-1.5B-Instruct (4-bit quantized)"
echo "Runtime: $RUNTIME"

if [ "$RUNTIME" = "ollama" ]; then
    if ! command -v ollama &> /dev/null; then
        echo "Ollama is not installed. Install via: curl -fsSL https://ollama.com/install.sh | sh"
        exit 1
    fi

    echo "[1/3] Ensuring Ollama daemon is active..."
    if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "Starting Ollama server..."
        ollama serve > /dev/null 2>&1 &
        sleep 3
    fi

    echo "[2/3] Pulling Qwen2.5-1.5B-Instruct ($MODEL)..."
    ollama pull "$MODEL"

    echo "[3/3] Verifying inference endpoint..."
    curl -s -X POST http://localhost:11434/api/generate \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"$MODEL\", \"prompt\": \"Output valid JSON: {\\\"status\\\": \\\"ready\\\"}\", \"format\": \"json\", \"stream\": false}" \
        | grep -q "status" && echo ">> Qwen2.5-1.5B is ready on http://localhost:11434 <<"

elif [ "$RUNTIME" = "llama.cpp" ]; then
    if ! command -v llama-server &> /dev/null; then
        echo "llama-server not found in PATH."
        echo "Compile or download llama.cpp: https://github.com/ggerganov/llama.cpp"
        exit 1
    fi
    echo "Starting llama-server with Qwen2.5-1.5B-Instruct..."
    llama-server -m "./models/$MODEL" --host 127.0.0.1 --port "$PORT" -c 4096
fi
