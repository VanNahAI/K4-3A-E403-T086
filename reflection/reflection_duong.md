# Reflection Cá Nhân — Dương Dương (Product Research)
**Mã học viên:** 2A202602498 · **Lớp:** 3A · **Nhóm:** K4-3A-E403-Curator  

---

### 1. Vai trò & Phần việc trực tiếp đảm nhiệm
- **Vai trò chính:** Product Research kiêm Điều phối Nội dung Đặc tả & Khảo sát Người dùng.
- **Phần việc cụ thể:**
  - Khai phá 779 tin nhắn người dùng trong `data/discord-pack/`, chuẩn hóa phép lọc tái lập và ghi nhận 133 tin (17,1%) thuộc 5 nhóm vận hành lặp lại (Evidence Standard B) tại `validation/evidence_mining_log.md`.
  - Thiết kế và tổng hợp khảo sát vấn đề ẩn danh $n=25$: ghi nhận 24/25 (96%) người từng gặp câu hỏi trùng và 16/25 (64%) đánh giá bảng gom nhóm realtime ở mức hữu ích; lưu vết chi tiết tại `validation/problem_survey_log.md`.
  - Chắp bút bản Canvas CP1 và hoàn thiện bản đặc tả `spec.md` (§1–§9) theo đúng chuẩn mực HAX & PAIR Playbook của Google/Microsoft.
  - Soạn thảo cấu trúc kịch bản pitch 6 slide (`demo_slides.md`) bám sát quy tắc "Không có bằng chứng thì không có slide" và chuẩn bị kế hoạch phỏng vấn người dùng thật (Bonus R6).

### 2. AI đã hỗ trợ như thế nào trong công việc
- Sử dụng LLM để hỗ trợ phân loại sơ bộ các cụm chủ đề từ file chatlog hơn 1.000 dòng, giúp tiết kiệm hơn 4 giờ đọc và gắn thẻ thủ công.
- Dùng AI sinh các kịch bản phản biện theo HAX Playbook để phát hiện sớm các điểm gãy trong luồng trải nghiệm (đặc biệt là hiện tượng Echo Chamber khi học viên vào muộn).

### 3. Bài học từ Case Thất Bại của chính nhóm (Fail Case Lesson)
- **Case thất bại:** Ở mốc CP1 ban đầu, nhóm đặt ra Non-goal cứng nhắc: *"AI tuyệt đối không bao giờ trả lời học viên"*. Nhưng qua nghiên cứu thực tế và quan sát lớp học, học viên hỏi lặp lại đúng câu thầy vừa trả lời chiếm tỷ lệ rất lớn. Việc cấm AI can thiệp khiến giảng viên vẫn phải liên tục bị ngắt mạch giảng bài.
- **Bài học rút ra:** Không nên tư duy sản phẩm theo hướng nhị phân cực đoan (hoàn toàn thủ công vs hoàn toàn tự động). Giải pháp tối ưu là **Conditional Automation dựa trên Cost-of-Error**: Khi chưa có căn cứ thì cấm AI tự bịa; nhưng khi giảng viên đã chốt đáp án, AI sẽ dùng chính phát ngôn của giảng viên làm Ground Truth để tự động giải đáp cho học viên hỏi sau. Điều này biến Echo-Responder thành giá trị cốt lõi giải quyết đúng nỗi đau nhất của buổi học.
