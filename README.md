# Multi-Country Wireproxy + Dynamic Rotating Proxy Pool (Netflix & Asia Optimized)

Hệ thống biến các cấu hình WireGuard VPN từ **ProtonVPN Plus** thành cụm **Proxy xoay đa quốc gia (Rotating Proxy Pool)** và các cổng SOCKS5 / HTTP riêng lẻ, phục vụ bot cào dữ liệu, bypass Cloudflare/Netflix, và chạy 24/7 trên Cloud (Railway).

---

## 1. Cơ chế hoạt động & Điểm nổi bật

* **Cổng Master Proxy Đa Giao Thức (`10800`)**: Lắng nghe trên cổng `10800` với cơ chế **Smart Protocol Sniffer**. Tự động phân tích byte đầu tiên để hỗ trợ cả **HTTP/HTTPS CONNECT** và **SOCKS5** trên cùng một cổng duy nhất.
* **Xoay ngẫu nhiên 100% (100% Random Rotation)**: Mỗi request đến cổng Master `10800` được định tuyến hoàn toàn ngẫu nhiên đến một node trong nhóm node đang trực chiến, đồng thời các node dự phòng được nạp ngẫu nhiên (Fisher-Yates shuffle) và luân chuyển ngẫu nhiên liên tục.
* **Tối ưu hóa độ trễ cho Netflix & Đa Quốc Gia**: Tập trung vào cụm **43 máy chủ Proton WireGuard mới tinh** trải rộng trên **27 quốc gia**: Việt Nam, Singapore, Nhật Bản, Hồng Kông, Đài Loan, Hàn Quốc, Ả Rập Xê-út, Afghanistan, Ai Cập, Albania, Algeria, Ấn Độ, Andorra, Angola, Áo, Argentina, Armenia, Azerbaijan, Ba Lan, Bắc Macedonia, Bahrain, Bangladesh, Belarus, Bhutan, Bỉ, Bồ Đào Nha, Campuchia.
* **Kiểm tra sống tự động (Live Handshake Probe)**: Mỗi khi một node khởi động, rotator gửi gói tin kiểm tra kết nối qua tunnel tới `1.1.1.1` trong 3.5 giây. Nếu node bị Proton chặn handshake, hệ thống tự động loại bỏ và chuyển sang node sống tiếp theo, **loại trừ 100% rủi ro bị treo hoặc lỗi timeout cho bot**.
* **Chuyển vùng thần tốc (Fast Failover 6s)**: Nếu kết nối gặp sự cố hoặc nghẽn mạng quá 6 giây, rotator sẽ tự động hủy socket và thử lại ngay lập tức trên node đệm tiếp theo.
* **Hàng đợi đệm sẵn (Pre-warmed Buffer, 6 server)**: Luôn duy trì sẵn 6 máy chủ trực chiến luân phiên. Giới hạn 6 node giúp chừa lại 4 slot trống dưới trần 10 thiết bị của ProtonVPN cho PC và điện thoại cá nhân.
* **Tự động ngủ khi không hoạt động (Auto-Sleep 90s)**: Sau 90 giây không có request từ bot, toàn bộ tiến trình Wireproxy sẽ tự động tắt để giải phóng 100% slot thiết bị của Proton. Khi có request mới đến, hệ thống sẽ tự động thức dậy trong 1-2 giây.
* **Không cần Mật khẩu (No Auth)**: Cổng proxy mở trực tiếp, bot kết nối vào dùng ngay mà không cần cấu hình User/Pass rườm rà.
* **Không yêu cầu quyền Root**: Chạy Wireproxy ở tầng người dùng (Userspace WireGuard), không cần cài driver card mạng ảo TUN/TAP, tương thích hoàn hảo trong Docker container trên Railway.

---

## 2. Bảng phân bổ Node & Địa chỉ IP

Hệ thống hiện tại gồm **43 cụm máy chủ Proton WireGuard mới tinh** trên **27 quốc gia**:

| STT | Node | Quốc gia & Vị trí | Cổng HTTP | Cổng SOCKS5 | Trạng thái |
| :-: | :--- | :--- | :-: | :-: | :-: |
| 1 | `VN1` | 🇻🇳 Hà Nội (VN#1) | `25401` | `25400` | Verified Live |
| 2 | `VN2` | 🇻🇳 Hà Nội (VN#2) | `25403` | `25402` | Verified Live |
| 3 | `VN3` | 🇻🇳 Hà Nội (VN#3) | `25405` | `25404` | Verified Live |
| 4 | `VN4` | 🇻🇳 Hà Nội (VN#4) | `25407` | `25406` | Verified Live |
| 5 | `VN5` | 🇻🇳 Hà Nội (VN#5) | `25409` | `25408` | Verified Live |
| 6 | `VN6` | 🇻🇳 Hà Nội (VN#6) | `25411` | `25410` | Verified Live |
| 7 | `VN7` | 🇻🇳 Hà Nội (VN#7) | `25413` | `25412` | Verified Live |
| 8 | `VN8` | 🇻🇳 Hà Nội (VN#8) | `25415` | `25414` | Verified Live |
| 9 | `SG120` | 🇸🇬 Singapore (SG#120) | `25417` | `25416` | Verified Live |
| 10 | `SG124` | 🇸🇬 Singapore (SG#124) | `25419` | `25418` | Verified Live |
| 11 | `SG171` | 🇸🇬 Singapore (SG#171) | `25421` | `25420` | Verified Live |
| 12 | `SG175` | 🇸🇬 Singapore (SG#175) | `25423` | `25422` | Verified Live |
| 13 | `SG192` | 🇸🇬 Singapore (SG#192) | `25425` | `25424` | Verified Live |
| 14 | `JP188` | 🇯🇵 Tokyo (JP#188) | `25427` | `25426` | Verified Live |
| 15 | `JP201` | 🇯🇵 Osaka (JP#201) | `25429` | `25428` | Verified Live |
| 16 | `JP202` | 🇯🇵 Osaka (JP#202) | `25431` | `25430` | Verified Live |
| 17 | `JP203` | 🇯🇵 Osaka (JP#203) | `25433` | `25432` | Verified Live |
| 18 | `JP206` | 🇯🇵 Osaka (JP#206) | `25435` | `25434` | Verified Live |
| 19 | `HK29` | 🇭🇰 Hồng Kông (HK#29) | `25437` | `25436` | Verified Live |
| 20 | `HK35` | 🇭🇰 Hồng Kông (HK#35) | `25439` | `25438` | Verified Live |
| 21 | `TW13` | 🇹🇼 Đài Bắc (TW#13) | `25441` | `25440` | Verified Live |
| 22 | `KR20` | 🇰🇷 Seoul (KR#20) | `25443` | `25442` | Verified Live |
| 23 | `SA1` | 🇸🇦 Riyadh (SA#1) | `25445` | `25444` | Verified Live |
| 24 | `AF1` | 🇦🇫 Kabul (AF#1) | `25447` | `25446` | Verified Live |
| 25 | `EG1` | 🇪🇬 Cairo (EG#1) | `25449` | `25448` | Verified Live |
| 26 | `AL26` | 🇦🇱 Tirana (AL#26) | `25451` | `25450` | Verified Live |
| 27 | `DZ2` | 🇩🇿 Algiers (DZ#2) | `25453` | `25452` | Verified Live |
| 28 | `IN14` | 🇮🇳 Mumbai (IN#14) | `25455` | `25454` | Verified Live |
| 29 | `AD2` | 🇦🇩 Andorra (AD#2) | `25457` | `25456` | Verified Live |
| 30 | `AO1` | 🇦🇴 Luanda (AO#1) | `25459` | `25458` | Verified Live |
| 31 | `AT35` | 🇦🇹 Vienna (AT#35) | `25461` | `25460` | Verified Live |
| 32 | `AR31` | 🇦🇷 Buenos Aires (AR#31) | `25463` | `25462` | Verified Live |
| 33 | `AM2` | 🇦🇲 Yerevan (AM#2) | `25465` | `25464` | Verified Live |
| 34 | `AZ2` | 🇦🇿 Baku (AZ#2) | `25467` | `25466` | Verified Live |
| 35 | `PL52` | 🇵🇱 Warsaw (PL#52) | `25469` | `25468` | Verified Live |
| 36 | `MK01` | 🇲🇰 Skopje (MK#01) | `25471` | `25470` | Verified Live |
| 37 | `BH1` | 🇧🇭 Manama (BH#1) | `25473` | `25472` | Verified Live |
| 38 | `BD2` | 🇧🇩 Dhaka (BD#2) | `25475` | `25474` | Verified Live |
| 39 | `BY25` | 🇧🇾 Minsk (BY#25) | `25477` | `25476` | Verified Live |
| 40 | `BT1` | 🇧🇹 Thimphu (BT#1) | `25479` | `25478` | Verified Live |
| 41 | `BE43` | 🇧🇪 Brussels (BE#43) | `25481` | `25480` | Verified Live |
| 42 | `PT8` | 🇵🇹 Lisbon (PT#8) | `25483` | `25482` | Verified Live |
| 43 | `KH1` | 🇰🇭 Phnom Penh (KH#1) | `25485` | `25484` | Verified Live |

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


