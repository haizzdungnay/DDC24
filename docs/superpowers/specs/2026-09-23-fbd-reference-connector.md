# Đặc tả Kỹ thuật: FBD Reference Connector (Cut/Join Presentation Mode)

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `SPEC-FBD-REF-CONN-001` |
| Phiên bản | 1.0.0 |
| Trạng thái | `APPROVED FOR IMPLEMENTATION` |
| Ngày | 2026-09-23 |
| Tác giả | Kỹ sư Trưởng Hệ thống FBD / FE Platform |
| Phạm vi | `apps/web-ui/src/features/programming/fbd/*` (Giao diện FBD Workspace) |
| Requirement | `AC-FBD-REF-001..015`, `DDO-PGM02-FBD-009` |
| Kiến trúc | Presentation-layer Metadata gắn trên Canonical FBD Graph |

---

## Mục lục

1. [Phần 1: Mô hình Cấu trúc Dữ liệu wireReferences & Quản lý Trạng thái](#phần-1-mô-hình-cấu-trúc-dữ-liệu-wirereferences--quản-lý-trạng-thái)
   - 1.1 Ràng buộc Bất biến (Invariants I1 - I4)
   - 1.2 Kiểu Dữ liệu TypeScript (TypeScript Types)
   - 1.3 Reducer State, Actions & Pipeline Chuẩn hoá (Normalize)
   - 1.4 Quy tắc Sinh Tên Tín hiệu Mặc định (Default Signal Names)
   - 1.5 Lưu trữ Cục bộ (LocalStorage Isolation: `projectId:objectId`)
   - 1.6 Vỏ Bọc Sao lưu & Phục hồi (Backup Wrapper Envelope)
2. [Phần 2: Công thức Toạ độ Hình học SVG](#phần-2-công-thức-toạ-độ-hình-học-svg)
   - 2.1 Bảng Hằng số Hình học Không gian (Geometry Constants)
   - 2.2 Điểm Neo Cổng (Port Anchors)
   - 2.3 Source Full Cut Stub (Cắt Toàn phần Đầu phát)
   - 2.4 Source Partial Cut Stub (Cắt Phân nhánh Một phần)
   - 2.5 Destination Sink Stub (Đầu thu Mũi tên Chevron)
   - 2.6 Thuật toán Tránh Va chạm & Cắt tỉa Vật cản (Obstacle Clipping)
   - 2.7 Tọa độ Tích hợp Runtime Value Chip (SIMULATE/LIVE Mode)
3. [Phần 3: Luồng Tương tác Người dùng Chi tiết](#phần-3-luồng-tương-tác-người-dùng-chi-tiết)
   - 3.1 Trình đơn Ngữ cảnh (Context Menu Matrix)
   - 3.2 Điều hướng Đối tác & Nhấp đúp (Partner Navigation)
   - 3.3 Xem nhanh Dây Tạm thời (Peek Wire Nét đứt khi Hover)
   - 3.4 Máy Trạng thái Đổi tên Trực tiếp (Inline Rename State Machine)
   - 3.5 Cơ chế Dọn dẹp Rác & Khối Treo (Dangling Cleanup)
   - 3.6 Khả năng Tiếp cận & Điều hướng Bàn phím (Accessibility & Keyboard)
4. [Phần 4: Ma trận Kiểm thử Tự động](#phần-4-ma-trận-kiểm-thử-tự-động)
   - 4.1 Module M: Model & Invariants
   - 4.2 Module R: Reducer, Action & Undo/Redo
   - 4.3 Module G: Geometry & SVG Paths
   - 4.4 Module C: Canvas Interactions & Shortcuts
   - 4.5 Module E & B: Storage Isolation & Backup Envelope
   - 4.6 Module X: E2E Playwright Integration
5. [Phần 5: Thứ tự Triển khai (5 Phase Roadmap)](#phần-5-thứ-tự-triển-khai-5-phase-roadmap)

---

## Phần 1: Mô hình Cấu trúc Dữ liệu wireReferences & Quản lý Trạng thái

### 1.1 Ràng buộc Bất biến (Invariants I1 - I4)

Hệ thống Reference Connector biến đổi phương thức biểu diễn hình học của đường dây (wire) trên màn hình mà không làm biến dạng cấu trúc đồ thị logic (topological graph) của sơ đồ FBD. Bốn bất biến cốt lõi bắt buộc phải được bảo toàn qua mọi thao tác:

- **Bất biến I1 (Toàn vẹn Tham chiếu — Referential Integrity):**  
  Mọi khóa `wireId` có mặt trong bảng `wireReferences` bắt buộc phải tồn tại trong tập hợp `network.wires` của tài liệu canonical FBD hiện hành:
  $$\forall w_{id} \in \operatorname{dom}(\text{wireReferences}),\ \exists w \in \text{network.wires} : w.\text{id} = w_{id}$$
  Bất kỳ hành vi xóa dây (`DELETE_WIRE`), xóa khối (`DELETE_NODE`), hoặc dọn dẹp network (`CLEAR_NETWORK`) đều phải kích hoạt bước dọn dẹp nguyên tử (atomic cascade cleanup) tương ứng trên `wireReferences`. Không bao giờ tồn tại bản ghi reference mồ côi (orphaned reference record).

- **Bất biến I2 (Thuần túy Trình diễn — Presentation-Only / Canonical Invariant):**  
  `wireReferences` là siêu dữ liệu tầng hiển thị (visual presentation metadata). Việc cắt một dây thành cặp connector (Cut) hoặc chập nối cặp connector lại thành dây vật lý (Join) tuyệt đối không thay đổi:
  1. Mô hình trừu tượng AST của bộ biên dịch IEC 61131-3.
  2. Định dạng JSON canonical của `FbdDocument` (schema v1).
  3. Thứ tự thực thi `executionOrder` của các khối.
  4. Luồng truyền dữ liệu thực tế tại runtime C++/Go trên phần cứng DDC-24.

- **Bất biến I3 (Nhận diện Tín hiệu Duy nhất & Nhất quán Phân nhánh — Signal Identity & Fan-out Consistency):**  
  Mỗi đường dây logic $w$ chỉ sở hữu tối đa một bản ghi biểu diễn cắt. Khi một cổng ra (output port) phân nhánh đến $N$ cổng vào (fan-out, $N \ge 2$), mỗi đường dây $w_1, w_2, \dots, w_N$ có thể được chuyển đổi độc lập giữa `DIRECT` và `REFERENCE`.
  Tên tín hiệu hiển thị (`signalName`) của các connector bắt nguồn từ cùng một cổng phát (source port) phải đồng nhất theo quy tắc nguồn: nếu người dùng đổi tên tín hiệu trên Source Stub hoặc trên bất kỳ Sink Stub nào trong nhóm phân nhánh, tên mới sẽ được áp dụng cho toàn bộ các stub thuộc cùng cổng phát đó.

- **Bất biến I4 (Ghép cặp Hai chiều Tuyệt đối — Bidirectional Pairing Invariant):**  
  Một dây được đánh dấu `REFERENCE` luôn ánh xạ chính xác một Source Stub tại cổng ra nguồn (`from.nodeId`, `from.portId`) và một Sink Stub tại cổng vào đích (`to.nodeId`, `to.portId`). Tuyệt đối cấm trạng thái Sink Stub chỉ về hư vô (dangling sink) hoặc Source Stub phát tín hiệu mà không có dây logic tương ứng trong canonical model.

---

### 1.2 Kiểu Dữ liệu TypeScript (TypeScript Types)

Các định nghĩa kiểu dữ liệu được đặt tại `apps/web-ui/src/features/programming/fbd/model.ts` hoặc module mở rộng `apps/web-ui/src/features/programming/fbd/wireReferenceModel.ts`:

```typescript
import type { FbdEndpoint, FbdWire } from './model'

/**
 * Chế độ hiển thị của đường dây trên Canvas:
 * - DIRECT: Dây vẽ bằng đường cong Bezier hoặc đường gấp khúc Orthogonal truyền thống.
 * - REFERENCE: Dây bị cắt thành cặp đầu cắm tham chiếu (Source Stub & Sink Stub).
 */
export type FbdWirePresentationMode = 'DIRECT' | 'REFERENCE'

/**
 * Bản ghi tham chiếu chi tiết của một dây bị cắt.
 */
export interface FbdWireReferenceItem {
  /** Định danh duy nhất của wire trong canonical document (UUID v4) */
  readonly wireId: string
  /**
   * Tên định danh tín hiệu hiển thị trên nhãn connector (ví dụ: "AI1_TEMP", "SIG_PUMP_RUN").
   * Tuân thủ quy tắc định danh IEC 61131-3 / C-identifier: [a-zA-Z_][a-zA-Z0-9_]*
   */
  readonly signalName: string
  /** Nhãn tuỳ biến người dùng chỉ định (ghi đè signalName tự động nếu có) */
  readonly customLabel?: string
  /** Thời điểm tạo (Unix timestamp milliseconds) để quản lý lịch sử và hiển thị */
  readonly createdAt: number
}

/**
 * Bảng ánh xạ tập hợp các dây đang ở chế độ Reference.
 * Khóa (key) là `wireId`.
 */
export type FbdWireReferenceMap = Readonly<Record<string, FbdWireReferenceItem>>

/**
 * Trạng thái trình diễn mở rộng cho một Network FBD.
 */
export interface FbdNetworkPresentation {
  readonly networkId: string
  readonly wireReferences: FbdWireReferenceMap
}

/**
 * Toàn bộ trạng thái trình diễn (Presentation State) của tài liệu FBD.
 */
export interface FbdDocumentPresentation {
  readonly schemaVersion: 1
  /** Map theo networkId */
  readonly networks: Readonly<Record<string, FbdNetworkPresentation>>
}
```

---

### 1.3 Reducer State, Actions & Pipeline Chuẩn hoá (Normalize)

Để đảm bảo khả năng hoàn tác/làm lại (Undo/Redo) liền mạch, `FbdDocumentPresentation` được tích hợp trực tiếp vào `FbdEditorState` tại `apps/web-ui/src/features/programming/fbd/commands.ts`.

#### Danh sách Action Types

```typescript
export type FbdReferenceAction =
  | {
      type: 'CONVERT_WIRE_TO_REFERENCE'
      networkId: string
      wireId: string
      customSignalName?: string
    }
  | {
      type: 'CONVERT_REFERENCE_TO_WIRE'
      networkId: string
      wireId: string
    }
  | {
      type: 'RENAME_REFERENCE_SIGNAL'
      networkId: string
      wireId: string
      newSignalName: string
    }
  | {
      type: 'BATCH_CUT_NODE_WIRES'
      networkId: string
      nodeId: string
      direction?: 'INPUT' | 'OUTPUT' | 'ALL'
    }
  | {
      type: 'BATCH_JOIN_NODE_WIRES'
      networkId: string
      nodeId: string
      direction?: 'INPUT' | 'OUTPUT' | 'ALL'
    }
  | {
      type: 'SET_PRESENTATION_STATE'
      presentation: FbdDocumentPresentation
    }
```

#### Thuật toán Chuẩn hoá (Normalize & Invariant Enforcement)

Mỗi khi tài liệu canonical bị thay đổi bởi các action thông thường (`DELETE_NODE`, `DELETE_WIRE`, `PASTE`, `LOAD_DOCUMENT`), reducer thực thi pipeline chuẩn hóa:

```typescript
export function normalizeWireReferences(
  wires: readonly FbdWire[],
  currentMap: FbdWireReferenceMap
): FbdWireReferenceMap {
  const activeWireIds = new Set(wires.map((w) => w.id))
  let changed = false
  const nextMap: Record<string, FbdWireReferenceItem> = {}

  for (const [wireId, item] of Object.entries(currentMap)) {
    if (activeWireIds.has(wireId)) {
      nextMap[wireId] = item
    } else {
      // Dây không còn tồn tại -> loại bỏ khỏi presentation map (bảo toàn Bất biến I1)
      changed = true
    }
  }

  return changed ? Object.freeze(nextMap) : currentMap
}
```

---

### 1.4 Quy tắc Sinh Tên Tín hiệu Mặc định (Default Signal Names)

Khi người dùng thực hiện cắt một dây mà chưa nhập nhãn tùy biến, hệ thống tự động sinh `signalName` theo thuật toán chuẩn hóa:

1. **Thu thập thông tin nguồn:**
   - Lấy tên hoặc nhãn của khối phát: $N_{source}$ (ví dụ: `TEMP_SENSOR_1`, `AND_01`).
   - Lấy tên cổng ra: $P_{source}$ (ví dụ: `OUT`, `Q`, `VAL`).
2. **Chuẩn hóa ký tự (Sanitization):**
   - Chuyển khoảng trắng và ký tự đặc biệt thành dấu gạch dưới `_`.
   - Loại bỏ ký tự không thuộc bảng mã `[a-zA-Z0-9_]`.
   - Nếu ký tự đầu là chữ số, thêm tiền tố `SIG_`.
3. **Mẫu tên (Template):**
   $$\text{BaseName} = \text{Sanitize}(N_{source}) + \text{"\_"} + \text{Sanitize}(P_{source})$$
   *Ví dụ:* `AI1_OUT`, `PID_01_CV`.
4. **Xử lý xung đột (Disambiguation):**
   Nếu $\text{BaseName}$ đã được sử dụng bởi một cổng nguồn khác trong cùng network, thêm hậu tố đếm: `AI1_OUT_1`, `AI1_OUT_2`.

---

### 1.5 Lưu trữ Cục bộ (LocalStorage Isolation: `projectId:objectId`)

Khi người dùng thao tác trong môi trường Client mà không lưu bản ghi lên đám mây, trạng thái presentation được lưu bền vững (persist) trong LocalStorage của trình duyệt.

- **Cấu trúc Khóa (Key Schema):**
  $$\text{StorageKey} = \text{"fbd:ref:"} + \text{encodeURIComponent}(projectId) + \text{":"} + \text{encodeURIComponent}(objectId)$$
  Trong đó:
  - `projectId`: Mã dự án hiện hành (hoặc `"default"` nếu offline/standalone).
  - `objectId`: Định danh POU hoặc Functional Block Document đang mở.
- **Xử lý Lỗi Quota Exceeded:**
  Khi trình duyệt báo lỗi `QuotaExceededError`, hệ thống bắt ngoại lệ, ghi log cảnh báo và giữ trạng thái trên bộ nhớ in-memory của phiên làm việc hiện tại mà không làm sập ứng dụng.

---

### 1.6 Vỏ Bọc Sao lưu & Phục hồi (Backup Wrapper Envelope)

Để bảo toàn tương thích ngược 100% với backend runtime C++ và các công cụ chỉ hiểu canonical schema v1, định dạng lưu file `.fbd.json` được thiết kế theo mô hình vỏ bọc Envelope:

```json
{
  "$schema": "https://schemas.mekong-ddc.vn/fbd/envelope/v1.json",
  "envelopeVersion": 1,
  "canonicalDocument": {
    "schemaVersion": 1,
    "profileId": "PGM02_DDC24",
    "networks": [
      {
        "id": "net_001",
        "nodes": [ ... ],
        "wires": [
          {
            "id": "wire_abc_123",
            "from": { "nodeId": "node_1", "portId": "out_0" },
            "to": { "nodeId": "node_2", "portId": "in_0" }
          }
        ]
      }
    ]
  },
  "presentation": {
    "schemaVersion": 1,
    "networks": {
      "net_001": {
        "networkId": "net_001",
        "wireReferences": {
          "wire_abc_123": {
            "wireId": "wire_abc_123",
            "signalName": "SENSOR_VAL",
            "createdAt": 1774320000000
          }
        }
      }
    }
  }
}
```

*Nguyên tắc nạp (Import Rule):* Nếu file nạp vào là canonical JSON thuần (không có trường `presentation`), parser tự động gán `wireReferences = {}` (toàn bộ dây hiển thị ở chế độ `DIRECT`). Nếu file có chứa vỏ bọc `presentation`, dữ liệu hiển thị được khôi phục nguyên vẹn.

---

## Phần 2: Công thức Toạ độ Hình học SVG

### 2.1 Bảng Hằng số Hình học Không gian (Geometry Constants)

Các hằng số sau được định nghĩa tại `apps/web-ui/src/features/programming/fbd/geometry.ts`:

| Ký hiệu Hằng số | Giá trị | Ý nghĩa & Mô tả chức năng |
|---|---|---|
| `FBD_REF_STUB_WIDTH` | `96 px` | Độ rộng cơ bản của thẻ nhãn tham chiếu (chứa text signal name) |
| `FBD_REF_STUB_HEIGHT` | `20 px` | Chiều cao của thẻ nhãn tham chiếu (tương thích hàng port 22px) |
| `FBD_REF_CHEVRON_ARROW` | `6 px` | Độ sâu/vát của mũi tên điều hướng dạng chevron |
| `FBD_REF_PORT_GAP` | `8 px` | Khoảng cách an toàn từ tâm điểm cổng (port anchor) tới cạnh đầu tiên của stub |
| `FBD_REF_CORNER_RADIUS`| `4 px` | Bán kính bo góc thẻ SVG |
| `FBD_REF_STUB_STACK_GAP`| `4 px` | Khoảng cách dãn dòng khi xếp chồng nhiều sink stub trên cùng 1 port |
| `FBD_REF_MAX_LABEL_LEN` | `14 chars` | Ngưỡng ký tự hiển thị trước khi cắt elision (`...`) |
| `FBD_REF_HIT_PADDING` | `4 px` | Vùng đệm mở rộng bắt sự kiện chuột xung quanh thẻ SVG |

---

### 2.2 Điểm Neo Cổng (Port Anchors)

Cho một cổng $P$ nằm trên khối $N$, tọa độ tâm thực tế $(C_x, C_y)$ trên canvas được tính toán từ `FbdNodeGeometry`:
- Với cổng xuất (`OUTPUT`):  
  $$C_x = N.x + N.width,\quad C_y = N.y + \text{FBD\_NODE\_HEADER\_HEIGHT} + (P.order \times \text{FBD\_PORT\_ROW\_HEIGHT}) + \frac{\text{FBD\_PORT\_ROW\_HEIGHT}}{2}$$
- Với cổng nhập (`INPUT`):  
  $$C_x = N.x,\quad C_y = N.y + \text{FBD\_NODE\_HEADER\_HEIGHT} + (P.order \times \text{FBD\_PORT\_ROW\_HEIGHT}) + \frac{\text{FBD\_PORT\_ROW\_HEIGHT}}{2}$$

---

### 2.3 Source Full Cut Stub (Cắt Toàn phần Đầu phát)

Khi toàn bộ các dây xuất phát từ cổng `OUTPUT` $(C_x, C_y)$ đều ở chế độ `REFERENCE`, cổng chỉ render một **Source Tag** duy nhất hướng mũi tên sang phải (chỉ hướng phát tín hiệu ra ngoài).

#### Tọa độ Khung bao (Bounding Box)
- Điểm bắt đầu bên trái: $X_{start} = C_x + \text{FBD\_REF\_PORT\_GAP}$
- Chiều rộng tổng thể: $W = \text{FBD\_REF\_STUB\_WIDTH}$
- Tọa độ đỉnh trên: $Y_{top} = C_y - \frac{\text{FBD\_REF\_STUB\_HEIGHT}}{2}$
- Chiều cao: $H = \text{FBD\_REF\_STUB\_HEIGHT}$
- Độ vát mũi tên: $A = \text{FBD\_REF\_CHEVRON\_ARROW}$

#### Đường dẫn SVG (SVG Path Data)
Đầu phát có hình chữ nhật bo góc bên trái và vát nhọn hình mũi tên ở cạnh phải:

$$\begin{aligned}
\text{pathData} = &\ M\ (X_{start}),\ (Y_{top}) \\
&\ L\ (X_{start} + W - A),\ (Y_{top}) \\
&\ L\ (X_{start} + W),\ (C_y) \\
&\ L\ (X_{start} + W - A),\ (Y_{top} + H) \\
&\ L\ (X_{start}),\ (Y_{top} + H) \\
&\ Z
\end{aligned}$$

Nối giữa tâm port $(C_x, C_y)$ và cạnh trái stub $(X_{start}, C_y)$ là một đoạn thẳng neo nhỏ (stub neck line):
$$M\ (C_x),\ (C_y)\ L\ (X_{start}),\ (C_y)$$

Nếu có $k$ dây cùng phát ra từ cổng này (fan-out $k > 1$), một **Badge số đếm** có đường kính $14\text{px}$ được vẽ tại $(X_{start} + W + 2,\ C_y)$, hiển thị text `[k]`.

---

### 2.4 Source Partial Cut Stub (Cắt Phân nhánh Một phần)

Trường hợp cổng `OUTPUT` có $M$ dây nối, trong đó $M_{direct} \ge 1$ dây giữ kết nối `DIRECT` và $M_{ref} \ge 1$ dây chuyển sang `REFERENCE`:

1. **Dây Direct:** Render đường dẫn Bezier / Orthogonal thông thường xuất phát từ điểm neo chuẩn $(C_x, C_y)$.
2. **Dây Reference:** Để tránh đè hình lên đường dây Direct, Source Reference Stub được dịch chuyển tọa độ:
   - Dịch chuyển theo trục Y một khoảng lệch an toàn:
     $$Y_{top\_partial} = C_y - \frac{H}{2} - 18\text{px}$$
   - Hoặc ghim thẻ badge dạng thu nhỏ ngay cạnh cổ dây xuất phát với kích thước compact ($W = 64\text{px}, H = 16\text{px}$).

---

### 2.5 Destination Sink Stub (Đầu thu Mũi tên Chevron)

Cổng `INPUT` tại $(C_x, C_y)$ nhận tín hiệu tham chiếu. Thẻ Sink Stub nằm phía bên trái của cổng, có hình mũi tên vát lõm/nhọn hướng vào cổng (`-X` sang `+X`).

#### Tọa độ Khung bao
- Điểm kết thúc bên phải: $X_{end} = C_x - \text{FBD\_REF\_PORT\_GAP}$
- Điểm bắt đầu bên trái: $X_{start} = X_{end} - \text{FBD\_REF\_STUB\_WIDTH}$
- Tọa độ đỉnh trên: $Y_{top} = C_y - \frac{\text{FBD\_REF\_STUB\_HEIGHT}}{2}$
- Chiều cao: $H = \text{FBD\_REF\_STUB\_HEIGHT}$
- Độ vát nhọn mũi tên: $A = \text{FBD\_REF\_CHEVRON\_ARROW}$

#### Đường dẫn SVG (Sink Chevron Path)
Cạnh phải của stub vát nhọn chĩa vào cổng đích; cạnh trái lõm cùng góc để tạo cảm giác mũi tên dòng chảy:

$$\begin{aligned}
\text{pathData} = &\ M\ (X_{start}),\ (Y_{top}) \\
&\ L\ (X_{end} - A),\ (Y_{top}) \\
&\ L\ (X_{end}),\ (C_y) \\
&\ L\ (X_{end} - A),\ (Y_{top} + H) \\
&\ L\ (X_{start}),\ (Y_{top} + H) \\
&\ L\ (X_{start} + A),\ (C_y) \\
&\ Z
\end{aligned}$$

Đoạn thẳng neo kết nối vào cổng đích:
$$M\ (X_{end}),\ (C_y)\ L\ (C_x),\ (C_y)$$

---

### 2.6 Thuật toán Tránh Va chạm & Cắt tỉa Vật cản (Obstacle Clipping)

Khi không gian giữa 2 block quá hẹp (ví dụ khoảng cách giữa 2 cột khối nhỏ hơn $W + 2 \times \text{GAP}$):
1. **Kiểm tra va chạm:** Tính toán khoảng cách $\Delta X = N_{dest}.x - (N_{source}.x + N_{source}.width)$.
2. **Thu nhỏ linh hoạt (Auto-collapse):** Nếu $\Delta X < 120\text{px}$, chiều rộng stub tự động co lại thành $W_{collapsed} = \max(48\text{px}, \Delta X - 24\text{px})$.
3. Nhãn chữ dài được cắt gọn bằng SVG `<text text-overflow="ellipsis">` kèm tooltip khi hover.

---

### 2.7 Tọa độ Tích hợp Runtime Value Chip (SIMULATE/LIVE Mode)

Khi FBD Editor chuyển sang chế độ Online Monitor (SIMULATE hoặc LIVE), giá trị runtime thời gian thực của tín hiệu (ví dụ: `24.5`, `TRUE`, `400`) cần được hiển thị đồng thời mà không che mất nhãn connector.

- **Vị trí Value Chip trên Source Stub:**
  Ghim phía trên thân stub: tâm Chip đặt tại $(X_{start} + \frac{W}{2},\ Y_{top} - 8\text{px})$. Kích thước Chip: $H = 14\text{px}$, bo tròn dạng viên thuốc (pill badge).
- **Vị trí Value Chip trên Sink Stub:**
  Ghim phía trên thân Sink stub: tâm Chip đặt tại $(X_{start} + \frac{W}{2},\ Y_{top} - 8\text{px})$.
- Màu sắc hiển thị tuân thủ bảng màu runtime: xanh lá (`#22c55e`) cho kiểu BOOLEAN TRUE, xám cho FALSE, xanh cyan (`#06b6d4`) cho số thực/nguyên.

---

## Phần 3: Luồng Tương tác Người dùng Chi tiết

### 3.1 Trình đơn Ngữ cảnh (Context Menu Matrix)

Hệ thống bổ sung các mục lệnh xử lý Reference vào menu chuột phải (Right-Click Context Menu) trên Canvas:

| Vùng kích hoạt (Target) | Mục menu (Menu Item) | Phím tắt | Điều kiện khả dụng | Hành động thực hiện |
|---|---|---|---|---|
| **Trên đường dây (Wire)** | Chuyển thành Tham chiếu (Cut to Reference) | `Alt + C` | Dây đang là `DIRECT` | Phát action `CONVERT_WIRE_TO_REFERENCE` |
| **Trên đường dây (Wire)** | Xóa dây | `Delete` | Luôn bật | Xóa canonical wire & dọn reference |
| **Trên Sink Stub** | Nối lại thành Dây (Join to Wire) | `Alt + J` | Đang là `REFERENCE` | Phát action `CONVERT_REFERENCE_TO_WIRE` |
| **Trên Sink Stub** | Đi tới Khối phát (Go to Source) | `F4` hoặc `DblClick` | Khối nguồn tồn tại | Di chuyển viewport tới Source Block |
| **Trên Sink Stub** | Đổi tên Tín hiệu (Rename Signal) | `F2` | Không ở mode Read-only | Kích hoạt Inline Rename Input |
| **Trên Source Stub** | Nối lại Toàn bộ (Join All Wires) | `Alt + Shift + J` | Có $\ge 1$ dây cắt | Chuyển tất cả dây của cổng về `DIRECT` |
| **Trên Source Stub** | Danh sách Khối nhận (List Sinks) | — | Có $\ge 1$ dây cắt | Mở popup danh sách đích để chọn nhảy |
| **Trên Cổng Block (Port)**| Cắt toàn bộ dây của Cổng | — | Cổng có kết nối | Cắt hàng loạt dây của cổng |

---

### 3.2 Điều hướng Đối tác & Nhấp đúp (Partner Navigation)

Nhằm giúp kỹ sư theo dõi luồng dữ liệu trên các sơ đồ lớn mà không bị mất phương hướng:

1. **Thao tác Nhấp đúp (Double-Click):**
   - Khi người dùng nhấp đúp chuột trái vào **Sink Stub**, Canvas thực hiện hoạt ảnh mượt mà (smooth pan & zoom transition) đưa khối nguồn chứa **Source Stub** vào trọng tâm màn hình.
   - Khi nhấp đúp vào **Source Stub**:
     - Nếu chỉ có 1 Sink: Tự động cuộn đến Sink tương ứng.
     - Nếu có nhiều Sink (Fan-out): Mở danh sách thả nổi (Flyout Target Menu) liệt kê các khối đích (`Block Name: Port Name`). Bấm vào dòng nào, màn hình sẽ nhảy tới khối đó.
2. **Hiệu ứng Nhấn mạnh Điểm đến (Pulse Highlight Animation):**
   Sau khi hoàn tất dịch chuyển màn hình, đối tác đích được phát hiệu ứng sóng tròn lan tỏa (Pulse Halo / Radar ping) trong thời gian $1.2\text{s}$ với màu xanh lam đậm (`rgba(59, 130, 246, 0.6)`), giúp mắt người định vị tức thì điểm nối.

---

### 3.3 Xem nhanh Dây Tạm thời (Peek Wire Nét đứt khi Hover)

Để người dùng kiểm tra nhanh đường đi vật lý của tín hiệu mà không cần bấm hoàn tác cắt dây:

- **Sự kiện Kích hoạt:** Di chuột (`onPointerEnter`) vào thân thẻ Source Stub hoặc Sink Stub.
- **Hành vi Biểu diễn:**
  - Canvas tạm thời vẽ đè một đường dây nét đứt ảo (Ghost Wire) kết nối trực tiếp giữa Source Port và Sink Port.
  - Thuộc tính đồ họa SVG:
    - `stroke`: Màu vàng hổ phách (`#f59e0b`) hoặc cam (`#f97316`).
    - `stroke-dasharray`: `6 4`.
    - `stroke-width`: `2 px`.
    - `animation`: Chuyển động chạy dòng điện nét đứt (`stroke-dashoffset` giảm dần) với chu kỳ $0.8\text{s}$.
- **Sự kiện Kết thúc:** Rời chuột (`onPointerLeave`) khỏi stub -> đường nét đứt biến mất ngay lập tức.

---

### 3.4 Máy Trạng thái Đổi tên Trực tiếp (Inline Rename State Machine)

Việc đổi tên tín hiệu được quản lý bằng State Machine chặt chẽ:

```
[IDLE] 
  │  (Double click vào chữ hoặc nhấn F2 khi đang chọn Stub)
  ▼
[EDITING] ──(Gõ phím)──> Cập nhật giá trị đệm (Local Buffer)
  │
  ├─── Nhấn Enter / Blur ───> [VALIDATING]
  │                             │
  │                             ├── Hợp lệ ──────> [COMMITTED] ──> Trả về [IDLE]
  │                             └── Không hợp lệ ─> [ERROR_TOOLTIP] (Giữ focus)
  │
  └─── Nhấn Escape ─────────> [CANCELLED] ───────────────────────> Trả về [IDLE]
```

- **Quy tắc Kiểm tra Hợp lệ (Validation Rules):**
  1. Độ dài từ 1 đến 32 ký tự.
  2. Bắt đầu bằng chữ cái hoặc dấu gạch dưới, không chứa ký tự toán tử `+ - * / % & | ^ ! ~`.
  3. Không trùng với các từ khóa dành riêng của chuẩn IEC 61131-3 (`VAR`, `END_VAR`, `PROGRAM`, `FUNCTION_BLOCK`, `IF`, `THEN`).

---

### 3.5 Cơ chế Dọn dẹp Rác & Khối Treo (Dangling Cleanup)

- Khi một khối bị xóa (`DELETE_NODE`):
  1. Canonical reducer tự động xóa tất cả các dây gắn vào khối đó.
  2. Middleware chuẩn hóa `normalizeWireReferences` quét và xóa sạch mọi bản ghi reference liên quan.
  3. Không có bất kỳ thành phần đồ họa mồ côi nào còn tồn tại trên DOM tree.
- Khi người dùng tách dây hoặc thay đổi đích nối: Dây cũ bị hủy thì reference bị hủy; dây mới tạo mặc định ở trạng thái `DIRECT`.

---

### 3.6 Khả năng Tiếp cận & Điều hướng Bàn phím (Accessibility & Keyboard)

Tuân thủ WCAG 2.2 và tiêu chuẩn công nghiệp:
- **ARIA Roles & Labels:**
  Mỗi thẻ connector được gắn:
  ```html
  <g role="button"
     tabindex="0"
     aria-label="Tín hiệu tham chiếu AI1_OUT từ Cảm biến Nhiệt độ đến Bộ so sánh"
     aria-haspopup="menu">
  ```
- **Phím tắt Bàn phím (Keyboard Shortcuts):**
  - `Tab` / `Shift + Tab`: Di chuyển tiêu điểm tuần tự giữa các Block, Port và Reference Connector.
  - `Enter`: Kích hoạt nhảy đến đối tác (Jump to Partner).
  - `Space` hoặc `Shift + F10`: Mở trình đơn ngữ cảnh tại vị trí stub.
  - `F2`: Mở chế độ chỉnh sửa tên inline.
  - `Escape`: Đóng menu / Hủy sửa tên.
- **Phản hồi Trình đọc Màn hình (Screen Reader Announcements):**
  Sử dụng `translateFbdAnnouncement` để phát âm thanh trạng thái:
  - *"Đã chuyển dây thành tham chiếu tín hiệu AI1_OUT"*.
  - *"Đã nhảy tới khối nguồn TEMP_SENSOR_1"*.

---

## Phần 4: Ma trận Kiểm thử Tự động

Hệ thống kiểm thử được chia thành 6 module nghiêm ngặt với độ phủ mục tiêu $\ge 85\%$:

### 4.1 Module M: Model & Invariants

| Mã Test | Mô tả Ca kiểm thử | Điều kiện Đầu vào | Kết quả Kỳ vọng |
|---|---|---|---|
| `TEST-M-001` | Bảo toàn Bất biến I1 khi tạo reference | Wire hợp lệ `wire_1` | `wireReferences['wire_1']` tồn tại, trỏ đúng ID |
| `TEST-M-002` | Từ chối tạo reference cho wire không tồn tại | Khởi tạo với ID `wire_fake` | Ném ngoại lệ hoặc không ghi vào map |
| `TEST-M-003` | Kiểm tra Bất biến I2 (Canonical Document) | Chuyển 5 dây thành reference | Canonical JSON giữ nguyên 100% hash |
| `TEST-M-004` | Sinh tên tín hiệu tự động chuẩn C-identifier | Khối `Temp Sensor #1`, Cổng `Out 1` | Sinh tên `Temp_Sensor_1_Out_1` |
| `TEST-M-005` | Tự động thêm hậu tố khi xung đột tên | Hai cổng cùng tên trong 1 mạng | Tên thứ hai tự động thêm hậu tố `_1` |

---

### 4.2 Module R: Reducer, Action & Undo/Redo

| Mã Test | Mô tả Ca kiểm thử | Trình tự Thao tác | Kết quả Kỳ vọng |
|---|---|---|---|
| `TEST-R-001` | Cắt dây thành reference (`CONVERT_WIRE_TO_REF`) | Dispatch action trên `wire_1` | State có 1 ref; wire trong canonical không đổi |
| `TEST-R-002` | Nối lại dây (`CONVERT_REF_TO_WIRE`) | Dispatch action hoàn tác cắt | Map rỗng; dây trở lại chế độ vẽ DIRECT |
| `TEST-R-003` | Hoàn tác / Làm lại (Undo/Redo Stack) | Cắt dây -> Undo -> Redo | Trạng thái visual đồng bộ chính xác với lịch sử |
| `TEST-R-004` | Tự động dọn rác khi xóa khối nguồn | Cắt dây -> Xóa Source Node | Wire bị xóa, reference map tự động dọn sạch |
| `TEST-R-005` | Cắt hàng loạt dây của Node (Batch Cut) | Dispatch `BATCH_CUT_NODE_WIRES` | Tất cả dây gắn vào node đồng loạt chuyển sang ref |

---

### 4.3 Module G: Geometry & SVG Paths

| Mã Test | Mô tả Ca kiểm thử | Thông số Đầu vào | Kết quả Kỳ vọng |
|---|---|---|---|
| `TEST-G-001` | Tính toán Tọa độ Source Stub Anchor | Port `OUTPUT` tại $(200, 100)$ | $X_{start} = 208$, $Y_{top} = 90$, chiều dài $96$ |
| `TEST-G-002` | Tính toán Tọa độ Sink Stub Chevron | Port `INPUT` tại $(400, 100)$ | $X_{end} = 392$, vát nhọn chĩa về toạ độ $(392, 100)$ |
| `TEST-G-003` | Xử lý chống va chạm khi khoảng cách hẹp | Hai khối cách nhau $80\text{px}$ | Stub tự động co độ rộng về $56\text{px}$ |
| `TEST-G-004` | Vị trí Value Chip trực tuyến | Stub tại $(208, 90)$ | Tọa độ tâm Chip tại $(256, 82)$ không đè nhãn chữ |

---

### 4.4 Module C: Canvas Interactions & Shortcuts

| Mã Test | Mô tả Ca kiểm thử | Hành vi Tương tác | Kết quả Kỳ vọng |
|---|---|---|---|
| `TEST-C-001` | Bật Peek Wire nét đứt khi hover | `pointerEnter` vào Source Stub | Xuất hiện đường `<path>` nét đứt với class `peek-wire` |
| `TEST-C-002` | Tắt Peek Wire khi rời chuột | `pointerLeave` khỏi Stub | Thẻ `<path>` nét đứt bị gỡ bỏ khỏi DOM |
| `TEST-C-003` | Kích hoạt Inline Rename bằng phím `F2` | Chọn Stub -> Nhấn phím `F2` | Input xuất hiện tại đúng tọa độ hộp nhãn |
| `TEST-C-004` | Huỷ đổi tên bằng phím `Escape` | Nhập chữ dở dang -> Bấm `Esc` | Nhãn giữ nguyên tên cũ; input đóng lại |
| `TEST-C-005` | Điều hướng bằng phím `Tab` | Nhấn `Tab` liên tục | Vòng focus chuyển qua lại giữa các connector |

---

### 4.5 Module E & B: Storage Isolation & Backup Envelope

| Mã Test | Mô tả Ca kiểm thử | Kịch bản Thực thi | Kết quả Kỳ vọng |
|---|---|---|---|
| `TEST-E-001` | Cách ly LocalStorage theo Project & Object | Lưu POU1 của ProjA và POU1 ProjB | Khóa storage riêng biệt, không ghi đè nhau |
| `TEST-E-002` | Kháng lỗi QuotaExceeded trong LocalStorage | Mock `setItem` ném lỗi Quota | Ứng dụng không crash, tiếp tục chạy trên RAM |
| `TEST-B-001` | Xuất file Envelope Backup trọn vẹn | Export tài liệu có 3 reference | File JSON chứa đầy đủ vỏ bọc và canonical data |
| `TEST-B-002` | Nhập file canonical cũ (Backward Compat) | Import file JSON schema v1 thuần | Nạp thành công, toàn bộ dây hiển thị DIRECT |

---

### 4.6 Module X: E2E Playwright Integration

Bộ test tích hợp chạy trên trình duyệt thực (`e2e/fbd-reference-connector.spec.ts`):

- **Kịch bản Kép Toàn diện (Full Lifecycle Journey):**
  1. Mở POU FBD, kéo 2 khối `AI_TEMP` và `PID_CONTROL` vào canvas.
  2. Nối dây giữa cổng `OUT` của `AI_TEMP` và cổng `IN` của `PID_CONTROL`.
  3. Mở Context Menu trên đường dây -> Chọn *"Chuyển thành Tham chiếu"*.
  4. Xác nhận dây biến mất, xuất hiện 1 Source Stub bên phải `AI_TEMP` và 1 Sink Stub bên trái `PID_CONTROL`.
  5. Rê chuột lên Sink Stub -> Xác nhận đường nét đứt Peek Wire hiện lên nối về Source Stub.
  6. Nhấp đúp vào Sink Stub -> Xác nhận màn hình pan mượt về vị trí khối `AI_TEMP`.
  7. Nhấn `F2` trên Source Stub -> Nhập tên `ZONE1_ROOM_TEMP` -> Nhấn `Enter`.
  8. Xác nhận cả Source Stub và Sink Stub cùng đổi sang nhãn `ZONE1_ROOM_TEMP`.
  9. Tải lại trang (F5 reload) -> Xác nhận trạng thái tham chiếu được khôi phục nguyên vẹn từ bộ nhớ.
  10. Chuột phải vào Sink Stub -> Chọn *"Nối lại thành Dây"* -> Xác nhận dây vật lý xuất hiện lại.

---

## Phần 5: Thứ tự Triển khai (5 Phase Roadmap)

```
[Phase 1: Foundation]
  ├── Model Types & Invariants I1-I4 Validator
  ├── Presentation Reducer Actions & Normalizer
  └── Unit Tests Module M & Module R
         │
         ▼
[Phase 2: Geometry Engine & SVG Rendering]
  ├── Hằng số hình học & Math Formulas (Stub, Chevron)
  ├── SVG Components: FbdSourceStub, FbdSinkStub, ValueChip
  └── Unit Tests Module G
         │
         ▼
[Phase 3: Interactive Features & Context Menu]
  ├── Context Menu Options (Cut, Join, Rename)
  ├── Double-Click Partner Navigation & Pulse Highlight
  ├── Hover Peek Wire (Animated SVG dashed stroke)
  └── Inline Rename State Machine & Shortcuts
         │
         ▼
[Phase 4: Persistence, Backup Envelope & A11y]
  ├── LocalStorage Storage Layer (projectId:objectId Isolation)
  ├── Backup Envelope Import/Export Adapter
  ├── Keyboard Accessibility (Tab, Enter, F2, Esc) & ARIA Labels
  └── Unit Tests Module E, Module B, Module C
         │
         ▼
[Phase 5: Verification & E2E Polish]
  ├── Playwright E2E Suite (Module X)
  ├── Benchmark hiệu năng: 256 Nodes / 512 Wires (60fps render)
  └── Cập nhật CHANGELOG.md & Tài liệu hướng dẫn sử dụng
```

### Chi tiết Từng Giai đoạn

#### Giai đoạn 1: Foundation (Nền tảng Dữ liệu & Reducer)
- **Mục tiêu:** Xây dựng mô hình dữ liệu sạch, đảm bảo không phá vỡ canonical schema v1 và duy trì đầy đủ tính đúng đắn của 4 Bất biến I1 - I4.
- **File tác động:**
  - Tạo mới: `apps/web-ui/src/features/programming/fbd/wireReferenceModel.ts`
  - Chỉnh sửa: `apps/web-ui/src/features/programming/fbd/commands.ts` (thêm actions, tích hợp vào reducer và undo/redo history stack)
- **Tiêu chí Hoàn thành:** Toàn bộ unit test Module M và Module R chạy qua (`vitest`).

#### Giai đoạn 2: Geometry Engine & SVG Rendering (Toạ độ & Hiển thị SVG)
- **Mục tiêu:** Tính toán chuẩn xác toạ độ đồ họa, đường cắt tỉa mũi tên chevron, và render các stub lên canvas.
- **File tác động:**
  - Chỉnh sửa: `apps/web-ui/src/features/programming/fbd/geometry.ts` (thêm hàm tính toạ độ stub và clipping)
  - Tạo mới: `apps/web-ui/src/features/programming/fbd/components/FbdReferenceConnector.tsx`
  - Chỉnh sửa: `apps/web-ui/src/features/programming/fbd/FbdCanvasLayers.tsx` (tích hợp render lớp connector)
- **Tiêu chí Hoàn thành:** Unit test Module G đạt $100\%$ pass. Các connector hiển thị sắc nét, đúng kích thước, không lệch pixel.

#### Giai đoạn 3: Interactive Features & UX (Tương tác Người dùng)
- **Mục tiêu:** Hiện thực hóa toàn bộ trải nghiệm người dùng theo bản vẽ: chuột phải cắt/nối, rê chuột xem dây nét đứt, nhấp đúp nhảy view và đổi tên trực tiếp.
- **File tác động:**
  - Chỉnh sửa: `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx`
  - Chỉnh sửa: `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx`
- **Tiêu chí Hoàn thành:** Kỹ sư có thể thao tác cắt/nối mượt mà bằng chuột và phím; hiệu ứng nhảy đối tác hoạt động chính xác.

#### Giai đoạn 4: Persistence, Backup Envelope & A11y (Lưu trữ & Phím tắt)
- **Mục tiêu:** Lưu trữ an toàn trên máy trạm, đảm bảo import/export file backup không làm mất dữ liệu và tuân thủ tiêu chuẩn tiếp cận tiếp cận WCAG.
- **File tác động:**
  - Tạo mới: `apps/web-ui/src/features/programming/fbd/wireReferenceStorage.ts`
  - Chỉnh sửa: `apps/web-ui/src/features/programming/fbd/announcements.ts`
  - Chỉnh sửa logic Import/Export JSON POU
- **Tiêu chí Hoàn thành:** Unit test Module E, B, C hoàn thành đạt chuẩn.

#### Giai đoạn 5: Verification & Polish (Kiểm chứng & Tối ưu Hoá)
- **Mục tiêu:** Chạy bộ test Playwright E2E mô phỏng hành vi người dùng thực tế; benchmark tải với đồ thị 256 block / 512 kết nối.
- **File tác động:**
  - Tạo mới: `apps/web-ui/e2e/fbd-reference-connector.spec.ts`
  - Cập nhật `CHANGELOG.md`
- **Tiêu chí Hoàn thành:** Pipeline CI chạy xanh toàn bộ (`build`, `lint`, `vitest`, `playwright`).
