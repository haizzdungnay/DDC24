# BACnet Rev A — Plan triển khai từ Tài liệu đến Source Code và E2E trên bo Forlinx

| Thuộc tính | Giá trị |
|---|---|
| **ID** | `PLAN-BACNET-D2C-001` |
| **Phiên bản** | 1.0 | 2026-09-10 |
| **Trạng thái** | **PROPOSED — chờ review. Review OK thì mới tạo Issue theo từng task.** |
| **Chủ quản** | Product Owner/CTO + System Architect + Dev Lead |
| **Đầu vào** | [`REV-BACNET-ASBUILT-001`](../05_verification/BACNET_REV_A_ASBUILT_REVIEW.md) · [`PLAN-BACNET-REVA-001`](BACNET_REV_A_IMPLEMENTATION_PLAN.md) · [`OD-BAC-SET-001`](../00_governance/BACNET_OPEN_DECISIONS.md) |
| **Target** | Forlinx OK1126B-S (SoM FET1126Bx-S, Rockchip RV1126B, Buildroot 2024.02) |
| **Quan hệ** | Chi tiết hoá `PLAN-BACNET-REVA-001` xuống mức task thi hành được. Không thay thế nó. |
| **Release gate** | Chỉ mở bằng evidence TARGET-HIL trên bo thật, không phải host/mock |

---

## 0. Cách đọc plan này

`PLAN-BACNET-REVA-001` trả lời **"phải sửa gì và theo thứ tự nào"** ở mức Work Package.
Plan này trả lời **"làm cụ thể ra sao, chạm file nào, verify trên bo Forlinx bằng cách
nào"** — mức task giao được cho một người trong một lần ngồi.

### 0.1 Bốn mức bằng chứng — không được trộn

Đây là điểm mấu chốt của toàn bộ plan. Review as-built đã chỉ ra rằng dự án từng coi
bằng chứng mức thấp là bằng chứng mức cao (host test PASS được đọc như "BACnet chạy").
Plan này khoá bốn mức tách bạch:

| Mức | Ý nghĩa | Chứng minh được gì | **Không** chứng minh được gì |
|---|---|---|---|
| `HOST` | `ctest` trên x86_64 | Logic thuần đúng | Bất cứ điều gì về mạng, target, hay phần cứng |
| `LOOPBACK` | Test tích hợp UDP trên host, `BACNET=ON` | Gói tin BACnet được tạo/phân giải đúng; handler được đăng ký thật | Hành vi trên aarch64; timing thật; I/O vật lý |
| `TARGET-FAKE` | Chạy trên bo Forlinx với `mkddc-fakemcu` | Toàn chuỗi phần mềm chạy trên aarch64/Buildroot; BMS thật nói chuyện được với bo thật | Giá trị I/O vật lý; AO/DO ra thiết bị |
| `TARGET-HIL` | Bo Forlinx + **MCU STM32 thật** + tín hiệu vật lý + thiết bị đo | Physical Input → BACnet; BACnet Write → Physical Output | — (đây là mức cao nhất) |

**Luật:** một capability chỉ được ghi `VERIFIED` kèm **tên mức**. Không có
"VERIFIED" trần. `BACNET_REV_A = READY` đòi mức `TARGET-HIL` cho T2/T4/T6.

### 0.2 Trạng thái task

| Trạng thái | Ý nghĩa |
|---|---|
| `READY` | Đủ design/decision để bắt đầu ngay sau khi review plan OK. |
| `ORDERED` | Đã thiết kế xong; tự chuyển `READY` khi dependency `DONE`, không cần approval mới. |
| `GATED` | Chờ một quyết định `OD-BAC-*` cụ thể. Ghi rõ chờ mã nào. |
| `EVIDENCE_QUEUE` | Code xong; chạy khi có window bo/thiết bị. **Không chặn** task code khác. |
| `DONE` | Code + test + evidence + docs + changelog đã có và đã kiểm lại. |

**Không dùng `BLOCKED` cho task code.** Thiếu bo hay thiếu MCU là `EVIDENCE_QUEUE`,
không phải lý do dừng các Wave code còn làm được — đúng nguyên tắc đã áp cho Plan 59.

---

## 1. Baseline và ràng buộc target

### 1.1 Baseline

- Nhánh: `claude/bacnet-rev-a-bms-integration-740ef3`; source baseline `35299f4` (main).
- As-Built mạnh: đường AI/BI từ Physical I/O → IOP → `io_shm` → core → `kx_plc_shm_t`
  là **thật và chạy được**; `bacnet_objtable::publish()` đã ghi đủ 7 bank object;
  mapping Reliability theo ADR-011 đúng.
- Gap phải đóng: xem `REV-BACNET-ASBUILT-001` §3 (G-01..G-11).

### 1.2 Ràng buộc bo Forlinx — đọc kỹ trước khi ước lượng

Bảng này lấy từ `HW-FOXLINX-DEPLOY-001` và evidence deploy thật, **không suy đoán**:

| Ràng buộc | Hệ quả cho BACnet |
|---|---|
| **Buildroot 2024.02 — không có `apt`/`dpkg`/`pip`** (`FX-F05`) | Không thể cài `libbacnet` lên bo. bacnet-stack **bắt buộc link tĩnh** vào `mkddc-iobus`. |
| **Cross-compile bắt buộc** (`aarch64-linux-gnu-`) | Phải dựng bacnet-stack cho aarch64. FetchContent hiện tải tarball từ `github.com` — vừa bị egress chặn (403), vừa không phải đường dựng lặp lại được. |
| **Trần `GLIBCXX_3.4.30` trên bo** | Đã có cách xử lý đã kiểm: `-static-libstdc++ -static-libgcc`. Phải kiểm lại sau khi thêm bacnet-stack. |
| **`gtest_discover_tests` chạy binary aarch64 trên host** | Đã có cách xử lý: `-DCMAKE_GTEST_DISCOVER_TESTS_DISCOVERY_MODE=PRE_TEST`. |
| **Bo đang chạy `MCU_MODE=FAKE`; STM32G0B1 thật trên `/dev/ttyS2` chưa từng được nghiệm thu** | **Đây là dependency nặng nhất của plan.** T2/T4/T6 (physical I/O) không thể chạy tới khi MCU thật sống. Xem §5.3 và `T-BAC-063`. |
| Ethernet on-SoC (FEPHY), RS-485 trên `ttyS5`/`ttyS1` | BACnet/IP đi qua Ethernet — không đụng RS-485. Không xung đột với Modbus RTU. |
| RAM 2 GB, eMMC 16 GB (rootfs còn ~7,7 GB) | Đủ rộng; bacnet-stack tĩnh làm binary to thêm vài trăm KB, không đáng ngại. |
| User `root`, không có `sudo` | Script deploy hiện tại (`tools/deploy/deploy_board.sh`) viết cho Orange Pi (`sudo -n`, `/home/orangepi`) — **không dùng được cho Forlinx**. Cần đường deploy riêng. |

### 1.3 Luật không thương lượng

1. **Contract trước consumer.** Đổi SHM/OpenAPI xong mới sửa bên dùng; một nguồn sự thật.
2. **Mỗi task gồm code + test positive/negative/fault + docs/trace/changelog.**
3. **Không sửa acceptance để biến fail thành PASS.**
4. **Core là authority duy nhất.** BACnet không ghi `plc_shm` trực tiếp, không tự quyết
   arbitration, không vượt safe-state.
5. **Không claim PICS thứ chưa verify.** PICS lệch implementation ⇒ sửa PICS.
6. **Không dùng readback từ chính bacnet-stack làm bằng chứng cho đường ghi.** Đây là
   lỗi đã mắc trong hồ sơ pre-test 2026-07-01 và không được lặp lại.

---

## 2. Chuỗi lớp: Tài liệu → Source → E2E

```
LỚP 1 — TÀI LIỆU AUTHORITY                              (Wave W0)
  PRODUCT.md → PROD-BACNET-001 → SYS-REQ-BAC-*
  → PICS/EPICS (sửa) → BACNET_ARCHITECTURE_DESIGN
  → BACNET_API_DATA_CONTRACT → BACNET_VV_ACCEPTANCE_SPEC
        │  (tài liệu chốt xong mới có baseline đúng để code đối chiếu)
        ▼
LỚP 2 — NỀN BUILD/TARGET                                (Wave W1)
  vendor bacnet-stack → cross-build aarch64 BACNET=ON
  → gate CI BACNET=ON → test LOOPBACK UDP
        │  (không có lớp này thì không verify được gì)
        ▼
LỚP 3 — CONTRACT                                        (Wave W2)
  contracts/config/bacnet_export.schema.json
  + contracts/shm/mkddc_shm.h (khối telemetry, ABI bump)
        │
        ▼
LỚP 4 — SOURCE: IOBUS/BACNET                            (Wave W3, W4)
  BacnetExportRegistry → data path đọc → data path ghi → COV
        │  (apps/iobus/adapters/bacnet/**)
        ▼
LỚP 5 — SOURCE: BE + FE                                 (Wave W5)
  networkapi.go desired/active/runtime → OpenAPI → NetworkPage.tsx
        │
        ▼
LỚP 6 — DEPLOY + E2E TRÊN BO FORLINX                    (Wave W6)
  cross-build → deploy → E2E tầng TARGET-FAKE → E2E tầng TARGET-HIL
        │
        ▼
LỚP 7 — ĐÓNG SẢN PHẨM
  PICS final reconciliation → traceability → release record
```

---

## 3. Danh mục task

40 task, 7 Wave. Mỗi task là **một Issue** sau khi plan được review OK.

Cột `Mức` = mức bằng chứng cao nhất mà task tự nó đạt được.

### Wave W0 — Tài liệu authority (7 task)

| ID | Task | Files | Mức | Prio | Dep | Trạng thái |
|---|---|---|---|---|---|---|
| `T-BAC-001` | PICS: sửa 9 BIBB khai sai, thêm cột Evidence | `BACNET_PICS_EPICS_*.md` | — | P0 | — | `GATED` (OD-BAC-001, OD-BAC-011) |
| `T-BAC-002` | PICS: gỡ đường dẫn `services/`, giải mâu thuẫn AO writable | PICS §4/§4.1/§4.2, `33_BACNET_OBJECT_ALIGNMENT_PLAN.md` | — | P1 | — | `READY` |
| `T-BAC-003` | Tạo `PROD-BACNET-001` + tập `SYS-REQ-BAC-*` | `docs/01_product/`, `docs/02_requirements/REQUIREMENTS.md` | — | P1 | — | `READY` |
| `T-BAC-004` | `BACNET_ARCHITECTURE_DESIGN` — Export Registry, identity, capability gate | `docs/03_architecture/` | — | P0 | 003 | `ORDERED` |
| `T-BAC-005` | `BACNET_API_DATA_CONTRACT` — desired/active/runtime + diff OpenAPI | `docs/02_design/interfaces/`, `contracts/openapi/openapi.yaml` | — | P1 | 004 | `ORDERED` |
| `T-BAC-006` | `BACNET_VV_ACCEPTANCE_SPEC` — đặc tả T1..T9 mức thao tác được | `docs/05_verification/` | — | P0 | 004 | `ORDERED` |
| `T-BAC-007` | `BACNET_TRACEABILITY_MATRIX` — khung rỗng, điền dần | `docs/07_records/` | — | P2 | 003 | `ORDERED` |

---

### Wave W1 — Nền build/target (4 task) — **mở khoá mọi verify**

| ID | Task | Files | Mức | Prio | Dep | Trạng thái |
|---|---|---|---|---|---|---|
| `T-BAC-010` | Vendor bacnet-stack 1.3.8, bỏ FetchContent từ `github.com` | `apps/iobus/CMakeLists.txt`, `third_party/` hoặc artifact nội bộ | `HOST` | P0 | — | `GATED` (OD-BAC-009) |
| `T-BAC-011` | Cross-build aarch64 `BACNET=ON` + guard trần GLIBCXX | `platform/cmake/toolchain-aarch64-linux-gnu.cmake`, script build | `TARGET-FAKE` | P0 | 010 | `ORDERED` |
| `T-BAC-012` | Gate CI dựng `BACNET=ON` (host + cross) | `.github/workflows/` | `HOST` | P0 | 010 | `ORDERED` |
| `T-BAC-013` | Tầng test `LOOPBACK` — client BACnet trong test, UDP thật trên loopback | `apps/iobus/adapters/bacnet/tests/test_bacnet_loopback.cpp` (mới) | `LOOPBACK` | P0 | 010 | `ORDERED` |

> **`T-BAC-013` là task quan trọng bị thiếu trong mọi plan trước.** Hiện có một hố
> giữa `HOST` (không chạm mạng) và `TARGET` (cần bo). Hố đó là lý do 67 test BACnet
> PASS mà không phát hiện được việc SubscribeCOV chưa đăng ký. Tầng `LOOPBACK` bắt
> được đúng loại lỗi này **trên CI, trong vài giây**, không cần bo.

---

### Wave W2 — Contract & Export Registry (5 task)

| ID | Task | Files | Mức | Prio | Dep | Trạng thái |
|---|---|---|---|---|---|---|
| `T-BAC-020` | Schema `bacnet_export` + file lưu bền mapping instance | `contracts/config/bacnet_export.schema.json` (mới), `data/config/` | `HOST` | P0 | 004 | `ORDERED` |
| `T-BAC-021` | `BacnetExportRegistry` — 8 trường bắt buộc, sinh từ Canonical Point | `apps/iobus/adapters/bacnet/bacnet_export_registry.{hpp,cpp}` (mới) | `HOST` | P0 | 020 | `ORDERED` |
| `T-BAC-022` | Capability gate: không tạo BI khi `board_cap_map` không báo isolated-DI | `bacnet_export_registry.cpp`, `bacnet_server.cpp:214-226`, `main.cpp` | `TARGET-FAKE` | P1 | 021 | `ORDERED` |
| `T-BAC-023` | Instance bền vững qua restart/rename/đổi cấu hình + load/persist | `bacnet_export_registry.cpp` | `TARGET-FAKE` | P0 | 021 | `ORDERED` |
| `T-BAC-024` | Cảnh báo breaking khi đổi UI mode làm đổi Object Type | `bacnet_export_registry.cpp`, `apps/web-api/internal/app/configapi.go` | `HOST` | P2 | 021 | `GATED` (OD-BAC-002) |

---

### Wave W3 — Data path đọc (5 task) — **gap nặng nhất**

| ID | Task | Files | Mức | Prio | Dep | Trạng thái |
|---|---|---|---|---|---|---|
| `T-BAC-030` | `sync_all_objects()` — nạp AV×32/BV×16/MSV×8 từ `plc_shm` | `bacnet_server.cpp:228-256` | `LOOPBACK` | P0 | 021 | `ORDERED` |
| `T-BAC-031` | AO/BO `Present_Value` đọc từ authority + bật `Status_Flags.OVERRIDDEN` | `bacnet_server.cpp`, `bacnet_objects.cpp:170-203` | `TARGET-FAKE` | P0 | 030 | `ORDERED` |
| `T-BAC-032` | Đẩy Units/Reliability/Status_Flags/OOS cho **mọi** loại object | `bacnet_server.cpp`, `bacnet_objects.cpp` | `LOOPBACK` | P1 | 030 | `ORDERED` |
| `T-BAC-033` | `Object_Name` cấu hình tới BMS cho AI/BI/AV/BV/MSV | `bacnet_server.cpp` (`apply_*_config`) | `LOOPBACK` | P2 | 030 | `ORDERED` |
| `T-BAC-034` | `dispatch_cov()` quét đủ 16 UI (hiện 1..8) | `bacnet_server.cpp:295` | `HOST` | P1 | 030 | `ORDERED` |

---

### Wave W4 — Data path ghi + COV (8 task)

| ID | Task | Files | Mức | Prio | Dep | Trạng thái |
|---|---|---|---|---|---|---|
| `T-BAC-040` | Callback ghi đi qua `BacnetObjects::write_ao/write_bo` — hồi sinh `BacnetPriority` | `bacnet_server.cpp:44-60`, `:141-152` | `LOOPBACK` | P0 | 031 | `ORDERED` |
| `T-BAC-041` | Kiểm biên `min_pv`/`max_pv` + `ao_engineering_to_physical()` trên đường mạng | `bacnet_objects.cpp:293-327` | `TARGET-HIL` | P0 | 040 | `ORDERED` |
| `T-BAC-042` | AV/BV/MSV: nối core **hoặc** trả `WRITE_ACCESS_DENIED` | `bacnet_server.cpp`, `bacnet_objects.cpp:329-361` | `LOOPBACK` | P1 | 040 | `GATED` (OD-BAC-003) |
| `T-BAC-043` | Mutation qua BACnet vào audit store, không chỉ `fprintf` stderr | `bacnet_server.cpp:149-151`, `apps/web-api` audit | `TARGET-FAKE` | P1 | 040 | `ORDERED` |
| `T-BAC-044` | Đăng ký `SERVICE_CONFIRMED_SUBSCRIBE_COV` + nối `BacnetCov::subscribe()` | `bacnet_server.cpp:116-127` | `LOOPBACK` | P0 | 030 | `ORDERED` |
| `T-BAC-045` | Gửi COV notification **thật** (confirmed + unconfirmed) | `bacnet_server.cpp:286-293` | `LOOPBACK` | P0 | 044 | `ORDERED` |
| `T-BAC-046` | COV lifetime/expiry/cancel + giải nghĩa `recipient_tag` + COV_Increment từ config | `bacnet_cov.{hpp,cpp}`, `bacnet_objects.cpp` | `LOOPBACK` | P1 | 045 | `ORDERED` |
| `T-BAC-047` | ReinitializeDevice: nối `reinit_fn_` + `check_reinit_password()` **hoặc** gỡ khỏi PICS | `bacnet_server.cpp:77,82,123`, `main.cpp:549-551` | `TARGET-FAKE` | P2 | 011 | `GATED` (OD-BAC-001) |

---

### Wave W5 — Telemetry + BE + FE (8 task)

| ID | Task | Files | Mức | Prio | Dep | Trạng thái |
|---|---|---|---|---|---|---|
| `T-BAC-050` | Khối telemetry BACnet trong SHM + **bump magic** (ABI change) | `contracts/shm/mkddc_shm.h:210-211` | `HOST` | P1 | 004 | `ORDERED` |
| `T-BAC-051` | iobus publish 9 trường telemetry | `bacnet_server.cpp`, `io_cache.{hpp,cpp}:248-255` | `TARGET-FAKE` | P1 | 050 | `ORDERED` |
| `T-BAC-052` | BE: `bmsLink` từ `lastRx`, thôi suy diễn từ `bip_init()` | `networkapi.go:293-307` | `TARGET-FAKE` | P1 | 051 | `GATED` (OD-BAC-004) |
| `T-BAC-053` | BE: tách `desired`/`active`/`runtime`; read-back Device ID + Name | `networkapi.go:166-265`, `overview.go:317-342` | `TARGET-FAKE` | P1 | 052 | `ORDERED` |
| `T-BAC-054` | OpenAPI + `TestRouteTableMatchesOpenAPI` khớp bề mặt mới | `contracts/openapi/openapi.yaml`, `contract_routes_test.go` | `HOST` | P1 | 053 | `ORDERED` |
| `T-BAC-055` | FE: bảng diagnostics 9 trường; thiếu số đo hiện `—` | `NetworkPage.tsx`, `shared/types.ts` | `TARGET-FAKE` | P1 | 054 | `ORDERED` |
| `T-BAC-056` | FE: phân biệt desired vs active; "chờ áp dụng" hiện rõ | `NetworkPage.tsx` | `TARGET-FAKE` | P1 | 055 | `ORDERED` |
| `T-BAC-057` | FE + BE: object catalog `/bacnet/objects` (chỉ đọc) | `http.go`, `NetworkPage.tsx` | `TARGET-FAKE` | P2 | 021, 054 | `GATED` (OD-BAC-006) |

---

### Wave W6 — Deploy + E2E trên bo Forlinx (6 task)

| ID | Task | Files | Mức | Prio | Dep | Trạng thái |
|---|---|---|---|---|---|---|
| `T-BAC-060` | Runbook + script deploy BACnet cho **Forlinx** (không dùng script Orange Pi) | `tools/deploy/deploy_foxlinx.sh` (mới), `docs/06_operations/` | `TARGET-FAKE` | P0 | 011 | `ORDERED` |
| `T-BAC-061` | Viết lại `bacnet_pretest.sh` → bộ E2E tầng `TARGET-FAKE` (T1,T3,T5,T7,T8,T9) | `tools/qa/bacnet_board_e2e.sh` (mới), thay `tools/bacnet_pretest/` | `TARGET-FAKE` | P0 | 006, 060 | `ORDERED` |
| `T-BAC-062` | **Chạy** E2E tầng `TARGET-FAKE` trên bo → evidence | `docs/07_records/evidence/bacnet-hil/` | `TARGET-FAKE` | P0 | 061 + W3 + W4 | `EVIDENCE_QUEUE` |
| `T-BAC-063` | Bring-up MCU STM32 thật trên `/dev/ttyS2` (dependency ngoài BACnet) | `firmware/stm32/`, `mkddc-iobus` IOP | `TARGET-HIL` | P0 | — | `GATED` (OD-BAC-007) |
| `T-BAC-064` | **Chạy** E2E tầng `TARGET-HIL`: T2, T4, T6 với tín hiệu + thiết bị đo thật | `docs/07_records/evidence/bacnet-hil/` | `TARGET-HIL` | P0 | 062, 063 | `EVIDENCE_QUEUE` |
| `T-BAC-065` | PICS final reconciliation + traceability + release record | PICS, `docs/07_records/` | — | P0 | 064 | `ORDERED` |

---

## 4. Runbook cross-build và deploy lên Forlinx

Mọi lệnh dưới đây lấy từ đường đã chạy thật trong
`docs/07_records/test-evidence/fw-som/2026-08-05-foxlinx-track-a-acceptance.md` và
`2026-08-24-foxlinx-plan59-corrective-deploy.md`, bổ sung phần BACnet.
Thông tin truy cập bo nằm ở [`HW-FOXLINX-DEPLOY-001`](../08_hardware/foxlinx-som-ddc24/FOXLINX_DEPLOY_CHECKLIST.md) — **không chép credential vào plan này**.

### 4.1 Chuẩn bị sysroot một lần trên máy build

```bash
sudo dpkg --add-architecture arm64
sudo apt-get update
sudo apt-get install -y g++-aarch64-linux-gnu \
    libmodbus-dev:arm64 libsodium-dev:arm64
export PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig
```

> bacnet-stack **không** có gói arm64 — đó chính là lý do `T-BAC-010` phải vendor nó
> và dựng từ nguồn cho aarch64, link tĩnh.

### 4.2 Cross-build với BACnet bật

```bash
cmake -S . -B build/fw-aarch64 \
  -DCMAKE_TOOLCHAIN_FILE=platform/cmake/toolchain-aarch64-linux-gnu.cmake \
  -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_BACNET=ON \
  -DMKDDC_ENABLE_MODBUS=ON \
  -DCMAKE_GTEST_DISCOVER_TESTS_DISCOVERY_MODE=PRE_TEST \
  -DCMAKE_EXE_LINKER_FLAGS="-static-libstdc++ -static-libgcc"
cmake --build build/fw-aarch64 --parallel
```

Hai cờ cuối **không phải tuỳ chọn**: thiếu cờ đầu thì build đứt ở bước post-link vì
CMake chạy binary aarch64 trên host; thiếu cờ sau thì binary đòi `GLIBCXX_3.4.32` mà bo
chỉ có tới `3.4.30`.

### 4.3 Ba cổng kiểm **trước** khi copy — `T-BAC-011` phải tự động hoá

```bash
# 1. Trần GLIBCXX — phải ≤ 3.4.30
aarch64-linux-gnu-objdump -T build/fw-aarch64/iobus/mkddc-iobus \
  | grep -o 'GLIBCXX_[0-9.]*' | sort -uV | tail -1

# 2. Không phát sinh .so mới mà bo không có (bacnet-stack PHẢI là tĩnh)
aarch64-linux-gnu-objdump -p build/fw-aarch64/iobus/mkddc-iobus | grep NEEDED

# 3. Symbol BACnet thật sự có trong binary — chứng minh BACNET=ON đã ăn
aarch64-linux-gnu-nm -C build/fw-aarch64/iobus/mkddc-iobus | grep -c bip_init
```

Cổng 3 là bài học trực tiếp từ review as-built: nếu không kiểm, một bản build
`BACNET=OFF` vẫn deploy trót lọt và mọi thứ trông như đang chạy.

### 4.4 Deploy (`T-BAC-060`)

Khác Orange Pi ở ba điểm: user `root` (không `sudo`), không package manager, và MCU
thật nằm trên `/dev/ttyS2`.

```bash
BOARD=SOM-DDC-24-foxlinx
TS=$(date -u +%Y%m%dT%H%M%S)

# 1. Backup
ssh $BOARD "mkdir -p /root/backup && \
  cp -a /usr/sbin/mkddc-iobus /root/backup/mkddc-iobus.$TS && \
  tar -czf /root/backup/config-$TS.tar.gz /data/config"

# 2. Copy
scp build/fw-aarch64/iobus/mkddc-iobus $BOARD:/tmp/mkddc-iobus.new

# 3. Hoán đổi + restart
ssh $BOARD "systemctl stop mkddc-iobus && \
  install -m 0755 /tmp/mkddc-iobus.new /usr/sbin/mkddc-iobus && \
  systemctl start mkddc-iobus && sleep 3 && \
  systemctl is-active mkddc-iobus"

# 4. Xác nhận BACnet thật sự bind trên bo — KHÔNG suy từ log
ssh $BOARD "ss -lunp | grep 47808"
ssh $BOARD "journalctl -u mkddc-iobus -n 30 --no-pager | grep bacnet_server"
```

**Rollback:** `cp -a /root/backup/mkddc-iobus.$TS /usr/sbin/mkddc-iobus` rồi restart.
`T-BAC-060` phải diễn tập rollback một lần và ghi vào evidence — Plan 59 để hở đúng
chỗ này và nó vẫn còn treo.

---

## 5. Bộ E2E trên bo Forlinx

### 5.1 Kiến trúc test

```
        ┌──────────────────────────────┐
        │ PC/BMS  (BACnet test client) │
        │ bacnet-stack tools / YABE /  │
        │ Wireshark bắt gói            │
        └───────────────┬──────────────┘
                        │  LAN, UDP 47808
        ┌───────────────▼──────────────┐
        │ Bo Forlinx OK1126B-S         │
        │  mkddc-iobus (BACNET=ON)     │
        │  mkddc-core  (authority)     │
        │  mkddc-web-pi                │
        └───────────────┬──────────────┘
                        │  IOP /dev/ttyS2
        ┌───────────────▼──────────────┐
        │ Tầng 1: mkddc-fakemcu        │  ← chạy được NGAY
        │ Tầng 2: STM32G0B1 thật       │  ← cần T-BAC-063
        │         + tín hiệu vào UI1   │
        │         + đồng hồ đo AO1/BO1 │
        └──────────────────────────────┘
```

### 5.2 Tầng 1 — `TARGET-FAKE` (`T-BAC-061`, `T-BAC-062`)

Chạy được **ngay khi W1–W4 xong**, không cần MCU thật, không cần thiết bị đo.

| Test | Nội dung | Tiêu chí PASS | Vì sao tầng 1 đủ |
|---|---|---|---|
| **T1** Discovery | BMS gửi Who-Is | I-Am đúng Device ID/Name | Discovery không phụ thuộc I/O |
| **T3** RPM | Đọc nhiều object một request | Mọi object trả giá trị runtime; **không object nào trả `0.0` giả** | Fake MCU vẫn sinh giá trị đổi được — đủ để bắt G-01 |
| **T5** COV | SubscribeCOV AI1, ép giá trị đổi qua fake MCU | Nhận COV notification, **không poll xen giữa** (xác nhận bằng Wireshark) | COV là logic mạng, không phải logic I/O |
| **T7** Priority | Hai lệnh khác mức, rồi release lần lượt | Winner đúng Priority_Array; release trả đúng owner kế tiếp/Relinquish_Default | Kiểm tại `plc_shm` + `core.sock`, không cần đo điện |
| **T8** Restart | `systemctl restart mkddc-iobus`; `systemctl restart mkddc-core`; power-cycle bo | Object identity không đổi; BMS discover/read lại được | Đây là bài kiểm identity, không phải I/O |
| **T9** Config read-back | Đổi Device ID/Name/Port rồi apply | Đọc **runtime authority** xác nhận; không báo SUCCESS chỉ vì file đã ghi | Kiểm qua API + `ss -lunp` |
| **T6a** Output (một phần) | BMS WriteProperty AO1/BO1 | Lệnh tới `core.sock`, qua arbitration, hiện đúng ở `plc_shm.ao/bo` và ở BACnet read-back | Chứng minh chuỗi phần mềm; **không** chứng minh đầu ra vật lý |

**Ranh giới phải ghi rõ trong evidence:** tầng 1 chứng minh chuỗi
`BMS → BACnet → iobus → core → arbitration → plc_shm` chạy trên aarch64/Buildroot với
BMS thật. Nó **không** chứng minh Physical Input hay Physical Output. Không được đọc
kết quả tầng 1 như thể là `TARGET-HIL`.

### 5.3 Tầng 2 — `TARGET-HIL` (`T-BAC-063`, `T-BAC-064`)

| Test | Nội dung | Tiêu chí PASS | Cần |
|---|---|---|---|
| **T2** Physical Input | Gắn nguồn tín hiệu thật vào UI1, thay đổi mức | ReadProperty AI1.Present_Value đổi tương ứng, sai số trong dung sai công bố | MCU thật + nguồn tín hiệu chuẩn |
| **T4** Quality | Hở mạch 4-20 mA, quá dải, rút cảm biến | Reliability/Status_Flags đúng ADR-011; **không** biến BAD/UNKNOWN thành GOOD | MCU thật + khả năng tạo fault |
| **T6b** Physical Output | BMS WriteProperty AO1/BO1 | **Đo bằng đồng hồ**: AO1 ra đúng V/mA; BO1 tiếp điểm đóng/cắt đúng | MCU thật + đồng hồ đo + tải giả |

**Dependency nặng nhất của toàn plan:** cả ba bài đều đứng sau `T-BAC-063` (MCU thật
bring-up). Bo Forlinx **chưa bao giờ** chạy MCU thật — mọi evidence hiện có đều
`MCU_MODE=FAKE`, và `T59-703` đã bị defer đúng vì lý do này. Đây không phải rủi ro
của BACnet mà là dependency dự án đã tồn tại; plan này chỉ nêu ra chứ không giấu.

> **Hệ quả cho lịch:** khởi động `T-BAC-063` **song song với W0**, không đợi tới W6.
> Nếu để tới W6 mới bắt đầu thì toàn bộ phần code xong xuôi sẽ nằm chờ một hạng mục
> phần cứng có lead time không đoán trước được.

### 5.4 Cấu trúc evidence bắt buộc

```
docs/07_records/evidence/bacnet-hil/<UTC-timestamp>/
├── summary.txt          # verdict từng test + mức bằng chứng (TARGET-FAKE | TARGET-HIL)
├── board.txt            # serial, uname, commit, sha256 mkddc-iobus, MCU_MODE
├── capture-T1-discovery.pcap
├── capture-T5-cov.pcap  # bằng chứng quyết định của T5
├── iobus.log            # journalctl -u mkddc-iobus
└── measurements.md      # số đo thiết bị (chỉ tầng 2)
```

`board.txt` phải ghi `MCU_MODE` — thiếu trường này thì không phân biệt được tầng 1 với
tầng 2, và đó chính là cách hồ sơ pre-test 2026-07-01 trở thành bằng chứng gây hiểu lầm.

---

## 6. Lịch thực thi và dependency

```
W0 Tài liệu ─────────────────────────────┐
   (001..007)                            │
                                          │
W1 Nền build ────────────────────────────┤
   (010 → 011 → 012, 013)                │
        │                                 │
        ▼                                 │
W2 Contract + Registry                    │
   (020 → 021 → 022, 023, 024)            │
        │                                 │
        ▼                                 │
W3 Data path đọc                          │
   (030 → 031, 032, 033, 034)             │
        │                                 │
        ├──────────────┬──────────────────┤
        ▼              ▼                  ▼
W4 Ghi + COV      W5 Telemetry/BE/FE   T-BAC-063
   (040→041,042    (050→051→052→053     MCU thật
    043; 044→045    →054→055,056,057)   ⚠ CHẠY SONG SONG
    →046; 047)          │                TỪ ĐẦU
        │               │                  │
        └───────┬───────┘                  │
                ▼                          │
        W6 E2E tầng 1 (060→061→062)        │
                │                          │
                └──────────┬───────────────┘
                           ▼
                W6 E2E tầng 2 (064)
                           │
                           ▼
                    T-BAC-065 đóng
```

**Đường găng:** `010 → 011 → 021 → 030 → 040 → 061 → 062 → 064 → 065`.

**Ba nhánh chạy song song được:** W5 (telemetry/BE/FE) sau `T-BAC-021`;
COV (`044..046`) sau `T-BAC-030`; và `T-BAC-063` từ ngày đầu.

| Wave | Ước lượng | Ghi chú |
|---|---|---|
| W0 | ~16 h | Chỉ tài liệu; `T-BAC-002`/`003` bắt đầu được ngay |
| W1 | ~20 h | `T-BAC-013` (LOOPBACK) chiếm ~8 h nhưng trả lại giá trị lớn nhất |
| W2 | ~24 h | |
| W3 | ~20 h | Gap nặng nhất |
| W4 | ~28 h | COV chiếm ~16 h |
| W5 | ~24 h | ABI change cần deploy đồng bộ |
| W6 | ~20 h + lead time thiết bị/MCU | `T-BAC-063` không ước lượng được |
| **Tổng code** | **~152 h** | Chưa gồm `T-BAC-063` và window bo |

---

## 7. Quy tắc tạo Issue

**Cổng:** plan này được review OK ⇒ mới tạo Issue. Một task = một Issue, không gộp.

### 7.1 Khuôn Issue bắt buộc

Mỗi Issue mang đủ 11 mục (theo `PLAN-BACNET-REVA-001` §5):

```
Title:        [T-BAC-0xx] <tiêu đề task>
Finding:      <mã G-xx trong REV-BACNET-ASBUILT-001>
Evidence:     <file:line>
Current:      <hành vi hiện tại, mô tả được từ mã>
Target:       <hành vi đích>
Boundary:     <ranh giới kiến trúc — được và không được chạm gì>
Files:        <danh sách file được phép sửa>
AC:           <tiêu chí đo được>
Test:         <mức HOST | LOOPBACK | TARGET-FAKE | TARGET-HIL>
Dependency:   <T-BAC-xxx>
Priority:     P0 | P1 | P2
```

### 7.2 Thứ tự tạo Issue

| Đợt | Task | Điều kiện mở |
|---|---|---|
| 1 | `T-BAC-002`, `003` | Review plan OK |
| 2 | `T-BAC-010..013` | + `OD-BAC-009` ký |
| 3 | `T-BAC-001`, `004..007` | + `OD-BAC-001`, `OD-BAC-011` ký |
| 4 | `T-BAC-020..024` | + W1 `DONE`, `OD-BAC-002` ký |
| 5 | `T-BAC-030..034` | + W2 `DONE` |
| 6 | `T-BAC-040..047`, `050..057` | + W3 `DONE`, `OD-BAC-003`/`004`/`006` ký |
| 7 | `T-BAC-060..065` | + W4/W5 `DONE`, `OD-BAC-007` ký |

`T-BAC-063` (MCU thật) tạo Issue **ngay đợt 1** dù nó thuộc W6 — vì lead time.

### 7.3 Luật thi hành

1. **Không implement task N+1 nếu dependency N chưa đạt AC.**
2. **Task `GATED` không được bắt đầu** tới khi `OD-BAC-*` tương ứng được ký.
3. **Không task nào sau `T-BAC-030` được đánh `DONE`** trước khi `T-BAC-062` có evidence
   `TARGET-FAKE` — vì mọi task sau đều đứng trên giả định "dữ liệu là thật".
4. Người tạo Issue không tự implement; người implement không tự merge
   (`WF-CLEAN-001`, `scripts/workflow_guard.py`).

---

## 8. Rủi ro

| ID | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| `R-BAC-01` | **MCU thật chưa từng chạy trên Forlinx** ⇒ T2/T4/T6 không có đường về đích | 🔴 Cao | Khởi động `T-BAC-063` song song từ ngày đầu; `OD-BAC-007` ký sớm; nếu trượt thì Rev A đóng ở mức `TARGET-FAKE` **và ghi rõ là NOT READY**, không hạ tiêu chí |
| `R-BAC-02` | bacnet-stack cross-build aarch64 phát sinh `.so` hoặc symbol vượt trần GLIBCXX | 🟡 TB | Ba cổng kiểm ở §4.3, tự động hoá trong `T-BAC-011`; link tĩnh |
| `R-BAC-03` | Đổi ABI SHM (`T-BAC-050`) làm lệch iobus/core/web-api khi deploy | 🟡 TB | Bump magic để reader cũ fail lớn tiếng; deploy đồng bộ cả ba binary |
| `R-BAC-04` | `T-BAC-041` chạm đường điều khiển ra thiết bị — ghi sai đơn vị làm hỏng thiết bị thật | 🔴 Cao | Test với **tải giả** trước; không chạy trên hệ thống đang vận hành; kiểm biên bật trước khi bật quy đổi |
| `R-BAC-05` | Bỏ 8 BI + cấp lại instance làm hỏng cấu hình BMS đã tích hợp | 🟡 TB | `OD-BAC-002`; Rev A chưa GA nên chi phí thấp nhất là làm ngay; kèm công cụ xuất bảng object mới |
| `R-BAC-06` | Egress policy tiếp tục chặn nguồn bacnet-stack ⇒ W1 không khởi động được | 🔴 Cao | `OD-BAC-009`; vendor vào artifact nội bộ là đường không phụ thuộc egress |
| `R-BAC-07` | Bão COV notification khi tín hiệu nhiễu | 🟢 Thấp | COV_Increment từ config (`T-BAC-046`); test với tín hiệu thật ở T5 |
| `R-BAC-08` | Deploy Forlinx dùng nhầm script Orange Pi (`sudo`/`/home/orangepi`) | 🟢 Thấp | `T-BAC-060` tách script riêng; runbook §4.4 |

---

## 9. Definition of Done theo lớp

Không lớp nào được đánh xong nếu lớp dưới chưa xong.

| Lớp | DoD |
|---|---|
| **Tài liệu** | PICS không còn dòng claim thứ chưa verify; `PROD-BACNET-001` + `SYS-REQ-BAC-*` phủ 19 mục MUST; cổng link `docs_iso_harness.py` PASS |
| **Nền build** | `BACNET=ON` dựng được host **và** cross aarch64; gate CI chạy cả hai; ba cổng kiểm §4.3 tự động; tầng `LOOPBACK` bắt được lỗi thiếu handler |
| **Contract** | Schema `bacnet_export` có gate; SHM bump magic; `TestRouteTableMatchesOpenAPI` PASS |
| **Source iobus** | 0 mã chết trong `adapters/bacnet/**` (xoá thử một hàm thì build phải hỏng); mọi object export có dữ liệu thật; COV gửi gói thật |
| **Source BE/FE** | Ba khối desired/active/runtime tách bạch; `bmsLink` không suy diễn; FE thiếu số đo hiện `—` |
| **E2E tầng 1** | T1, T3, T5, T7, T8, T9, T6a PASS trên bo Forlinx với BMS thật; evidence có `MCU_MODE=FAKE` ghi rõ |
| **E2E tầng 2** | T2, T4, T6b PASS với MCU thật + tín hiệu + thiết bị đo; evidence có số đo |
| **Đóng sản phẩm** | 15/15 điều kiện DoD của `REV-BACNET-ASBUILT-001` §8; traceability đầy đủ; release record ký |

---

## 10. Điều Owner cần làm với plan này

1. **Review plan** — đặc biệt ba điểm: chiến lược E2E hai tầng (§5), việc thêm tầng
   `LOOPBACK` (`T-BAC-013`), và việc tách `T-BAC-063` (MCU thật) chạy song song từ đầu.
2. **Ký các `OD-BAC-*`** theo thứ tự ở [`OD-BAC-SET-001`](../00_governance/BACNET_OPEN_DECISIONS.md) §3.
   Hai mục chặn nhiều nhất: `OD-BAC-009` (nguồn bacnet-stack) và `OD-BAC-007` (bo + MCU
   + thiết bị đo).
3. **Duyệt cho tạo Issue** theo §7.2. Trước khi có bước này, không Issue nào được tạo và
   không dòng mã sản phẩm nào được sửa.

---
**Rev** 1.0 | 2026-09-10 — PROPOSED, chờ review. Ký: ___
