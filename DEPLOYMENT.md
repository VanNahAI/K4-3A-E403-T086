# Hướng dẫn chạy phiên có xác thực

Phiên realtime yêu cầu `LECTURER_ACCESS_TOKEN` để cấp quyền cho giảng viên.
Không đặt token trong URL, mã nguồn hoặc Git.

## Chạy trên Windows PowerShell

```powershell
$env:LECTURER_ACCESS_TOKEN = "thay-bang-chuoi-bi-mat-dai"
$env:PORT = "3000"
$env:MAX_REQUEST_BODY_BYTES = "1048576"
$env:ZOOM_MEETING_URL = "https://us06web.zoom.us/j/meeting-id"
$env:ZOOM_MEETING_ID = "meeting-id"
$env:ZOOM_PASSCODE = "mat-khau-zoom"
$env:ZOOM_TOPIC = "AI20K Workshop"
$env:ZOOM_SPEAKER = "Ten giang vien"
$env:ENABLE_SIMULATION = "false"
npm start
```

## Chạy trên Linux/macOS

```bash
export LECTURER_ACCESS_TOKEN="thay-bang-chuoi-bi-mat-dai"
export PORT=3000
export MAX_REQUEST_BODY_BYTES=1048576
export ZOOM_MEETING_URL="https://us06web.zoom.us/j/meeting-id"
export ZOOM_MEETING_ID="meeting-id"
export ZOOM_PASSCODE="mat-khau-zoom"
export ZOOM_TOPIC="AI20K Workshop"
export ZOOM_SPEAKER="Ten giang vien"
export ENABLE_SIMULATION=false
npm start
```

Mở `/` và chọn vai trò giảng viên. Nhập đúng token khi bắt đầu buổi học.
Token chỉ được giữ trong `sessionStorage` của tab hiện tại.

Endpoint kiểm tra trạng thái triển khai: `GET /api/health`. Endpoint chỉ trả
trạng thái cấu hình, không trả token hay mật khẩu Zoom.

## Kiểm thử realtime

```powershell
$env:LECTURER_ACCESS_TOKEN = "test-lecturer-token"
$env:TEST_PORT = "3000"
npm run test:realtime
```

Nếu server không có `LECTURER_ACCESS_TOKEN`, các API quản trị sẽ bị khóa và
không thể bắt đầu phiên giảng viên.

Phòng Zoom mô phỏng bị tắt mặc định. Chỉ dùng `ENABLE_SIMULATION=true` khi cần
chạy bộ giao diện legacy để kiểm thử; triển khai thật phải dùng URL Zoom thật
trong biến môi trường `ZOOM_MEETING_URL`. Cấu hình này được kiểm tra trước khi
mở phiên, nên server sẽ không tạo phiên nếu link Zoom chưa hợp lệ.

Các API yêu cầu quyền giảng viên gồm:

- `POST /api/session/start`
- `POST /api/reset-session`
- `POST /api/config-zoom`
- `POST /api/zoom-import`

Trong môi trường Internet thật vẫn cần triển khai HTTPS/WSS, reverse proxy,
rate limit và cơ chế đăng nhập người dùng đầy đủ; token dùng ở bước này là
lớp bảo vệ tối thiểu cho prototype đang chuyển sang triển khai thật.

Server đã có giới hạn body JSON, giới hạn payload WebSocket, giới hạn tần suất
message theo kết nối, security headers cơ bản và graceful shutdown. Reverse
proxy vẫn cần giới hạn tốc độ theo IP ở lớp public.
