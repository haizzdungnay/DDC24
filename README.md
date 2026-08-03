# MK-DDC-24

MK-DDC-24 là bộ điều khiển tự động hóa biên BMS theo mô hình component, chạy cục bộ trên Linux. Rev A cung cấp 16 Universal Input, 4 Analog Output và 4 Digital Output; HMI cục bộ là dịch vụ tùy chọn theo cấu hình build.

## Bắt đầu

- [Document hub](docs/README.md): cổng vào duy nhất cho tài liệu đang hiệu lực.
- [Product baseline](docs/01_product/PRODUCT.md): sản phẩm, phạm vi Rev A và các nội dung hoãn.
- [System architecture](docs/03_architecture/SYSTEM.md): topology và luồng dữ liệu.
- [Development & operations](docs/06_operations/DEVELOPMENT_AND_OPERATIONS.md): build, test, chạy và chẩn đoán.
- [Changelog](CHANGELOG.md): lịch sử thay đổi toàn dự án.

## Runtime Rev A

- `mkddc-core`: component graph, scan, priority và safe-state.
- `mkddc-iobus`: Kinexus-IOP, I/O, Modbus RTU/TCP và BACnet/IP.
- `mkddc-web`: REST API và giao diện cấu hình React.
- `mkddc-hmi`: LVGL/DRM HMI tùy chọn, bật bằng `MKDDC_ENABLE_HMI`.

Source production nằm trong `apps/`, firmware trong `firmware/stm32`, contract
machine-readable duy nhất trong `contracts/`, còn CMake/packaging/systemd nằm
trong `platform/`. Entrypoint kiểm chứng thống nhất là
`scripts/verify-project.sh`; build artifact chỉ được tạo dưới `build/`.

Source code và contract là nguồn chuẩn cho hành vi đã triển khai; hồ sơ trong
`docs/` kiểm soát yêu cầu, thiết kế, xác minh và release gate. Tài liệu trước
đợt tái cấu trúc ngày 2026-07-22 nằm trong
`archives/markdown-before-restructure-2026-07-22.tar.gz` và không còn là nguồn
đang hiệu lực.
