# CP2 · Workshop Question Curator (Final Interactive Mock)

## Prototype Level
Mock chạy offline, dữ liệu stream realtime giả lập bám sát tập Golden Set và chatlog Discord K4. Chưa kết nối Zoom API và chưa gọi AI API thật — phần này sẽ tích hợp ở CP3 (16:00 17/9).

## Lát cắt Demo (Core Slice)
> **Một giảng viên · theo dõi Q&A Zoom trong workshop · AI gom và xếp hạng câu hỏi theo số lần lặp · giảng viên xử lý Top 5 trước khi buổi học kết thúc.**

## 5 Bước Trải Nghiệm Người Dùng (End-to-End User Flow)
1. **Bước 1 (Setup):** Chọn workshop `AI20K · Workshop 01 — Q&A Onboarding & Lab Setup` → Bấm `Bắt đầu phiên mock (Realtime Engine) →`.
2. **Bước 2 (Realtime Stream):** 
   - Bấm `Bắt đầu luồng tự động` hoặc chọn kịch bản nhanh (`⚡ Cháy chat Deadline Lab 2`, `⚡ Kẹt lỗi CVAT/OPA`, `⚡ Bắn Injection & Tin cộc lốc`).
   - Luồng tin nhắn xuất hiện ở cột trái.
3. **Bước 3 (AI Gom cụm & Xếp hạng Top nóng):**
   - Hệ thống tự động phân loại ngữ nghĩa, tăng bộ đếm số lần lặp và đẩy chủ đề lặp nhiều nhất lên vị trí `#1 🔥 Ưu tiên`.
   - Tin chào hỏi / spam / injection tự động bị lọc sang tab `🛡️ Đã lọc`.
   - Câu hỏi mơ hồ / thiếu ngữ cảnh tự động chuyển vào tab `⚠️ Cần duyệt`.
4. **Bước 4 (Giảng viên Xử lý & Sửa sai):**
   - Giảng viên bấm `Xem N tin gốc ▾` để mở rộng danh sách trích dẫn nguyên văn (HAX G11).
   - Giảng viên bấm `✂️ Tách nhóm` để sửa sai nếu AI gom nhầm (HAX G9).
   - Sau khi giải thích xong, giảng viên bấm `✓ Đã giải thích xong` → Thẻ chuyển trạng thái, chủ đề tiếp theo tự động đẩy lên #1.
5. **Bước 5 (Tóm tắt phiên - Flow 5):**
   - Bấm nút `🏁 Kết thúc phiên & Xem tóm tắt (Flow 5) →`.
   - Màn hình tổng kết hiển thị các chỉ số tương tác và danh sách phân loại:
     - Các vấn đề đã giải thích trực tiếp (kèm số học viên được phục vụ).
     - Các vấn đề còn tồn đọng cần recap hoặc gửi thông báo trên Discord.

## Cách chạy
Mở trực tiếp file `prototype_mock.html` bằng bất kỳ trình duyệt nào (Chrome, Edge, Firefox, Safari). Không cần cài đặt package hay chạy server nền.

## Acceptance Checklist CP2
- [x] Có luồng bấm tương tác từ đầu đến cuối (Flow 1 → Flow 5).
- [x] Có dữ liệu mẫu mô phỏng stream và kịch bản cháy chat.
- [x] Có thuật toán phân cụm intent và xếp hạng theo số lần lặp giảm dần.
- [x] Có accordion trích dẫn câu hỏi gốc (HAX G11) & modal tách nhóm (HAX G9).
- [x] Có lọc tin rác/chào hỏi và chặn prompt injection (Lớp chỗ khó ③).
- [x] Có màn hình tóm tắt phiên học (Flow 5) tổng hợp danh sách đã xử lý và tồn đọng.
- [ ] Tích hợp API Gemini gọi AI thật cho clustering — dự kiến hoàn thiện tại CP3.
