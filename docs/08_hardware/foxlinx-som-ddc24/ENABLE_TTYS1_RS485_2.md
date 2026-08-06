# Bật `ttyS1` cho cổng RS-485 số 2 — Foxlinx SOM-DDC-24

> **ID:** HW-FOXLINX-TTYS1-ENABLE
> **Ngày:** 2026-08-06
> **Trạng thái:** CHẶN — cần quyết định của chủ sở hữu phần cứng/BSP
> **Chặn:** `MBR-B403` bus 2, `OD-MBRTU-001` (phần cổng 2)

## 1. Tóm tắt

Toàn bộ đường **phần mềm** cho cổng RS-485 thứ hai đã sẵn sàng và đã kiểm chứng:
`buses[]` hai phần tử, `BusWorker` riêng cho từng bus, udev rule
`ttyS1 → /dev/rs485-2`, trang Cổng RS-485 cấu hình từng cổng, validator chấp nhận
`rs485-2`, capability manifest đã khai báo cổng.

Thứ duy nhất còn thiếu nằm ở **device tree**: node UART tương ứng đang bị tắt.

```text
serial@21160000   status = "disabled"      ← ttyS1, cổng RS-485-2
serial@21170000   status = "okay"          ← ttyS2, UART của MCU STM32
serial@211a0000   status = "okay"          ← ttyS5, cổng RS-485-1
```

Hệ quả: `/dev/ttyS1` không tồn tại ⇒ udev không tạo được `/dev/rs485-2` ⇒
`BusWorker` của bus 2 báo `connect_fail` và bus không bao giờ lên.

## 2. Điểm thuận lợi: pin mux đã có sẵn

Node `serial@21160000` **đã khai báo đầy đủ** `pinctrl-0` và
`pinctrl-names = "default"`, và pinctrl controller đã có nhóm chân:

```text
/sys/firmware/devicetree/base/pinctrl/uart1/
    uart1m0-xfer-pins   uart1m0-ctsn-pins   uart1m0-rtsn-pins
    uart1m1-xfer-pins   uart1m1-ctsn-pins   uart1m1-rtsn-pins
```

Nghĩa là **không cần thêm hay sửa pin mux**. Thay đổi cần thiết đúng một thuộc
tính:

```dts
&uart1 {                     /* serial@21160000 */
    status = "okay";         /* đang là "disabled" */
};
```

## 3. Vì sao chưa thực hiện

DTB nằm trong partition `boot` (`/dev/block/by-name/boot` → `mmcblk0p4`, 64 MiB).
Bốn byte đầu là `D0 0D FE ED` — magic FDT, tức partition là một **FIT image**
chứa kernel + DTB (+ ramdisk).

Ghi lại partition này trên bo Foxlinx hiện tại có hai rủi ro cụ thể:

1. **Không có đường cứu từ xa.** Bo chỉ truy cập được qua SSH
   (`mekong-fac.ddns.net:2223`). Nếu ảnh boot hỏng, bo không lên mạng và phải
   cứu bằng maskrom/USB — tức phải có người **đứng tại chỗ**.
2. **FIT có thể có hash/chữ ký.** U-Boot của Rockchip thường kiểm hash node
   `fdt` trong FIT. Vá DTB tại chỗ mà không cập nhật hash sẽ làm U-Boot từ chối
   nạp, và triệu chứng là bo không boot — không phải một thông báo lỗi.

Ngoài ra `dtc`/`fdtput` không có sẵn trên cả bo lẫn máy dev (không có quyền cài
gói), nên chưa có công cụ để mở và đóng gói lại FIT một cách kiểm chứng được.

## 4. Hai đường đi

### 4.1 Đường đúng — sửa trong BSP rồi nạp ảnh chính thức (khuyến nghị)

Sửa `status = "okay"` cho `&uart1` trong device tree source của SDK Forlinx
OK1126B-S, build lại `boot.img`, nạp bằng quy trình flash chuẩn có người tại chỗ.
Ưu điểm: hash FIT được sinh lại đúng, thay đổi nằm trong source có version, và
mọi bo sản xuất sau đều có sẵn cổng 2.

### 4.2 Đường nhanh — vá tại chỗ trên bo lab

Chỉ dùng khi **có người ở cạnh bo** để cứu nếu hỏng.

```bash
# 1. Sao lưu TOÀN BỘ partition boot ra file, và tải về máy dev
ssh SOM-DDC-24-foxlinx "dd if=/dev/block/by-name/boot of=/root/boot.img.bak bs=1M"
scp SOM-DDC-24-foxlinx:/root/boot.img.bak ./boot.img.bak

# 2. Trên máy dev: mở FIT, đổi status của serial@21160000, đóng gói lại
#    (cần device-tree-compiler + u-boot-tools)

# 3. Kiểm hash: nếu FIT có node hash/signature, PHẢI sinh lại bằng mkimage

# 4. Nạp lại và reboot; nếu không lên, cứu bằng boot.img.bak qua maskrom
```

**Mẹo giữ nguyên độ dài (nếu chọn vá nhị phân):** giá trị `"disabled"` dài 9 byte
kể cả NUL, `"okay"` chỉ 5. Ghi `okay\0` rồi giữ nguyên 4 byte đệm và **không đổi
trường length** thì cấu trúc blob không dịch chuyển, vì mọi bên đọc `status` đều
dừng ở NUL đầu tiên. Cách này tránh phải dựng lại toàn bộ blob, nhưng **không**
giải quyết được vấn đề hash FIT.

## 5. Câu hỏi còn mở cho chủ sở hữu phần cứng

Bật device tree mới chỉ làm `/dev/ttyS1` xuất hiện. Cần xác nhận thêm:

- **Cổng 2 đã có transceiver RS-485 chưa?** Tài liệu mô tả nó ở *Header P16, UART1
  M1, chân 26/36/23*, nghe như đầu ra mức TTL trên header chứ không phải cổng
  A/B đã có transceiver như cổng 1. Nếu vậy cần mạch chuyển bên ngoài.
- **Nhóm chân là `m0` hay `m1`?** Device tree có cả hai; `pinctrl-0` hiện tại trỏ
  vào nhóm nào phải khớp với đường mạch thật.
- Cổng 2 cũng **không có DE/RE** như cổng 1 chứ? Nếu có, `buses[1].direction`
  phải đặt `rts` thay vì `auto`.

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-06 | Tạo tài liệu: xác định `serial@21160000` `status="disabled"` là thứ duy nhất chặn cổng RS-485-2; pin mux đã có sẵn; nêu hai đường đi và rủi ro nạp lại partition `boot` từ xa |
