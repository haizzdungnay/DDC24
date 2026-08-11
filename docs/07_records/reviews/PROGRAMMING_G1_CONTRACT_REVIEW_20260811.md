# Biên bản join hợp đồng G1 Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-G1-CONTRACT-REVIEW-2026-08-11` |
| Task | `TASK-PROG-105` |
| Ngày | 2026-08-11 |
| Source candidate | `30a068b80555125ee0353b04342b631d83702497` |
| Git tree | `5b41e819da0e071bc25c6ccb4fac978dfe1a7820` |
| Phạm vi | Join OpenAPI/IPC/profile/artifact/error/store; compatibility; deploy/rollback host |
| Trạng thái | **GO CHO P2/P3 IMPLEMENTATION — P1 6/6 DONE; không phải RELEASE GO** |
| Authority | Product Owner/CTO + System Architect Phạm Đình Chương theo `AUTH-PROG-2026-08-11-03` và chỉ thị tiếp tục implement ngày 2026-08-11 |
| Verification | `WAIVED FOR IMPLEMENTATION`; Test Result đầy đủ vẫn cần independent review trước release |
| Evidence | [`EV-PROG-G1-100..105`](programming-g1/raw/EV-PROG-G1-105.txt) |

## 1. Phán quyết

G1 được phép bàn giao contract foundation cho `TASK-PROG-200..207` và
`TASK-PROG-300..307`. Sáu contract có nguồn máy đọc duy nhất, cùng major `1`,
hash/version được ghim và consumer C++/Go/TypeScript có phép kiểm drift. Không có
finding P0/P1 mở trong phạm vi G1.

Phán quyết này **không** bật `PROGRAMMING_REV_A`, không nối Commission, không
đổi Active/LKG, không tuyên bố hai scenario `VS-PROG-001/019` đã PASS đầy đủ,
không thay `RELEASE_READY`. Hai Test Result G1 được tạo với verdict `BLOCKED` để
ghi đúng phần còn thiếu ở G2: service/wiring/import của `VS-001` và Check/API/UI
của `VS-019`.

## 2. Manifest join và kết quả compatibility

Authority máy đọc là
[`g1_contract_join_v1.json`](../../../contracts/programming/g1_contract_join_v1.json),
SHA-256 `2682d14ee7b4a04e585426629610637fb213bf1ce2c09271a6bc00c24772db43`.

| Contract | Version/major | SHA-256 | Kết quả consumer |
|---|---:|---|---|
| OpenAPI | `1.16.0` / `1` | `34862da2349a7b705f79f813c337b7801f46e68716d8fdff779212eaf7c9bb7e` | Go route và TS client cùng 25 operation |
| IPC | `1.0` / `1.0` | `d18702bc1f699b9fc90d05f41ae0dd4dee4444a1025dcb45c9f559cfb6409342` | C++/Go cùng canonical CBOR; major/minor mới hơn bị từ chối |
| Profile | `1.0` / `1` | `94c58ffa552f33cbcef530c82cd0203d492a5308f8312040e569f4354a1f3bdc` | generated C++ constants khớp profile |
| Artifact | schema `1` | `f39ede1fce04d5f13e657268635cc909194d3f1c32c086f5bc2551942e50a417` | loader/golden cùng profile `1`, `HASH_ONLY` |
| Catalog lỗi | `1.0.0` / `1` | `2315add30a8e5880dbf09574371ed662726004c0e04372d16c88164d182571d4` | 19 public/77 detail sinh cho C++/Go/TS |
| SQLite store | schema `1` | `6c30ca18645c8870f5794b10a330a0e5da8164224ac203ffc22f47bd6bac44e7` | migration checksum, PRAGMA và flag OFF khớp |

`python3 scripts/verify_programming_g1_contracts.py --self-test` cho kết quả:

- `6/6` contract khớp hash/version/major;
- `5/5` mutation unknown major, deploy đảo, Commission ON, hash drift và
  rollback phá dữ liệu bị từ chối;
- `5/5` thứ tự deploy sai hoặc thiếu bước bị chặn ở preflight trước mutation;
- đường chuẩn deploy rồi rollback bảo toàn DB, backup, Revision, Artifact,
  Operation, audit, Active/LKG và tạo `0` Commission.

## 3. Thứ tự deploy và rollback được khóa

```text
Deploy:   backup/schema → Core dual-compatible → Backend → Frontend read-only
Rollback: Frontend → Backend → Core
Schema:   không tự downgrade
Flag:     OFF
```

Stop trigger: bất kỳ hash/version/major mismatch, thiếu backup verified, thứ tự
sai hoặc consumer không dual-compatible. Khi dừng, không chạy bước tiếp theo và
không replay mutation. Rollback không được xóa DB, backup, Revision, Artifact,
Operation, audit hoặc Active/LKG.

Dry-run ở đây là mô hình host deterministic, không phải bằng chứng cài đặt trên
board. Deploy target, migration target và power-loss thật được giữ cho P6/G6.

## 4. Bằng chứng kiểm chứng

| Làn | Kết quả đo lại |
|---|---|
| G1 join | `6/6` contract; self-test `5/5`; deploy-order âm `5/5`; rollback chuẩn PASS |
| C++ | Release Modbus + BACnet + HMI build PASS; CTest `877/877` PASS |
| Go | `go vet ./...` và `go test ./... -count=1` PASS |
| FE | Vitest `55/55` file, `479/479` test; lint/build PASS; 25 operation đồng bộ |
| Layout gate | Còn lỗi baseline ngoài Programming tại `features/scheduler/shared.ts`; không làm sai kết quả join G1 |
| Browser | Không chạy vì không đổi route/component/layout hoặc runtime UI |
| Target/HIL | `NOT RUN`; không được suy từ host |

Raw evidence và toàn bộ hash nằm trong
[`EV-PROG-G1-105`](programming-g1/raw/EV-PROG-G1-105.txt).

## 5. Finding và xử lý

| ID | Mức | Nội dung | Xử lý | Trạng thái |
|---|---|---|---|---|
| `F-G1-105-01` | P1 | Join ban đầu chỉ so danh sách deploy, chưa thực hiện dry-run state/no-mutation | Thêm mô hình deploy/rollback và 5 order âm | **CLOSED** |
| `F-G1-105-02` | P1 | C++/Go chưa có ca từ chối peer gửi IPC minor mới hơn | Thêm test hai consumer, cùng trả `UnsupportedMinor` | **CLOSED** |
| `F-G1-105-03` | P2 | `layout` gate dừng trước verifier do lỗi dependency scheduler có sẵn | Nối verifier vào gate và chạy trực tiếp; giữ finding baseline cho owner scheduler | **OPEN ngoài Programming; không chặn G1** |

Finding P0/P1 mở trong G1: **0**.

## 6. Test Result và giới hạn gate

| Scenario | Record | Kết quả | Vì sao chưa PASS |
|---|---|---|---|
| `VS-PROG-001` | `TR-PROG-001-20260811-001` | `BLOCKED` | Store có source nhưng chưa wiring service, functional tag, export/import và restart BE E2E |
| `VS-PROG-019` | `TR-PROG-019-20260811-001` | `BLOCKED` | Contract impact có source nhưng compiler worker, Check aggregate/API và UI xác nhận chưa implement |

Số record: `2/32`; PASS: `0/32`; BLOCKED: `2/32`; 30 scenario còn lại
`NOT_RUN`. Không nâng cột `P/R` trong Trace và không giảm residual risk.

## 7. Sign-off và bàn giao

| Vai trò | Verdict | Căn cứ |
|---|---|---|
| Product Owner/CTO | **GO downstream implementation** | Chỉ thị của Phạm Đình Chương ngày 2026-08-11; `AUTH-PROG-2026-08-11-03` |
| System Architect | **ACCEPT contract join** | Phạm Đình Chương; sáu contract major 1, hash và deploy/rollback đã khóa |
| Verification Lead | **WAIVED FOR IMPLEMENTATION / PENDING cho Test Result PASS** | Giữ độc lập cho release evidence |
| Document Control | **RECORDED** | Plan/Trace/Risk/VVP/Roadmap/candidate đồng bộ trong cùng task |

Next action theo plan: `TASK-PROG-200` compiler ST subset/type/source-map/fuzz;
`TASK-PROG-204` wiring Project/Draft/Revision store chỉ được triển khai sau các
contract G1 này và phải đóng phần thiếu của `VS-PROG-001`.
