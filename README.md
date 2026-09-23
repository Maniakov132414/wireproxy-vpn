# Multi-Country Wireproxy + Dynamic Rotating Proxy Pool (Netflix & Asia Optimized)

Hệ thống biến các cấu hình WireGuard VPN từ **ProtonVPN Plus** thành cụm **Proxy xoay đa quốc gia (Rotating Proxy Pool)** và các cổng SOCKS5 / HTTP riêng lẻ, phục vụ bot cào dữ liệu, bypass Cloudflare/Netflix, và chạy 24/7 trên Cloud (Railway).

---

## 1. Cơ chế hoạt động & Điểm nổi bật

* **Cổng Master Proxy Đa Giao Thức (`10800`)**: Lắng nghe trên cổng `10800` với cơ chế **Smart Protocol Sniffer**. Tự động phân tích byte đầu tiên để hỗ trợ cả **HTTP/HTTPS CONNECT** và **SOCKS5** trên cùng một cổng duy nhất.
* **Tối ưu hóa độ trễ cho Netflix & Châu Á**: Tập trung vào các cụm máy chủ có độ trễ thấp và định tuyến CDN tốt nhất: **Việt Nam (11 node)**, **Singapore (5 node)**, **Nhật Bản (3 node)** cùng các hub lớn như **Hồng Kông**, **Đài Loan**, **Hàn Quốc**, **Mỹ** và **Anh**.
* **Kiểm tra sống tự động (Live Handshake Probe)**: Mỗi khi một node khởi động, rotator gửi gói tin kiểm tra kết nối qua tunnel tới `1.1.1.1` trong 3.5 giây. Nếu node bị Proton chặn handshake, hệ thống tự động loại bỏ và chuyển sang node sống tiếp theo, **loại trừ 100% rủi ro bị treo hoặc lỗi timeout cho bot**.
* **Chuyển vùng thần tốc (Fast Failover 6s)**: Nếu kết nối gặp sự cố hoặc nghẽn mạng quá 6 giây, rotator sẽ tự động hủy socket và thử lại ngay lập tức trên node đệm tiếp theo.
* **Hàng đợi đệm sẵn (Pre-warmed Buffer, 6 server)**: Luôn duy trì sẵn 6 máy chủ trực chiến luân phiên. Giới hạn 6 node giúp chừa lại 4 slot trống dưới trần 10 thiết bị của ProtonVPN cho PC và điện thoại cá nhân.
* **Tự động ngủ khi không hoạt động (Auto-Sleep 90s)**: Sau 90 giây không có request từ bot, toàn bộ tiến trình Wireproxy sẽ tự động tắt để giải phóng 100% slot thiết bị của Proton. Khi có request mới đến, hệ thống sẽ tự động thức dậy trong 1-2 giây.
* **Không cần Mật khẩu (No Auth)**: Cổng proxy mở trực tiếp, bot kết nối vào dùng ngay mà không cần cấu hình User/Pass rườm rà.
* **Không yêu cầu quyền Root**: Chạy Wireproxy ở tầng người dùng (Userspace WireGuard), không cần cài driver card mạng ảo TUN/TAP, tương thích hoàn hảo trong Docker container trên Railway.

---

## 2. Bảng phân bổ Node & Địa chỉ IP

Hệ thống hiện tại gồm **24 cụm máy chủ** tập trung cao độ vào Việt Nam, Singapore, Nhật Bản và các khu vực truyền phát Netflix tốt nhất:

| STT | Node | Quốc gia & Vị trí | Cổng HTTP | Cổng SOCKS5 | Nhà mạng / ASN | Trạng thái |
| :-: | :--- | :--- | :-: | :-: | :--- | :-: |
| 1 | `VN` | 🇻🇳 Hà Nội (VN#8) | `25345` | `25344` | M247 Europe SRL | Hoạt động |
| 2 | `VN1` | 🇻🇳 Hà Nội (VN#1) | `25413` | `25412` | M247 Europe SRL | Hoạt động |
| 3 | `VN2` | 🇻🇳 Hà Nội (VN#2) | `25367` | `25366` | M247 Europe SRL | Hoạt động |
| 4 | `VN3` | 🇻🇳 Hà Nội (VN#3) | `25415` | `25414` | M247 Europe SRL | Hoạt động |
| 5 | `VN4` | 🇻🇳 Hà Nội (VN#4) | `25361` | `25360` | M247 Europe SRL | Hoạt động |
| 6 | `VN6` | 🇻🇳 Hà Nội (VN#6) | `25417` | `25416` | M247 Europe SRL | Hoạt động |
| 7 | `VN7` | 🇻🇳 Hà Nội (VN#7) | `25419` | `25418` | M247 Europe SRL | Hoạt động |
| 8 | `VN9` | 🇻🇳 Hà Nội (VN#9) | `25365` | `25364` | M247 Europe SRL | Hoạt động |
| 9 | `VN10` | 🇻🇳 Hà Nội (VN#10) | `25421` | `25420` | M247 Europe SRL | Hoạt động |
| 10 | `VN11` | 🇻🇳 Hà Nội (VN#11) | `25423` | `25422` | M247 Europe SRL | Hoạt động |
| 11 | `VN12` | 🇻🇳 Hà Nội (VN#12) | `25425` | `25424` | M247 Europe SRL | Hoạt động |
| 12 | `SG` | 🇸🇬 Singapore (SG#192) | `25347` | `25346` | Proton AG | Hoạt động |
| 13 | `SG120` | 🇸🇬 Singapore (SG#120) | `25427` | `25426` | Proton AG | Hoạt động |
| 14 | `SG171` | 🇸🇬 Singapore (SG#171) | `25371` | `25370` | Proton AG | Hoạt động |
| 15 | `SG175` | 🇸🇬 Singapore (SG#175) | `25363` | `25362` | Proton AG | Hoạt động |
| 16 | `SG228` | 🇸🇬 Singapore (SG#228) | `25369` | `25368` | Proton AG | Hoạt động |
| 17 | `JP` | 🇯🇵 Tokyo (JP#188) | `25349` | `25348` | xTom GmbH | Hoạt động |
| 18 | `JP201` | 🇯🇵 Osaka (JP#201) | `25431` | `25430` | Datacamp Limited | Hoạt động |
| 19 | `JP202` | 🇯🇵 Osaka (JP#202) | `25433` | `25432` | Datacamp Limited | Hoạt động |
| 20 | `HK` | 🇭🇰 Hồng Kông (HK#35) | `25353` | `25352` | M247 Europe SRL | Hoạt động |
| 21 | `TW` | 🇹🇼 Cao Hùng (TW#21) | `25357` | `25356` | M247 Europe SRL | Hoạt động |
| 22 | `KR` | 🇰🇷 Seoul (KR#24) | `25355` | `25354` | M247 Europe SRL | Hoạt động |
| 23 | `US` | 🇺🇸 Hoa Kỳ (US-AZ#84) | `25351` | `25350` | M247 Europe SRL | Hoạt động |
| 24 | `UK` | 🇬🇧 London (UK#186) | `25359` | `25358` | Datacamp Limited | Hoạt động |

---

## 3. Triển khai trên Railway

### Bước 1: Deploy lên Railway
Dự án đã liên kết trực tiếp với GitHub repo `wireproxy-vpn` và deploy tự động lên dịch vụ Railway.

### Bước 2: Cấu hình TCP Proxy
1. Trong Railway Settings của service `wireproxy-vpn`, vào phần **Networking**.
2. Thêm **TCP Proxy** trỏ tới cổng nội bộ `10800`.
3. Địa chỉ truy cập public sẽ có định dạng:
   ```text
   altaria.proxy.rlwy.net:13082
   ```

### Bước 3: Biến môi trường
Các biến môi trường có thể tùy chỉnh trong tab **Variables**:

| Tên biến | Mặc định | Ý nghĩa |
| :--- | :---: | :--- |
| `POOL_SIZE` | `6` | Số lượng server luôn được giữ ấm (khuyên dùng 6 để an toàn dưới trần 10 slot của Proton) |
| `MAX_REQUESTS_PER_NODE` | `60` | Số lượt request tối đa trước khi xoay node |
| `IDLE_TIMEOUT_MS` | `90000` | Thời gian không có request (90s) để đưa hệ thống vào chế độ ngủ tiết kiệm slot |

---

## 4. Cách sử dụng Proxy cho Bot / Checker

### Cấu hình trong `proxy.txt`:
Do cổng Master hỗ trợ cả HTTP và SOCKS5, bạn có thể điền:
```text
http://altaria.proxy.rlwy.net:13082
```
hoặc:
```text
socks5://altaria.proxy.rlwy.net:13082
```

### Kiểm tra bằng cURL:
```bash
# Kiểm tra HTTP
curl -x http://altaria.proxy.rlwy.net:13082 http://api.ipify.org

# Kiểm tra kết nối tới Netflix
curl -I -x http://altaria.proxy.rlwy.net:13082 https://www.netflix.com
```

### Khuyến nghị số luồng (Threads):
* Với Netflix Cookie Checker, khuyến nghị chạy từ **15 đến 25 threads** để đảm bảo tốc độ phản hồi ổn định (khoảng 2.0s - 2.5s / cookie) mà không bị Netflix WAF chặn tạm thời (HTTP 403/429).

---

## 5. Quản lý cục bộ trên Windows (Tùy chọn)

* **Khởi chạy toàn bộ hệ thống trên máy cá nhân**:
  ```powershell
  .\start-pool.ps1
  ```
* **Dừng toàn bộ các tiến trình**:
  ```powershell
  .\stop-pool.ps1
  ```


