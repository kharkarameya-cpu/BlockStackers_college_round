# Handsfree — Intent-Aware Browser Navigation

> An intent-aware, voice-and-webcam-controlled browser extension that enables people to browse websites without relying on a conventional mouse or keyboard.

---

## 🌟 Overview & Core Differentiators

Handsfree is not merely a webcam mouse with speech recognition bolted on. It is an **intent-aware accessibility system** built for Google Chrome (Manifest V3) that combines:

1. **Precision Head-Tracking & Smoothing:** MediaPipe Face Landmarker with an adaptive **One Euro Filter** (`1€ Filter`) for high stability at rest and low latency during movement.
2. **Safe Pause on Tracking Loss:** Instantly halts cursor motion and cancels pending dwell actions if the user's face is obscured, poor lighting occurs, or the user turns away from the screen.
3. **Interactive 30-Second Guided Calibration:** A user-guided wizard to calibrate neutral posture, comfortable yaw/pitch range, dead zones, and dwell activation.
4. **Isolated In-Page Shadow DOM Overlay:** Renders a non-intrusive cursor, an **Uncertainty Lens** halo representing tracking variability, dwell progress ring, and an always-accessible HUD with an instant Pause/Resume shortcut (`Esc`).
5. **Privacy-First Architecture:** 100% on-device vision processing via WebAssembly and WebGL. Zero camera video, photos, or voice audio are ever saved or transmitted.

---

## 🛠️ Tech Stack

* **Platform:** Chrome Extension Manifest V3
* **Language:** TypeScript with strict type checking
* **UI:** React 19, Vite 6, Tailwind CSS, Lucide Icons
* **Perception:** MediaPipe Tasks Vision (Face Landmarker) with optical skin-luminance fallback
* **Filtering:** One Euro Filter (Casiez, Roussel, Vogel CHI 2012)
* **Testing:** Vitest

---

## 🚀 How to Install and Load in Google Chrome

### 1. Build the Extension
```bash
# Install dependencies
npm install

# Run unit tests
npm test

# Build production bundle
npm run build
```

This compiles all extension pages, generates compliant PNG icon assets (16x16, 48x48, 128x128), and outputs the extension bundle into the `dist/` directory.

### 2. Load into Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click the **Load unpacked** button.
4. Select the `dist/` folder inside this project directory (`gdg-project-bitndbuild/dist`).
5. The **Handsfree — Intent-Aware Browser Navigation** extension will appear in your extensions list.

---

## 🎯 Computer Vision Verification & Diagnostics

To test and visually inspect the MediaPipe computer vision subsystem independently:

1. **Open the Diagnostics View:**
   * Click the Handsfree toolbar icon and select **Vision Diagnostics & Mesh Preview**, or open `chrome-extension://<id>/diagnostics.html` directly in Chrome.
2. **Start Camera Perception:**
   * Click the **Start Camera** button. The camera stream is requested only upon this explicit user gesture.
3. **Inspect Real-Time Perception:**
   * **Face Mesh & Irises:** Watch the live 478-landmark tessellation, eye contour lines, and iris tracking.
   * **3D Head Pose Triad:** Observe the projected 3D orientation arrows extending from the nose tip (Red = Yaw axis, Green = Pitch axis, Cyan = forward direction vector).
   * **Tracking Quality Classification:** Review the live quality pill (`OPTIMAL`, `DEGRADED`, `INSUFFICIENT`, `LOST`).
   * **Multi-Face Handling:** Have a second person enter the camera frame — notice the yellow alert banner and immediate degradation of tracking quality to prevent erratic input.
   * **Resource Release:** Click **Stop Camera** to stop all video tracks and verify that the webcam hardware indicator turns off immediately.

---

## 🎯 Guided Calibration Workflow

1. **Launch Setup:**
   * Click the Handsfree toolbar icon and select **Recalibrate (30s)**, or open `chrome-extension://<id>/onboarding.html`.
2. **Grant Camera Access:**
   * Review the privacy disclosure and click **Enable Camera & Begin Calibration**.
3. **Calibrate Neutral Center:**
   * Look directly at the crosshair and hold still for 3 seconds. The system calculates your personal neutral head pose offset.
4. **Movement Range & Target Practice:**
   * Move your head across the 4 practice targets. Notice how the One Euro Filter eliminates cursor tremors while dwell-clicking each target smoothly.
5. **Browse Any Website:**
   * Open any website (e.g. `https://en.wikipedia.org` or any news site).
   * Notice the sleek in-page overlay with the cursor dot and Uncertainty Lens halo.
   * Dwell on any link or button to activate it.
   * Press <kbd>Esc</kbd> anytime to pause or resume tracking.

---

## 🤖 Local AI Command Interpreter (Qwen2.5-1.5B-Instruct)

Handsfree integrates **Qwen2.5-1.5B-Instruct** (quantized 4-bit GGUF) as an on-device, natural-language reasoning engine that converts spoken commands and complex intent into structured, safe browser action plans.

### 🌟 Key Local AI Features
1. **100% On-Device & Private:** Runs entirely on `localhost`. Zero cloud API keys, zero external data leaks, and webcam/biometric data are **never** forwarded to the LLM.
2. **Observe-Plan-Act-Verify Architecture:** Rather than executing blind sequences, Handsfree samples a compact DOM accessibility representation (<1500 tokens), requests an action plan, validates it against a strict Zod schema, displays an in-page Action Plan HUD, executes one action at a time, and verifies postconditions.
3. **Safety & Consequential Action Gating:** Non-reversible actions (form submission, purchases, sending messages, deletions) require explicit user confirmation via dialog and Handsfree speech confirmation before proceeding.
4. **Prompt-Injection Hardening:** Webpage text is enclosed inside `<untrusted_page_context>` XML wrappers and strictly isolated from command interpretation instructions.
5. **Flexible Local Inference Runtimes:** Natively supports both **Ollama** and **llama.cpp** (`llama-server`).

---

## ⚡ Quick Start: Local Model Setup

### Option A: Using Ollama (Recommended)

1. **Install Ollama:**
   - Windows / macOS / Linux: Download from [https://ollama.com](https://ollama.com).
2. **Automated Setup Script:**
   - **Windows (PowerShell):**
     ```powershell
     powershell -ExecutionPolicy Bypass -File ./scripts/setup-qwen.ps1
     ```
   - **Linux / macOS (Bash):**
     ```bash
     chmod +x ./scripts/setup-qwen.sh
     ./scripts/setup-qwen.sh
     ```
   This script verifies disk/RAM availability, ensures Ollama is running, and pulls `qwen2.5:1.5b` (approx. 986 MB).
3. **Manual Command:**
   ```bash
   ollama pull qwen2.5:1.5b
   ollama run qwen2.5:1.5b
   ```
   The local REST API will be accessible at `http://localhost:11434`.

---

### Option B: Using llama.cpp (`llama-server`)

1. **Download llama.cpp:**
   - Obtain pre-built binaries for your OS from the official [llama.cpp releases](https://github.com/ggerganov/llama.cpp/releases).
2. **Download Qwen2.5-1.5B-Instruct GGUF:**
   - Download the official quantized GGUF (`qwen2.5-1.5b-instruct-q4_k_m.gguf`, Apache 2.0 license) from Hugging Face:
     ```bash
     huggingface-cli download Qwen/Qwen2.5-1.5B-Instruct-GGUF qwen2.5-1.5b-instruct-q4_k_m.gguf --local-dir ./models
     ```
3. **Launch the Inference Server:**
   ```bash
   llama-server -m ./models/qwen2.5-1.5b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 8080 -c 4096
   ```
4. **Configure Handsfree Options:**
   - Open Handsfree Options (`chrome-extension://<id>/options.html`).
   - Select **llama.cpp (OpenAI-compatible)**.
   - Set endpoint to `http://127.0.0.1:8080/v1/chat/completions`.
   - Click **Test Connection**.

---

## 🔒 Security & Privacy Guarantees

* **Zero Cloud Fallback:** Handsfree will **never** silently fall back to cloud AI or commercial APIs. If your local model is stopped, Handsfree will display a clear `Local AI Offline` badge and guide you to start the server.
* **No Biometric Data:** MediaPipe landmarks, camera frames, and user coordinates are never serialized or sent to the model endpoint.
* **Bounded Plan Schema:** Plans are restricted to a maximum of 10 steps, strictly validated against registered browser actions (`navigate`, `click`, `fill`, `press_key`, `scroll`, `select`, `wait`, `extract_text`, `compare_items`, `go_back`, `clarify`). Arbitrary JavaScript and `eval()` execution are strictly forbidden.
* **Localhost Scoped Host Permissions:** The extension manifest requests `http://localhost/*` and `http://127.0.0.1/*` strictly for background service worker communication with local inference runtimes.

---

## 📋 Supported Natural-Language Command Examples

* *"Open YouTube and search for Minecraft redstone tutorials."*
* *"Find the cheapest laptop on this page and open its details."*
* *"Scroll down until you reach the customer reviews."*
* *"Go back to the previous page."*
* *"Fill the contact form with my name."*
* *"Open the second search result."*
* *"Read the headings on this page."*
* *"Stop what you are doing / Cancel."*

---

## 🔧 Troubleshooting

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **"Local AI Unavailable" badge** | Model server is not running or listening on another port | Run `ollama serve` or start `llama-server`. Check port in Extension Options (`11434` vs `8080`). |
| **Connection Timeout (>8s)** | CPU-only inference overloaded or model cold start | Increase **Timeout (ms)** in Handsfree Options (e.g. to `15000ms`), or enable GPU offloading (`-ngl 99`). |
| **Invalid Plan Schema error** | Model hallucinated an unregistered action | The built-in prompt builder injects strict JSON formatting instructions. Handsfree automatically rejects malformed plans and prompts for clarification. |
| **CORS / Permission Denied** | Chrome extension host permission missing | Manifest V3 includes `http://localhost/*` and `http://127.0.0.1/*`. Ensure no third-party firewall blocks local loopback connections. |

---

## 🧪 Testing

Run the full automated test suite covering unit math, cursor mapping, prompt injection defense, schema validation, and mocked local AI client flows:

```bash
npm test
```

