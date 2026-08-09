# Bộ báo cáo tình trạng mã nguồn MK-DDC-24 — 2026-08-09

Tập tài liệu này mô tả hệ thống **đúng như mã nguồn đang có**, không phải như tài
liệu thiết kế mô tả. Khi mã nguồn và tài liệu mâu thuẫn, tài liệu ở đây luôn ghi
theo mã nguồn và nêu rõ chỗ lệch.

## Bối cảnh bản đo

| Mục | Giá trị |
|---|---|
| Commit | `8754a8e` (`8754a8ea5470c77d42cb498f918ecd8bc9fb2158`) |
| Nhánh | `docs/programming-design-set-v22` |
| Thời điểm đo | 2026-08-09T14:50+07:00 |
| Máy đo | Linux 7.0.0-28-generic, x86_64 |
| Toolchain | cmake 3.28.3, g++ (host), go 1.22.2, node v24.15.0 |

## Danh mục tài liệu

| Tệp | Nội dung |
|---|---|
| [01_TINH_TRANG_SRC_CODE.md](01_TINH_TRANG_SRC_CODE.md) | Tình trạng tổng thể mã nguồn: quy mô, cấu trúc, kết quả build/test thật, chất lượng |
| [02_TINH_NANG_PROGRAMMING_THEO_SRC.md](02_TINH_NANG_PROGRAMMING_THEO_SRC.md) | Tính năng lập trình điều khiển — cái gì có thật trong mã, cái gì chỉ có trên giấy |
| [03_BAO_CAO_ISO.md](03_BAO_CAO_ISO.md) | Đánh giá theo ISO/IEC 25010, ISO/IEC/IEEE 12207, IEC 61131-3, ISO 16484-5 |
| [04_FE_FRONTEND.md](04_FE_FRONTEND.md) | Frontend React/TypeScript (`apps/web-ui`) |
| [05_BE_BACKEND.md](05_BE_BACKEND.md) | Backend Go (`apps/web-api`) |
| [06_FW_SOM.md](06_FW_SOM.md) | Firmware SOM C++ (`apps/core`, `apps/iobus`; phụ: `netcfg`, `hmi`) |
| [07_PHAT_HIEN_VA_KHUYEN_NGHI.md](07_PHAT_HIEN_VA_KHUYEN_NGHI.md) | Sổ phát hiện có mã truy vết, mức độ, và trạng thái xử lý |

## Phương pháp

Mọi khẳng định trong bộ tài liệu này thuộc một trong ba loại, và loại nào cũng
truy ngược được về mã nguồn hoặc lệnh đã chạy:

1. **Số đo thực thi** — kết quả build/test chạy trên máy đo tại commit trên. Không
   dẫn lại số cũ từ CHANGELOG hay báo cáo trước.
2. **Sự kiện tĩnh của mã** — đếm tệp, đếm dòng, bảng ký hiệu, bảng định tuyến,
   đồ thị phụ thuộc. Mỗi khẳng định kèm đường dẫn tệp và số dòng.
3. **Suy luận có nêu căn cứ** — ví dụ "tính năng X không tới được người dùng" được
   suy ra từ chuỗi cụ thể: cờ build → điều kiện định tuyến → thiếu handler. Chuỗi
   này được viết ra đầy đủ để người đọc tự kiểm lại được.

Cái **không** làm: chấm điểm theo checklist tài liệu, đếm hạng mục "đã Done"
trong bảng kế hoạch, hay suy ra trạng thái hiện thực từ tên tài liệu thiết kế.

### Lệnh kiểm chứng đã chạy

```bash
# C++ — bật cả 3 tuỳ chọn để không bỏ sót gate HMI (mặc định OFF)
cmake --fresh -S . -B build/report-audit -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
cmake --build build/report-audit --parallel
ctest --test-dir build/report-audit --output-on-failure

# Go
cd apps/web-api && go vet ./... && go test ./... -count=1

# Frontend
cd apps/web-ui && npx vitest --run --environment jsdom src && npm run lint && npm run build
```

### Kết quả (exit code thật, không dẫn lại)

| Bộ | Lệnh | Kết quả | Exit |
|---|---|---|---|
| C++ | cmake configure | thành công | 0 |
| C++ | cmake build | thành công | 0 |
| C++ | ctest | **860/860 pass**, 13.44 s | 0 |
| Go | `go vet ./...` | sạch | 0 |
| Go | `go test ./... -count=1` | **11/11 gói pass** (505 hàm test) | 0 |
| FE | vitest | **465/465 pass**, 52 tệp | 0 |
| FE | eslint `--max-warnings=0` | sạch | 0 |
| FE | vite build | thành công | 0 |

Toàn bộ gate xanh. Xin đọc kỹ điểm này: **gate xanh nói lên chất lượng của phần
đã viết, không nói lên độ đầy đủ của phần chưa viết.** Phát hiện nặng nhất trong
bộ báo cáo này — tính năng lập trình điều khiển không tới được người dùng — nằm
trọn trong vùng mù đó, vì không có test nào khẳng định nó phải tới được.

## Phạm vi thuật ngữ

- **FE** = `apps/web-ui` (React + TypeScript + Vite).
- **BE** = `apps/web-api` (Go 1.22, HTTP API + IPC tới core/iobus).
- **FW SOM** = `apps/core` + `apps/iobus` (C++17 chạy trên SOM Linux). Hai dịch
  vụ SOM khác — `apps/netcfg` và `apps/hmi` — được báo cáo riêng trong cùng tệp
  vì chúng chạy trên SOM nhưng không thuộc đường điều khiển.
- **FW MCU** = `firmware/stm32` (STM32, C). Ngoài phạm vi "FW SOM"; chỉ nêu số
  liệu quy mô để đối chiếu.
