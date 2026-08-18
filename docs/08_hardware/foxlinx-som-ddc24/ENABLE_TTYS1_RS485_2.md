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

Thứ còn thiếu nằm hoàn toàn ở **device tree**, và là **hai** thay đổi chứ không
phải một: node UART tương ứng đang bị tắt, **và** `pinctrl-0` của nó đang trỏ vào
nhóm chân M0 không ra Header P16 (xem §2).

```text
serial@21160000   status = "disabled"      ← ttyS1, cổng RS-485-2
serial@21170000   status = "okay"          ← ttyS2, UART của MCU STM32
serial@211a0000   status = "okay"          ← ttyS5, cổng RS-485-1
```

Hệ quả hiện tại: `/dev/ttyS1` không tồn tại ⇒ udev không tạo được `/dev/rs485-2` ⇒
`BusWorker` của bus 2 báo `connect_fail` và bus không bao giờ lên.

Để so sánh, cổng RS-485 **số 1** (`uart5`/`ttyS5`) đã đúng cả hai điều đó: node
`okay` và `pinctrl-0` trỏ `uart5m0-xfer-pins` = `GPIO4_A6`/`GPIO4_A7` = P16 chân
8/10 — đã đo xác nhận ngày 2026-08-18.

## 2. Pin mux: node có `pinctrl-0`, nhưng đang trỏ NHẦM nhóm chân

> [!CAUTION]
> **Đính chính 2026-08-18.** Bản 1.0 của tài liệu này viết rằng "không cần thêm
> hay sửa pin mux" và thay đổi cần thiết "đúng một thuộc tính" là `status`.
> **Điều đó sai** và nếu làm theo sẽ ra một bo có `/dev/ttyS1` chạy được nhưng
> **không có tín hiệu ở chân 26/36 của Header P16**. Xem bằng chứng đo tại
> [EVID-MBRTU-FOXLINX-P16-2026-08-18](../../07_records/test-evidence/fw-som/2026-08-18-foxlinx-rs485-p16-verification.md) §8.

Node `serial@21160000` **có** khai báo `pinctrl-0` và `pinctrl-names = "default"`,
và pinctrl controller **có** đủ các nhóm chân:

```text
/sys/firmware/devicetree/base/pinctrl/uart1/
    uart1m0-xfer-pins   uart1m0-ctsn-pins   uart1m0-rtsn-pins
    uart1m1-xfer-pins   uart1m1-ctsn-pins   uart1m1-rtsn-pins
```

Nhưng phải đọc xem `pinctrl-0` đang trỏ vào nhóm **nào**:

```text
$ hexdump -C /proc/device-tree/serial@21160000/pinctrl-0
00000000  00 00 00 b2 00 00 00 b3  00 00 00 b4

  phandle 0xb2 = uart1m0-xfer-pins      ← M0, KHÔNG PHẢI M1
  phandle 0xb3 = uart1m0-ctsn-pins
  phandle 0xb4 = uart1m0-rtsn-pins
```

Hai nhóm này nằm ở hai bộ chân hoàn toàn khác nhau:

| Nhóm | `rockchip,pins` (bank, pin, func) | Chân SoC | Ra Header P16? |
|---|---|---|:---:|
| `uart1m0-xfer-pins` | (0, 21, 3) + (0, 20, 3) | `GPIO0_C5`, `GPIO0_C4` | ❌ **không** |
| `uart1m1-xfer-pins` | (3, 15, 4) + (3, 14, 4) | `GPIO3_B7`, `GPIO3_B6` | ✅ chân 36, 26 |
| `uart1m1-rtsn-pins` | (3, 12, 4) | `GPIO3_B4` | ✅ chân 23 |

P16 chỉ đưa ra `GPIO0_C6` (chân 5) và `GPIO0_C7` (chân 7) của bank 0 — **không có**
`GPIO0_C4`/`GPIO0_C5`. Vì vậy giữ nguyên `pinctrl-0` = M0 thì UART1 sẽ được route
tới chân không có trên header.

Bản vá device tree phải đổi **cả hai** thuộc tính:

```dts
&uart1 {                     /* serial@21160000 */
    pinctrl-names = "default";
    pinctrl-0 = <&uart1m1_xfer>;   /* BẮT BUỘC: đổi từ uart1m0_xfer sang M1 */
    status = "okay";               /* đang là "disabled" */
};
```

Không thêm `&uart1m1_rtsn` trừ khi transceiver của cổng 2 thật sự cần DE/RE điều
khiển bằng RTS — xem câu hỏi còn mở ở §5. Cổng 1 (uart5) hiện chỉ khai `xfer`,
không khai `ctsn`/`rtsn`, và không có thuộc tính `rs485-*` nào.

> [!IMPORTANT]
> Triệu chứng nếu quên bước này rất dễ đánh lừa: `/dev/ttyS1` xuất hiện, udev tạo
> `/dev/rs485-2`, `BusWorker` mở cổng thành công, `stty` chạy sạch, bộ đếm `tx:`
> vẫn tăng đều — mọi thứ ở tầng phần mềm đều "xanh". Chỉ có bus là im lặng. Rất
> dễ mất nhiều giờ đi dò dây và transceiver.

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

Sửa **cả** `pinctrl-0 = <&uart1m1_xfer>` **và** `status = "okay"` cho `&uart1`
(xem đoạn DTS ở §2 — thiếu vế `pinctrl-0` là hỏng câm) trong device tree source
của SDK Forlinx OK1126B-S, build lại `boot.img`, nạp bằng quy trình flash chuẩn
có người tại chỗ.
Ưu điểm: hash FIT được sinh lại đúng, thay đổi nằm trong source có version, và
mọi bo sản xuất sau đều có sẵn cổng 2.

### 4.2 Đường nhanh — vá tại chỗ trên bo lab

Chỉ dùng khi **có người ở cạnh bo** để cứu nếu hỏng.

```bash
# 1. Sao lưu TOÀN BỘ partition boot ra file, và tải về máy dev
ssh SOM-DDC-24-foxlinx "dd if=/dev/block/by-name/boot of=/root/boot.img.bak bs=1M"
scp SOM-DDC-24-foxlinx:/root/boot.img.bak ./boot.img.bak

# 2. Trên máy dev: mở FIT, đổi CẢ HAI thứ của serial@21160000 rồi đóng gói lại:
#      - status: "disabled" -> "okay"
#      - pinctrl-0: phandle uart1m0-xfer (0xb2) -> uart1m1-xfer (0x35b)
#    (cần device-tree-compiler + u-boot-tools)

# 3. Kiểm hash: nếu FIT có node hash/signature, PHẢI sinh lại bằng mkimage

# 4. Nạp lại và reboot; nếu không lên, cứu bằng boot.img.bak qua maskrom
```

> [!WARNING]
> Mẹo vá nhị phân dưới đây **chỉ áp dụng cho `status`**. Thuộc tính `pinctrl-0`
> là mảng phandle, đổi nó là đổi giá trị 4 byte tại đúng offset — làm được nhưng
> phải xác định offset bằng cách parse blob, không "ghi đè chuỗi" như `status`.
> Vá thiếu vế `pinctrl-0` sẽ cho ra bo có `/dev/ttyS1` nhưng bus câm.

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
- ~~**Nhóm chân là `m0` hay `m1`?**~~ **ĐÃ TRẢ LỜI 2026-08-18:** `pinctrl-0` hiện
  trỏ `uart1m0` (`GPIO0_C4`/`GPIO0_C5`), **không** ra P16. Thiết kế cần `uart1m1`
  (chân 26/36/23) nên bản vá **bắt buộc** đổi `pinctrl-0`. Chi tiết ở §2.
- Cổng 2 cũng **không có DE/RE** như cổng 1 chứ? Nếu có, `buses[1].direction`
  phải đặt `rts` thay vì `auto`.

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-06 | Tạo tài liệu: xác định `serial@21160000` `status="disabled"` là thứ duy nhất chặn cổng RS-485-2; pin mux đã có sẵn; nêu hai đường đi và rủi ro nạp lại partition `boot` từ xa |
| 1.1 | 2026-08-18 | **Đính chính §2:** `pinctrl-0` của uart1 đang trỏ nhóm **M0** (`GPIO0_C4/C5`, không ra P16) chứ không phải M1. Đổi `status` thôi là chưa đủ — phải đổi cả `pinctrl-0` sang `uart1m1_xfer`. Bằng chứng đo: `EVID-MBRTU-FOXLINX-P16-2026-08-18` |
