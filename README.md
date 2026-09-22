# Multi-Country Wireproxy + Auto-Rotating Proxy Pool

Biến các file cấu hình WireGuard VPN từ ProtonVPN thành hệ thống **Proxy xoay đa quốc gia (Rotating Proxy Pool)** và các cổng SOCKS5/HTTP riêng lẻ.

## 1. Cổng Proxy Tổng Xoay Tự Động (Master Rotating Port)

- **Địa chỉ Proxy Master**: `http://127.0.0.1:10800`
- **Cơ chế**: Round-robin tự động xoay IP qua từng quốc gia mỗi request.
- **Tự động phục hồi (Auto Failover)**: Nếu 1 server bị timeout, hệ thống tự động bỏ qua và chuyển tiếp request ngay sang server tiếp theo mà không làm gián đoạn request của bot.

---

## 2. Danh sách cổng Proxy riêng lẻ từng quốc gia

| Quốc gia | Server ProtonVPN | HTTP Proxy | SOCKS5 Proxy | Egress IP |
| :--- | :--- | :--- | :--- | :--- |
| 🇸🇬 **Singapore** | `SG#192` | `http://127.0.0.1:25347` | `socks5://127.0.0.1:25346` | `159.26.115.96` |
| 🇯🇵 **Nhật Bản** | `JP#288` | `http://127.0.0.1:25349` | `socks5://127.0.0.1:25348` | `159.26.119.47` |
| 🇺🇸 **Hoa Kỳ** | `US-CA#684` | `http://127.0.0.1:25351` | `socks5://127.0.0.1:25350` | `149.102.228.200` |
| 🇻🇳 **Việt Nam** | `VN#8` | `http://127.0.0.1:25345` | `socks5://127.0.0.1:25344` | `188.214.152.234` |

---

## 3. Cách thêm Server / Quốc gia mới vào hệ thống

Khi bạn tải file `.conf` mới từ ProtonVPN (ví dụ: Hà Lan, Anh, Đức...):
1. Đặt file vào thư mục hoặc chạy lệnh:
   ```powershell
   .\add-server.ps1 -FilePath "C:\duong\dan\file-moi.conf" -Name "NL"
   ```
2. Script sẽ tự động:
   - Trích xuất key WireGuard
   - Tự cấp cặp port SOCKS5/HTTP tiếp theo
   - Lưu vào thư mục `configs/`
   - Cổng tổng `10800` sẽ tự động nhận diện và nạp thêm server này vào vòng xoay!

---

## 4. Quản lý trên Windows

- **Khởi động toàn bộ**: Chạy `start-pool.ps1`
- **Dừng toàn bộ**: Chạy `stop-pool.ps1`

---

## 5. Triển khai Docker / Linux VPS / Railway

- **Khởi chạy trên Docker**:
  ```bash
  docker compose up -d
  ```
- **Triển khai lên Railway**:
  Đẩy thư mục lên GitHub -> Tạo project trên Railway -> Thêm TCP Proxy vào cổng `10800` để có địa chỉ Public 24/7.
