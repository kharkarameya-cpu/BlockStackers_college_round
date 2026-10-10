# Chrome Web Store Listing — Handsfree

> Single source of truth for Handsfree extension metadata, permissions justifications, and privacy disclosures.

**Last Updated:** 2026-10-10  
**Current Version:** 1.0.0  

---

## 1. Extension Overview

- **Name:** Handsfree — Intent-Aware Browser Navigation
- **Short Description:** Navigate websites hands-free using head movement and voice commands with intent awareness and safe activation.
- **Category:** Accessibility
- **Default Language:** English

---

## 2. Detailed Description

Handsfree enables individuals with motor impairments, temporary injuries, or repetitive strain difficulties to browse websites comfortably without touching a mouse or keyboard.

Unlike basic head-tracking tools, Handsfree is built with intent-awareness to prevent accidental clicks:
- **Calibrated Head Cursor:** Smooth, natural cursor movement powered by on-device computer vision and an adaptive One Euro Filter that cancels jitter when looking at targets.
- **Safe Pause & Recovery:** Automatically freezes pointer activation whenever you look away or when tracking confidence drops.
- **30-Second Guided Calibration:** Set up comfortable posture, movement ranges, and dead zones in under 30 seconds.
- **Uncertainty Lens:** Real-time visual feedback on tracking stability.
- **Isolated In-Page Overlay:** Clean, high-contrast cursor and controls that work across standard web pages without interfering with page styles.

All perception is performed 100% on-device. No camera footage or voice recordings are ever stored or sent to remote servers.

---

## 3. Permissions Justification

| Permission | Justification |
| :--- | :--- |
| `storage` | Required to save your personalized calibration profile, cursor sensitivity, and dwell preferences locally on your computer. |
| `offscreen` | Required to host background vision processing so head tracking continues smoothly across browser tabs without slowing down the active page. |
| `tabs` | Required to communicate cursor coordinate updates to the active web tab. |
| `activeTab` | Required to enable the in-page cursor overlay on the active website when requested by the user. |

---

## 4. Privacy & Data Use Disclosure

- **Camera & Microphone:** Used solely in real-time on your computer to estimate head movement and recognize spoken commands. Raw camera frames and audio are never recorded, saved, or uploaded to any cloud service.
- **Website Content:** Only interacted with locally via standard browser click and scroll events. No page contents are collected or logged.
- **Telemetry:** Purely local performance measurements stored on-device to help you adjust sensitivity.

---

## 5. Version History

- **v1.0.0 (2026-10-10):**
  - Initial release with Manifest V3 support.
  - MediaPipe Tasks Vision Face Landmarker head pose estimation.
  - One Euro Filter 2D cursor smoothing with dead-zone support.
  - 30-second guided onboarding and calibration wizard.
  - In-page closed Shadow DOM overlay with cursor, uncertainty halo, dwell indicator, and HUD.
  - Safe pause-on-tracking-loss behavior.
