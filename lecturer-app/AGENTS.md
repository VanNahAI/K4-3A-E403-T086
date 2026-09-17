# Lecturer App — Agentic Coding Guide & Architecture Specification (`lecturer-app/AGENTS.md`)

> **For AI Coding Agents (Antigravity, Cursor, Claude Code, GitHub Copilot) & Teammates:**
> Read this file before making any edits or improvements to the lecturer cockpit or host tools.

---

## 1. Role & Mission of Lecturer App
The `lecturer-app` module gives the instructor and Teaching Assistants (TAs) **complete cockpit visibility** over the workshop Q&A flow:
1. **Realtime Dual Workspace (`index.html`):**
   - **Left Panel:** Ingests live Zoom chat log entries and Web submissions with timestamp badges.
   - **Right Panel:** Dynamically ranks question clusters by frequency, priority, and velocity.
2. **Cháy Chat Radar (Velocity Spike Alert):** Sliding-window monitor alerting when $\ge 4$ students get stuck on the same issue within 30 seconds.
3. **Web Speech API Voice Mirror:** Web speech recognition (`webkitSpeechRecognition`) in Vietnamese (`vi-VN`) converting spoken teacher explanations into Ground Truth FAQs in $< 1.5$s.
4. **HAX G9 Human-in-the-Loop Controls:** 1-click split/merge controls allowing the teacher to correct any AI clustering errors instantly.
5. **Zoom Chat Bridge (`zoom_bridge.js`):** Regex parser converting Zoom timestamped chat exports into structured message objects.
6. **1-Click Discord Recap:** Generates clean, ready-to-post Discord Markdown summaries for post-workshop archiving.

---

## 2. Key Files & Components

```text
lecturer-app/
├── index.html            # Fullscreen Cockpit (Screen 0: Setup, Screen 1: Live, Screen 2: Summary)
├── app.js                # Master Cockpit Controller & UI State Machine
├── pip_lecturer.html     # Floating Host PiP Companion (ghim nổi cạnh Zoom)
├── pip_lecturer.js       # Host PiP logic (quick mic explanation & deflection counter)
├── zoom_bridge.js        # Parser for Zoom chat logs & REST bridge
├── zoom_room.html        # Interactive Zoom meeting simulation stage
├── zoom_room.js          # Zoom stage controller
├── zoom_room.css         # Zoom stage styling
└── style.css             # Main cockpit dark-mode design system
```

---

## 3. UI State & Lifecycle Management (`app.js`)

### App Screens:
- `screen-0`: Setup, workshop topic selection, and QR code projection.
- `screen-1`: Active live cockpit with real-time stream ingestion, cluster ranking, radar alert, and tabs (`active`, `echo`, `review`, `answered`, `filtered`).
- `screen-2`: Post-workshop summary, unresolved question report, and Discord markdown generator.

### Cluster Actions:
- **`explainClusterVoice(clusterId)`**: Starts microphone recording, transcribes Vietnamese speech, synthesizes canonical FAQ answer, and broadcasts `broadcast_faq_resolved` to all students.
- **`splitCluster(clusterId)`**: HAX G9 rule — separates misclustered questions into a new independent cluster.
- **`dismissRadarBanner()`**: Dismisses the velocity alert banner.

---

## 4. Coding Rules for AI Agents
1. **Graceful Speech Recognition:** Always check `window.webkitSpeechRecognition || window.SpeechRecognition`. If unavailable or denied, fall back to modal text input.
2. **WebSocket Synchronization:** When a cluster is resolved, broadcast the event via WebSocket (`type: 'broadcast_faq_resolved'`) so all connected students receive the update immediately.
3. **No Dev Test Artifacts in UI:** Keep the cockpit clean of hardcoded test buttons or fake canned loops. Ingestion must use the live WebSocket feed or manual question input.
