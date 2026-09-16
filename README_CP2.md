# CP2 · Workshop Question Curator

## Prototype level

Mock chạy offline, dữ liệu synthetic/replay. Chưa kết nối Zoom thật và chưa gọi AI thật — phần này để CP3.

## Lát cắt demo

Một giảng viên · theo dõi Q&A Zoom trong workshop · AI gom và xếp hạng câu hỏi theo số lần lặp · giảng viên xử lý Top 5 trước khi buổi học kết thúc.

## Luồng chính

1. Chọn workshop `AI20K · Workshop 01 — Q&A onboarding`.
2. Bấm `Bắt đầu phiên mock`.
3. Bấm `Phát luồng câu hỏi mẫu` để nhận 7 tin nhắn.
4. Bấm `Gom nhóm câu hỏi`.
5. Kiểm tra danh sách Top câu hỏi: nhóm 3 lần đứng trên nhóm 2 lần và nhóm 1 lần.
6. Bấm `Xem chi tiết` ở nhóm đầu tiên.
7. Kiểm tra các câu hỏi gốc và confidence.
8. Bấm `Đánh dấu đã giải thích`.
9. Bấm `Kết thúc phiên và xem tóm tắt`.

## Cách chạy

Mở file `workshop-question-curator-cp2.html` bằng trình duyệt. Không cần cài package hoặc server.

## Script demo 30–45 giây

“Đây là màn hình chọn workshop. Tôi bắt đầu một phiên theo dõi Q&A. Các câu hỏi mẫu xuất hiện theo thứ tự thời gian. Khi bấm gom nhóm, hệ thống nhận ra ba câu cùng ý về điểm danh và đưa nhóm này lên vị trí số một vì có ba lần lặp. Tôi mở chi tiết để kiểm tra các câu gốc, sau đó đánh dấu đã giải thích. Cuối cùng, màn hình tóm tắt cho biết vấn đề nào đã xử lý và vấn đề nào còn tồn.”

## Acceptance checklist CP2

- [x] Có luồng bấm từ đầu đến cuối.
- [x] Có dữ liệu mẫu để mô phỏng realtime.
- [x] Có gom nhóm và xếp hạng theo số lần lặp.
- [x] Có màn hình chi tiết và trạng thái đã xử lý.
- [x] Có màn hình tóm tắt cuối phiên.
- [ ] Kết nối Zoom thật — để CP3.
- [ ] AI clustering thật — để CP3.
