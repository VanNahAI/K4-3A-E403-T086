# Hướng dẫn chạy phiên có xác thực

Phiên realtime yêu cầu `LECTURER_ACCESS_TOKEN` để cấp quyền cho giảng viên.
Không đặt token trong URL, mã nguồn hoặc Git.

## Chạy trên Windows PowerShell

```powershell
$env:LECTURER_ACCESS_TOKEN = "thay-bang-chuoi-bi-mat-dai"
$env:PORT = "3000"
npm start
```

## Chạy trên Linux/macOS

```bash
export LECTURER_ACCESS_TOKEN="thay-bang-chuoi-bi-mat-dai"
export PORT=3000
npm start
```

Mở `/` và chọn vai trò giảng viên. Nhập đúng token khi bắt đầu buổi học.
Token chỉ được giữ trong `sessionStorage` của tab hiện tại.

## Kiểm thử realtime

```powershell
$env:LECTURER_ACCESS_TOKEN = "test-lecturer-token"
$env:TEST_PORT = "3000"
npm run test:realtime
```

Nếu server không có `LECTURER_ACCESS_TOKEN`, các API quản trị sẽ bị khóa và
không thể bắt đầu phiên giảng viên.

Các API yêu cầu quyền giảng viên gồm:

- `POST /api/session/start`
- `POST /api/reset-session`
- `POST /api/config-zoom`
- `POST /api/zoom-import`

Trong môi trường Internet thật vẫn cần triển khai HTTPS/WSS, reverse proxy,
rate limit và cơ chế đăng nhập người dùng đầy đủ; token dùng ở bước này là
lớp bảo vệ tối thiểu cho prototype đang chuyển sang triển khai thật.
