# Hướng dẫn Lắp đặt — MK-DDC-24

> **Tài liệu:** KX-DDC24-INSTALL-001_VI  
> **Sản phẩm:** MK-DDC-24 — Bộ điều khiển DDC 24 điểm  
> **Phiên bản:** 1.0 | 2026-06-02  
> **Mục đích:** Hướng dẫn lắp đặt, đấu dây và các yêu cầu an toàn — phục vụ hồ sơ CR Mark / QCVN (mục B10)

---

## 1. Yêu cầu Chung

### 1.1 Điều kiện môi trường

| Thông số | Giá trị |
|----------|---------|
| Nhiệt độ làm việc | 0°C đến +55°C |
| Nhiệt độ bảo quản | -40°C đến +85°C |
| Độ ẩm | 10–90% RH, không ngưng tụ |
| Cấp bảo vệ | IP20 (chỉ dùng trong nhà) |
| Vị trí lắp | Trong tủ điện, tránh nước, bụi và rung động mạnh |

### 1.2 Yêu cầu nguồn điện

| Thông số | Giá trị |
|----------|---------|
| Điện áp cấp | 24 VAC/VDC ±20% |
| Công suất tiêu thụ | < 5W điển hình, < 8W max (tất cả relay đóng) |
| Dây nguồn khuyến nghị | 1.5 mm² (16 AWG), đôi xoắn |
| Bảo vệ | Cầu chì hoặc MCB 1A ngoài (bắt buộc) |

### 1.3 Dụng cụ cần thiết

- Tô-vít đầu dẹt 3.5mm (cho terminal block)
- Tô-vít đầu Phillips (cho vít DIN-rail)
- Đồng hồ đo điện (VOM)
- Máy tính / laptop có cổng Ethernet và USB-C
- Cáp Ethernet RJ-45, cáp USB-C

---

## 2. Kích thước & Lắp đặt Cơ khí

### 2.1 Kích thước

```
      150 mm
◄──────────────►
┌────────────────┐  ▲
│                │  │
│                │  90 mm
│   MK-DDC-24   │  │
│                │  ▼
└────────────────┘
◄──── 55 mm ────► (chiều sâu)
```

- **Rộng × Cao × Sâu:** 150 × 90 × 55 mm
- **Trọng lượng:** ~300 g

### 2.2 Kiểu lắp

**Lựa chọn 1 — DIN-rail 35 mm (khuyến nghị):**
1. Gắn clip DIN-rail phía sau thiết bị vào thanh DIN 35 mm tiêu chuẩn.
2. Ấn nhẹ cho đến khi clip kêu "tách".
3. Kéo nhẹ để xác nhận đã khóa chặt.

**Lựa chọn 2 — Mounting flange (gắn tường / mặt phẳng):**
1. Dùng mặt bích đi kèm (2× vít M4).
2. Khoan lỗ theo template gói hàng.
3. Gắn thiết bị bằng vít M4 × 20 mm.

### 2.3 Yêu cầu thông gió

- Duy trì khoảng trống tối thiểu **50 mm** trên và dưới thiết bị.
- Không đặt thiết bị cạnh nguồn nhiệt lớn (biến tần, contactor công suất cao).
- Nếu tủ điện kín, cần quạt thông gió khi nhiệt độ tủ > 50°C.

---

## 3. Sơ đồ Chân & Đấu dây

### 3.1 Bố trí terminal

Nhìn từ mặt trước, terminal block từ trái sang phải:

| Vị trí | Ký hiệu | Chức năng | Ghi chú |
|--------|---------|-----------|---------|
| PWR+ | 24V+ | Nguồn 24 VAC/VDC (+) | 1.5 mm² |
| GND  | GND | Nguồn 24 VAC/VDC (-) | 1.5 mm² |
| UI1–UI8 | UI1–UI8 | Universal Input 1–8 | Xem §3.2 |
| COM_UI | COM | Common cho UI | Nối với GND |
| DI1–DI8 | DI1–DI8 | Digital Input 1–8 | 24V DC |
| COM_DI | COM | Common cho DI | Nối với GND |
| AO1–AO4 | AO1–AO4 | Analog Output 1–4 | 0–10V / 4–20mA |
| GND_AO | GND | Ground cho AO | |
| DO1–DO4 | DO1–DO4 (NO/COM/NC) | Digital Output relay 1–4 | 5A @ 250VAC |
| RS-485 | A/B/GND | Modbus RTU master | Shielded twisted pair |
| Ethernet | RJ-45 | BACnet/IP, MQTT, Web UI | |
| USB-C | USB-C | Serial console, commissioning | |
| USB-A | USB-A | Debug / recovery | |

### 3.2 Đấu nối Universal Input (UI)

UI tự động nhận dạng loại cảm biến. Chỉ đấu dây theo các sơ đồ dưới đây:

**Cảm biến NTC 10k/20k (2 dây):**
```
UI(N) ──────┬──── NTC sensor
            │
COM  ───────┴──── NTC sensor
```

**PT100/PT1000 (2 dây):**
```
UI(N) ────── PT100/1000
COM   ────── PT100/1000
```

**0–10V:**
```
UI(N) ────── Signal (+) của sensor
COM   ────── Signal (-) / GND của sensor
```

**4–20mA:**
```
UI(N) ────── Signal (+) của sensor
COM   ────── Signal (-) / GND của sensor
(Lưu ý: UI có sẵn resistor 250Ω cho 4–20mA)
```

**Dry contact (công tắc / relay):**
```
UI(N) ────── Contact
COM   ────── Contact còn lại
```

### 3.3 Đấu nối Digital Output (Relay)

DO dùng relay SPDT (Single Pole Double Throw), 5A @ 250VAC.

| Chân | Chức năng | Ghi chú |
|------|-----------|---------|
| NO (Normally Open) | Tiếp điểm thường mở | Đóng khi relay active |
| COM (Common) | Tiếp điểm chung | |
| NC (Normally Closed) | Tiếp điểm thường đóng | Mở khi relay active |

**Ví dụ — Điều khiển quạt:**
```
DO1-NO ──── Fan contactor coil (A1)
DO1-COM ─── Nguồn L (qua MCB)
    NC ──── (Không dùng)
```

### 3.4 Đấu nối RS-485 (Modbus RTU master)

| Chân | Tín hiệu | Màu dây khuyến nghị |
|------|----------|---------------------|
| A | D+ / Non-inverting | Xanh dương |
| B | D- / Inverting | Trắng / Vàng |
| GND | Signal ground | Xanh lá / Đen |

**Yêu cầu:**
- Dây: Belden 9841 hoặc tương đương (shielded twisted pair 120Ω).
- Bấm điện trở termination **120Ω** ở 2 đầu bus nếu tổng chiều dài > 100 m.
- Nối shield/GND tại **một điểm** (gần DDC).
- Khoảng cách tối đa: 1200 m @ 9600 baud.

### 3.5 Đấu nối Ethernet

- Cáp: CAT5e trở lên.
- Kết nối trực tiếp vào switch LAN.
- Mặc định DHCP; nếu cần IP tĩnh, cấu hình qua Web UI (xem Hướng dẫn Sử dụng §4).

---

## 4. Quy trình Lắp đặt

### Bước 1 — Kiểm tra trước khi lắp
- [ ] Thiết bị không bị hư hỏng vật lý.
- [ ] Điện áp nguồn trong dải 24 VAC/VDC ±20%.
- [ ] Ngắt nguồn trước khi đấu dây.

### Bước 2 — Lắp đặt cơ khí
- [ ] Gắn thiết bị lên DIN-rail hoặc mặt phẳng.
- [ ] Đảm bảo khoảng trống thông gió.

### Bước 3 — Đấu dây nguồn
- [ ] Đấu dây 24 VAC/VDC vào terminal PWR+ / GND.
- [ ] Kiểm tra polarity (với DC) hoặc đảm bảo đồng pha (với AC).

### Bước 4 — Đấu dây I/O
- [ ] Đấu UI theo loại cảm biến (§3.2).
- [ ] Đấu DI (nếu có).
- [ ] Đấu AO (nếu có).
- [ ] Đấu DO (nếu có).

### Bước 5 — Đấu dây truyền thông
- [ ] Đấu RS-485 (A/B/GND) nếu có thiết bị phụ Modbus.
- [ ] Gắn cáp Ethernet vào switch.

### Bước 6 — Kiểm tra trước khi cấp nguồn
- [ ] Kiểm tra ngắn mạch giữa các terminal.
- [ ] Kiểm tra nguồn đúng điện áp.
- [ ] Kiểm tra termination RS-485.

### Bước 7 — Cấp nguồn
- [ ] Bật nguồn → đèn PWR xanh → đèn RUN nhấp nháy trong vòng ≤ 30 giây.
- [ ] Nếu đèn FAULT đỏ: ngắt nguồn, kiểm tra lại đấu dây.

---

## 5. Đèn LED Báo trạng thái

| LED | Màu | Trạng thái | Ý nghĩa |
|-----|-----|------------|---------|
| PWR | Xanh | Sáng | Có nguồn 24V |
| RUN | Xanh | Nhấp nháy 1 Hz | Hệ thống hoạt động bình thường |
| RUN | Xanh | Nhấp nháy chậm (0.25 Hz) | Standalone mode (mất BACnet) |
| FAULT | Đỏ | Sáng | Lỗi hệ thống |
| FAULT | Đỏ | Nhấp nháy | Cảnh báo (over-range, timeout thiết bị phụ) |
| BACnet | Xanh | Sáng | Kết nối BACnet/IP active |
| BACnet | Tắt | — | Không có kết nối BACnet |
| MQTT | Xanh | Sáng | Kết nối MQTT broker OK |
| MQTT | Tắt | — | Mất kết nối MQTT |
| RS-485 | Xanh | Nhấp nháy | Đang giao tiếp Modbus RTU |

---

## 6. Yêu cầu An toàn

### 6.1 An toàn điện

- **Ngắt nguồn trước khi đấu dây.** Không đấu nối khi đang có điện.
- Sử dụng cầu chì hoặc MCB 1A cho đường nguồn 24V.
- Dây nguồn tối thiểu 1.5 mm².
- Không dùng chung nguồn 24V với thiết bị có tải cảm lớn (contactor, van solenoid) —
  dùng nguồn riêng hoặc flyback diode cho tải cảm.
- Đảm bảo nối đất (PE) cho tủ điện.

### 6.2 An toàn vận hành

- Relay DO có thể mang điện áp nguy hiểm (250VAC). Luôn ngắt nguồn tải trước khi đấu dây DO.
- Không vượt quá định mức relay: 5A @ 250VAC (resistive load).
- Với tải cảm (motor, contactor): dùng RC snubber hoặc diode flyback.

### 6.3 Cảnh báo

- Sản phẩm không phải là thiết bị an toàn (safety device). Không dùng trong ứng dụng bảo vệ
  sinh mạng (life safety) mà không có hệ thống dự phòng riêng.
- Lắp đặt phải do kỹ thuật viên có chuyên môn thực hiện.
- Tuân thủ quy định an toàn điện địa phương (QCVN 4:2009/BKHCN).

---

## 7. Bảo trì

| Khoảng | Nội dung |
|--------|----------|
| Hàng tháng | Kiểm tra đèn LED trạng thái. Vệ sinh bụi tủ điện. |
| 6 tháng | Kiểm tra kết nối terminal (vít siết chặt). |
| 12 tháng | Kiểm tra chức năng failsafe (ngắt BACnet → đo output). |

---

## 8. Đóng gói & Vận chuyển

- Sản phẩm được đóng gói trong hộp carton với đệm xốp ESD.
- Bảo quản nơi khô ráo, tránh ẩm và nhiệt độ cao.
- Khi vận chuyển: tránh va đập mạnh, giữ bao bì gốc.

---

## 9. Liên hệ Hỗ trợ

**KINEXUS Technologies JSC**  
Lô I-3, Khu Công nghệ Cao, Quận 9, TP. Hồ Chí Minh

📧 support@KINEXUS-tech.vn  
📞 1900-xxxx (8h–17h, T2–T6)

---

**Document ID:** KX-DDC24-INSTALL-001_VI  
**Revision:** 1.0 | 2026-06-02  
**Related docs:** [DS_MK-DDC-24_VI](../01_specs/DS_MK-DDC-24_VI.md) | [KX-DDC24-USER-001_VI](KX-DDC24-USER-001_VI.md) | [KX-DDC24-SWDESC-001_VI](KX-DDC24-SWDESC-001_VI.md)
