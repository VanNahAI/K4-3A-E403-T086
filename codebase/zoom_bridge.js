/**
 * Zoom Chat Bridge (zoom_bridge.js)
 * Parses Zoom in-meeting chat format and streams messages into the Curator engine.
 */

class ZoomChatBridge {
  constructor() {
    this.importedCount = 0;
  }

  /**
   * Parses standard Zoom meeting chat format
   * Supports both English and Vietnamese formats:
   *   14:23:05 From S0129 to Everyone:
   *   Cho em hỏi hạn nộp bài lab 2 là mấy giờ tối nay ạ?
   */
  parse(rawText) {
    if (!rawText || !rawText.trim()) return [];

    const lines = rawText.split(/\r?\n/);
    const messages = [];
    let currentMsg = null;

    // Matches: "14:23:05 From User Name to Everyone:" or "14:23:05 From User Name (Direct Message):"
    const headerRegex = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+From\s+(.+?)(?:\s+to\s+.*)?:?\s*$/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const match = line.match(headerRegex);
      if (match) {
        if (currentMsg && currentMsg.content) {
          messages.push(currentMsg);
        }
        currentMsg = {
          id: `ZM${Math.floor(1000 + Math.random() * 9000)}`,
          timestamp: match[1],
          user: match[2].trim(),
          content: ''
        };
      } else if (currentMsg) {
        currentMsg.content = (currentMsg.content ? currentMsg.content + ' ' : '') + line;
      } else {
        // Line without a header (freeform paste)
        messages.push({
          id: `ZM${Math.floor(1000 + Math.random() * 9000)}`,
          timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          user: `S${Math.floor(1000 + Math.random() * 9000)}`,
          content: line
        });
      }
    }

    if (currentMsg && currentMsg.content) {
      messages.push(currentMsg);
    }

    return messages;
  }

  /**
   * Ingest a batch of parsed Zoom messages into the active engine with a natural pacing
   */
  async ingestBatch(messages, onProgress = null) {
    this.importedCount += messages.length;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      await window.engine.processMessage(m.content, m.user);
      if (onProgress) onProgress(i + 1, messages.length);
      // Small delay between stream events to simulate live influx
      if (messages.length > 1 && i < messages.length - 1) {
        await new Promise(r => setTimeout(r, 250));
      }
    }
  }
}

window.zoomBridge = new ZoomChatBridge();
