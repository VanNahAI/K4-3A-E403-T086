# Reflection Cá Nhân — Chu Văn Nhân (AI Engineer & QA)
**Mã học viên:** 2A202602668 · **Lớp:** 3A · **Nhóm:** K4-3A-E403-Curator  

---

### 1. Vai trò & Phần việc trực tiếp đảm nhiệm
- **Vai trò chính:** Đội trưởng kiêm AI Engineer & Quality Assurance Lead.
- **Phần việc cụ thể:**
  - Thiết kế và hoàn thiện module Lõi AI (`ai-core/ai_engine.js`): Kết nối linh hoạt Cloud LLM OpenRouter (`google/gemini-2.0-flash-exp:free`, `nex-agi/nex-n2.5-mini:free`) và Local Ollama Qwen2.5-3B.
  - Trực tiếp xây dựng cơ chế thẩm định LLM thời gian thực khi học viên gõ phím (`/api/llm-verify-faq`) kết hợp bộ lọc chống mâu thuẫn thời gian (`hasSemanticConflict`) giúp ngăn chặn hoàn toàn lỗi ảo giác gợi ý nhầm nội dung buổi học khác ngày.
  - Xây dựng và hoàn thiện bộ kiểm thử Golden Set 25 cases (`ai-core/eval/golden_set.json`), viết runner tự động hóa `run_eval.js` và bộ đo số liệu `run_cp3_eval.js`.
  - Khắc phục triệt để các ca khó CP4: `GS17` (bóc tách câu hỏi đa ý định `split_intents`), `GS22` (câu nối tiếp thiếu ngữ cảnh đưa vào hàng đợi `flag_low_confidence`), `GS24` (chặn prompt injection can thiệp đáp án giảng viên), đưa kết quả đánh giá đạt tuyệt đối **25/25 (100.0%)**.
  - Thiết lập bộ kiểm thử hồi quy WebSocket Realtime E2E đạt 8/8 tiêu chí đồng bộ thời gian thực.

### 2. AI đã hỗ trợ như thế nào trong công việc
- Sử dụng LLM để tự động sinh các biến thể câu hỏi adversarial (prompt injection, jailbreak vào Lớp ③) nhằm kiểm tra tính vững chắc của các tầng Guardrail.
- Ứng dụng mô hình suy luận để hỗ trợ viết nhanh các kịch bản kiểm thử hồi quy và bộ khung runner tự động trong Node.js.

### 3. Bài học từ Case Thất Bại của chính nhóm (Fail Case Lesson)
- **Case thất bại:** Ở lượt đo đầu tiên, case `GS17` (*"Lab 2 nộp muộn bị trừ điểm thế nào và link nộp ở đâu ạ?"*) bị hệ thống ưu tiên vế nộp muộn nên kích hoạt trả lời tự động ngay, có nguy cơ bỏ sót hoàn toàn ý hỏi link nộp bài. Đồng thời, học viên hỏi bài ngày mai vẫn bị gợi ý bài hôm nay do trùng lặp từ khóa.
- **Bài học rút ra:** Đa ý định (Multi-intent) và mâu thuẫn thời gian là hai cạm bẫy kinh điển trong AI hội thoại. Giải pháp là kết hợp **bộ lọc mâu thuẫn logic tức thì (0ms)** với **bộ thẩm định ngữ nghĩa bằng LLM**. Khi phát hiện câu hỏi chứa nhiều ý độc lập hoặc có dấu hiệu mâu thuẫn ngữ cảnh, hệ thống phải chuyển sang hàng đợi làm rõ (`Cần tách ý`) thay vì vội vã trả lời tự động.
