# 🤖 AGENTS.md — Master Agentic Coding Guidelines for Workshop Question Curator

> **Welcome AI Coding Agent & Teammates!**  
> This repository is organized into **3 distinct, modular domains**. Read this guide before making any architectural or code changes.

---

## 1. System Architecture Overview

```text
                               +-----------------------------+
                               |     portal.html (Root)      |
                               | Workshop Entry & Zoom Link  |
                               +--------------+--------------+
                                              |
                       +----------------------+----------------------+
                       |                                             |
            +----------v----------+                       +----------v----------+
            |    student-app/     |                       |    lecturer-app/    |
            | Mobile Web & PiP    |                       | Host Cockpit & PiP  |
            +----------+----------+                       +----------+----------+
                       |                                             |
                       +----------------------+----------------------+
                                              |
                                   +----------v----------+
                                   |      server.js      |
                                   | HTTP & WebSocket    |
                                   +----------+----------+
                                              |
                                   +----------v----------+
                                   |       ai-core/      |
                                   | Semantic NLP & LLM  |
                                   +---------------------+
```

### Module Responsibilities:
1. **`ai-core/`**: Semantic clustering, 4-layer classification, intent extraction, OpenRouter/LLM fallback, Golden Set evaluation suite.
   - *Agent Instructions:* See [ai-core/AGENTS.md](file:///f:/Personal_project/MiniHack/K4-3A-E403-T086/ai-core/AGENTS.md)
2. **`student-app/`**: Student Mobile Portal, in-meeting PiP companion, pre-submit deflection, instant FAQ display.
   - *Agent Instructions:* See [student-app/AGENTS.md](file:///f:/Personal_project/MiniHack/K4-3A-E403-T086/student-app/AGENTS.md)
3. **`lecturer-app/`**: Fullscreen Host Cockpit, Cháy Chat Radar, Voice-to-FAQ Mirror, Zoom Bridge, Discord Recap.
   - *Agent Instructions:* See [lecturer-app/AGENTS.md](file:///f:/Personal_project/MiniHack/K4-3A-E403-T086/lecturer-app/AGENTS.md)

---

## 2. Server Routing Map (`server.js`)

| Route | Target | Purpose |
|---|---|---|
| `GET /` | `portal.html` | Workshop onboarding portal & Zoom connector |
| `GET /student` | `student-app/student.html` | Mobile Q&A portal for attendees |
| `GET /lecturer` | `lecturer-app/index.html` | Master Cockpit for instructors |
| `GET /pip?role=student` | `student-app/pip_student.html` | Floating Zoom companion for student |
| `GET /pip?role=lecturer` | `lecturer-app/pip_lecturer.html` | Floating Zoom companion for lecturer |
| `GET /room` | `lecturer-app/zoom_room.html` | Simulated Zoom meeting stage |
| `WS /ws` | WebSocket broker | Realtime question ingestion & FAQ broadcast |
| `POST /api/zoom-import` | Zoom Chat Bridge | Parses raw Zoom chat text |
| `POST /api/reset-session` | State Reset | Clears in-memory session FAQs for fresh testing |

---

## 3. Technology Stack & Coding Principles
1. **No Heavy Frontend Bundlers:** Built with pure Vanilla JS, modern CSS3 (glassmorphism, CSS variables, dark-mode), and HTML5. No Webpack, Vite, or npm build steps required to run the client.
2. **Deterministic Security First:** Prompt injection (Layer ③) must be filtered in $< 1$ms before any LLM inference occurs.
3. **Vietnamese Language Optimization:** All normalizers, semantic titles, stopwords, and Web Speech recognition use native Vietnamese (`vi-VN`).
4. **Resilient Offline Fallback:** If cloud LLM (OpenRouter) is offline or has no API key, the system seamlessly falls back to high-accuracy local semantic feature extraction.

---

## 4. Verification Checklist Before Any Git Commit
- [ ] Run Golden Set benchmark: `node ai-core/eval/run_eval.js` (Must score $\ge 85\%$).
- [ ] Run Realtime E2E test: `node ai-core/eval/test_realtime_e2e.js` (Must pass 3/3).
- [ ] Verify server starts cleanly: `node server.js` on port 3000.
- [ ] Confirm no API keys or raw data files are committed (`.gitignore` must remain intact).
