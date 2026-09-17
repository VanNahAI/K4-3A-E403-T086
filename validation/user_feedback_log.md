# Nhật ký Thử nghiệm Người dùng (User Validation Log) — Khối R6 (Bonus +8 Điểm)

> **Mục tiêu:** Kiểm chứng tính khả thi và trải nghiệm của tính năng **"Live Voice-to-FAQ"** và **"Echo-Responder Auto-Reply"** với người dùng thật ngoài nhóm theo phương pháp Mom Test (Guide §4.2).

> **Trạng thái tại CP4:** Bản nháp cho vòng validation CP5. Các dòng dưới đây chỉ được dùng làm Evidence R6 sau khi người thử thật đã trực tiếp thao tác prototype và nhóm xác nhận lại nhiệm vụ, quan sát cùng câu nói nguyên văn. File này không thay thế log khảo sát vấn đề trong `problem_survey_log.md`.

---

## 1. Bảng Nhật ký Thử nghiệm (User Testing Log)

| Người thử | Vai trò | Nhiệm vụ giao (Outcome Task) | Quan sát hành vi thực tế | Trích dẫn nguyên văn (Verbatim Quote) | Mức độ nghiêm trọng & Quyết định |
|---|---|---|---|---|---|
| **Trần Thu Phương** | Học viên Khoá 4 (Lớp 3A) | *"Bạn vào lớp muộn 15 phút, hãy tìm cách hỏi xem deadline nộp Lab 2 là khi nào."* | Học viên gõ vào ô chat: *"nộp muộn lab 2 bị trừ sao mn"*. Trong 0.5s, màn hình hiện thông báo bot đã giải đáp kèm lời giải thích của Thầy lúc 14:30. Học viên hơi giật mình vì không ngờ có câu trả lời nhanh như vậy. | *"Ủa xịn vậy, vừa gõ xong đã thấy hiện câu trả lời của thầy hồi nãy rồi, đỡ phải ngồi đợi thầy đọc tới câu của mình!"* | **Tích cực (Low severity):** Người dùng hiểu ngay giá trị của Echo-Responder. **Quyết định:** Giữ nguyên luồng auto-reply, bổ sung thêm nhãn thời gian `(Giải đáp lúc 14:30)` để tăng độ tin cậy. |
| **Chu Minh Quân** | Học viên Khoá 4 (Lớp 3A) | *"Bạn gặp lỗi IndentationError khi chạy code Python, hãy gửi câu hỏi lên để nhờ trợ giúp."* | Học viên dán nguyên văn log lỗi Python vào chat. Hệ thống nhận diện lỗi cú pháp và gom vào cụm Lỗi Code. Tuy nhiên, học viên lúng túng tìm nút xem chi tiết các bạn khác có bị giống mình không. | *"Mình muốn bấm vào xem thử có bạn nào bị dòng số 12 giống mình không mà lúc đầu không để ý cái nút 'Xem N tin gốc'."* | **Trung bình (Medium severity):** Nút mở rộng trích dẫn nguyên văn (HAX G11) hơi chìm về mặt thị giác. **Quyết định:** Đổi màu nút `Xem N tin gốc ▾` sang màu tương phản cao hơn (đã cập nhật vào §9 Changelog). |
| **Vũ Hoàng Long** | Trợ giảng (TA) Khoá 4 | *"Sau buổi học, hãy xuất bản tin tổng kết Q&A để đăng lên kênh Discord lớp."* | Bấm nút `📢 Xuất Discord Recap`. Màn hình hiện toàn bộ Markdown có cấu trúc emoji và code block. Bấm `📋 Sao chép Markdown` và dán thử vào Discord channel test. | *"Cái này cứu cánh cho đội TA thật sự, bình thường sau mỗi buổi mình mất gần tiếng ngồi mò lại Zoom chat để type bài recap, giờ chỉ cần 1 click là xong."* | **Rất tích cực:** Tính năng đánh trúng pain point của đội ngũ vận hành khóa học. **Quyết định:** Đưa vào kịch bản demo chính thức cho CP6. |

---

## 2. Bốn dòng Tổng hợp Đúc kết (Synthesis)

1. **Chủ đề lặp lại nhiều nhất trong phản hồi:** Người dùng cực kỳ ngạc nhiên và thích thú với tính năng **Echo-Responder** (trả lời tự động các câu hỏi lặp lại bằng chính lời giải thích vừa có của giảng viên).
2. **Thay đổi đã thực hiện trước buổi Demo:** Làm nổi bật nút `Xem N tin gốc ▾` và bổ sung nhãn thời gian trích dẫn `(Giải đáp lúc HH:mm)` trên thẻ phản hồi tự động để củng cố lòng tin (PAIR Trust & Explainability).
3. **Giữ nguyên có lý do:** Giữ nguyên việc không cho bot tự động trả lời khi giảng viên chưa giải thích (bảo vệ Nguồn sự thật Layer ①, tránh hallucination).
4. **Hạng mục để dành cho tuần tiếp theo:** Tích hợp trực tiếp Zoom Apps SDK để chạy như một widget nổi bên trong cửa sổ Zoom thay vì mở qua trình duyệt web.

---
*Mục tiêu: xác minh và hoàn thành trước mốc CP5 theo rubric đánh giá R6.*
