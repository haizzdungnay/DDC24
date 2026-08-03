# Báo cáo sửa nền source DDC-24 trước thiết kế Programming

**ID:** DDC24-BASELINE-SRC-FIX-2026-08-03
**Ngày kiểm chứng:** 2026-08-03
**Phạm vi:** source nền, CI, Point Model, Modbus RTU Point, cấu hình I/O/safe-state, firmware IOP, health/recovery và deployment provenance
**Ngoài phạm vi:** Program API, ST/FBD Editor, nối `StScheduler` vào production, Program Deployment/Activation, Modbus TCP Point và BACnet/IP Point

## Kết luận điều hành

Nền source và CI host đã được sửa đủ để tiếp tục thiết kế Programming có điều kiện. Point Model và đường cấu hình I/O/safe-state đã có hợp đồng thống nhất, thẩm quyền metadata ở BE/Core, revision/checksum và rollback khi apply lỗi. Modbus RTU đã có đường source FE → BE → profile → iobus → Core Point Table → API/WebSocket cùng simulator test.

Hai gate phần cứng bắt buộc chưa thể đóng trong phiên này:

- target `SOM-DDC-24` đang nối fake MCU qua `/tmp/mkddc-iop-a`, chưa nối STM32/physical I/O thật;
- target chưa có `fieldbus.conf` và không có Modbus RTU slave/RS485 device thật để chạy acceptance test.

Do đó báo cáo không suy diễn host/simulator thành HIL production và không tuyên bố Physical I/O hoặc Modbus RTU Point đã sẵn sàng release.

## Thay đổi As-Built

### CI baseline

- Sửa `-Werror=dangling-else` trên GCC 11 trong `fw/tests/test_iop_link.cpp` bằng block tường minh; không tắt warning và không skip test.
- Sửa locator login của ba Playwright spec thành `getByLabel(..., { exact: true })`, loại ambiguity giữa ô Password và nút Show password.
- Sửa source helper chỉ dùng khi bật Modbus để cấu hình GCC 11 mặc định không phát sinh `unused-function`.

### Point Model và metadata authority

`PointDTO` của BE cung cấp hợp đồng canonical cho Local Physical I/O, Virtual Point và Modbus RTU Point:

`point_id`, `tag_name`, `display_name`, `data_type`, `unit`, `value`, `quality`, `timestamp`, `read_write`, `source`, `default_value`, `safe_value`.

- FE chỉ giữ preference trình bày trong `localStorage`; metadata Point được đọc/ghi qua BE.
- Tag được kiểm tra unique xuyên Local Physical I/O, Virtual Point và Modbus RTU Point.
- `point_id` là identity ổn định; API từ chối đổi ID khi chỉ rename tag/display name.
- Core Point Table có kind `EXT`, source `MODBUS_RTU`; scan loop nhập EXT snapshot mà không nối `StScheduler` production.

### Config Apply

- Thêm I/O bundle gồm `io.conf` và `safe_state.conf`.
- Validate toàn bundle trước khi ghi; hai file dùng cùng revision/checksum.
- Apply dùng atomic file replace; nếu reload core/iobus thất bại thì khôi phục cả hai file và reload cấu hình cũ.
- Các đường cập nhật I/O, safe-state và point metadata hiện đi qua cùng baseline bundle, tránh trạng thái nửa cũ/nửa mới trong lỗi apply thông thường.

### Health và recovery

- Thêm public `GET /health` và authenticated `GET /api/v1/health`.
- Health tách riêng process core, process iobus, core socket, `plc_shm`, `io_shm` và MCU connection; không coi có SHM là đủ để kết luận process còn sống.
- Đã đo systemd restart sau `SIGKILL` trên target cho core, iobus và web. Đây là bằng chứng recovery của deployment hiện hữu, không phải bằng chứng binary mới đã deploy.

## Bằng chứng test trong phiên

| Gate | Lệnh/phạm vi | Kết quả |
|---|---|---|
| GCC 11 Ubuntu 22.04 | CMake Release, warning-as-error, CTest | **708/708 PASS** |
| C++ đầy đủ host | `MKDDC_ENABLE_MODBUS=ON`, `MKDDC_ENABLE_BACNET=ON`, `MKDDC_ENABLE_HMI=ON` | **751/751 PASS** |
| Go BE | `go vet ./...` + `go test ./... -count=1` | **PASS**, package `mkddc-web` 22.309 s |
| FE unit | Vitest jsdom | **35 file, 299/299 PASS** |
| FE static/build | eslint, TypeScript, Vite production | **PASS**, 0 warning |
| Firmware host | CMake/CTest portable runtime + IOP | **PASS** |
| Firmware ARM | `arm-none-eabi-gcc`, `-Wall -Wextra -Werror` | **PASS**; ELF tạo thành công |
| Modbus RTU simulator | pseudo-TTY read/write/timeout trong full CTest | **PASS** |
| OpenAPI | parse YAML và kiểm tra contract mới | **PASS** |
| Playwright | network, point-name, trends | **21/21 PASS**; không skip |

### Recovery đo trên `SOM-DDC-24`

| Service | PID trước → sau | `NRestarts` | Trạng thái sau |
|---|---:|---:|---|
| `mkddc-core` | 284680 → 364084 | 0 → 1 | active, `plc_shm` còn đọc được |
| `mkddc-iobus` | 284675 → 364599 | 0 → 1 | active, `io_shm` còn đọc được |
| `mkddc-web-pi` | 284692 → 364260 | 0 → 1 | active, HTTP 200 sau recovery |

Thời gian phục hồi quan sát khoảng 1.6–1.8 giây. Target dùng binary cũ nên số đo này chỉ đóng gate systemd recovery, không đóng provenance hay HIL cho source mới.

## Sai khác còn mở

| Finding | Mức | Trạng thái | Điều kiện đóng |
|---|---|---|---|
| BASE-HW-01 | Blocker | Target dùng fake MCU, weak HAL trong firmware chưa bind STM32 BSP production | flash firmware lên MCU thật và chạy đủ ma trận HIL |
| BASE-MB-01 | Blocker | Chưa có RS485 slave/device thật | test CRUD → poll/write → quality/CRC/timeout/retry → reboot trên thiết bị thật |
| BASE-PROV-01 | Blocker release | Worktree còn dirty, chưa có commit chứa thay đổi; target đang chạy binary cũ và không có provenance manifest | commit/review, build sạch, deploy bằng installer, đối chiếu runtime hash/commit |
| BASE-ATOMIC-01 | Giới hạn đã biết | Rollback được test cho lỗi apply/reload; chưa có power-cut test giữa các rename | fault-injection/power-cycle trên filesystem target |

## Danh sách commit

- HEAD nền tại thời điểm làm việc: `5eeb7b9bf95e0c7d7933766ae3bf62e7c6fdb90f`.
- Không tạo commit mới trong nhiệm vụ này vì người dùng chưa yêu cầu commit. Toàn bộ thay đổi hiện ở worktree; binary build trong phiên được gắn hậu tố `-dirty` để không giả mạo provenance commit sạch.

## Kết luận bắt buộc

```text
CI_BASELINE_GREEN = YES
POINT_MODEL_READY = YES
MODBUS_RTU_POINT_READY = NO
PHYSICAL_IO_READY = NO
CONFIG_BASELINE_READY = YES
READY_FOR_PROGRAMMING_DESIGN = CONDITIONAL
```

`CONDITIONAL` chỉ cho phép bắt đầu thiết kế trên các hợp đồng Point/Config đã test; không cho phép đóng gate production, release hoặc coi Programming đã được implement.
