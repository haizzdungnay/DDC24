# Tài liệu phần cứng — Foxlinx SOM-DDC-24

Bộ tài liệu kit bo phát triển **Foxlinx SOM-DDC-24** (SoC Rockchip RV1126B)
dùng trong sản phẩm **MK-DDC-24** của Mekong.

## Danh mục

| # | Tài liệu | Mục đích | Đối tượng |
|---|---|---|---|
| 1 | [FOXLINX_SOM_DDC24_SPEC.md](FOXLINX_SOM_DDC24_SPEC.md) | Thẻ thông số kỹ thuật kit | Tất cả |
| 2 | [FOXLINX_PINOUT_MAP.md](FOXLINX_PINOUT_MAP.md) | Sơ đồ chân & Pin Mux | HW, FW |
| 3 | [FOXLINX_UART_RS485_GUIDE.md](FOXLINX_UART_RS485_GUIDE.md) | Hướng dẫn cấu hình UART/RS485 | FW, SW, Deploy |
| 4 | [FOXLINX_DEPLOY_CHECKLIST.md](FOXLINX_DEPLOY_CHECKLIST.md) | Checklist triển khai | Deploy, QA |
| 5 | [FOXLINX_KNOWN_ISSUES.md](FOXLINX_KNOWN_ISSUES.md) | Vấn đề đã biết & findings | Tất cả |

## Thông tin board

| Thuộc tính | Giá trị |
|---|---|
| Model | Forlinx OK1126B-S Board |
| SoC | Rockchip RV1126B — Quad-core Cortex-A53 |
| SSH alias | `SOM-DDC-24-foxlinx` |
| SSH host | `root@mekong-fac.ddns.net:2223` |
| OS | Buildroot 2024.02, Linux 6.1.141 |

## Nguồn dữ liệu

- Khảo sát trực tiếp trên board production qua SSH (2026-08-04 / 2026-08-05).
- Bảng tra cứu chân SoM (Pin Mux Table) từ nhà sản xuất Forlinx.
- Sơ đồ mạch Header GPIO P16 (20×2, 2.54 mm) từ schematic bo đế.
- Trang web nhà sản xuất: [Forlinx Developer Center](https://www.forlinx.net/).
- Tài liệu dự án hiện có: `HW_SPEC_MK-DDC-24_VI.md`, bằng chứng khảo sát UART/RS485.
