# Báo cáo hiện trạng và đề xuất đại tu Program Property / Inspector

**ID:** `REC-PGM02-PROP-INS-001`
**Ngày rà soát:** 2026-09-09
**Baseline source:** `34483c9821837efd1f58cf5aa5a508f53d9b20f9`
**Trạng thái:** **PARTIAL / CHƯA MATCH `d.md` / READY FOR CONTROLLED PLANNING**
**Phạm vi:** Property của POU đang chọn, trọng tâm `PROGRAM`, và
`ContextInspector` trên PGM-02; truy vết FE → web-api → Core/FW-SOM khi có liên
quan.
**Ngoài phạm vi:** sửa mã nguồn, đổi runtime semantics, commission/deploy,
physical HIL và kết luận `RELEASE_READY`.

> Đây là review record theo source tại ngày ghi ở trên, không phải Detailed
> Design và không tự thay đổi authority sản phẩm. Khi triển khai phải chuyển các
> quyết định đã chốt thành hồ sơ thiết kế/Issue có acceptance và test trace.

---

## 1. Kết luận điều hành

**Kết luận ngắn:** phần Inspector hiện tại **chưa đúng đầy đủ yêu cầu trong
[`d.md`](../../../d.md)**. Nó đã có nền context-sensitive và trình bày trung thực
`không xác định được`, nhưng phần Program Property mới ở mức **form metadata cơ
bản + các section khung**.

Hai baseline phải được tách rõ:

| Baseline | Kết luận |
|---|---|
| FE Handoff PGM-02 §9 đang được đăng ký làm authority trực quan | **Đạt một phần đáng kể**: có context Program/ST symbol/FBD block/Connection, có Name/Language/Cycle/Description và tự thu gọn khi rỗng. Chưa hoàn tất Enable, Advanced Execution và Variable context độc lập. |
| Đề bài mở rộng `d.md` G-12..G-21 | **Không đạt**: Interface chưa sửa được; Initial/Retain/Description chưa có dữ liệu; Task/Enable chưa nối; Namespace/Attributes/DDC Metadata/Calls chưa có contract; References chưa điều hướng; language lifecycle chưa có. |

Không được dùng 13 dấu `✓` trong Definition of Done của `d.md` làm bằng chứng
hoàn tất: ngay cuối cùng file vẫn còn danh sách “viết/mount/test/install/E2E/merge”.
Đó là mâu thuẫn nội bộ của tài liệu yêu cầu, không phải bằng chứng As-Built.

### Phán quyết theo tầng

| Tầng | Hiện trạng | Đề xuất |
|---|---|---|
| FE | Có nền tốt nhưng Property bị lặp, nhiều section chỉ là placeholder, model ngữ cảnh chưa đủ và một số thông tin đã lỗi thời | Đại tu chính nằm ở FE: một view-model Property có nguồn rõ ràng, một bề mặt sửa duy nhất, trạng thái `known/unavailable/not-applicable/error`, bố cục responsive đúng handoff |
| web-api | Đã đủ cho Name/Kind/Language/source, Description/Access annotation, chu kỳ và read-back Enable/runtime; chưa có schema cho Namespace/IEC Attributes/DDC Metadata cấp Program | Tận dụng contract có sẵn trước; chỉ mở rộng schema sau khi chốt ownership và semantics, không tạo API song song |
| Core/FW-SOM | Đã có scheduler/profile, runtime read-back, priority arbitration và watchdog độc lập | **Không cần đổi** cho đợt Property cơ bản. Priority 5 và watchdog nên là policy read-only; chỉ đổi Core/FW-SOM nếu Product phê duyệt semantics lập lịch mới |
| STM32/I/O firmware | Không sở hữu metadata/Inspector | **Không đổi** |

---

## 2. Nguồn và giới hạn bằng chứng

### 2.1 Authority và đầu vào

- Yêu cầu làm việc: [`d.md`](../../../d.md), trọng tâm G-12..G-21.
- Authority trực quan đã đăng ký: [PGM-02 Programs FE Handoff v2.2](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md),
  đặc biệt §4 responsive và §9 Shared Inspector.
- Source FE: [`EditorPane.tsx`](../../../apps/web-ui/src/features/programming/design/editor/EditorPane.tsx),
  [`ContextInspector.tsx`](../../../apps/web-ui/src/features/programming/design/inspector/ContextInspector.tsx),
  các section Inspector và Draft adapter.
- Source BE: [`draft_v2.go`](../../../apps/web-api/internal/programming/application/draft_v2.go),
  [`checks.go`](../../../apps/web-api/internal/programming/application/checks.go),
  [`programs.go`](../../../apps/web-api/internal/programming/application/programs.go).
- Source Core: [`priority_resolver.hpp`](../../../apps/core/domain/priority/priority_resolver.hpp),
  [`st_process_image.cpp`](../../../apps/core/application/st/st_process_image.cpp), và
  [Programming Control Semantics](../../02_design/software/PROGRAMMING_CONTROL_SEMANTICS.md).

### 2.2 Snapshot giao diện do người dùng cung cấp

Snapshot DOM `pasted-text.txt` có `25.156` byte, SHA-256
`3e16529aac59e1e0d7fc99fda7a96753eb5960149332908d3783384c26c62507`.
Nó xác nhận trên một Program `RelayPattern32`:

- cùng lúc có `POU properties` và `General`, lặp Name/Kind/Access/Description;
- `IEC interface (32)` có dữ liệu Name/Direction/Type nhưng ba cột
  Initial/Retain/Description đều `not determinable`;
- Resource/Task/Mode/Priority/Watchdog đều `not determinable`, chỉ Interval `1 s`
  và Desired state có giá trị;
- IEC Attributes, DDC Metadata và Calls chưa có dữ liệu;
- toàn snapshot có **117** lần `not determinable`.

Snapshot DOM là bằng chứng bổ sung về markup đã render, **không** chứng minh
Console sạch, Network thành công, responsive đúng hay runtime/target/HIL.

### 2.3 Mức kiểm chứng

| Hạng mục | Kết quả |
|---|---|
| Source/contract audit | Đã thực hiện trên baseline nêu trên |
| Vitest Inspector/Draft adapter/workspace | **6 file / 98 test PASS** |
| Chrome DevTools MCP | Server đã cấu hình nhưng tool không khả dụng trong phiên này; **NOT RUN** |
| Browser desktop/mobile thật | **NOT RUN**; snapshot DOM do người dùng cung cấp không thay thế bước này |
| web-api/Core test toàn module | **NOT RUN** vì phiên này chỉ tạo review record, không thay code/runtime |
| Target/FakeMCU/physical HIL | **NOT RUN / không claim** |

---

## 3. Hiện trạng As-Built của Program Property

### 3.1 Luồng dữ liệu hiện tại

```text
Draft v2 objects[] / programs[]
        │
        ├─ draftV2.ts ──> ProgrammingProgram ──> ProgramInspector (sửa)
        │                                      └─ ContextInspector (đọc)
        │
        ├─ source buffer ST ──> regex/index FE ──> Interface + ST symbol
        │
        └─ GET /projects/{id}/programs ──> Context strip/Overview
                                         └─ CHƯA nối vào Program Inspector
```

`ProgramsTab.tsx` hiện chỉ là facade re-export `EditorPane`; ownership thật của
Property vẫn nằm trong `EditorPane.tsx`.

### 3.2 Trường Property theo nguồn thật

| Trường | Nguồn hiện tại | As-Built | Phán quyết/định hướng |
|---|---|---|---|
| Name | `objects[].name`; `upsertProgram` | Sửa được, validate tên và trùng tên | **Giữ**, gom về một form duy nhất |
| Kind | `objects[].kind` | Form chỉ cho chọn `PROGRAM`; cảnh báo Function/FB chưa được Check hỗ trợ | **Sai hiện trạng**: BE đã nhận `FUNCTION`/`FUNCTION_BLOCK` trong POU graph; phải bỏ cảnh báo cũ và khóa đổi kind theo lifecycle an toàn |
| Language | `objects[].language` | Chỉ đọc | Cần quyết định create-time immutable hay conversion workflow; không cho đổi trực tiếp làm mất source |
| Namespace | Không có trong Draft v2 | Luôn unknown | Không nên giữ placeholder vĩnh viễn; loại khỏi Rev A hoặc bổ sung contract có owner/migration |
| Access | `objects[].access`; `annotateObject` | Sửa được | Đây chỉ là **ghi chú người dùng**, không phải RBAC. Đổi nhãn thành “Ghi chú truy cập” hoặc chuyển khỏi nhóm quyền |
| Description | `objects[].description`; `annotateObject` | Sửa được | **Giữ**; semantics xóa bằng chuỗi rỗng đã rõ |
| Cycle | `programs[].periodMs` | Đọc đúng theo Program | **Giữ**; chỉ nhận 1/5/30 s theo profile |
| Task | BE có thể lưu `programs[].taskId` | Adapter v2 không chiếu taskId theo Program và dựng `document.task.taskId` từ library/project; `document.task.name` thường không có | Cần read model typed theo Program; không tự biến ID thành display name |
| Enable intent | `GET .../programs.items[].desiredEnabled` | Chưa nối, FE truyền `null` | Nối nguồn có sẵn; phân biệt intent với read-back |
| Enable thực | `GET .../programs.items[].enabled` + source/observedAt | Chưa nối | Chỉ hiện là live/read-back khi source hợp lệ; không suy từ intent |
| Interface Name/Direction/Type | Buffer ST chưa lưu hoặc FBD interface | Đọc được INPUT/OUTPUT/IN_OUT | Nền tốt, nhưng regex FE không thể là authority cuối cho mutation |
| Initial/Retain/Description | Chưa có trong `InspectorPouParameter` | Mỗi row luôn unknown | Chưa đạt G-15 |
| VAR/VAR_TEMP/VAR_EXTERNAL | Không truyền vào Program context | Luôn unknown | Chưa đạt G-14; có dữ liệu một phần trong variable/index nhưng chưa thành model Program Property |
| IEC Attributes | Không có schema | Component luôn nhận `[]` | Placeholder |
| DDC Attributes | `functionalTags` được chiếu thành cặp key/value | Có thể hiện tag, nhưng semantics chưa phải schema IEC/DDC hoàn chỉnh | Không gọi là hoàn tất Attributes |
| DDC Metadata | Component có props nhưng caller gọi không props | Luôn unknown | Placeholder; phần lớn Unit/Mapping/Writable nên thuộc Variable/Binding/Point, không phải Program |
| Uses/Used by | `dependencies[]` + reverse lookup FE | Hiện tên dạng text | Đạt một phần; thiếu stable target và jump |
| Calls | Không có nguồn | Luôn unknown | Chưa đạt |
| Global Task link | Route tab Execution | Có link | Giữ; bổ sung link theo đúng Program/Task sau khi có identity |

### 3.3 Context-sensitive Inspector

Union type khai báo `PROGRAM`, `VARIABLE`, `ST_SYMBOL`, `FBD_BLOCK`,
`FBD_CONNECTION`, nhưng resolver thực tế ưu tiên FBD → ST symbol → Program →
Empty và **không có nhánh tạo `VARIABLE`**. Vì vậy “Variable context” độc lập
chưa có đường người dùng đi tới; con trỏ ST hiện dùng `ST_SYMBOL`.

Điểm đã làm đúng:

- không biến thiếu dữ liệu thành `0`, `false`, `CPU_Main` hay `Cyclic` giả;
- phân biệt `undefined` interface với danh sách interface rỗng;
- FBD selection và ST cursor có ưu tiên cao hơn Program nền;
- Inspector thu gọn khi thật sự không có context.

Điểm chưa đúng:

- `editableProgramSlot` render ngay trước `General`, tạo hai nguồn presentation
  cho cùng trường;
- test “G-14/G-16/G-18/G-19/G-20” chủ yếu kiểm section tồn tại, chưa chứng minh
  contract/data đầy đủ;
- bảng Interface có `min-width: 34rem` trong khi Inspector bị giới hạn tối đa
  `420 px`, nên ngang cuộn là tất yếu;
- workspace bật grid bốn cột từ `lg` (1024 px), chưa thực hiện right dock chung ở
  1280–1439 px như handoff;
- tab Attributes thiếu liên kết `tab`/`tabpanel`, arrow-key và focus management
  đầy đủ.

---

## 4. Đối chiếu `d.md` G-12..G-21

Quy ước: **ĐẠT** = có contract + hành vi + test phù hợp; **MỘT PHẦN** = có
đường nền nhưng thiếu dữ liệu/hành vi; **CHƯA ĐẠT** = placeholder hoặc không có.

| ID | Yêu cầu rút gọn | Trạng thái | Bằng chứng/chênh lệch chính |
|---|---|---|---|
| G-12 | Inspector theo context | **MỘT PHẦN** | Resolver có Program/ST/FBD; Variable độc lập không reachable; Program Property bị lặp |
| G-13 | General: Name/Type/Language/Namespace/Description | **MỘT PHẦN** | Name/Kind/Description có; Language chỉ đọc; Namespace không contract |
| G-14 | VAR_INPUT/OUTPUT/IN_OUT/VAR/TEMP/EXTERNAL | **MỘT PHẦN** | Chỉ ba nhóm interface có dữ liệu; ba nhóm locals luôn unknown |
| G-15 | Bảng sửa Name/Direction/Type/Init/Retain/Description + validation | **CHƯA ĐẠT** | Bảng read-only; chỉ ba field đầu có model; chưa có transaction/compiler validation |
| G-16 | Resource/Task/Mode/Interval/Priority/Watchdog | **MỘT PHẦN** | Interval/scheduled có; Task chưa chiếu ổn định; bốn field còn lại unknown |
| G-17 | Global Execution + liên kết POU | **MỘT PHẦN** | Có route global; chưa link đúng Task identity của Program |
| G-18 | IEC Attributes tách DDC Attributes | **KHUNG** | Có tab presentation; IEC luôn rỗng, DDC chưa có schema có nghĩa rõ |
| G-19 | Unit/Range/BACnet/Modbus/Historian/Alarm/Writable | **CHƯA ĐẠT** | Component placeholder, caller không truyền field nào |
| G-20 | Used by/Uses/Calls/Cross refs/Task + jump | **MỘT PHẦN** | dependency names có; Calls unknown; không jump theo item |
| G-21 | Language lifecycle/convert | **CHƯA ĐẠT** | Không có UI/contract chuyển đổi hoặc khóa có giải thích |

**Tổng hợp:** 0/10 mục đạt đầy đủ; 7/10 một phần hoặc khung; 3/10 chưa đạt.
Con số này đánh giá phạm vi mở rộng trong `d.md`, không phủ nhận các phần đã đạt
theo handoff §9 hẹp hơn.

---

## 5. Findings cần đưa vào kế hoạch

| ID | Mức | Finding | Tác động | Tầng sở hữu |
|---|---|---|---|---|
| `PPI-001` | **Cao** | Dropdown/copy nói Check chỉ hỗ trợ `PROGRAM`, trái với `checks.go` hiện đã thu POU `FUNCTION/FUNCTION_BLOCK` vào linked graph | Người dùng không tạo/sửa đúng loại POU hoặc bị hướng dẫn sai | FE; regression contract với BE |
| `PPI-002` | **Cao** | `programs[].taskId` không được chiếu thành context theo Program; Inspector đọc `document.task.name` vốn không có trong adapter v2 | Task hiện unknown dù cấu hình Program có identity | FE model + BE contract clarification |
| `PPI-003` | **Cao** | Form sửa và General đọc cùng render trong một Inspector | Lặp field, tạo hai presentation authority và trải nghiệm dài/rối | FE |
| `PPI-004` | **Cao** | G-15 chưa có data model/mutation cho Initial/Retain/Description và locals | Không thể dùng Inspector để quản lý interface như yêu cầu | FE + BE/compiler contract |
| `PPI-005` | **Cao** | Enable/read-back đã có API nhưng Inspector cố ý truyền `null` | Người dùng không biết intent khác trạng thái thật | FE, tái sử dụng BE |
| `PPI-006` | **Trung bình** | Attributes/DDC Metadata có UI nhưng không có schema/ownership | Tạo cảm giác feature đã có trong khi chỉ là placeholder | Product/Architecture rồi FE/BE |
| `PPI-007` | **Trung bình** | Bảng 544 px nằm trong dock tối đa 420 px | Cuộn ngang nhiều, đặc biệt Program có 32 biến | FE/UX |
| `PPI-008` | **Trung bình** | References là text, Calls unknown, không điều hướng theo item | Cross-reference chưa hỗ trợ luồng debug | FE + analysis contract |
| `PPI-009` | **Trung bình** | `VARIABLE` context được khai báo nhưng resolver không tạo | Handoff Variable không có đường tương tác rõ | FE interaction model |
| `PPI-010` | **Trung bình** | Breakpoint workspace không đúng handoff 1280–1439 shared dock | Editor bị ép bởi bốn cột trước khi đủ rộng | FE responsive |
| `PPI-011` | **Thấp** | Tab Attributes chưa hoàn chỉnh quan hệ ARIA/keyboard | Giảm khả năng dùng bàn phím/screen reader | FE accessibility |
| `PPI-012` | **Quản trị** | `d.md` mở rộng vượt target Inspector §9 nhưng tự đánh tất cả DoD là hoàn tất | Kế hoạch dễ lấy nhầm proposal làm authority/As-Built | Product + UX + Architecture |

---

## 6. Kiến trúc mục tiêu đề xuất

### 6.1 Một Property model, một nguồn trình bày

```text
ProgramPropertyVM
├─ identity       Name, Kind, Language, Description, Access note
├─ interface      ports/locals + source provenance + validation state
├─ execution      task identity, desired/actual enable, period, runtime source
├─ engineering    chỉ field đã có owner/contract; theo Variable/Binding khi phù hợp
└─ references     stable target id + label + relation + jump destination
```

Mọi field cần mang tối thiểu:

```ts
type PropertyField<T> =
  | { state: 'known'; value: T; source: 'draft' | 'compiler' | 'runtime' | 'catalog' }
  | { state: 'unavailable'; reason: string }
  | { state: 'not-applicable'; reason: string }
  | { state: 'error'; code: string; message: string }
```

Không nên tiếp tục gom tất cả vào một `unknown`: “chưa đọc được”, “không áp dụng”
và “contract chưa tồn tại” dẫn tới ba hành động khắc phục khác nhau.

### 6.2 Tách bề mặt hẹp và editor đầy đủ

- Dock Inspector: summary theo context, field quan trọng và action điều hướng.
- Interface đầy đủ 6 cột: mở drawer/workbench/editor chuyên dụng; dock hẹp chỉ
  hiển thị nhóm + số lượng + 2–3 cột cốt lõi.
- Một section `General` duy nhất; ở EDIT thì field hợp lệ trở thành control, ở
  LIVE/SIMULATE là read-only. Không render form rồi lặp lại bản đọc ngay sau nó.
- 1280–1439 px: Quick Library/Inspector dùng một right dock theo authority;
  dưới 1024 px thành drawer; dưới 768 px read-only.

### 6.3 Ownership đề xuất cho field gây tranh chấp

| Field | Quyết định đề xuất |
|---|---|
| Namespace | Loại khỏi Rev A cho đến khi có use case, schema, uniqueness và migration rõ |
| Access | Gọi đúng là “Ghi chú truy cập”; RBAC thật tiếp tục do server/capability quyết định |
| Language | Immutable sau khi POU có source; muốn đổi phải qua conversion workflow có preview, validation và rollback |
| Initial/Retain | Compiler/source là authority cho ST; form thực hiện edit command nguyên tử lên declaration rồi Check xác nhận, không duy trì bản metadata song song |
| DDC Unit/Range/Mapping/Writable | Thuộc Variable/Binding/Canonical Point; Program chỉ aggregate/read-only khi thật sự cần |
| BACnet/Modbus/Historian/Alarm | Link tới binding/point policy tương ứng; không sao chép cấu hình protocol vào Program object |
| Priority | Hiển thị read-only “Local logic / mức 5” nếu cần giải thích output arbitration; không cho Program tự sửa |
| Watchdog | Hiển thị như policy hệ thống độc lập hoặc link tới health; không gọi Task period là watchdog timeout |
| Mode | Rev A là cyclic/profile cố định; dùng `not-applicable` hoặc read-only policy, không bịa field editable |

---

## 7. Đề xuất thay đổi theo tầng

### 7.1 FE — phạm vi chính

1. Xóa duplication bằng một `ProgramPropertyPanel`; tách read/write theo mode và
   capability, không theo hai component cạnh nhau.
2. Sửa `PPI-001`: đồng bộ Kind với contract hiện tại; bổ sung test contract cho
   PROGRAM/FUNCTION/FUNCTION_BLOCK và quy tắc đổi kind.
3. Tạo `ProgramPropertyVM` với provenance/state; join Draft + compiler analysis +
   `GET .../programs` theo stable `programId/objectId` đã chốt.
4. Nối `desiredEnabled`, `enabled`, `runtimeStateSource`, `observedAt`; copy phải
   phân biệt **ý định** và **read-back**.
5. Làm rõ task identity theo từng Program; bỏ phụ thuộc vào
   `document.task.name` không được adapter v2 cấp.
6. Chuyển Interface 6 cột sang editor đủ rộng; mọi mutation lên ST declaration
   phải atomic, giữ comment/source và fail-closed khi parse/compiler không chắc.
7. Làm References có stable link và keyboard navigation; `Calls` chỉ hiện khi có
   semantic source thật.
8. Thực hiện đúng breakpoint handoff và hoàn thiện ARIA/focus.

### 7.2 web-api

Không cần endpoint mới cho Name/Kind/Language/source, Description/Access, chu kỳ
và Enable/runtime read-back. Việc ưu tiên là:

- chuẩn hóa read model task theo từng Program và nêu rõ `taskId` có phải display
  name hay chỉ identity;
- tái sử dụng compiler/check analysis cho interface/reference thay vì để FE tự
  tạo một semantics thứ hai;
- nếu Product duyệt Namespace/Attributes cấp POU, mở rộng Draft v2 bằng operation
  typed, strict validation, ETag/base revision, compatibility và migration;
- không nhét DDC metadata của Point/Binding vào Program object để tránh hai nguồn
  cấu hình BACnet/Modbus/Alarm.

### 7.3 Core/FW-SOM

Đợt đại tu Property cơ bản **không cần thay Core/FW-SOM**:

- chu kỳ Rev A đã khóa `1.000/5.000/30.000 ms`;
- watchdog chạy theo base step/IOP service, độc lập Task period;
- output từ Program đi qua `PRIO_LOCAL_LOGIC = 5`;
- API Programs đã chiếu intent/read-back/runtime metrics lên FE.

Chỉ khi Product yêu cầu priority hoặc watchdog **riêng cho từng Program** mới
phải mở một track kiến trúc khác, gồm package schema, compiler/loader, scheduler,
IPC/ABI, safe-state, rollback, timing benchmark và physical HIL. Track đó không
nằm trong kế hoạch đại tu Inspector này.

### 7.4 Firmware STM32/I/O

Không có thay đổi. MCU/I/O tiếp tục sở hữu IOP, safe output và hardware watchdog
theo contract hiện hành; nó không sở hữu metadata hay layout Program Property.

---

## 8. Work package đề xuất để lập kế hoạch

| WP | Phạm vi | Phụ thuộc | Exit gate |
|---|---|---|---|
| `PPI-WP0` | Chốt authority/scope; sửa Kind/copy lỗi thời; định nghĩa field ownership và trạng thái | Product + UX + Architecture | Không còn mâu thuẫn handoff/`d.md`; `PPI-001/012` đóng |
| `PPI-WP1` | Một Property panel + `ProgramPropertyVM`; bỏ duplication | WP0 | Mỗi field có đúng một presentation authority và provenance |
| `PPI-WP2` | Identity/metadata/language lifecycle | WP1 | Name/Kind/Language/Description/Access note có mode/RBAC/error/rollback rõ |
| `PPI-WP3` | Interface editor + compiler validation | WP1, quyết định source authority | Sửa declaration atomic; positive/negative/parse-fault/round-trip PASS |
| `PPI-WP4` | Execution: task identity, period, desired/actual enable, runtime quality | WP1, task read model | Không suy đoán; intent/read-back/stale/offline phân biệt đúng |
| `PPI-WP5` | References và engineering metadata đã được duyệt | WP0, semantic/Point ownership | Mọi item có stable ID/jump; không sao chép config Point/Binding |
| `PPI-WP6` | Responsive, a11y, browser/E2E và regression | WP1..5 | Breakpoint authority PASS; 0 Console error; 0 request thất bại ngoài fixture; keyboard flow PASS |

Thứ tự khuyến nghị: `WP0 → WP1 → (WP2, WP4) → WP3 → WP5 → WP6`.
Không ước lượng ngày công trước khi WP0 chốt Namespace, language conversion,
interface authority và engineering metadata ownership.

---

## 9. Acceptance bắt buộc cho Detailed Design/Issue kế tiếp

1. Mỗi field ghi rõ source contract, mode, RBAC, editability, null semantics,
   validation, side effect, error và rollback.
2. Một Program chỉ có một khối Property; không lặp Name/Kind/Description trong
   cùng Inspector.
3. PROGRAM/FUNCTION/FUNCTION_BLOCK trong FE khớp khả năng Check thực tế; không
   còn copy `ST-CLI-LIMIT` lịch sử.
4. Task/period của Program được join đúng 100% theo stable identity; không lấy
   Task đầu tiên hay library revision làm tên.
5. Enable intent và enable read-back luôn là hai field/nhãn khác nhau; stale,
   offline, unavailable không biến thành `false`.
6. Không có giá trị fabricated. `not-applicable` không bị ghi thành `unknown`.
7. Interface mutation round-trip không mất source/comment; compile diagnostic
   trỏ đúng field/line; conflict ETag không ghi đè.
8. Priority/Watchdog không có mutation từ Inspector trong Rev A.
9. Unit/Mapping/BACnet/Modbus/Historian/Alarm/Writable dùng đúng authority
   Variable/Binding/Point và có link nguồn.
10. References có stable target + jump, xử lý target đã xóa/rename và keyboard.
11. Visual/browser tại ≥1440, 1280–1439, 1024–1279 và <768 đúng authority; test
    ít nhất loading/empty/error/permission/stale/offline và Program 32 biến.
12. Vitest/lint/build/E2E PASS; Chrome Console/Network sạch; không claim
    FakeMCU/physical HIL nếu chưa chạy đúng target.

---

## 10. Gate cuối

| Câu hỏi | Phán quyết |
|---|---|
| Inspector hiện tại đã match hoàn toàn `d.md` chưa? | **CHƯA** |
| Có thể giữ lại nền hiện tại không? | **CÓ** — context resolver, unknown honesty, Draft operations và runtime API là nền dùng lại tốt |
| Có nên chỉ “điền hết unknown” ở FE không? | **KHÔNG** — nhiều field chưa có contract hoặc không thuộc Program |
| Có cần sửa BE? | **Có giới hạn** — task read model/semantic analysis và schema chỉ sau quyết định ownership |
| Có cần sửa Core/FW-SOM ngay? | **KHÔNG** cho Property Rev A; chỉ cần nếu đổi scheduling/safety semantics |
| Có cần sửa STM32/I/O firmware? | **KHÔNG** |
| Đủ để tuyên bố implementation-ready chưa? | **CHƯA** — cần WP0 chốt bốn quyết định mở: Namespace, language lifecycle, interface authority, engineering metadata ownership |

**Khuyến nghị phê duyệt:** dùng báo cáo này làm đầu vào mở kế hoạch đại tu, nhưng
không lấy nguyên `d.md` làm acceptance authority và không bắt đầu từ việc thêm
placeholder/field hardcode. Bắt đầu bằng `PPI-WP0`, sau đó dựng một Property
model thống nhất trước khi mở rộng từng section.

---

## 11. Lệnh kiểm chứng đã chạy

```bash
cd apps/web-ui
npx vitest --run --environment jsdom \
  src/features/programming/design/inspector \
  src/features/programming/design/editor/ProgramsWorkspace.test.tsx \
  src/features/programming/design/editor/ProgramsTab.test.ts \
  src/features/programming/model/draftV2.test.ts
```

Kết quả: **6 test files passed, 98 tests passed**.

## 12. Revision history

| Phiên bản | Ngày | Thay đổi | Người lập |
|---|---|---|---|
| 1.0 | 2026-09-09 | Rà source/contract/DOM snapshot, chấm G-12..G-21 và đề xuất work package FE→BE→Core/FW-SOM | Codex |
