# 👨‍🏫 Lecturer App Module

The command-and-control cockpit for instructors and Teaching Assistants in the **Workshop Question Curator** system.

---

## 📁 Directory Layout

```text
lecturer-app/
├── index.html            # Fullscreen Cockpit dashboard (Setup, Live, Summary)
├── app.js                # State machine & WebSocket synchronizer
├── pip_lecturer.html     # Floating Host PiP companion window
├── pip_lecturer.js       # Host PiP logic & voice explanation
├── zoom_bridge.js        # Parser for Zoom chat logs & REST bridge
├── zoom_room.html        # Interactive Zoom meeting simulation stage
├── zoom_room.js          # Zoom stage controller
├── zoom_room.css         # Zoom stage styling
├── style.css             # Main cockpit design system
├── AGENTS.md             # Developer & AI Agent coding rules for this module
└── README.md             # This document
```

---

## 🌐 URLs & Access Points

When `server.js` is running:
- **Full Dashboard Cockpit:** `http://localhost:3000/lecturer`
- **Workshop Entry (Lecturer Role):** `http://localhost:3000/?role=lecturer`
- **Floating Host PiP:** `http://localhost:3000/pip?role=lecturer`
- **Zoom Meeting Stage Simulation:** `http://localhost:3000/room`

---

## ✨ Key Capabilities
1. **🔥 Cháy Chat Radar:** Real-time velocity spike detection ($\ge 4$ students / 30s).
2. **🎙️ Voice-to-FAQ Mirror:** Instant speech-to-text resolution using Web Speech API in Vietnamese.
3. **✂️ HAX G9 Human Correction:** 1-click cluster splitting for AI misclassification recovery.
4. **📢 1-Click Discord Recap:** Instant post-workshop Discord markdown generator.
5. **📌 Always-on-top Host Companion:** Uses Document Picture-in-Picture on supported Chrome/Edge desktop browsers while preserving live cockpit state during pin/unpin handoff.
