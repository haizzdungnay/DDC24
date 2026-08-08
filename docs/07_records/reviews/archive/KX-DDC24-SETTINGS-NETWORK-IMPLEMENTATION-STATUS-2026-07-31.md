# Báo cáo tình trạng triển khai trang `settings/network`

> **HỒ SƠ LỊCH SỬ — lưu trữ 2026-08-08.** Không dùng làm nguồn chuẩn. Lý do lưu
> trữ và tài liệu thay thế: [`archive/README.md`](README.md). Mọi đường dẫn source
> trong tài liệu này theo cây thư mục **trước** `PLAN-ARCH-RESTRUCT-002`; bảng ánh
> xạ sang vị trí hiện tại ở [chỉ mục hồ sơ rà soát](../README.md).

## MK-DDC-24 — Đánh giá xuyên suốt UI/UX · Use Case · Frontend · Backend · FW SOM

> **Document ID:** KX-DDC24-NETWORK-PAGE-STATUS-031-VI
> **Phiên bản:** 1.1
> **Ngày lập:** 2026-07-31 · **Sửa đổi:** 2026-08-01 (đính chính số liệu độ phủ test `netcfg` — xem Phụ lục A)
> **Người lập:** Claude Code, theo yêu cầu rà soát trang `settings/network` tại repo `DDC-PROJECT`
> **Nhánh khảo sát:** `fix/review-2026-07-30-fe-be-fwsom` @ `87a0ff0`
> **Phạm vi:** Toàn bộ chuỗi thực thi của trang `settings/network` — lớp trình bày (`NetworkPage.tsx`), lớp API Web (`web/backend/network*.go`, `netcfg_client.go`), lớp authority hệ điều hành (`services/netcfg`), cùng tài liệu ADR/UX/UC liên quan.
> **Không bao gồm:** Trang HMI cục bộ (`services/hmi`) ngoài phần đối chiếu contract; kiểm thử vật lý trên thiết bị (physical commissioning); chứng nhận BTL/BACnet; đánh giá bởi tổ chức độc lập.
> **Chuẩn trình bày tham chiếu:** Hồ sơ kiểm soát chất lượng theo ISO 9001:2015; vòng đời phần mềm theo ISO/IEC/IEEE 12207; đặc tả yêu cầu theo ISO/IEC/IEEE 29148; tiêu chí khả dụng theo ISO 9241-11 và ISO 9241-110. Báo cáo này **không** thay thế chứng nhận bởi tổ chức đánh giá độc lập.

---

## 1. Tóm tắt điều hành

Trang `settings/network` là **màn hình cấu hình có mức độ chín về an toàn cao nhất của sản phẩm**. Cơ chế giao dịch `Validate → Stage → Apply → Confirm/Rollback` với tự động hoàn tác trong 120 giây, khoá `Apply` khi chưa vào bằng hostname ổn định và khi Ethernet chưa có carrier, cùng việc tách bạch bốn tầng sự thật (ACTIVE/KERNEL · CONFIGURED · PENDING · EDITABLE DRAFT) là thiết kế đúng chuẩn công nghiệp và đã được hiện thực hoá đầy đủ ở cả ba lớp.

Tuy nhiên, đánh giá xuyên suốt phát hiện **một khoảng cách rõ rệt giữa hai nửa của cùng một trang**:

| Nửa trang | Lớp | Kết luận |
|---|---|---|
| **Panel ETHERNET** (giao dịch an toàn) | FE + BE + FW SOM | 🟢 **Chín, có contract, có test, bám sát ADR-017** |
| **Panel NORTHBOUND / SOUTHBOUND** (BACnet, WiFi, Modbus) | FE + BE | 🔴 **Chưa hoàn chỉnh: đường ghi không có hiệu lực, telemetry giả lập, KPI không thể báo lỗi** |

**Bốn kết luận trọng yếu:**

1. **Đường lưu BACnet/WiFi ghi được file nhưng không bao giờ áp dụng.** Hàm `applySystem` trên Linux là stub trả về `false` kèm chuỗi `"reload system pending B7 (systemd/polkit)"`. Mọi thao tác "Lưu BACnet/WiFi" đều kết thúc bằng toast cảnh báo chứa nguyên văn thuật ngữ nội bộ đó. Hạng mục "B7" này **không tồn tại trong bất kỳ tài liệu nào** của `docs/`.
2. **Ba chỉ số sức khoẻ ở nửa dưới trang là số liệu không có thật.** `Poll health` về mặt cấu trúc không bao giờ hạ dưới 100%; `Error rate` luôn cứng bằng 0; `Poll state` và `Last poll` là một giá trị toàn cục sao chép cho mọi dòng slave. Riêng `bmsLink` suy diễn `online` chỉ từ việc ba trường trong file config khác rỗng — **vi phạm trực tiếp ADR-017 §2.9 và tiêu chí nghiệm thu UC-HMI-016**.
3. **Trang không có bất kỳ tài liệu use case hay wireframe nào cho Web.** Kho tài liệu chỉ có hai họ use case là `UC-HMI` (19 mục) và `UC-LOCAL` (14 mục); **không tồn tại họ `UC-WEB`**. Không có file wireframe/mockup nào trong `docs/`. Màn hình cấu hình rủi ro nhất của sản phẩm đang được xây dựng mà không có đặc tả hành vi phía Web.
4. **Mâu thuẫn phân quyền giữa tài liệu, backend và router.** ADR-017 §2.7 quy định `GET status` dành cho `viewer|operator|admin`; backend thực thi đúng như vậy; component FE có nhánh chỉ-đọc cho viewer và **có unit test cho nhánh đó**. Nhưng router bọc toàn trang trong `RequireAdmin`, khiến toàn bộ nhánh viewer trở thành mã chết và bài test kiểm thử một kịch bản không thể xảy ra trong sản phẩm.

**Kết quả kiểm thử tự động tại thời điểm lập báo cáo — toàn bộ PASS:**

| Bộ test | Kết quả |
|---|---|
| Go backend (`-run 'Network\|Netcfg'`) | 17/17 hàm test PASS |
| Vitest `NetworkPage.test.tsx` | 16/16 PASS |
| GoogleTest `netcfg_tests` | 37/37 PASS (xem đính chính ở §2.3) |
| Playwright `network-qa.spec.ts` | **Không chạy — không được nối vào CI** |

**Khuyến nghị gate:** Giữ **Network gate = RED** như ADR-017 §3 đã tuyên bố. Bổ sung điều kiện: gate không được chuyển sang AMBER cho tới khi đóng xong nhóm phát hiện Cao (F-01…F-04) và bổ sung tối thiểu đặc tả `UC-WEB` cho trang này.

---

## 2. Căn cứ đánh giá

### 2.1 Tài liệu đã rà soát

| Tài liệu | Vai trò trong đánh giá |
|---|---|
| `docs/adr/ADR-017-settings-network-tabs-and-state-contract.md` | Nguồn contract chính; 10 quyết định kiến trúc |
| `shared/netcfg_protocol_v1.schema.json` | Schema JSON strict cho protocol v1 |
| `docs/03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md` (Rev 1.36) | Đặc tả tuyến API, route và RBAC phía Web |
| `docs/04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md` | Design tokens, phân cấp ISA-101, tiêu chí WCAG 2.1 AA |
| `docs/04_uiux/KX-DDC24-UX-HMI-001_VI.md` | Wireframe panel mạng phía HMI (đối chiếu chéo) |
| `docs/04_uiux/KX-DDC24-UC-HMI-001_VI.md` | UC-HMI-016…019 — use case mạng phía HMI |
| `docs/06_operations/DEVELOPMENT_AND_OPERATIONS.md` | Cấu hình vận hành `netcfg.conf`, journal, socket |
| `docs/07_records/reviews/KX-DDC24-UIUX-PRODUCT-AUDIT-2026-07-30.md` §2.8 | Audit UI/UX tiền nhiệm; báo cáo này kế thừa và mở rộng |

### 2.2 Mã nguồn đã rà soát

| Lớp | File | Dòng |
|---|---|---|
| FE — trang | `src/frontend/src/pages/NetworkPage.tsx` | 570 |
| FE — test | `src/frontend/src/pages/NetworkPage.test.tsx` | 468 |
| FE — e2e | `src/frontend/e2e/network-qa.spec.ts` | 258 |
| FE — router / nav | `src/frontend/src/App.tsx`, `components/NavRail.tsx` | — |
| BE — API trang | `web/backend/networkapi.go` | 297 |
| BE — API giao dịch | `web/backend/networktransaction.go` | 313 |
| BE — adapter IPC | `web/backend/netcfg_client.go` | 386 |
| BE — reload | `web/backend/reload.go`, `reload_unix.go` | — |
| FW SOM — authority | `services/netcfg/netcfg.cpp` / `.hpp` | 1352 / 214 |
| FW SOM — test | `services/netcfg/tests/test_netcfg.cpp` | 1014 |
| Packaging | `packaging/systemd/mkddc-netcfg.service`, `packaging/netcfg.conf` | — |

### 2.3 Lệnh xác minh đã chạy

```bash
# Backend Go — toàn bộ test liên quan mạng
cd web/backend && go test ./... -run 'Network|Netcfg' -v
# → PASS (mkddc-web 0.201s), 17 hàm test

# Frontend — unit test trang mạng
cd src/frontend && npx vitest run src/pages/NetworkPage.test.tsx
# → Test Files 1 passed | Tests 16 passed (9.52s)

# FW SOM — authority mạng
./build/services/netcfg/netcfg_tests
# → [ PASSED ] 11 tests from 3 test suites (245 ms)
#
# ĐÍNH CHÍNH (rev 1.1): con số 11 ở trên SAI — lệnh này đã chạy một BINARY CŨ
# nằm sẵn trong `build/` từ lần build trước, không phải bản dựng từ mã nguồn tại
# `87a0ff0`. Đếm lại trực tiếp trên mã nguồn của chính commit đang rà soát:
#   git show 87a0ff0:services/netcfg/tests/test_netcfg.cpp | grep -cE '^TEST\('
#   → 37   (NetcfgEngine 17 · NetcfgLinuxPlatform 16 · NetcfgValidation 3 · NetcfgServer 1)
# Tức `LinuxPlatform` ĐÃ có 16 test trực tiếp tại thời điểm rà soát. Mọi nhận định
# dựa trên con số 11 trong bản 1.0 (§4.1, §5, §8) đã được sửa theo.

# Truy vết tài liệu
grep -rhoE "UC-[A-Z]+-[0-9]+" docs/ --include=*.md | sort -u
# → chỉ có UC-HMI (19), UC-LOCAL (14); KHÔNG có UC-WEB
find docs -iname "*wireframe*" -o -iname "*mockup*" -o -iname "*figma*"
# → rỗng
grep -rln "pending B7\|polkit" docs/
# → không tài liệu nào mô tả hạng mục reload B7
grep -n "e2e\|playwright" .github/workflows/*.yml
# → rỗng: e2e không được nối vào CI
```

### 2.4 Bằng chứng vận hành thực tế

Ảnh chụp giao diện thiết bị `orangepi5b.local:8081/settings/network` ngày 2026-07-31 10:07 ghi nhận:

- Header badge: `ETH NO CARRIER`; banner: *"Ethernet link is not ready; connect the Ethernet cable before Apply."*
- ACTIVE/KERNEL: `Admin up`, `Carrier absent`, `Kernel link down`, `Address No IPv4`, `Mode unknown`, `Reason NO_CARRIER`
- CONFIGURED PROFILE: `end1` / `DHCP` / `DNS auto`
- MANAGEMENT HOST: `orangepi5b` / `orangepi5b.local` / `Stable ready` / origin `orangepi5b.local:8081`
- TRANSACTION: **`FAILED`**, id `net-1785233659457-991191-3`, **không hiển thị bất kỳ dòng lý do nào**
- Bốn thẻ KPI: `Device N/A`, `BACnet/IP UDP N/A`, `Modbus slaves 0/0 online`, `Poll health 0%`

Trạng thái này xác nhận trực tiếp phát hiện **F-05** (trạng thái `failed` không hiển thị nguyên nhân) và cho thấy file cấu hình BACnet/thiết bị trên máy đang rỗng.

---

## 3. Kiến trúc chuỗi thực thi đã triển khai

```
┌─ Trình duyệt ───────────────────────────────────────────────────────┐
│ NetworkPage.tsx                                                     │
│  • useApi(getNetwork,           refreshMs 1000)  → GET  /api/v1/network
│  • useApi(getNetworkTransaction,refreshMs 1000)  → GET  /api/v1/network/transaction
│  • runTransaction(action)                        → POST /api/v1/network/transaction/{action}
└─────────────────────────────────────────────────────────────────────┘
                              │ REST same-origin, Bearer token
┌─ mkddc-web (Go) ────────────────────────────────────────────────────┐
│ http.go       : GET  /api/v1/network              → RoleViewer      │
│                 PUT  /api/v1/network              → RoleAdmin       │
│                 GET  /api/v1/network/transaction  → RoleViewer      │
│                 POST /api/v1/network/transaction/{action} → RoleAdmin│
│ networkapi.go        : đọc/ghi network.conf, device.conf, bacnet.conf│
│ networktransaction.go: validate candidate, kiểm tra capability, audit│
│ netcfg_client.go     : dialer 2s, line-delimited JSON, bounded frame │
└─────────────────────────────────────────────────────────────────────┘
                              │ AF_UNIX /run/mkddc-netcfg/netcfg.sock (0750, SO_PEERCRED)
┌─ mkddc-netcfg (C++, systemd, User=root Group=mkddc) ────────────────┐
│ Engine : máy trạng thái giao dịch + journal bền vững                │
│          /data/mkddc/netcfg-transaction.json                        │
│          deadline kép epoch + steady clock, tick() mỗi 250 ms       │
│ LinuxPlatform : nmcli/NetworkManager, đọc kernel state, mDNS         │
└─────────────────────────────────────────────────────────────────────┘
                              │ CAP_NET_ADMIN / CAP_NET_RAW
                        NetworkManager → kernel
```

**Đánh giá kiến trúc:** Chuỗi này đúng với ADR-017 §2.1. Web và HMI không chạm trực tiếp vào trạng thái Linux; unit systemd được siết chặt hợp lý (`NoNewPrivileges`, `ProtectSystem=strict`, `RestrictAddressFamilies`, `CapabilityBoundingSet` tối thiểu, `ReadWritePaths` giới hạn). Không phát hiện đường vòng nào cho phép FE/BE gọi shell trực tiếp.

---

## 4. Tình trạng triển khai theo từng lớp

### 4.1 Lớp FW SOM — `services/netcfg` · 🟢 Hoàn chỉnh

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Máy trạng thái 8 trạng thái | ✅ | `netcfg.hpp:87-96`, enum `state` khớp schema |
| Auto-rollback ≤ 120 s | ✅ | `kRollbackMaxSeconds=120`; `Engine::tick()` `netcfg.cpp:1088` |
| Deadline chống nhảy đồng hồ | ✅ | Dùng đồng thời epoch + steady clock (`netcfg.cpp:951-955`, `1092-1094`); test `MonotonicDeadlineRollsBackEvenIfWallClockMovesBackward` |
| Journal bền vững + phục hồi sau restart | ✅ | `load_journal`/`save_journal`; test `StaticStageApplyConfirmIsDurableAndIdempotent` |
| Idempotency theo `requestId` | ✅ | `cache_` + `request_hash`; test `RequestIdConflictCannotRepeatMutation` |
| Allowlist interface | ✅ | Test `ConfiguredInterfaceIsAnEnforcedAllowlist` |
| DHCP chờ lease thật trước khi confirm | ✅ | Test `DhcpWaitsForARealLeaseBeforeConfirmation` |
| Từ chối thay thế giao dịch chưa kết thúc | ✅ | Test `RefusesToReplaceAnUnfinishedTransaction` |
| Kiểm soát UID peer qua socket | ✅ | `Server::allowed_peer` + `SO_PEERCRED`, `--allowed-user mkddc` |
| Frame bounded 8192 B | ✅ | `kMaxFrameBytes` |

**Nhận định:** Đây là lớp trưởng thành nhất trong ba lớp. Không phát hiện sai lệch nào so với ADR-017 hay schema. Việc dùng deadline kép epoch/steady là chi tiết kỹ thuật vượt yêu cầu tài liệu và đáng ghi nhận.

**Hạn chế còn lại (đã đính chính ở rev 1.1):** Toàn bộ 37 test là host test. Không có bằng chứng nào chạm tới NetworkManager thật, đúng như ADR-017 §3 đã cảnh báo — **đây mới là hạn chế thật sự**, và nó vẫn đứng vững.

Bản 1.0 còn khẳng định thêm rằng `LinuxPlatform` "chưa có test trực tiếp" ở các hàm `run`, `persist`, `read_interface_state`, `interface_has_address`. **Khẳng định đó sai** và đã bị gỡ: tại `87a0ff0` đã có sẵn **16 test `NetcfgLinuxPlatform`** chạy thẳng vào lớp này qua một command-runner giả, phủ `persist` (`PersistsManualDnsWithNetworkManagerFlags`, `PersistsAutomaticDnsByClearingManualOverrides`), `read_interface_state` (`ConfiguredStaticProfileUsesFirstValidAddress`, `ReportsConfiguredAndRuntimeDnsSeparately`), `run` (`TruncatedCommandOutputStillReportsSuccess`) và sáu nhánh fail-closed của rollback. Nguyên nhân sai: lệnh ở §2.3 chạy một binary cũ còn sót trong `build/`.

Điều chỉnh kết luận cho đúng: độ phủ `LinuxPlatform` **không mỏng**; cái thiếu là **bản chất của fake** — mọi test đều nạp sẵn output cho `run`, nên chúng chốt được *logic dựng lệnh và xử lý kết quả*, chứ không chứng minh được `nmcli` thật hành xử như giả định. Đúng loại lỗi mà F-14 (`promote_secondaries`) là ví dụ: chỉ lộ ra khi chạy trên phần cứng thật.

### 4.2 Lớp BE — `web/backend` · 🟡 Nửa giao dịch chín, nửa cấu hình hở

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Tách quyền GET viewer / POST admin | ✅ | `http.go:132-135`, khớp ADR-017 §2.7 |
| `DisallowUnknownFields` + chặn body > 4096 B | ✅ | `decodeNetworkTransactionBody` |
| Validate candidate song song với C++ | ✅ | Test `TestValidateNetcfgCandidateMatchesCppAuthorityPolicy` |
| Kiểm tra IPv4 loại trừ network/broadcast/multicast/loopback | ✅ | `validateNetcfgCandidate:222-249` — chất lượng cao |
| Gateway phải cùng subnet và khác IP candidate | ✅ | `networktransaction.go:237-245` |
| Capability `dns` phải xác nhận trước khi forward | ✅ | `requireNetworkCapability` |
| Fail-closed khi authority trả response lai | ✅ | `validateNetcfgDNSMutationResponse` |
| Audit mọi POST đúng một lần, không log candidate/DNS/token | ✅ | Test `...AuditSkipsStatusAndRecordsDNSMutationOnce` |
| Phân biệt 502 (response sai) / 503 (không kết nối được) | ✅ | `networkAuthorityError` |
| **Áp dụng cấu hình BACnet/WiFi** | ❌ | `applySystem` là stub — xem **F-01** |
| **Telemetry slave Modbus** | ❌ | Giả lập — xem **F-02** |
| **Suy diễn `bmsLink`** | ❌ | Từ file config — xem **F-03** |

### 4.3 Lớp FE — `NetworkPage.tsx` · 🟡 Logic an toàn xuất sắc, lớp trình bày còn nợ

**Điểm mạnh đã xác minh trong mã nguồn:**

- Bốn tầng sự thật hiển thị tách bạch bằng bốn `AuthorityCard` riêng, kèm chú thích *"Editable candidate; this is not a realtime mirror of ACTIVE / KERNEL"* (`NetworkPage.tsx:283`) — đúng ADR-017 §2.9.
- `managementPathReady` khoá `Apply` cho tới khi trang được mở qua đúng hostname mDNS ổn định (`NetworkPage.tsx:224-225, 313`) — chống tự cắt đường quản trị.
- `ethernetApplyReady` khoá `Apply` khi chưa có carrier (`NetworkPage.tsx:226`).
- `reconcileAfter` — khi một mutation trả lỗi mạng, FE **khoá toàn bộ thao tác** và yêu cầu hai mẫu trạng thái ổn định liên tiếp từ authority trước khi mở lại (`NetworkPage.tsx:85-99`). Đây là xử lý bất định chín chắn, hiếm gặp.
- `pendingMatchesCandidate` chặn `Apply` nếu candidate hiển thị lệch với pending của authority (`NetworkPage.tsx:164-167`) — chống race giữa hai admin.
- `candidateFromAuthority` **không bịa** draft khi authority báo `mode: unknown` (`NetworkPage.tsx:374`) — đúng tiêu chí "không suy diễn".
- `aria-live="polite"` cho khối trạng thái giao dịch (`NetworkPage.tsx:270`).

**Điểm còn nợ:** xem F-04 đến F-11.

### 4.4 Lớp UI/UX · 🟡 Tuân thủ design system, thiếu đặc tả và thiếu a11y

| Tiêu chí | Đánh giá |
|---|---|
| Dùng design token (`--c-*`, `--radius`) | ✅ Nhất quán, trừ một màu thô `rgba(143,161,189,0.18)` tại dòng 562 |
| Phân cấp ISA-101 (Overview → Settings) | ✅ Nằm đúng nhóm SETTINGS trong NavRail |
| Trạng thái tải / lỗi / rỗng | ✅ Có đủ ba `StateBlock` |
| Ngữ nghĩa màu trạng thái | ✅ good/warn/fault theo tone |
| WCAG 2.1 AA — `role="switch"` cho Toggle | ❌ F-08 |
| Đặc tả UI (wireframe/mockup) | ❌ **Không tồn tại** — G-02 |
| Song ngữ VI/EN nhất quán | ❌ F-09 |

---

## 5. Ma trận truy vết ADR-017 → Triển khai → Bằng chứng

| ADR-017 §2 | Yêu cầu | FW SOM | BE | FE | Bằng chứng | Kết luận |
|---|---|---|---|---|---|---|
| 1 | `mkddc-netcfg` là authority duy nhất qua `netcfg.sock` | ✅ | ✅ | ✅ | systemd unit + `netcfg_client.go` | **Đạt** |
| 2 | Protocol v1 strict, bounded, capability-discovered | ✅ | ✅ | ✅ | schema + `DisallowUnknownFields` + `hasExactNetcfgCapabilities` | **Đạt** |
| 3 | Phân biệt `active`/`configured`/`pending`/`management` | ✅ | ✅ | ✅ | 4 `AuthorityCard` | **Đạt** |
| 4 | Candidate + DNS tuỳ chọn; `auto` chỉ với DHCP; `manual` 1..4 duy nhất | ✅ | ✅ | ✅ | `validateNetcfgDNS` + `setCandidateMode` | **Đạt** |
| 5 | Vòng đời giao dịch + last-known-good + auto-rollback 120 s + journal | ✅ | ✅ | ✅ | 37 test C++ | **Đạt** (chỉ host test) |
| 6 | Hostname không thuộc candidate, không mutate được | ✅ | ✅ | ✅ | `management` read-only | **Đạt** |
| 7 | GET `viewer\|operator\|admin`; POST admin-only; audit một lần | ✅ | ✅ | ⚠️ | `App.tsx:63` `RequireAdmin` chặn viewer | **Lệch — F-04** |
| 8 | HMI: `network_status` read-only, mutation qua broker | — | — | — | Ngoài phạm vi trang Web | Không đánh giá |
| 9 | FE hiển thị riêng 4 tầng; **không báo success từ desired file** | — | ❌ | ⚠️ | `bmsLinkStatus` suy diễn từ file | **Lệch — F-03** |
| 10 | Đổi địa chỉ không restart core / không dừng IOP scan | ✅ | ✅ | ✅ | Đường IP không gọi reload | **Đạt** cho đường IP |

---

## 6. Khoảng trống tài liệu (Documentation Gaps)

> Mục này đáp ứng yêu cầu: *"nếu không có tài liệu mà làm thì cũng phải báo cáo gap"*.

| ID | Khoảng trống | Bằng chứng | Mức độ | Hệ quả |
|---|---|---|---|---|
| **G-01** | **Không tồn tại use case nào cho Web.** Kho tài liệu chỉ có `UC-HMI` (19 mục) và `UC-LOCAL` (14 mục). Không có họ `UC-WEB`. | `grep -rhoE "UC-[A-Z]+-[0-9]+" docs/` | **Cao** | Trang cấu hình rủi ro nhất không có tiêu chí nghiệm thu hành vi. QA không có căn cứ để viết kịch bản kiểm thử chấp nhận. Hành vi hiện tại chỉ được định nghĩa bởi chính mã nguồn. |
| **G-02** | **Không có wireframe/mockup/UI spec cho trang Web.** | `find docs -iname "*wireframe*" -o -iname "*mockup*"` → rỗng | **Cao** | Bố cục, thứ tự ưu tiên thông tin, hành vi countdown và cách trình bày old→new hoàn toàn do lập trình viên tự quyết. Không có cơ sở để review thiết kế. Đối chiếu: phía HMI **có** wireframe ASCII trong `KX-DDC24-UX-HMI-001_VI.md` §9. |
| **G-03** | **Hạng mục "B7 (systemd/polkit)" không được tài liệu hoá.** Chuỗi này xuất hiện trong mã sản phẩm và lọt tới người dùng cuối qua toast, nhưng không tồn tại trong `docs/`. | `grep -rln "pending B7\|polkit" docs/` | **Cao** | Một tính năng chưa hoàn thành đang được che bằng warning string thay vì được theo dõi như một hạng mục công việc có chủ sở hữu và deadline. |
| **G-04** | **ADR-017 mang tiêu đề "Settings/Network tabs" nhưng thân ADR không định nghĩa tab nào, và triển khai cũng không có tab.** Từ "tabs" chỉ xuất hiện duy nhất ở dòng tiêu đề. | `grep -n -i "tab" docs/adr/ADR-017-*.md` → chỉ dòng 1 | **Thấp** | Sai lệch tiêu đề gây hiểu nhầm khi tra cứu; hoặc yêu cầu tab đã bị bỏ mà không ghi nhận quyết định. |
| **G-05** | **Không có ma trận truy vết UC → FE → BE → FW → test cho mạng.** | Không tìm thấy tài liệu tương ứng | **Trung bình** | Không chứng minh được độ phủ yêu cầu; ISO/IEC/IEEE 29148 §5.2.8 yêu cầu truy vết hai chiều. |
| **G-06** | **Không có runbook xử lý sự cố khi giao dịch ở trạng thái `failed`.** `DEVELOPMENT_AND_OPERATIONS.md` mô tả đường dẫn journal/socket nhưng không có thủ tục khôi phục. | `grep` trong docs vận hành | **Trung bình** | Thiết bị thực tế đang ở trạng thái `FAILED` (§2.4) mà không có tài liệu hướng dẫn kỹ thuật viên xử lý. |

---

## 7. Danh mục phát hiện (Findings)

Thang mức độ: **Nghiêm trọng** — mất an toàn/mất dữ liệu · **Cao** — sai chức năng hoặc thông tin sai lệch cho người vận hành · **Trung bình** — thiếu sót ảnh hưởng chất lượng/khả dụng · **Thấp** — hoàn thiện.

---

### F-01 · Cao · Lưu BACnet/WiFi ghi file nhưng không bao giờ áp dụng

**Vị trí:** `web/backend/reload_unix.go:82-84`, `web/backend/networkapi.go:80-88`, `src/frontend/src/pages/NetworkPage.tsx:146-157`

```go
//go:build linux
func applySystem(target string) (bool, []string) {
	return false, []string{fmt.Sprintf("reload %s pending B7 (systemd/polkit)", target)}
}
```

`handlePutNetworkPage` gọi `dispatchReload(reloadSystem)` rồi `dispatchReload(reloadRestartIobus)`; cả hai đều rơi vào `applySystem` và luôn trả `false` kèm cảnh báo. Do `Applied: len(warnings) == 0`, response **luôn** có `applied: false`.

Phía FE:

```tsx
if (result.applied) { toast.push('success', ...) }
else { toast.push('warn', result.warnings?.join('; ') || ...) }
```

**Hệ quả:** Mỗi lần quản trị viên bấm "Lưu BACnet/WiFi", hệ thống ghi file thành công nhưng hiển thị toast cảnh báo với nội dung nguyên văn:

> `reload system pending B7 (systemd/polkit); reload restart-iobus pending B7 (systemd/polkit)`

Thay đổi BACnet Device ID, BACnet/IP port, tên thiết bị và bật/tắt WiFi **không có hiệu lực** cho đến khi dịch vụ được khởi động lại thủ công. Người vận hành nhận một thông báo bằng thuật ngữ nội bộ không thể hành động được, và không có cách nào biết cấu hình đã áp dụng hay chưa.

**Khuyến nghị:** (a) Triển khai `applySystem` qua polkit/systemd D-Bus, hoặc (b) nếu còn nợ kỹ thuật, thay chuỗi cảnh báo bằng thông điệp song ngữ hướng dẫn được ("Đã lưu. Cấu hình sẽ có hiệu lực sau khi khởi động lại dịch vụ."), đồng thời đăng ký hạng mục B7 vào tài liệu kế hoạch (đóng G-03).

---

### F-02 · Cao · Chỉ số `Poll health` về mặt cấu trúc không bao giờ báo lỗi

**Vị trí:** `web/backend/networkapi.go:140-167` ↔ `src/frontend/src/pages/NetworkPage.tsx:50-51, 243`

Backend chỉ phát sinh hai giá trị `pollState`:

```go
state := "degraded"
if core.IOP.Status == "normal" { state = "online" }
```

Frontend tính sức khoẻ bằng cách **chỉ trừ đi các slave `offline`**:

```tsx
const healthyPolls = slaves.length
  ? Math.round(((slaves.length - slaves.filter(s => s.pollState === 'offline').length) / slaves.length) * 100)
  : 0
```

Vì backend **không bao giờ** phát ra `"offline"`, biểu thức luôn cho **100%** khi có ít nhất một slave. Kéo theo `warn={healthyPolls < 100}` không bao giờ kích hoạt, nên thẻ KPI không bao giờ chuyển sang màu cảnh báo.

**Hệ quả:** Khi IOP suy giảm, hai thẻ KPI cạnh nhau mâu thuẫn trực tiếp: `Modbus slaves 0/3 online` nằm ngay cạnh `Poll health 100%`. Chỉ số sức khoẻ — thứ người vận hành nhìn đầu tiên — mất hoàn toàn giá trị chẩn đoán.

**Khuyến nghị:** Định nghĩa lại `healthyPolls` theo tỉ lệ slave `online`, hoặc để backend phát `offline` khi IOP mất kết nối. Bổ sung unit test chốt: IOP degraded ⇒ `Poll health < 100`.

---

### F-03 · Cao · Telemetry từng slave Modbus là số liệu giả lập

**Vị trí:** `web/backend/networkapi.go:140-167`

```go
items = append(items, NetworkSlave{
    ...
    PollState:  state,     // một giá trị TOÀN CỤC, sao chép cho mọi slave
    ErrorRate:  0,         // cứng bằng 0
    LastPollMS: lastPoll,  // core.IOP.LastIORespMS — dùng chung cho mọi slave
})
```

Giao diện lại trình bày ba trường này như số đo riêng của từng thiết bị: cột `Poll state` có badge riêng mỗi dòng, cột `Error rate` có thanh tiến trình riêng (`NetworkPage.tsx:562`), cột `Last poll` hiển thị mili-giây riêng.

**Hệ quả:** Kỹ thuật viên không thể phát hiện một slave hỏng trong số nhiều slave, vì mọi dòng luôn hiển thị giống hệt nhau. Thanh error rate vĩnh viễn rỗng. Đây là thông tin sai lệch chủ động, không phải thiếu thông tin.

**Khuyến nghị:** Hoặc bổ sung thống kê per-slave ở `mkddc-core`/`iobus` rồi truyền lên, hoặc — nếu chưa có nguồn dữ liệu — hiển thị `—` kèm chú thích "chưa có số liệu per-slave" thay vì con số bịa.

---

### F-04 · Cao · `bmsLink` suy diễn `online` từ file cấu hình — vi phạm ADR-017 §2.9

**Vị trí:** `web/backend/networkapi.go:220-225`, `src/frontend/src/pages/NetworkPage.tsx:207-213, 343`

```go
func bmsLinkStatus(ip string, enabled bool, port int) string {
	if enabled && ip != "" && port > 0 { return "online" }
	return "offline"
}
```

Trạng thái `online` được kết luận **chỉ từ việc ba trường trong file config khác rỗng**, không hề kiểm chứng socket BACnet/IP có thực sự bind hay có traffic hay không.

Vi phạm hai điều khoản tường minh:

- **ADR-017 §2.9:** *"không báo success từ desired file"*
- **UC-HMI-016 Acceptance:** *"không có `online` suy diễn từ field không rỗng"*

Nghiêm trọng hơn, FE dùng giá trị này làm **fallback cho badge trạng thái Ethernet ở header** khi authority không phản hồi:

```tsx
const ethernetState = activeNetwork ? (…kernel truth…) : config.bmsLink
```

Nghĩa là khi `mkddc-netcfg` mất kết nối — đúng lúc cần sự thật nhất — badge tiêu đề có thể hiển thị `ONLINE` màu xanh dựa trên nội dung file.

**Khuyến nghị:** Khi authority không khả dụng, badge phải về `UNKNOWN`/`UNAVAILABLE` chứ không rơi về giá trị từ file. `bmsLink` cần lấy từ trạng thái bind thực của `mkddc-iobus`.

---

### F-05 · Trung bình-Cao · Trạng thái `failed` không hiển thị nguyên nhân

**Vị trí:** `src/frontend/src/pages/NetworkPage.tsx:275`

```tsx
{transaction.result === 'rejected' && <div …>{transaction.message || transaction.reasonCode}</div>}
```

Dòng lý do chỉ hiện khi `result === 'rejected'`. Nhưng một giao dịch có thể kết thúc ở `state: 'failed'` với `result: 'accepted'` — ví dụ khi apply thành công nhưng health check thất bại rồi auto-rollback lỗi. Trong trường hợp đó **không dòng lý do nào được hiển thị**.

**Bằng chứng vận hành:** Ảnh chụp §2.4 cho thấy đúng tình huống này — badge đỏ `FAILED`, mã giao dịch `net-1785233659457-991191-3`, và không một chữ giải thích. Trường `last_reason` mà engine C++ vẫn lưu (`netcfg.hpp:95`) không được đưa ra response hoặc không được FE hiển thị.

**Khuyến nghị:** Hiển thị lý do cho mọi trạng thái kết thúc bất thường (`failed`, `rolled_back`), kèm gợi ý hành động khôi phục (liên kết tới runbook — đóng G-06).

---

### F-06 · Trung bình · Mâu thuẫn phân quyền: nhánh viewer là mã chết nhưng vẫn được test

**Vị trí:** `src/frontend/src/App.tsx:63`, `components/NavRail.tsx:104`, `web/backend/http.go:132,134`, `NetworkPage.test.tsx`

| Tầng | Hành vi | Nguồn |
|---|---|---|
| ADR-017 §2.7 | GET status cho `viewer\|operator\|admin` | Tài liệu |
| Backend | `RoleViewer` cho cả hai GET | `http.go:132,134` |
| Component | Có nhánh chỉ-đọc: `canManageNetwork = role === 'admin'` vô hiệu hoá mọi nút | `NetworkPage.tsx:34` |
| Unit test | `it('lets a viewer read authority state but disables all mutations')` | `NetworkPage.test.tsx` |
| **Router** | **`<RequireAdmin><NetworkPage /></RequireAdmin>`** | `App.tsx:63` |
| **NavRail** | **Ẩn mục với mọi role ≠ admin** | `NavRail.tsx:104` |

Viewer/operator **không bao giờ** tới được trang. Toàn bộ nhánh chỉ-đọc trong component, quyền `RoleViewer` ở backend, và bài unit test tương ứng đều mô tả một kịch bản không tồn tại trong sản phẩm.

**Hệ quả:** Bài test tạo cảm giác an toàn sai — nó xanh nhưng không bảo vệ hành vi nào có thật. Đồng thời hoặc ADR-017 §2.7 sai, hoặc router quá chặt; hiện chưa có quyết định nào ghi nhận việc thu hẹp này.

**Khuyến nghị:** Chọn một hướng và ghi vào ADR: (a) mở route cho viewer/operator ở chế độ chỉ-đọc — đúng ADR-017 hiện hành và tận dụng được test đã có; hoặc (b) giữ admin-only, hạ quyền GET backend xuống `RoleAdmin` và xoá nhánh viewer cùng bài test.

---

### F-07 · Trung bình · Bộ e2e chuyên biệt cho trang mạng không chạy trong CI

**Vị trí:** `src/frontend/e2e/network-qa.spec.ts` (258 dòng), `.github/workflows/build-and-test.yml`

Không workflow nào tham chiếu `playwright` hay `test:e2e`; gate FE chỉ chạy `npm test` = `vitest --run --environment jsdom src`, và thư mục `e2e/` nằm **ngoài** `src`.

Bộ e2e này mô phỏng đầy đủ authority (`staticTransaction`, `dhcpUnknownTransaction`, khôi phục sau mất kết nối) — chính là kịch bản khó kiểm bằng unit test. Nó đang không bảo vệ gì.

**Khuyến nghị:** Thêm job Playwright vào `build-and-test.yml` (hoặc gọi `npm run test:e2e` trong job frontend hiện có).

---

### F-08 · Trung bình · Không có kiểm tra định dạng phía client cho IPv4/netmask/gateway/DNS

**Vị trí:** `src/frontend/src/pages/NetworkPage.tsx:128-134, 535-537`

`Field` là `<input>` text trơn: không `pattern`, không `inputMode="numeric"`, không `aria-invalid`, không thông báo lỗi inline. Nhập `192.168.1.999` hay `abc` vẫn phải bấm Validate và chờ server từ chối.

Riêng DNS tách chuỗi thô:

```tsx
servers: value.split(',').map(server => server.trim())
```

Dấu phẩy cuối sinh phần tử rỗng, bị backend từ chối với thông điệp kỹ thuật `candidate.dns.servers[2]: must be a canonical IPv4 address`.

Đối chiếu nội bộ: `TimeSettingsPage` đã làm đúng (regex RFC3339 + `Date.parse` + `aria-invalid` + lỗi inline). Trang mạng nên theo chuẩn đó.

*Ghi nhận: phát hiện này trùng N1/N2 của audit 2026-07-30 và được xác nhận lại là chưa xử lý.*

---

### F-09 · Trung bình · Lưu BACnet/WiFi không có xác nhận hậu quả

**Vị trí:** `src/frontend/src/pages/NetworkPage.tsx:325`

Nút "Lưu BACnet/WiFi" ghi thẳng ba file cấu hình và (theo thiết kế) kích hoạt `restart-iobus` — làm gián đoạn BACnet và Modbus. Không có modal xác nhận nào, trong khi `TimeSettingsPage` đã có modal nêu rõ hậu quả.

Kết hợp với F-01 (reload là stub), tình huống hiện tại còn khó hiểu hơn: người dùng không được cảnh báo trước, và sau khi bấm lại nhận cảnh báo bằng thuật ngữ nội bộ.

---

### F-10 · Thấp · Trường chết `Serial` và `Firmware`

**Vị trí:** `src/frontend/src/pages/NetworkPage.tsx:348-349`

```tsx
<Info label="Serial" value="N/A" mono />
<Info label="Firmware" value="N/A" mono />
```

Hai trường gán cứng `"N/A"`, không nối tới nguồn dữ liệu nào. Đáng chú ý: sidebar của chính ứng dụng **đã** hiển thị `FIRMWARE 0.1.0-be-b6c` (xem §2.4), nên dữ liệu có sẵn nhưng không được dùng.

---

### F-11 · Thấp · Song ngữ không đồng đều; hai tiêu đề panel trộn ngôn ngữ cứng

**Vị trí:** `src/frontend/src/pages/NetworkPage.tsx:325, 356`

```tsx
<Panel title="NORTHBOUND - BACnet/IP lên BMS" …>
<Panel title="SOUTHBOUND - RS-485 Modbus RTU Master" …>
```

Hai chuỗi này **không đi qua `pick()`**, trộn tiếng Anh và tiếng Việt trong cùng một dòng và không đổi khi chuyển sang chế độ EN.

Ngoài ra, toàn bộ mặt làm việc thực tế vẫn là tiếng Anh (`Interface`, `Mode`, `Subnet Mask`, `DNS mode`, `Stage`, `Apply`, `Confirm`, `Rollback`, và mọi giá trị trong `AuthorityCard`: `up`/`down`, `present`/`absent`, `ready`/`not ready`), trong khi tiêu đề và toast lại được dịch đầy đủ.

---

### F-12 · Thấp · Trình bày countdown yếu hơn đặc tả HMI

**Vị trí:** `src/frontend/src/pages/NetworkPage.tsx:272`

Web hiển thị `{transaction.rollbackRemainingS ?? 0}s` — số giây thô trong một thẻ nhỏ. Đặc tả HMI (`KX-DDC24-UX-HMI-001_VI.md` §9) quy định panel phải trình bày:

```
New IP       192.168.1.80 /24
Old IP       192.168.1.50 /24
Rollback in  01:42
```

Web thiếu định dạng `MM:SS` và thiếu đối chiếu old→new tường minh trong thẻ giao dịch (người dùng phải tự so sánh giữa thẻ ACTIVE và thẻ PENDING). Với thao tác mà sai sót đồng nghĩa với việc phải cử người tới hiện trường, đây là khoảng cách đáng thu hẹp.

---

### F-13 · Thấp · Thiếu `role="switch"` cho Toggle WiFi

**Vị trí:** `src/frontend/src/pages/NetworkPage.tsx:539-541`

`Toggle` là `<button>` không có `role="switch"` và `aria-checked`. Trình đọc màn hình không truyền đạt được trạng thái bật/tắt. Vi phạm WCAG 2.1 AA §4.1.2 — mục tiêu đã cam kết trong `KX-DDC24-UX-SYSTEM-001_VI.md` §8.

---

## 8. Đánh giá độ phủ kiểm thử

| Lớp | Số test | Chất lượng | Nhận định |
|---|---|---|---|
| FW SOM `netcfg_tests` | 37 | **Cao** | Phủ đúng các nhánh rủi ro: deadline, nhảy đồng hồ, journal, idempotency, allowlist, DHCP lease, cùng **16 test đi thẳng vào `LinuxPlatform`** (persist DNS, đọc profile/kernel state, 6 nhánh fail-closed của rollback). Hạn chế còn lại không phải số lượng mà là **bản chất fake**: `run` luôn được nạp sẵn output, nên không chốt được hành vi thật của `nmcli`. |
| BE Go | 17 hàm | **Cao** | Đặc biệt tốt: `TestValidateNetcfgCandidateMatchesCppAuthorityPolicy` chốt tính nhất quán chéo Go↔C++; nhóm `...FailsClosedOnMixedAuthorityResponse` phủ 8 biến thể response lai. |
| FE Vitest | 16 | **Cao** cho panel ETHERNET | Phủ đúng các bất biến an toàn: khoá hostname, khoá carrier, reconcile sau mất response, không bịa draft từ `unknown`. **Nhưng:** một test kiểm thử kịch bản viewer không thể xảy ra (F-06). |
| FE Playwright | 1 kịch bản | Không xác định | **Không chạy trong CI** (F-07). |
| **Vùng không có test** | — | — | Toàn bộ nửa dưới trang: `bmsLinkStatus`, `networkSlavesFromConfig`, `healthyPolls`, đường `saveServiceConfig` khi reload trả cảnh báo. Đây chính xác là vùng chứa F-01…F-04. |

**Nhận định trọng yếu:** Bốn phát hiện mức Cao đều nằm trong vùng không có test. Độ phủ hiện tại tập trung gần như toàn bộ vào panel giao dịch — vốn đã là phần chín nhất — và bỏ trống phần đang có lỗi.

---

## 9. Đánh giá rủi ro

| ID | Rủi ro | Khả năng | Tác động | Mức | Giảm thiểu |
|---|---|---|---|---|---|
| R-01 | Người vận hành tin vào `Poll health 100%` trong khi field bus đã suy giảm | Cao | Cao | **Cao** | Đóng F-02 |
| R-02 | Cấu hình BACnet được lưu nhưng không có hiệu lực; BMS không thấy thiết bị đúng ID/port | Cao | Cao | **Cao** | Đóng F-01 |
| R-03 | Badge Ethernet hiển thị `ONLINE` từ file khi authority chết | Trung bình | Cao | **Cao** | Đóng F-04 |
| R-04 | Kỹ thuật viên gặp `FAILED` không rõ lý do, không có runbook, xử lý sai | Trung bình | Cao | **Cao** | Đóng F-05 + G-06 |
| R-05 | Không có UC/wireframe Web ⇒ thay đổi tương lai làm hỏng bất biến an toàn mà không ai phát hiện | Trung bình | Cao | **Cao** | Đóng G-01, G-02 |
| R-06 | Regression ở luồng giao dịch lọt lưới do e2e không chạy | Trung bình | Trung bình | **Trung bình** | Đóng F-07 |
| R-07 | Sai lệch RBAC giữa ADR và router gây hiểu nhầm khi audit an ninh | Thấp | Trung bình | **Thấp** | Đóng F-06 |

---

## 10. Khuyến nghị theo thứ tự ưu tiên

### Đợt 1 — Chặn phát hành (ước lượng 3–4 ngày)

| # | Hành động | Đóng |
|---|---|---|
| 1 | Sửa công thức `healthyPolls` theo tỉ lệ `online`; thêm unit test chốt "IOP degraded ⇒ Poll health < 100" | F-02 |
| 2 | Bỏ suy diễn `bmsLink` từ file; khi authority không khả dụng, badge về `UNKNOWN` | F-04 |
| 3 | Thay chuỗi cảnh báo `pending B7 (systemd/polkit)` bằng thông điệp song ngữ hành động được; đăng ký hạng mục B7 vào tài liệu kế hoạch | F-01, G-03 |
| 4 | Hiển thị lý do cho mọi trạng thái kết thúc bất thường (`failed`, `rolled_back`) | F-05 |
| 5 | Thay telemetry per-slave giả lập bằng `—` + chú thích, cho tới khi có nguồn dữ liệu thật | F-03 |

### Đợt 2 — Trước khi chuyển Network gate sang AMBER (ước lượng 4–5 ngày)

| # | Hành động | Đóng |
|---|---|---|
| 6 | **Viết `UC-WEB-001…00n` cho trang `settings/network`**, tối thiểu: xem trạng thái, đổi static, đổi DHCP, cấu hình DNS, rollback, xử lý authority mất kết nối | G-01 |
| 7 | **Bổ sung wireframe/UI spec cho trang Web**, tham chiếu chéo wireframe HMI để thống nhất trình bày old→new và countdown | G-02, F-12 |
| 8 | Nối Playwright vào CI | F-07 |
| 9 | Quyết định và ghi vào ADR hướng xử lý RBAC viewer; đồng bộ router ↔ backend ↔ test | F-06 |
| 10 | Thêm validate client cho IPv4/netmask/gateway/DNS theo khuôn mẫu `TimeSettingsPage` | F-08 |
| 11 | Viết runbook khôi phục giao dịch `failed` | G-06 |

### Đợt 3 — Hoàn thiện (ước lượng 2 ngày)

| # | Hành động | Đóng |
|---|---|---|
| 12 | Modal xác nhận hậu quả cho "Lưu BACnet/WiFi" | F-09 |
| 13 | Nối `Serial`/`Firmware` vào nguồn dữ liệu thật | F-10 |
| 14 | Đưa hai tiêu đề panel qua `pick()`; dịch nhãn mặt làm việc và giá trị `AuthorityCard` | F-11 |
| 15 | `role="switch"` + `aria-checked` cho Toggle | F-13 |
| 16 | Sửa tiêu đề ADR-017 hoặc bổ sung quyết định về việc bỏ tab | G-04 |
| 17 | Lập ma trận truy vết UC → FE → BE → FW → test | G-05 |

---

## 11. Kết luận chính thức

1. **Panel ETHERNET đạt yêu cầu contract.** Chín trên mười quyết định của ADR-017 §2 được hiện thực hoá đầy đủ và có bằng chứng kiểm thử ở cả ba lớp. Cơ chế giao dịch, auto-rollback deadline kép, journal bền vững, idempotency và các khoá bảo vệ đường quản trị là chuẩn mực nội bộ nên nhân rộng.

2. **Panel NORTHBOUND/SOUTHBOUND chưa đạt.** Đường ghi cấu hình không có hiệu lực (F-01), ba nhóm chỉ số hiển thị số liệu không có thật (F-02, F-03) và một chỉ số suy diễn trạng thái từ file trái với contract (F-04). Nửa dưới trang hiện đang trình bày thông tin sai lệch cho người vận hành, không chỉ là thiếu thông tin.

3. **Sai lệch so với tài liệu tập trung ở đúng một điều khoản.** ADR-017 §2.9 ("không báo success từ desired file") bị vi phạm bởi `bmsLinkStatus`, và §2.7 (RBAC) bị router thu hẹp mà không có quyết định ghi nhận. Tám điều khoản còn lại đạt.

4. **Khoảng trống tài liệu là rủi ro lớn nhất về dài hạn.** Trang cấu hình rủi ro nhất của sản phẩm đang được xây dựng **không có use case và không có wireframe** cho phía Web. Mọi bất biến an toàn hiện chỉ tồn tại trong mã nguồn và trong 16 bài unit test. Không có tài liệu nào để một kỹ sư mới — hay một auditor — kiểm chứng rằng hành vi hiện tại là hành vi được chủ đích.

5. **Độ phủ kiểm thử lệch.** Toàn bộ bốn phát hiện mức Cao nằm trong vùng không có test, trong khi phần đã chín nhất lại được phủ dày nhất.

6. **Giữ Network gate = RED.** Kết luận này thống nhất với ADR-017 §3. Ngoài các điều kiện vật lý mà ADR đã liệt kê, báo cáo này bổ sung điều kiện: đóng xong nhóm F-01…F-05 và bổ sung `UC-WEB` trước khi xem xét chuyển AMBER.

---

## 12. Phê duyệt

| Vai trò | Tên | Ngày | Chữ ký |
|---|---|---|---|
| Người lập báo cáo | Claude Code | 2026-07-31 | — |
| SW Lead | | | |
| Product Owner | | | |
| QA Lead | | | |

---

## Phụ lục A — Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-07-31 | Bản đầu tiên. Rà soát xuyên suốt UI/UX · UC · FE · BE · FW SOM cho trang `settings/network` tại `87a0ff0`. 13 phát hiện, 6 khoảng trống tài liệu. |
| 1.1 | 2026-08-01 | **Đính chính độ phủ test `netcfg`.** Bản 1.0 ghi `netcfg_tests` có 11 test và kết luận `LinuxPlatform` "chưa có test trực tiếp" (§2.3, §4.1, §5, §8, §1 bảng tóm tắt). Số liệu đó lấy từ một **binary cũ còn sót trong `build/`**, không phải bản dựng từ mã nguồn tại `87a0ff0` — nơi thực tế đã có **37 test, trong đó 16 test đi thẳng vào `LinuxPlatform`**. Đã sửa cả năm chỗ và viết lại nhận định §4.1/§8 cho đúng: hạn chế thật không nằm ở số lượng test mà ở **bản chất fake của command-runner** (không chứng minh được hành vi `nmcli` thật) — đúng loại lỗi mà F-14 minh hoạ. Các phát hiện F-01…F-13 và G-01…G-06 **không thay đổi**; không phát hiện nào dựa trên con số 11. |

## Phụ lục B — Tham chiếu chéo

- Contract: [ADR-017](../../../adr/ADR-017-settings-network-tabs-and-state-contract.md) · [`shared/netcfg_protocol_v1.schema.json`](../../../../contracts/config/netcfg_protocol_v1.schema.json)
- Đặc tả Web: [09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md](../../../03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md)
- UI/UX: [KX-DDC24-UX-SYSTEM-001_VI.md](../../../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md) · [KX-DDC24-UX-HMI-001_VI.md](../../../04_uiux/KX-DDC24-UX-HMI-001_VI.md)
- Use case (HMI, đối chiếu chéo): [KX-DDC24-UC-HMI-001_VI.md](../../../04_uiux/KX-DDC24-UC-HMI-001_VI.md) — UC-HMI-016…019
- Audit tiền nhiệm: [KX-DDC24-UIUX-PRODUCT-AUDIT-2026-07-30.md](KX-DDC24-UIUX-PRODUCT-AUDIT-2026-07-30.md) §2.8
- Vận hành: [DEVELOPMENT_AND_OPERATIONS.md](../../../06_operations/DEVELOPMENT_AND_OPERATIONS.md)
