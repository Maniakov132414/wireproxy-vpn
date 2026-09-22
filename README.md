# Multi-Country Wireproxy + Dynamic Rotating Proxy Pool

Hệ thống biến các cấu hình WireGuard VPN từ **ProtonVPN Plus** thành cụm **Proxy xoay đa quốc gia (Rotating Proxy Pool)** và các cổng SOCKS5 / HTTP riêng lẻ, phục vụ bot cào dữ liệu, bypass Cloudflare/Netflix, và chạy 24/7 trên Cloud (Railway).

---

## 1. Cơ chế hoạt động & Điểm nổi bật

* **Cổng Master Proxy (`10800`)**: Lắng nghe mọi request HTTP/HTTPS và tự động xoay vòng (Round-Robin) qua danh sách các IP sạch từ ProtonVPN.
* **Tự động chuyển tiếp lỗi (Intelligent Auto-Failover)**: Nếu 1 server VPN gặp hiện tượng gián đoạn hoặc phản hồi chậm quá 4 giây, hệ thống sẽ tự động gạch tên tạm thời và định tuyến ngay sang server kế tiếp, đảm bảo bot không bị đứt kết nối.
* **Không yêu cầu quyền Root**: Chạy Wireproxy ở tầng người dùng (Userspace WireGuard), không cần cài driver card mạng ảo TUN/TAP, tương thích hoàn hảo trong Docker container trên Railway.
* **Tự động mở rộng (Hot-Reload)**: Tự động phát hiện và nạp các server VPN mới mà không cần can thiệp thủ công.

---

## 2. Bảng phân bổ Node & Địa chỉ IP

Hệ thống hiện tại gồm **14 cụm máy chủ** tốc độ cao, độ trễ thấp:

| STT | Node | Quốc gia & Thành phố | Cổng HTTP | Cổng SOCKS5 | Nhà mạng / ASN | Trạng thái |
| :-: | :--- | :--- | :-: | :-: | :--- | :-: |
| 1 | `SG` | 🇸🇬 Singapore (SG#196) | `25347` | `25346` | Proton AG | Hoạt động |
| 2 | `SG175` | 🇸🇬 Singapore (SG#175) | `25363` | `25362` | Proton AG | Hoạt động |
| 3 | `SG228` | 🇸🇬 Singapore (SG#228) | `25369` | `25368` | Proton AG | Hoạt động |
| 4 | `SG171` | 🇸🇬 Singapore (SG#171) | `25371` | `25370` | Proton AG | Hoạt động |
| 5 | `VN` | 🇻🇳 Hà Nội (VN#8) | `25345` | `25344` | M247 Europe SRL | Hoạt động |
| 6 | `VN4` | 🇻🇳 Hà Nội (VN#4) | `25361` | `25360` | M247 Europe SRL | Hoạt động |
| 7 | `VN9` | 🇻🇳 Hà Nội (VN#9) | `25365` | `25364` | M247 Europe SRL | Hoạt động |
| 8 | `VN2` | 🇻🇳 Hà Nội (VN#2) | `25367` | `25366` | M247 Europe SRL | Hoạt động |
| 9 | `JP` | 🇯🇵 Tokyo (JP#188) | `25349` | `25348` | xTom GmbH | Hoạt động |
| 10 | `TW` | 🇹🇼 Cao Hùng (TW#21) | `25357` | `25356` | M247 Europe SRL | Hoạt động |
| 11 | `HK` | 🇭🇰 Hồng Kông (HK#35) | `25353` | `25352` | M247 Europe SRL | Hoạt động |
| 12 | `KR` | 🇰🇷 Seoul (KR#24) | `25355` | `25354` | M247 Europe SRL | Hoạt động |
| 13 | `US` | 🇺🇸 Virginia / Arizona (US-AZ#84) | `25351` | `25350` | M247 Europe SRL | Hoạt động |
| 14 | `UK` | 🇬🇧 London (UK#186) | `25359` | `25358` | Datacamp Limited | Hoạt động |

---

## 3. Hướng dẫn cài đặt và cấu hình chi tiết trên Railway

### Bước 1: Tạo dự án từ GitHub
1. Đăng nhập vào [Railway](https://railway.com).
2. Nhấn nút **New Project** (hoặc góc trên bên phải bấm `+ New`).
3. Chọn **Deploy from GitHub repo**.
4. Chọn repository **`wireproxy-vpn`** (đặt ở chế độ Private).
5. Railway sẽ tự động tiến hành build Dockerfile (thời gian build chỉ mất khoảng 15–25 giây vì sử dụng binary biên dịch sẵn).

### Bước 2: Cấu hình TCP Proxy để lấy Public IP/Port
HTTP Proxy thông thường trên Railway chỉ xử lý web qua cổng 80/443, do đó để bot bên ngoài kết nối được cổng proxy `10800`, **bắt buộc phải tạo TCP Proxy**:

1. Bấm vào Service vừa deploy trên giao diện Railway.
2. Chuyển sang tab **Settings**.
3. Kéo xuống phần **Networking**:
   - Ở mục **Public Networking**, bấm vào nút **Add TCP Proxy**.
4. Trong ô cấu hình mở ra:
   - **Port**: Nhập chính xác số `10800` (đây là cổng của `rotator.js`).
   - Nhấn **Save** hoặc xác nhận.
5. Ngay sau đó, Railway sẽ cấp một địa chỉ Public dạng:
   ```text
   roundhouse.proxy.rlwy.net:54321
   ```
   *(Tên domain và port `54321` sẽ do Railway ngẫu nhiên cấp cho service của bạn).*

### Bước 3: Cấu hình biến môi trường (Tùy chọn bảo mật)
Để tránh bị người lạ scan và dùng trộm proxy của bạn, chuyển sang tab **Variables** trong Railway và thêm:

| Tên biến | Giá trị gợi ý | Ý nghĩa |
| :--- | :--- | :--- |
| `REQUIRE_AUTH` | `true` | Bật tính năng xác thực mật khẩu cho proxy |
| `PROXY_USER` | `admin` | Tên đăng nhập |
| `PROXY_PASS` | `MatKhauCuaBan123` | Mật khẩu truy cập |

---

## 4. Cách sử dụng Proxy cho Bot

### Trường hợp không đặt mật khẩu:
Điền địa chỉ được cấp từ TCP Proxy vào bot:
```text
http://roundhouse.proxy.rlwy.net:54321
```

### Trường hợp có đặt mật khẩu:
```text
http://admin:MatKhauCuaBan123@roundhouse.proxy.rlwy.net:54321
```

**Ví dụ dùng cURL để test từ máy ngoài:**
```bash
curl -x http://roundhouse.proxy.rlwy.net:54321 https://ipinfo.io/json
```
*(Mỗi lần chạy lại lệnh trên, bạn sẽ nhận được một địa chỉ IP thuộc quốc gia khác nhau: Việt Nam -> Singapore -> Nhật Bản -> Mỹ -> Đài Loan...)*

---

## 5. Thêm máy chủ WireGuard mới (Tự động 100%)

Khi bạn muốn bổ sung thêm quốc gia hoặc máy chủ mới:

1. Tải file WireGuard `.conf` từ ProtonVPN về máy tính.
2. Chạy lệnh PowerShell:
   ```powershell
   .\add-server.ps1 -FilePath "C:\duong-dan\wg-moi.conf" -Name "ten-quoc-gia" -Push
   ```
3. **Cơ chế tự động:**
   * Script tự cấp phát dải port SOCKS5 và HTTP tiếp theo.
   * Tạo file config vào thư mục `configs/`.
   * Tự động `git commit` và `git push` lên GitHub.
   * **Railway tự động nhận code mới -> Rebuild lại sau 20s mà địa chỉ TCP Proxy cấp cho bot VẪN GIỮ NGUYÊN.**

---

## 6. Kiểm tra toàn bộ danh sách IP (IP Tester)

Trong thư mục dự án có sẵn script kiểm tra đồng thời tất cả các node:
```bash
node test-all-ips.js
```
Script sẽ gửi request song song qua tất cả 14 cổng proxy, xuất bảng đo đạc gồm IP thực tế, quốc gia, độ trễ và nhà mạng.

---

## 7. Quản lý cục bộ trên Windows

* **Khởi chạy toàn bộ hệ thống trên máy cá nhân**:
  ```powershell
  .\start-pool.ps1
  ```
* **Dừng toàn bộ các tiến trình**:
  ```powershell
  .\stop-pool.ps1
  ```

