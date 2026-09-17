# 📱 Student App Module

The attendee-facing interface for the **Workshop Question Curator** system. Supports smartphone mobile access and floating in-meeting companion mode.

---

## 📁 Directory Layout

```text
student-app/
├── student.html          # Mobile web portal (accessed via classroom QR code)
├── student.js            # Client-side WebSocket sync, deflection, and FAQ feed
├── pip_student.html      # Floating Picture-in-Picture companion for Zoom
├── pip_student.js        # PiP companion controller
├── style.css             # Responsive theme stylesheet
├── AGENTS.md             # Developer & AI Agent coding rules for this module
└── README.md             # This document
```

---

## 🌐 URLs & Access Points

When `server.js` is running:
- **Mobile Portal:** `http://localhost:3000/student`
- **Workshop Entry (Role Selector):** `http://localhost:3000/?role=student`
- **Floating PiP Window:** `http://localhost:3000/pip?role=student`

---

## ✨ Key Features
1. **Pre-submit Deflection:** Suggests verified answers while the student types before submitting.
2. **Instant Echo Reply (< 5ms):** Auto-delivers the lecturer's verified answer when a duplicate question is asked.
3. **Live FAQ Feed:** Displays all questions explained by the lecturer in real time.
4. **Always-on-top Companion:** The `📌 Ghim` action uses Document Picture-in-Picture on supported Chrome/Edge desktop browsers and falls back to the regular pop-up otherwise.
