# HƯỚNG DẪN TOÀN DIỆN VỀ TẠO CHƯƠNG TRÌNH FBD VÀ KÍCH HOẠT VẬN HÀNH TRÊN MK-DDC-24

> **Tài liệu chuẩn hóa kiến trúc và quy trình vận hành hệ thống DDC-24 (Foxlinx SOM-DDC-24).**
> - **Phiên bản:** 1.1.0 (27/09/2026: sửa chu kỳ theo ADR-061, trạng thái sau Commission theo ADR-062, danh sách xác nhận Commission; xem cuối tài liệu)
> - **Ngày lập:** 26/09/2026
> - **Tác giả:** Em gái kỹ thuật của Onii-chan

---

## MỤC LỤC

- [TỔNG QUAN KIẾN TRÚC & RÀNG BUỘC CỐT LÕI](#tổng-quan-kiến-trúc--ràng-buộc-cốt-lõi)
- [PHẦN 1: QUY TRÌNH THỰC HIỆN DÀNH CHO NGƯỜI DÙNG (WEB UI WORKFLOW)](#phần-1-quy-trình-thực-hiện-dành-cho-người-dùng-web-ui-workflow)
  - [Bước 1: Tạo Khối Chức Năng (Function Block) hỗ trợ](#bước-1-tạo-khối-chức-năng-function-block-hỗ-trợ)
  - [Bước 2: Tạo và Vẽ Sơ đồ Khối FBD (FBD Editor)](#bước-2-tạo-và-vẽ-sơ-đồ-khối-fbd-fbd-editor)
  - [Bước 3: Gán Ánh xạ Tín hiệu I/O (Tab Mapping)](#bước-3-gán-ánh-xạ-tín-hiệu-io-tab-mapping)
  - [Bước 4: Cấu hình Chu kỳ và Thứ tự Thực thi (Tab Execution)](#bước-4-cấu-hình-chu-kỳ-và-thứ-tự-thực-thi-tab-execution)
  - [Bước 5: Kiểm tra và Đưa vào Vận hành (Check & Commission)](#bước-5-kiểm-tra-và-đưa-vào-vận-hành-check--commission)
  - [Bước 6: Bật Cho phép Chạy Chương trình (Enable Runtime Intent)](#bước-6-bật-cho-phép-chạy-chương-trình-enable-runtime-intent)
  - [Các Lỗi Thường Gặp trên Giao diện & Cách Xử lý](#các-lỗi-thường-gặp-trên-giao-diện--cách-xử-lý)
- [PHẦN 2: QUY TRÌNH & NGUYÊN TẮC DÀNH CHO AI AGENT (AUTOMATION & API)](#phần-2-quy-trình--nguyên-tắc-dành-cho-ai-agent-automation--api)
  - [1. Cấu trúc Tài liệu Draft Document v2](#1-cấu-trúc-tài-liệu-draft-document-v2)
  - [2. Cấu trúc JSON của POU FBD (Source Blob)](#2-cấu-trúc-json-của-pou-fbd-source-blob)
  - [3. Ràng buộc bất biến giữa locals, nodes và bindings](#3-ràng-buộc-bất-biến-giữa-locals-nodes-và-bindings)
  - [4. Danh tính thiết bị Modbus RTU: deviceId Canonical](#4-danh-tính-thiết-bị-modbus-rtu-deviceid-canonical)
  - [5. Pipeline Tự động hóa qua API REST (End-to-End Automation)](#5-pipeline-tự-động-hóa-qua-api-rest-end-to-end-automation)
  - [6. Ma trận Xử lý Lỗi & Diagnostic Codes](#6-ma-trận-xử-lý-lỗi--diagnostic-codes)
  - [7. Kiểm soát Bộ nhớ Chia sẻ (SHM Seqlock v7)](#7-kiểm-soát-bộ-nhớ-chia-sẻ-shm-seqlock-v7)

---

## TỔNG QUAN KIẾN TRÚC & RÀNG BUỘC CỐT LÕI

Hệ thống điều khiển MK-DDC-24 tuân thủ nghiêm ngặt chuẩn an toàn công nghiệp và tiêu chuẩn IEC 61131-3:
1. **Chu kỳ thực thi (Allowed Periods)**: Hệ thống chỉ nhận **8 mức chu kỳ** trên base step 10 ms theo `ADR-061` (thay `ADR-026` từ 2026-09-26): `10`, `50`, `100`, `500`, `1000`, `5000`, `10000`, `50000` ms. Gói cũ chu kỳ `30000 ms` chỉ còn được đọc để di trú; Check mới sẽ từ chối (`ST-SCHED-001`). Không cho phép chu kỳ tự do để tránh làm vỡ ràng buộc thời gian thực cứng (Hard Real-Time).
2. **Trạng thái sau Commission (DDD §0, `ADR-062`)**: Program **mới** (chưa từng có ý định chạy) vào bo ở trạng thái `DISABLED`; Core giữ ngắt an toàn (`safeState: true`, `safeStateNoControllerOnly: true`) cho đến khi người vận hành hoặc agent gửi `desiredEnabled: true`. Program **đã có** ý định `Enable` được lưu thì từ 2026-09-26 ý định đó đi cùng lệnh ACTIVATE và Program **chạy ngay** tại safe boundary kích hoạt gói, không phải bật lại sau mỗi lần Commission.
3. **Phân biệt hai hệ thống I/O vật lý**:
   - **Local I/O (`LOCAL`)**: Các cổng trực tiếp trên bo CPU (UI-01..16, AO-01..04, DO-01..04). Trên môi trường lab/test không gắn MCU STM32 thật, Local DO được mô phỏng qua `fake MCU` trong bộ nhớ ảo (không đóng cắt relay cơ).
   - **Fieldbus I/O (`MB_RTU`)**: Các module mở rộng qua cổng RS-485 như **CK508-04** (8 relay cơ + LED đỏ), **CK508-05**, **CK509-06/07**. Đây là các rơ-le vật lý thực tế gõ tiếp điểm tạch-tạch ngoài tủ.

---

## PHẦN 1: QUY TRÌNH THỰC HIỆN DÀNH CHO NGƯỜI DÙNG (WEB UI WORKFLOW)

### Bước 1: Tạo Khối Chức Năng (Function Block) hỗ trợ
Trong chuẩn IEC 61131-3, sơ đồ FBD tái sử dụng các thuật toán tính toán/định thời thông qua các khối chức năng.
1. Tại màn hình **Programming Workspace**, nhìn vào thanh danh mục bên trái (POU Explorer).
2. Nhấn nút **`+ Thêm POU`** (hoặc dấu cộng).
3. Điền thông tin:
   - **Tên POU**: `FB_DO_BLINK_5S` (viết hoa, không dấu, không khoảng trắng).
   - **Loại POU (Kind)**: Chọn **`FUNCTION_BLOCK`**.
   - **Ngôn ngữ (Language)**: Chọn **`ST`** (Structured Text).
4. Nhập mã nguồn logic đảo trạng thái mỗi 5 giây:
```pascal
FUNCTION_BLOCK FB_DO_BLINK_5S
VAR_INPUT
    DUMMY : BOOL;
END_VAR

VAR_OUTPUT
    Q : BOOL;
END_VAR

VAR
    Count : INT;
END_VAR

(* Chương trình chạy mỗi 1s. Đủ 5s thì đảo trạng thái ngõ ra Q *)
Count := Count + 1;
IF Count >= 5 THEN
    Count := 0;
    Q := NOT Q;
END_IF;

END_FUNCTION_BLOCK
```
5. Nhấn **`Lưu` (Ctrl + S)**.

---

### Bước 2: Tạo và Vẽ Sơ đồ Khối FBD (FBD Editor)
1. Thêm một POU mới cho chương trình chính:
   - **Tên POU**: `DO_Blink5s`
   - **Loại POU (Kind)**: Chọn **`PROGRAM`**
   - **Ngôn ngữ (Language)**: Chọn **`FBD`**
2. Mở POU `DO_Blink5s` vào vùng soạn thảo đồ họa FBD.
3. Kéo thả các khối vào mạng lưới (Network):
   - **Khối Hằng số (Constant)**: Chọn loại `BOOL`, đặt giá trị là `true`.
   - **Khối Chức năng (Function Block)**: Chọn kiểu `FB_DO_BLINK_5S` mà ta đã tạo ở Bước 1. Khối này sẽ có 1 cổng vào `DUMMY` và 1 cổng ra `Q`.
   - **Các khối Đầu ra (Output)**: Thêm các khối Output đại diện cho các rơ-le cần điều khiển:
     - `DO_01` (Relay 1 trên bo mạch)
     - `DO_02` (Relay 2 trên bo mạch)
     - `CK50804_DO1` đến `CK50804_DO8` (8 relay trên module mở rộng Modbus CK508-04)
4. Nối dây (Wiring):
   - Nối chân ra `OUT` của khối Constant vào chân `DUMMY` của khối `FB_DO_BLINK_5S`.
   - Nối chân ra `Q` của khối `FB_DO_BLINK_5S` vào chân `IN` của **tất cả** các khối Output đã tạo ở trên (FBD cho phép 1 chân ra nối rẽ nhánh đến nhiều chân vào).
5. Nhấn **`Lưu` (Ctrl + S)**.

---

### Bước 3: Gán Ánh xạ Tín hiệu I/O (Tab Mapping)
1. Chuyển sang thanh công cụ **Mapping** (hoặc tab Ánh xạ I/O).
2. Tại đây sẽ liệt kê danh sách các biến Output của chương trình `DO_Blink5s`.
3. Tiến hành gán từng biến vào điểm vật lý tương ứng:
   - Biến `DO_01` -> Chọn nguồn **`LOCAL`**, điểm **`DO-01`** (Supply Fan Enable Relay).
   - Biến `DO_02` -> Chọn nguồn **`LOCAL`**, điểm **`DO-02`** (Common Alarm Relay).
   - Biến `CK50804_DO1` -> Chọn nguồn **`MB_RTU`**, thiết bị **`CK508-04`**, điểm **`CK50804-DO1`**.
   - Thực hiện tương tự cho `CK50804_DO2` đến `CK50804_DO8`.
4. Nhấn **`Lưu ánh xạ`**.

---

### Bước 4: Cấu hình Chu kỳ và Thứ tự Thực thi (Tab Execution)
1. Nhấn vào mục **Execution** trên thanh điều hướng bên trái (hoặc biểu tượng Play).
2. Kiểm tra thông số tác vụ:
   - **Chu kỳ quét (Period)**: Chọn **`1 s`** (1000 ms). Các mức khác được phép: 10 ms, 50 ms, 100 ms, 500 ms, 5 s, 10 s, 50 s (`ADR-061`).
   - **Danh sách chương trình**: Đảm bảo chương trình `DO_Blink5s` có mặt trong danh sách thực thi.
3. Nhấn **`Lưu`**.

---

### Bước 5: Kiểm tra và Đưa vào Vận hành (Check & Commission)
1. Điều hướng sang trang **Check & Commission** của dự án.
2. Nhấn nút **`Kiểm tra (Check)`**:
   - Hệ thống sẽ biên dịch đồ họa FBD sang mã thực thi và kiểm tra toàn bộ tính toàn vẹn.
   - Kết quả phải đạt trạng thái màu xanh: **`PASSED`** (0 lỗi).
   - *Nếu có lỗi, bảng "Log lỗi" phía dưới sẽ hiển thị chi tiết mã lỗi để sửa chữa.*
3. Nhấn nút **`Đưa vào vận hành (Commission)`**:
   - Một hộp thoại xác nhận các ảnh hưởng (Impact Acknowledgements) sẽ hiện ra.
   - Đánh dấu tick vào tất cả các ô xác nhận thay đổi (thay đổi ánh xạ ngõ ra, ngõ ra bị ảnh hưởng, v.v.).
   - Nhập mật khẩu tài khoản quản trị (`admin123`).
   - Nhấn **`Gửi lệnh (Submit)`**.
4. Chờ hệ thống thực hiện Staging và Cutover sang Core: Báo trạng thái **`Commission succeeded`**.

---

### Bước 6: Bật Cho phép Chạy Chương trình (Enable Runtime Intent)
1. Sau khi Commission thành công, chuyển sang trang **Programs** (hoặc Runtime Overview).
2. Tại danh sách chương trình đang chạy, tìm chương trình `DO_Blink5s`.
3. Nhìn vào cột Trạng thái / Ý định chạy:
   - Hiện tại đang là **`Disabled`** (Màu xám).
   - Nhấp vào nút gạt chuyển trạng thái sang **`Enabled`** (Màu xanh).
4. Quan sát thực tế:
   - Core runtime chuyển sang **`Core running`** (không còn báo lỗi safe state).
   - Cứ mỗi **5 giây**, toàn bộ rơ-le trên module **CK508-04** sẽ gõ tiếng **"TÁCH"**, 8 đèn LED đỏ bật sáng trong 5 giây, sau đó gõ "TÁCH" và tắt trong 5 giây.

---

### Các Lỗi Thường Gặp trên Giao diện & Cách Xử lý

| Mã lỗi / Hiện tượng | Nguyên nhân | Cách khắc phục |
| :--- | :--- | :--- |
| **`PRG-ERR-MAP-003`** (`ST-IOMAP-001`) | Một biến có trong tab Mapping nhưng sơ đồ FBD đã bị xoá mất khối Output của biến đó. | Vào sơ đồ FBD thêm lại khối Output tương ứng, hoặc vào tab Mapping xoá bỏ dòng ánh xạ thừa. |
| **`PRG-ERR-LIB-VERSION-001`** | Sơ đồ FBD gọi một Function Block nhưng FB đó chưa được tạo hoặc bị xoá khỏi danh mục POU. | Kiểm tra lại tên khối FB trong FBD xem có khớp 100% với tên FB trong danh mục POU bên trái không. |
| **`The controller simulation limit is reached`** | Phiên mô phỏng cũ bị treo ngầm chiếm slot duy nhất trên controller. | Nhấn nút **"Dừng phiên mô phỏng đang chạy trên thiết bị"** vừa được bổ sung trên giao diện để giải phóng. |
| **Commission thành công nhưng đèn không nháy** | Chương trình mới Commission chưa được gạt nút **`Enable`** sang màu xanh. | Vào tab Programs hoặc Execution gạt nút Enable cho chương trình đó. |


---

## PHẦN 2: QUY TRÌNH & NGUYÊN TẮC DÀNH CHO AI AGENT (AUTOMATION & API)

Dành cho AI Agent thao tác qua mã lệnh lập trình, API HTTP RESTful hoặc truy vấn trực tiếp CSDL SQLite trên bo nhúng.

### 1. Cấu trúc Tài liệu Draft Document v2
Mỗi dự án lưu trữ nội dung nháp trong bảng `drafts.content_json` (chuẩn JSON canonical v2). Bắt buộc phải có đầy đủ các trường sau:

```json
{
  "schemaVersion": 2,
  "project": {
    "projectId": "e96357dc-b00c-4116-a4a0-1dd71ea116db",
    "name": "AHU-MASTER-SEQUENCE",
    "functionalTags": []
  },
  "library": {
    "systemProfile": "revA-1t-1-5-30",
    "systemVersion": "rev-a.3",
    "projectLibraryRevisionId": null
  },
  "execution": {
    "maxProgramsEnabled": 16,
    "profileId": "revA-1t-1-5-30"
  },
  "programs": [
    {
      "objectId": "5619efde-f419-44cc-b4aa-981e19425481",
      "programId": "5619efde-f419-44cc-b4aa-981e19425481",
      "taskId": "e96357dc-b00c-4116-a4a0-1dd71ea116db",
      "periodMs": 1000
    }
  ],
  "signals": [],
  "bindings": [ /* Danh sách ánh xạ I/O */ ],
  "objects": [ /* Danh sách POU: Function Blocks & Programs */ ]
}
```

> **Lưu ý cho Agent**:
> - `execution.maxProgramsEnabled` bắt buộc phải là hằng số `16`.
> - `periodMs` của mỗi program chỉ được nhận một trong tám giá trị của `ADR-061`: `10`, `50`, `100`, `500`, `1000`, `5000`, `10000`, `50000`. Giá trị khác (kể cả `30000` cũ) bị từ chối `400 PRG-ERR-REQ-001` với `detailCode = ST-SCHED-001`.

---

### 2. Cấu trúc JSON của POU FBD (Source Blob)
Trong mảng `objects`, POU FBD có trường `source` là một chuỗi JSON stringified tuân thủ `fbd_v1.schema.json`:

```json
{
  "$schema": "../../fbd_v1.schema.json",
  "schemaVersion": 1,
  "name": "DO_Blink5s",
  "profileId": "revA-1t-1-5-30",
  "graphId": "77777777-7777-4777-8777-777777777777",
  "layout": {
    "schemaVersion": 1,
    "nodes": {
      "node-c-1": { "x": 100, "y": 150 },
      "node-fb-1": { "x": 350, "y": 150 },
      "node-out-1": { "x": 700, "y": 150 }
    }
  },
  "networks": [
    {
      "id": "net-01",
      "name": "network_1",
      "order": 0,
      "nodes": [
        {
          "executionOrder": 0,
          "id": "node-c-1",
          "kind": "CONSTANT",
          "parameters": { "value": true },
          "ports": [{ "dataType": "BOOL", "direction": "OUTPUT", "id": "port-c-out", "name": "OUT", "order": 0, "unit": null }],
          "typeRef": "BOOL"
        },
        {
          "executionOrder": 1,
          "id": "node-fb-1",
          "kind": "FUNCTION_BLOCK",
          "parameters": {},
          "ports": [
            { "dataType": "BOOL", "direction": "INPUT", "id": "port-fb-in", "name": "DUMMY", "order": 0, "unit": null },
            { "dataType": "BOOL", "direction": "OUTPUT", "id": "port-fb-out", "name": "Q", "order": 1, "unit": null }
          ],
          "typeRef": "FB_DO_BLINK_5S"
        },
        {
          "executionOrder": 2,
          "id": "node-out-1",
          "kind": "OUTPUT",
          "parameters": { "variable": "CK50804_DO1" },
          "ports": [{ "dataType": "BOOL", "direction": "INPUT", "id": "port-out-in-1", "name": "IN", "order": 0, "unit": null }],
          "typeRef": "BOOL"
        }
      ],
      "wires": [
        {
          "id": "wire-1",
          "from": { "nodeId": "node-c-1", "portId": "port-c-out" },
          "to": { "nodeId": "node-fb-1", "portId": "port-fb-in" }
        },
        {
          "id": "wire-2",
          "from": { "nodeId": "node-fb-1", "portId": "port-fb-out" },
          "to": { "nodeId": "node-out-1", "portId": "port-out-in-1" }
        }
      ]
    }
  ]
}
```

---

### 3. Ràng buộc bất biến giữa locals, nodes và bindings

Đây là nguyên nhân chính gây lỗi `PRG-ERR-SCOPE-001` (`ST-CLI-LIMIT`) hoặc `PRG-ERR-MAP-003` (`PGM-MAP-VARIABLE-001`):

1. **Trong POU Program**: Mảng `locals` trong đối tượng POU `objects` **BẮT BUỘC** phải khai báo mọi biến ngõ ra có mặt trong sơ đồ FBD:
```json
{
  "variableId": "port-out-in-1",
  "programId": "5619efde-f419-44cc-b4aa-981e19425481",
  "name": "CK50804_DO1",
  "type": "BOOL",
  "class": "OUTPUT",
  "retain": false,
  "unit": "bool"
}
```
2. **Trong mảng `bindings` toàn cục**:
```json
{
  "bindingId": "b0000004-0000-4000-8000-000000000001",
  "programId": "5619efde-f419-44cc-b4aa-981e19425481",
  "variableId": "port-out-in-1",
  "variable": "CK50804_DO1",
  "direction": "WRITE",
  "dataType": "BOOL",
  "unit": "bool",
  "writable": true,
  "qualityPolicy": "REQUIRE_GOOD",
  "point": {
    "category": "MB_RTU",
    "deviceId": "bus-1-slave-4",
    "pointId": "CK50804-DO1"
  }
}
```
3. **Quy tắc tam giác đồng nhất**:
   - `Node FBD (variable)` == `Locals (name & variableId)` == `Binding (variable & variableId)`.
   - `variableId` phải là chuỗi UUID chuẩn (hoặc định dạng UUID v4).
   - Nếu `bindings` có một biến không có trong `locals` hoặc ngược lại -> **Check từ chối ngay lập tức**.

---

### 4. Danh tính thiết bị Modbus RTU: deviceId Canonical

Khi tạo binding cho Modbus RTU (`category: "MB_RTU"`):
- **CẤM** dùng tên người dùng đặt như `CK508-04` làm `deviceId`.
- **BẮT BUỘC** dùng định danh chuẩn hóa (Canonical ID): `"bus-" + bus_id + "-slave-" + slave_address`.
  *Ví dụ:* Module CK508 địa chỉ 4 trên Loop 1 (rs485-1) -> `"bus-1-slave-4"`.
- Trường `unit` của điểm coil Modbus phải đặt chính xác là `"bool"` (khớp với catalog), tránh bị cảnh báo `PGM-MAP-UNIT-001`.

---

### 5. Pipeline Tự động hóa qua API REST (End-to-End Automation)

Để triển khai một chương trình tự động từ Agent, thực hiện đúng chuỗi 5 bước HTTP:

#### 1. Đăng nhập lấy Token:
```bash
POST /api/v1/auth/login
Body: {"username":"admin","password":"<password>"}
Header Response: Token JWT
```

#### 2. Cập nhật Draft (hoặc ghi trực tiếp vào SQLite drafts):
- Nếu qua API: `PATCH /api/v1/programming/projects/{projectId}/draft` kèm header `If-Match: "<etag>"` và các operation hợp lệ.
- Nếu qua SQLite trực tiếp (trên bo): Cập nhật cột `content_json`, `content_sha256 = sha256(data)`, tăng `etag = etag + 1`.

#### 3. Niêm phong Revision (Seal):
```bash
POST /api/v1/programming/projects/{projectId}/draft/revisions
Headers:
  Authorization: Bearer <token>
  If-Match: "<current_etag>"
  X-Idempotency-Key: <uuid>
Body:
  {
    "schemaVersion": "1.0",
    "baseRevisionId": "<project_base_revision_id>",
    "label": "auto-deploy-timestamp",
    "comment": "Automated deployment by agent"
  }
Response (201):
  {"resource": {"revisionId": "<NEW_REVISION_ID>"}}
```

#### 4. Biên dịch & Kiểm tra (Check):
```bash
POST /api/v1/programming/revisions/{NEW_REVISION_ID}/checks
Headers:
  Authorization: Bearer <token>
  X-Idempotency-Key: <uuid>
Body:
  {
    "schemaVersion": "1.0",
    "targetProfile": "MK-DDC-24-REV-A"
  }
Response (202):
  {"checkId": "<CHECK_ID>"}
```
*Agent thực hiện polling `GET /api/v1/programming/checks/{CHECK_ID}` cho đến khi `state == "PASSED"`.*

#### 5. Đưa vào vận hành (Commission):
- Đầu tiên đọc ảnh hưởng: `GET /api/v1/programming/revisions/{CURRENT_ACTIVE_ID}/changes/{NEW_REVISION_ID}`.
- Trích xuất `impactRef` và mảng `acknowledgements`: **đúng mọi key** có trạng thái `"PRESENT"` trong response, không thừa, không thiếu. Đừng chép cứng danh sách ở ví dụ dưới. Tập key backend nhận gồm `retain`, `activeOverrides`, `cutover`, `outputMappingChanges`, `publishedSignals`, `controlLibrary`, `programSet`, `enableIntent`, `physicalMappingChanges`, `virtualPointChanges`, `modbusMappingChanges`, `writableOutputsAffected`. Chương trình ghi vào Virtual Point sẽ có `virtualPointChanges`; thiếu nó thì nhận `422 PRG-ERR-ACK-MISSING-001`.
```bash
POST /api/v1/programming/operations/commission
Headers:
  Authorization: Bearer <token>
  X-Idempotency-Key: <uuid>
Body:
  {
    "schemaVersion": "1.0",
    "revisionId": "<NEW_REVISION_ID>",
    "expectedActiveRevisionId": "<CURRENT_ACTIVE_ID>",
    "checkId": "<CHECK_ID>",
    "impactRef": "<impactRef>",
    "acknowledgements": ["<mọi key PRESENT trong response changes, ví dụ: outputMappingChanges, virtualPointChanges, modbusMappingChanges, writableOutputsAffected, programSet>"],
    "cutover": { "requested": "PROGRAM_ONLY" }
  }
Response (202):
  {"operationId": "<OPERATION_ID>"}
```
*Agent poll `GET /api/v1/programming/operations/{OPERATION_ID}` cho đến khi `state == "SUCCEEDED"`.*

#### 6. Kích hoạt chạy (Enable Intent):
```bash
PUT /api/v1/programming/projects/{projectId}/programs/{programId}/runtime-intent
Headers:
  Authorization: Bearer <token>
  X-Idempotency-Key: <uuid>
Body:
  {
    "schemaVersion": "1.0",
    "desiredEnabled": true
  }
Response (200): OK
```

---

### 6. Ma trận Xử lý Lỗi & Diagnostic Codes

| Diagnostic Code | HTTP Status | Căn nguyên cốt lõi | Cách xử lý dứt điểm cho Agent |
| :--- | :--- | :--- | :--- |
| **`PRG-ERR-ACK-MISSING-001`** | 422 | Thiếu ít nhất một key có `status == "PRESENT"` trong mảng `acknowledgements` (hay gặp: `virtualPointChanges` khi Program ghi vào Virtual Point). | Đọc lại `changes` và gửi đủ mọi key `PRESENT`. |
| **`PRG-ERR-ACK-UNEXPECTED-001`** | 422 | Mảng `acknowledgements` gửi thừa key đang có status `NONE`, hoặc gửi key chưa được whitelist trong backend. | Đảm bảo mảng `acknowledgements` chỉ chứa đúng các key có `status == "PRESENT"` từ API `changes`. |
| **`PRG-ERR-SCOPE-001`** (`ST-CLI-LIMIT`) | 400 (Check) | POU Program thiếu khai báo `locals` cho biến được dùng trong binding hoặc FBD layout. | Điền đầy đủ mảng `locals` trong đối tượng PROGRAM chứa `variableId`, `name`, `class: "OUTPUT"`, `type: "BOOL"`. |
| **`PRG-ERR-MAP-003`** (`ST-IOMAP-001`) | 400 (Check) | Một biến nằm trong `bindings` nhưng không hề xuất hiện ở bất kỳ khối Output/Input nào trong đồ thị FBD. | Kiểm tra lại mảng `nodes` của FBD: mọi biến có trong `bindings` phải có 1 node tương ứng mang `parameters.variable`. |
| **`PRG-ERR-SIM-QUOTA`** | 429 | Đã có một tiến trình worker mô phỏng đang chạy nền chiếm slot độc quyền của controller. | Gửi `DELETE /api/v1/programming/simulation/sessions/active` kèm header `If-Match: *` để ép dừng worker cũ. |
| **`PRG-ERR-REQ-001`** (`X-Idempotency-Key`) | 400 | Header `X-Idempotency-Key` không đúng định dạng UUID hợp lệ. | Sinh UUID chuẩn (VD: `crypto.randomUUID()`), không dùng timestamp đơn thuần. |

---

### 7. Kiểm soát Bộ nhớ Chia sẻ (SHM Seqlock v7)
- Bộ nhớ chia sẻ giữa **Core** và **Web API** được đồng bộ qua seqlock (`/dev/shm/mkddc_plc_shm` và `/dev/shm/mkddc_io_shm`).
- Trên phần mềm hiện tại của bo Foxlinx, magic header của SHM là **`0x4B584407` (v7)**.
- Bộ đọc `seqlockCopy` trong `apps/web-api/internal/app/shm_reader.go` đã được cập nhật để chấp nhận cả `v6` và `v7`, đảm bảo các lệnh đọc `GET /api/v1/points` luôn trả về giá trị thời gian thực của các ngõ ra mà không bị lỗi 503 snapshot lock.

---
*Tài liệu được bảo trì và cập nhật liên tục cùng kho mã nguồn MK-DDC-24.*

### Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.1.0 | 2026-09-27 | Sửa theo `REC-DDC-FIELD-USE-20260927` U-17: tập chu kỳ `ADR-061` thay cho 1/5/30 s của `ADR-026`; Program đã có ý định Enable chạy ngay sau Commission (`ADR-062`); `acknowledgements` phải gồm mọi key `PRESENT` (thêm `virtualPointChanges`), thêm dòng `PRG-ERR-ACK-MISSING-001`. Luồng API đã kiểm trên bo: `GUIDE-PROG-ST-DO16-001` §6.8 (`docs/06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md`) |
| 1.0.0 | 2026-09-26 | Bản đầu |
