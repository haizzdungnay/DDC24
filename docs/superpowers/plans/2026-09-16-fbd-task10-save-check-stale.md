# Task 10 — Ranh giới Save/Check và xử lý chẩn đoán cũ (FBD)

- Ngày: 2026-09-17 (bản v5 — đối chiếu ảnh chủ sở hữu PGM-02B; 10b mở rộng sang dấu chẩn đoán trên khối canvas)
- Issue: #718 (hiện CLOSED do PR #724 dùng trùng số — cần quyết định mở lại hoặc tạo mới)
- Nguồn đặc tả: `docs/superpowers/plans/2026-08-31-fbd-edit.md` §10 (dòng 700–740)
- Ca chấp nhận: `docs/superpowers/specs/2026-08-31-fbd-edit-design.md` (dòng 675–707)
- Tiền nhiệm: Task 8 & 9 (Issue #667, đóng 2026-09-15)
- Kế nhiệm: Task 11 (e2e, accessibility, bundle gate — tạo `apps/web-ui/e2e/fbd-edit.spec.ts`)

## 0. Vì sao có bản v2

Bản v1 kết luận "Step 2 chỉ là nối dây `openBuffer` xuống `ProblemsDrawer`". **Kết luận đó sai.** Khảo sát sâu ngày 2026-09-16 phát hiện nhánh FBD **chưa có đường chẩn đoán từ server**:

`design/workbench/DesignWorkbench.tsx:154` chặn có chủ ý:

```ts
if (program.language !== 'FBD') {
  for (const diagnostic of checkDiagnostics) { ... }
}
```

Chú thích `:146-153` dẫn `ISS-STED-05`: "Nguồn cho ST là diagnostic Check (ISS-STED-04), KHÔNG phải một bộ kiểm thứ hai ở FE". FBD đi nhánh khác — validator cục bộ `validateFbdDocument` (`:174-208`).

Backend **đã sẵn sàng**: `apps/web-api/.../checks.go:793` biên dịch `--language FBD`; `checks.go:1092-1097` điền đủ `location.revisionId`, `location.pouId`, `location.sourceSha256`. Chặn nằm ở FE.

Trường `location` còn bị **xoá hai lần** trên đường tới `ProblemsDrawer`:

1. `DesignWorkbench.tsx:163-170` chuyển `ProgrammingDiagnostic` → `WorkbenchProblem`, không mang theo `location`.
2. `ProgrammingWorkbench.tsx:576-584` dựng ngược `ProgrammingDiagnostic[]` từ `problems` với `location` bỏ trống hoàn toàn.

Hệ quả: hiện FBD không có gì để gán nhãn cũ. Chẩn đoán cục bộ luôn tính lại từ buffer hiện tại nên luôn tươi theo định nghĩa.

## §0.1. Khảo sát lại sau khi kéo code mới (2026-09-17)

Sau khi kéo code mới từ GitHub, trạng thái kho hiện tại:
- Nhánh `main`, đồng bộ `origin/main`, ahead 0 / behind 0, cây làm việc **SẠCH**.
- 11 file sửa + 2 file chưa theo dõi trước đây ĐÃ được gom và commit hết vào `154a9ef3` (PR #724).
- 9 commit mới so với mốc `2e63a991`.
- KHÔNG commit nào chạm: `diagnosticFreshness.ts`, `ProblemsDrawer.tsx`, `DesignWorkbench.tsx`, `ProgrammingWorkbench.tsx`, `DesignWorkspacePage.tsx`, `useDraftWorkspace.ts`, hay bất kỳ file nào trong `apps/web-api/internal/programming/`.
- CÓ chạm: `FbdEditorPane.tsx` (do `154a9ef3` — thêm modal thuộc tính khối + context menu map điểm) và `EditorPane.tsx` (do `154a9ef3` nạp pointCatalog, `9d8832bb` layout thư viện 3 ngưỡng).
- Nhánh mới xuất hiện: `feat/fbd-port-mapping-properties-718`, `feat/fbd-edit-task8-redo`, `origin/clean-code/issue-677`, `origin/clean-code/issue-678`, `origin/fix/fbd-quick-library-layout-sync`.

| Commit | Có chạm vùng Task 10? |
|---|---|
| `0ba2fce7` (docs OD-BAC-009 #713) | Không |
| `b41daa69` (docs ARCH-BACNET-001 #629) | Không |
| `9a8e94de` (build web-ui typecheck+lint e2e #664) | Không |
| `550e420e` (build iobus vendor bacnet-stack 1.3.8 #625) | Không |
| `d7d7fb67` (docs WF-CLEAN-001 §8.7 #721) | Không |
| `be292128` (test bacnet LOOPBACK UDP #626) | Không |
| `154a9ef3` (feat programming-ui map point FBD + block properties, PR #724) | Không (chỉ chạm `FbdEditorPane.tsx` và `EditorPane.tsx`, không chạm đường chẩn đoán) |
| `46764ba5` (feat tooling cross-build aarch64 #627) | Không |
| `9d8832bb` (fix programming-ui thư viện nhanh FBD 3 ngưỡng desktop #676) | Không (chỉ chạm `EditorPane.tsx` layout thư viện 3 ngưỡng, không chạm đường chẩn đoán) |

**Mọi phán quyết CH-1…CH-5 của bản v3 VẪN CÒN HIỆU LỰC vì không commit nào chạm đường dữ liệu chẩn đoán.**

### Mốc dòng đã dịch

| Vị trí | Dòng cũ | Dòng mới | Nguyên nhân |
|---|---|---|---|
| `DesignWorkbench.tsx` — khối type props | `:47-85` | `:65-108` | Dịch chuyển dòng do các thay đổi trước đó trong file |
| `ProgrammingWorkbench.tsx` — chỗ render `<ProblemsPanel` | `:453` | `:452` | Dịch chuyển dòng nhẹ trong file |
| `ProgrammingWorkbench.tsx` — định nghĩa hàm `ProblemsPanel` | `:564-575` | `:563-575` | Dịch chuyển dòng nhẹ trong file |
| `FbdEditorPane.tsx` — 5 prop chưa dùng | `:69-86` | Rải ở `:124` (`saving`) và `:134-137` (`onRunCheck`, `onOpenCompare`, `checkDisabledReason`, `compareDisabledReason`) | `154a9ef3` chèn các hàm helper ánh xạ điểm ở đầu file, đẩy file từ 366 lên 503 dòng. Vẫn chưa prop nào được dùng trong thân component, và vẫn chưa có chú thích giải thích |
| `DesignWorkspacePage.tsx` — khối cảnh báo xung đột | `:765-775` | `:765-777` | Khối cảnh báo xung đột mở rộng thêm 2 dòng |

## §0.2. Đối chiếu ảnh chủ sở hữu PGM-02B (2026-09-17)

### Vì sao mục này tồn tại

- `docs/superpowers/plans/2026-08-31-fbd-edit.md:5` — mục tiêu 11 task: `Nâng bề mặt FBD EDIT thành workspace kéo-thả node-edge theo target PGM-02B...`
- `docs/superpowers/specs/2026-08-31-fbd-edit-design.md:529` — `- Ảnh chủ sở hữu: [PGM-02B FBD editor reference](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png).`
- Các plan Task 6, 8, 9 đều viện dẫn ảnh này. Plan Task 10 hiện KHÔNG viện dẫn — đây là thiếu sót cần vá. Ảnh là thẩm quyền hình ảnh của cả 11 task FBD.

### Ảnh vẽ gì ở khay Problems

Tab `Problems` hiển thị một dòng lỗi gồm: chip mức độ `Warning` · mã `PRG.W.3101` · thông điệp `Integral term is Zero` · vị trí `ln 1, Col 1`.

Suy luận có căn cứ: mã dạng `PRG.W.####` kèm dòng/cột là chẩn đoán trình biên dịch từ máy chủ. Bộ kiểm cục bộ FBD sinh mã dạng `FBD-SCHEMA-JSON-001` và không có dòng/cột (`DesignWorkbench.tsx:176`). Vậy ảnh minh họa vẽ khay Problems của FBD ĐANG hiển thị chẩn đoán Check từ máy chủ.

Ảnh KHÔNG chứa nhãn chữ `STALE`/`CŨ` nào — ảnh vẽ trạng thái bình thường, không vẽ trạng thái cũ.

### Điều khoản handoff trúng phạm vi

| Nguồn | Nguyên văn | Trúng phần nào của Task 10 |
|---|---|---|
| `PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md:53` | `- diagnostic markers on nodes/wires` | 10b (dấu chẩn đoán trên canvas) |
| `PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md:148` | `- Check diagnostics visible on canvas + Problems.` | 10b (hiển thị chẩn đoán Check) |
| `PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md:237` | `3. click Problems → focus/select canvas entity.` | 10b (nhảy từ khay tới entity) |
| `PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md:36` | `- Edit ≠ Save ≠ Check ≠ Commission ≠ Running.` | 10a (ranh giới Save/Check) |
| `PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md:37` | `- Save Draft SHALL NOT modify Active runtime.` | 10a (lưu draft độc lập runtime) |
| `PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md:40` | `- Missing/stale/offline data SHALL be Unknown / Stale / —, never fabricated zero.` | 10a (trạng thái UNKNOWN) & 10b (nhãn STALE) |
| `PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md:229` | `| Problems | Draft diagnostics | Draft + sim runtime diagnostics | Active runtime diagnostics |` | 10b (nguồn chẩn đoán khay Problems) |
| `PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md:369` | `- AC-PGM02-009 Save/Check do not change Active.` | 10a (Save/Check không đổi Active) |

### Bảy mã TC truy nguyên về đâu

Ánh xạ gốc tại `docs/superpowers/specs/2026-08-31-fbd-edit-design.md` §10.1.1, dòng 806-816:

| Mã TC | Nguồn truy nguyên |
|---|---|
| `TC-FBD-SAVE-001` | `DDO-PGM02-007`, `AC-PGM02-001..010` |
| `TC-FBD-CONFLICT-001` | `AC-PGM02-001..010`, `PRG-ERR-CONFLICT-001` |
| `TC-FBD-HEADER-001` | `AC-PGM02-001..010` |
| `TC-FBD-HEADER-002` | `BLK-FBD-006` / NFR-defensive (transport readiness) |
| `TC-FBD-HEADER-003` | `DDO-PGM02-015`, diagnostic freshness |
| `TC-FBD-STATE-003` | `DDO-PGM02-015`, defensive fail-closed |
| `TC-FBD-STATE-004` | `AC-PGM02-001..010`, viewport/RBAC |

**KHÔNG mã nào truy về `AC-FBD-###`. Nghĩa là phần 10a (ranh giới Save/Check) KHÔNG bị ảnh minh họa ảnh hưởng — đó là bài toán hành vi, không phải bố cục. Chỉ 10b bị ảnh hưởng.**

## §0.3. Lỗ hổng của bản v4 và phạm vi 10b sau điều chỉnh

Định nghĩa gốc `TC-FBD-HEADER-003` tại `docs/superpowers/specs/2026-08-31-fbd-edit-design.md:741`:

`| TC-FBD-HEADER-003 | stale server diagnostic + changed buffer | sửa graph sau Check | **marker cũ mang STALE DIAGNOSTIC**, không gạch như lỗi mới | HOST component | FE + compiler consumer |`

Chữ **marker** nghĩa là dấu TRÊN CANVAS, không phải dòng trong khay Problems. Plan v4 chỉ nối `location` xuống `ProblemsDrawer` để hiện chip `CŨ` trong khay, KHÔNG chạm canvas. Làm theo plan v4 nguyên trạng thì `TC-FBD-HEADER-003` KHÔNG THỂ ĐẠT.

### Hiện trạng dấu lỗi trên canvas

- Khối lỗi ĐÃ có dấu: thuộc tính `data-fbd-node-issue="true"`, viền vàng + chấm tròn cảnh báo dùng biến màu `var(--c-warn-fg)`. Bằng chứng: `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx:834-840` và `apps/web-ui/src/features/programming/fbd/FbdCanvasLayers.tsx:416-434`.
- Nguồn lỗi hiện CHỈ từ bộ kiểm cục bộ FE, không từ Check máy chủ.
- Dây nối (wire) CHƯA có dấu lỗi nào trên canvas.

### Phạm vi 10b sau điều chỉnh

- **GIỮ**: trọn 10 vị trí / 3 file của plan v4 (nối `location` xuống `ProblemsDrawer` để hiện chip `CŨ`).
- **THÊM**: đưa chẩn đoán Check từ máy chủ ra dấu trên KHỐI canvas, và dấu đó phải mang được trạng thái cũ (`STALE`) — tận dụng hạ tầng `data-fbd-node-issue` sẵn có ở `StructuredFbdEditor.tsx:834-840` / `FbdCanvasLayers.tsx:416-434`, không dựng lại từ đầu.
- **KHÔNG LÀM**: không làm dấu lỗi trên DÂY NỐI trong Task 10. Phần đó tách thành một issue riêng để phủ nốt `PGM-02B:53` (`markers on nodes/wires`). Đây là việc tồn đọng có chủ ý, kèm lý do: dây chưa từng có dấu nên là tính năng mới, và có rủi ro trượt ngân sách bundle R3 (165.00 KiB gzip).

## 1. Phạm vi và cách chia

Chủ dự án chốt ngày 2026-09-16: **làm trọn cả hai phần**.

- **Task 10a — Ranh giới Save/Check.** Không chạm đường chẩn đoán. Diff nhỏ, rủi ro thấp.
- **Task 10b — Nhãn chẩn đoán cũ.** Đảo quyết định `ISS-STED-05` cho FBD, chạm type dùng chung với ST. Rủi ro hồi quy ST.

Thứ tự thi hành bắt buộc: **10a xong và xanh trước, rồi mới sang 10b.** Hai commit tách biệt để có thể lùi riêng phần 10b nếu ST hồi quy.

## 2. Hiện trạng đã đo (2026-09-16)

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Module `diagnosticFreshness` (109 dòng) | ĐÃ CÓ | `shared/diagnosticFreshness.ts` |
| `ProblemsDrawer` có prop `openBuffer` | ĐÃ CÓ | `shared/ProblemsDrawer.tsx:77` |
| `ProblemsDrawer` render nhãn CŨ/STALE | ĐÃ CÓ | `shared/ProblemsDrawer.tsx:232-237` |
| Backend biên dịch FBD, điền `location` đủ | ĐÃ CÓ | `checks.go:793`, `checks.go:1092-1097` |
| FE cho FBD nhận chẩn đoán server | **BỊ CHẶN** | `DesignWorkbench.tsx:154` |
| `location` sống sót tới `ProblemsDrawer` | **BỊ RỤNG 2 LẦN** | `DesignWorkbench.tsx:163-170`, `ProgrammingWorkbench.tsx:576-584` |
| `ProgrammingWorkbench` nhận `openBuffer` | **CHƯA CÓ** | không có prop |
| Check khoá khi dirty | ĐÃ CÓ | `DesignWorkspacePage.tsx:460-463` |
| `If-Match` + bắt 409 | ĐÃ CÓ | `useDraftWorkspace.ts:101`, `:119-121` |
| Xung đột giữ buffer + Tải lại / Giữ bản đang gõ | ĐÃ CÓ | `DesignWorkspacePage.tsx:765-777` |
| Trạng thái UNKNOWN khi Save treo | **CHƯA CÓ** | không tìm thấy |
| `TC-FBD-STATE-003` | ĐÃ CÓ | `FbdWorkbench.test.tsx:309,330,353` |
| `TC-FBD-STATE-004` | ĐÃ CÓ | `DesignWorkspacePage.test.tsx:1148`, `FbdEditorPane.test.tsx:148` |
| `TC-FBD-HEADER-001` | MỘT PHẦN | `FbdEditorPane.test.tsx:98` |
| `SAVE-001` / `CONFLICT-001` / `HEADER-002` / `HEADER-003` | **CHƯA CÓ** | 0 khớp trong mã test |

Ước lượng: **10a ~70% xong** (thiếu chủ yếu bằng chứng, không phải mã) — **10b ~15% xong** (chỉ có module nền và phần render nhãn).

## 3. Câu hỏi chặn đã giải

### CH-1 — Băm chuỗi nào? → `SOURCE_BÁM_SÁT`

`local` là `useMemo` phái sinh trực tiếp từ `source` (`FbdEditorPane.tsx:103-107`), không có state song song. Không có `useEffect` reset. `StructuredFbdEditor.tsx:346-352` bắn `onChange` ở mọi thay đổi đồ thị; `onChange` gọi `setBuffers` (`EditorPane.tsx:367`), giá trị quay lại thành `source` ngay.

**Quyết định: băm `source` ở tầng `DesignWorkspacePage`. KHÔNG sửa `FbdEditorPane.tsx`.**

Lợi ích phụ: tránh hẳn file đang có phiên song song sửa.

### CH-2 — 5 prop trống của `FbdEditorPane` có phải thiếu sót? → KHÔNG

`saving`, `onRunCheck`, `onOpenCompare`, `checkDisabledReason`, `compareDisabledReason` (nằm rải ở `FbdEditorPane.tsx:124` cho `saving` và `:134-137` cho `onRunCheck`, `onOpenCompare`, `checkDisabledReason`, `compareDisabledReason`) cố ý để trống. Nguyên nhân mốc dòng dịch: `154a9ef3` chèn các hàm helper ánh xạ điểm ở đầu file, đẩy file từ 366 lên 503 dòng. Vẫn chưa prop nào được dùng trong thân component, và vẫn chưa có chú thích giải thích. Bất biến `2026-08-31-fbd-edit-design.md:360,581` yêu cầu **đúng 1 bề mặt Save/Check** ở header dùng chung; toolbar FBD **cấm nhân bản nút**.

Hành động: chỉ thêm chú thích mã dẫn `TC-FBD-HEADER-001`. Tuyệt đối không render nút Save/Check trong toolbar FBD.

### CH-3 — Có phải sửa `useDraftWorkspace.ts`? → KHÔNG

§10 liệt kê là file cần sửa, nhưng handoff `2026-09-15-fbd-pou-dragdrop-667-handoff.md` §2 đánh dấu chỉ đọc. Mọi thứ §10 cần đã có sẵn: `ifMatch: project.etag` (`:101`), bắt 409 (`:119-121`). Chỉ thêm ca test vào `useDraftWorkspace.test.tsx` (file test, không phải nguồn). Mâu thuẫn tiêu biến.

## 4. Hai câu chặn còn lại — đã giải (2026-09-16)

### CH-4 — `location` rỗng cho ra gì? → **AN TOÀN**

`diagnosticFreshness.ts:68-70` chặn ngay đầu hàm, trước mọi phép so sánh:

```ts
if (!revisionId || !pouId || !sourceSha256 || !profileVersion) {
  return { freshness: 'UNVERIFIABLE', diagnosticRevisionId: revisionId }
}
```

Chú thích `:65-67` nêu rõ ý định: thiếu bất kỳ trường nào thì không suy đoán từ phần còn lại.

`ProblemsDrawer.tsx:204` gán `staleReason` chỉ khi `freshness === 'STALE'`; `:231` chỉ render nhãn khi `staleReason` tồn tại. Vậy `UNVERIFIABLE` **không hiện nhãn**.

Mô phỏng: `location` undefined ⇒ `UNVERIFIABLE`; `location` là `{}` ⇒ `UNVERIFIABLE`; thiếu riêng `stLanguageProfileVersion` ⇒ `UNVERIFIABLE`; đủ 4 trường và khớp ⇒ `FRESH` (`:91`).

Đã có test phủ: `diagnosticFreshness.test.ts:96` — `'không có provenance nào (diagnostic scope/worker) ⇒ UNVERIFIABLE'`.

**Kết luận: chẩn đoán từ validator cục bộ FBD (không có `location`) sẽ nhận `UNVERIFIABLE` và KHÔNG bị dán nhãn cũ sai. Không cần xử lý thêm.**

### CH-5 — Bẫy `PROFILE_CHANGED` giả → **KHÔNG TỒN TẠI**

Backend điền trường này **vô điều kiện** cho mọi chẩn đoán compiler. `apps/web-api/internal/programming/application/checks.go:1088-1099`:

```go
func (p diagnosticProvenance) stamp(view *DiagnosticView) {
	if view.Location == nil { view.Location = map[string]any{} }
	pouID, _ := view.Location["programId"].(string)
	view.Location["revisionId"] = p.revisionID
	view.Location["pouId"] = pouID
	if hash, found := p.sourceByPOU[pouID]; found { view.Location["sourceSha256"] = hash }
	view.Location["stLanguageProfileVersion"] = domain.STLanguageProfileVersion
}
```

Không rẽ nhánh theo ngôn ngữ. Chẩn đoán từ đường FBD đi qua **cùng** vòng lặp `checks.go:369-386` với ST (`compilerDiagnostic()` rồi `provenance.stamp(&view)`), không có đường riêng.

Giá trị: `domain.STLanguageProfileVersion = "1.0.0"`, khớp hằng FE `ST_LANGUAGE_PROFILE_VERSION = "1.0.0"` (`api/generated/stLanguageProfile.ts:8`).

Hợp đồng xác nhận phạm vi áp dụng không phân ngôn ngữ — `docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md:244-247`: bốn trường provenance trong `location` là **bắt buộc theo `ISS-STED-18`**. Lược đồ: `contracts/openapi/openapi.yaml:4022-4025`.

**Kết luận: KHÔNG sinh `PROFILE_CHANGED` giả. Không sửa `diagnosticFreshness.ts`. Không cần hằng profile FBD riêng. Hai đường xử lý dự phòng nêu ở bản v2 đã bỏ.**

Hệ quả cho Bước 4 của 10b: `OpenBufferContext.languageProfileVersion` **để trống**, dùng fallback `ST_LANGUAGE_PROFILE_VERSION` có sẵn. Ghi lý do vào chú thích mã kèm dẫn `ISS-STED-18`.

## 5. Task 10a — Ranh giới Save/Check

### Files

- Sửa: `design/DesignWorkspacePage.tsx` (trạng thái UNKNOWN)
- Sửa nếu thiếu: `api/errorCopy.ts` (chỉ bổ sung copy cho mã lỗi đã tồn tại, cấm thêm mã mới)
- Test: `design/DesignWorkspacePage.test.tsx`, `design/useDraftWorkspace.test.tsx`
- **Không chạm**: `useDraftWorkspace.ts`, `FbdEditorPane.tsx`, `ProgrammingHeader.tsx`, toàn bộ `fbd/`

### Bước 1 — Viết test đỏ trước

Chỉ thêm ca mới. Cấm `.skip` / `.only` / `.todo`; cấm xoá ca cũ hay làm yếu matcher.

- `TC-FBD-SAVE-001` → `DesignWorkspacePage.test.tsx`: Draft hợp lệ và Draft chưa hoàn tất **đều lưu được**; canonical FBD/layout round-trip sau tải lại.
- `TC-FBD-CONFLICT-001` → `DesignWorkspacePage.test.tsx` + `useDraftWorkspace.test.tsx`: mô phỏng xung đột ETag 409; buffer cục bộ giữ nguyên, không bị ghi đè; hiện rõ Tải lại / Giữ bản đang gõ.
- `TC-FBD-HEADER-001` (bổ sung) → `FbdEditorPane.test.tsx`: khẳng định toolbar FBD **không** có nút Save/Check; dirty ⇒ Check disabled; error copy đúng mã.
- `TC-FBD-HEADER-002` → `DesignWorkspacePage.test.tsx`: request Save không bao giờ giải; khẳng định **0 lần gửi lại**, trạng thái UNKNOWN, buffer nguyên vẹn.

Môi trường test đã có: `client.request = vi.fn()` qua `vi.hoisted` (`DesignWorkspacePage.test.tsx:50-62`), helper `renderWorkspace(initialPath)` (`:134-147`). Không dùng MSW. Không thêm gói npm.

Lưu ý: `useDraftWorkspace.test.tsx` hiện chỉ 84 dòng / 2 ca, chưa có ca 409.

### Bước 2 — Trạng thái UNKNOWN cho Save treo

Bất biến `2026-08-31-fbd-edit-design.md:346-347`: timeout hoặc kết quả chưa xác định ⇒ trạng thái UNKNOWN (`Không xác định được/đang chờ xác nhận`), giữ nguyên buffer, **không tự gửi lại**.

`BLK-FBD-006` cấm tự thêm timeout/retry vào transport. UNKNOWN vì vậy là trạng thái **trình bày**, suy ra từ việc promise chưa giải, **không** từ đồng hồ đếm giờ tự chế.

**Nếu ca này đòi hợp đồng huỷ request ⇒ DỪNG tại `BLK-FBD-006` và báo cáo. Không tự thêm `AbortController`.**

### Bước 3 — Giữ nguyên hành vi transport

Tái dùng `useDraftWorkspace.save`, `If-Match` sẵn có, header idempotency/correlation, `programmingErrorCopy`.

Bất biến phải giữ:
- Mỗi lần Save/Retry do người dùng chủ động sinh idempotency key mới; cấm replay ngầm (`2026-08-31-fbd-edit-design.md:350-351`).
- Cập nhật state từ read-back response (`resource`, `etag`, `auditId`, `correlationId`); cấm suy diễn lạc quan (`:335-337`).
- Conflict 409/412/428 dùng `PRG-ERR-CONFLICT-001`, giữ nguyên local buffer (`:341-342,352`).

### Bước 4 — Kiểm chứng 10a

```bash
cd apps/web-ui
npx vitest --run src/features/programming/design/DesignWorkspacePage.test.tsx src/features/programming/design/useDraftWorkspace.test.tsx
cd ../..
```

Kỳ vọng: cử chỉ trên canvas **không** phát request HTTP nào; trạng thái xung đột và UNKNOWN giữ nguyên buffer và hiện hành động phục hồi.

### Bước 5 — Commit 10a

Commit riêng, trước khi động vào 10b.

## 6. Task 10b — Nhãn chẩn đoán cũ

Chỉ phục vụ `TC-FBD-HEADER-003`. **Chỉ bắt đầu khi 10a đã xanh.**

### Files

- Sửa: `design/workbench/DesignWorkbench.tsx` (gỡ chặn `:154`, giữ `location` tại `:163-170`)
- Sửa: `design/workbench/ProgrammingWorkbench.tsx` (nhận `openBuffer`, chuyển tiếp `location` tại `:576-584`, truyền xuống `ProblemsDrawer` tại `:604`)
- Sửa: `design/DesignWorkspacePage.tsx` (băm `source`, dựng `OpenBufferContext`, truyền xuống)
- Có thể sửa: type `WorkbenchProblem` (thêm trường **tuỳ chọn**)
- Test: `design/workbench/FbdWorkbench.test.tsx`, `design/DesignWorkspacePage.test.tsx`

### Bước 1 — Điểm chạm đã đo chính xác

**3 file / 10 vị trí, trong đó 2 vị trí ảnh hưởng nhánh ST.**

`ProgrammingWorkbench` chỉ được render ở đúng một chỗ (`DesignWorkbench.tsx:278`), ngoài ra chỉ có trong 2 file test. Chuỗi prop thẳng, không phân nhánh.

Chuỗi truyền `openBuffer`: `DesignWorkspacePage.tsx:964` → `DesignWorkbench.tsx:278` → `ProgrammingWorkbench.tsx:452` → `ProblemsPanel:563` → `ProblemsDrawer:604`. Mỗi chặng thêm đúng 1 prop `openBuffer?: OpenBufferContext`; `ProblemsDrawer` đã sẵn prop này.

| # | Vị trí | Việc | Ảnh hưởng |
|---|---|---|---|
| 1 | `ProgrammingWorkbench.tsx:35-43` | Thêm `location?: ProgrammingDiagnostic['location']` vào `WorkbenchProblem` | chung |
| 2 | `ProgrammingWorkbench.tsx:139-184` | Thêm prop `openBuffer?` vào `ProgrammingWorkbench` | chung |
| 3 | `ProgrammingWorkbench.tsx:452` | Truyền `openBuffer` vào `ProblemsPanel` | chung |
| 4 | `ProgrammingWorkbench.tsx:563-575` | `ProblemsPanel` nhận `openBuffer` | chung |
| 5 | `ProgrammingWorkbench.tsx:576-584` | Gán `location: problem.location` khi dựng `ProgrammingDiagnostic` | chung |
| 6 | `ProgrammingWorkbench.tsx:604-614` | Truyền `openBuffer={openBuffer}` vào `ProblemsDrawer` | chung |
| 7 | `DesignWorkbench.tsx:65-108` | Thêm prop `openBuffer?` vào `DesignWorkbench` | chung |
| 8 | `DesignWorkbench.tsx:163-170` | Gán `location: diagnostic.location` trong `output.push` | **ST** |
| 9 | `DesignWorkbench.tsx:278-293` | Truyền `openBuffer` xuống | chung |
| 10 | `DesignWorkspacePage.tsx:964-985` | Dựng `OpenBufferContext`, truyền xuống | **ST** |

Nhánh dựng problem cho FBD (`DesignWorkbench.tsx:174-208`) **giữ nguyên**, không cần `location` — theo CH-4 chúng nhận `UNVERIFIABLE` và không hiện nhãn, đúng ý muốn.

Lưu ý lưới an toàn: `DesignWorkbench.test.tsx:47,95` chỉ khẳng định text DOM và lời gọi `onJumpToDiagnostic`; `ProgrammingWorkbench.test.tsx` và `FbdWorkbench.test.tsx` **không có ca nào** nhắc `location`. Vùng này chưa có test bảo vệ ⇒ phải tự thêm khẳng định khi sửa.

### Bước 2 — Giữ `location` xuyên qua `WorkbenchProblem`

Thêm trường **tuỳ chọn** `location?` vào `WorkbenchProblem`, điền tại `DesignWorkbench.tsx:163-170` cho **cả ST lẫn FBD**, chuyển tiếp tại `ProgrammingWorkbench.tsx:576-584`.

Trường tuỳ chọn ⇒ hành vi ST không đổi khi chưa truyền `openBuffer`. Đây là lý do chọn cách này thay vì đường truyền riêng.

### Bước 3 — Gỡ chặn `language !== 'FBD'`

`DesignWorkbench.tsx:154`. Sau khi gỡ, POU FBD nhận **cả hai** nguồn: chẩn đoán server (có thể cũ) và validator cục bộ (luôn tươi). Đúng ý §10 Step 2: "validator cục bộ vẫn chạy trực tiếp".

Phải bảo đảm:
- Không trùng lặp mục giữa hai nguồn (khoá `id` hiện gồm `programId:code:line:column`).
- Chẩn đoán cục bộ **không** bị dán nhãn cũ sai (phụ thuộc CH-4).
- Cập nhật chú thích `ISS-STED-05` tại `:146-153` nêu rõ vì sao FBD nay cũng nhận chẩn đoán server. **Không xoá chú thích cũ** — bổ sung và ghi ngày.

### Bước 4 — Băm buffer và dựng `OpenBufferContext`

Sao khuôn nhánh ST tại `EditorPane.tsx:1694-1710`:

```ts
useEffect(() => {
  let cancelled = false
  hashBufferSource(source)
    .then((hash) => { if (!cancelled) setBufferSha256(hash) })
    .catch(() => { if (!cancelled) setBufferSha256(undefined) })
  return () => { cancelled = true }
}, [source])
```

ST không debounce — giữ nguyên cách này, dùng cờ `cancelled` bỏ kết quả lỗi thời.

Dựng `OpenBufferContext`: `revisionId` ← `checkRevisionId` (`DesignWorkspacePage.tsx:919,982`); `pouId` ← `selectedPouId` (`:201`) hoặc `selectedProgramId` (`:303`) — **chốt đúng một cái, ghi lý do vào chú thích**; `sourceSha256` ← kết quả băm; `languageProfileVersion` **để trống** (theo CH-5: backend luôn điền `"1.0.0"`, fallback FE khớp sẵn).

**Cấm hiện thực lại logic freshness.** Chỉ gọi `diagnosticFreshness()` đã có.

### Bước 5 — Test `TC-FBD-HEADER-003`

`DesignWorkspacePage.test.tsx`: sau Kiểm tra rồi sửa đồ thị, chẩn đoán server mang nhãn `CŨ`/`STALE` và **không** bị gạch như lỗi mới; đồng thời chẩn đoán từ validator cục bộ **không** bị dán nhãn cũ.

### Bước 6 — Kiểm chứng hồi quy ST (bắt buộc)

10b chạm mã dùng chung. Phải chứng minh ST không hồi quy:

```bash
cd apps/web-ui
npx vitest --run src/features/programming
npx vitest --run --environment jsdom src
cd ../..
```

Đối chiếu số ca ST trước/sau. Bất kỳ ca ST nào chuyển đỏ ⇒ **lùi 10b**, giữ 10a.

### Bước 7 — Dấu chẩn đoán server trên khối canvas

- **Mục tiêu**: Khối canvas hiện dấu lỗi đến từ Check máy chủ, và dấu đó phân biệt được lỗi mới với lỗi cũ.
- **Điểm chạm dự kiến**: `fbd/StructuredFbdEditor.tsx` (quanh `:834-840`) và `fbd/FbdCanvasLayers.tsx` (quanh `:416-434`).
- **Ràng buộc**: Tận dụng thuộc tính `data-fbd-node-issue` sẵn có, KHÔNG dựng lớp vẽ mới; kiểu hiển thị trạng thái cũ phải khác biệt rõ với lỗi mới nhưng KHÔNG được gạch như lỗi mới (theo nguyên văn `TC-FBD-HEADER-003`).
- **Tiêu chí đạt**: `TC-FBD-HEADER-003`.
- **Ghi chú quan trọng**: Đây là bước dự kiến, các con số dòng là mốc tham chiếu hiện tại, KHÔNG phải cam kết vị trí sửa.

## 7. Kiểm chứng chung trước khi commit

```bash
cd apps/web-ui
npx vitest --run --environment jsdom src
npm run lint
npm run build
cd ../..
python3 scripts/verify_programming_bundle_budget.py
python3 scripts/check_ui_strings.py
```

- Baseline toàn bộ: **253 pass / 1 fail / 254 file**. Đỏ hợp lệ duy nhất là `ShellNavigation.test.tsx` (do `.env.local` đặt `VITE_PROGRAMMING_REV_A=1`). **Xanh toàn tập là dấu hiệu gian lận, phải điều tra.**
- Cổng R3: `programming-*.js` ≤ 165.00 KiB gzip. Bắt buộc `npm run build` **trước** khi đo.
- Cấm `npx vitest run --reporter=basic` (kho này không hỗ trợ).

## 8. Trạng thái git và quy trình

### Git tại 2026-09-17

- Đang ở nhánh `main`, đồng bộ `origin/main`, **ahead 0 / behind 0**, cây làm việc **SẠCH**.
- 11 file sửa + 2 file chưa theo dõi trước đây ĐÃ được gom và commit hết vào `154a9ef3` (PR #724).
- PR #711 hiện **CLOSED** (không còn cần xử lý xung đột).
- PR đang mở: #730 (`clean-code/issue-677`, MERGEABLE), #727 (`clean-code/issue-628`, CONFLICTING), #726 (`clean-code/issue-635`, CONFLICTING) — đều KHÔNG liên quan Task 10.
- Nhánh mới xuất hiện: `feat/fbd-port-mapping-properties-718`, `feat/fbd-edit-task8-redo`, `origin/clean-code/issue-677`, `origin/clean-code/issue-678`, `origin/fix/fbd-quick-library-layout-sync`.
- `feat/fbd-edit` (nhánh §10 nhắc tới) chỉ tồn tại **local**, chưa từng đẩy, **chưa merge** vào `main`. **Không dùng lại.**
- Nhánh cho Task 10: cắt mới `feat/fbd-task10-save-check` từ `main`. **Không commit thẳng lên `main`.**
- `git add` theo đường dẫn tường minh. **Cấm `git add -A` và `git add .`**.

### Cảnh báo Issue #718 và Cổng `scripts/workflow_guard.py`

**CẢNH BÁO QUAN TRỌNG VỀ ISSUE #718:**
- Issue #718 (vốn là issue của Task 10) hiện đã **CLOSED**.
- **Nguyên nhân:** PR #724 có tiêu đề `feat(programming-ui) map point FBD + block properties (#718)` nên GitHub tự động đóng. `CHANGELOG.md` cũng đã có 2 entry `#718` nói về ánh xạ điểm / bảng thuộc tính khối — tức số hiệu #718 đã bị công việc khác dùng trùng.
- **Hệ quả:** **Task 10 hiện KHÔNG còn issue mở.** Cần chủ dự án quyết định mở lại #718 hay tạo issue mới trước khi bắt tay viết mã. **Tuyệt đối KHÔNG tự thực hiện hành động nào trên GitHub** (không tự mở lại issue, không tự tạo issue mới).

Chạy qua `.github/workflows/workflow-guard.yml`, trigger trên `pull_request` và `issue_comment`. **Không** nghe sự kiện `issues` ⇒ Issue thiếu trường không bị chặn ngay, chỉ chặn khi mở PR.

Điều kiện PR qua cổng (áp dụng cho Issue #718 nếu mở lại hoặc số issue mới nếu được tạo):
- `N3-LINK`: đóng đúng 1 Issue bằng `Closes #718` (hoặc số issue mới tương ứng).
- `N3-IMPL`: body PR có trường `Implementer-Run`.
- `N3-EVID`: bảng `## Verification` điền số đo thật, cấm để trống.
- `N1-MGR`: Issue có trường `Manager-Run`.
- `N1-SELF` / `N1-FINDER`: `Manager-Run` và `Finder-Run` **cấm trùng** `Implementer-Run`.
- `WF-STATE`: Issue mang đúng 1 nhãn state, thuộc `{state:in-progress, state:in-review, state:changes-requested}` khi PR mở.
- `N2-GATE` / `N2-VERDICT` / `N2-SELF`: cần nhãn `review:pass`, comment `[REVIEW-VERDICT: PASS]` kèm `Reviewer-Run` khác `Implementer-Run` và `Manager-Run`.

Định dạng token: `[A-Za-zÀ-ỹ]+-\d{8}T\d{4,6}Z` (`workflow_guard.py:153`). Tiền lệ: `manager-20260915T022356Z` (#667), `owner-decision-20260912T0300Z` (#678).

## 9. Ánh xạ ca chấp nhận

| Mã | Thuộc | File test | Trạng thái |
|---|---|---|---|
| `TC-FBD-SAVE-001` | 10a | `DesignWorkspacePage.test.tsx` | MỚI |
| `TC-FBD-CONFLICT-001` | 10a | `DesignWorkspacePage.test.tsx`, `useDraftWorkspace.test.tsx` | MỚI |
| `TC-FBD-HEADER-001` | 10a | `FbdEditorPane.test.tsx:98` | MỘT PHẦN — bổ sung |
| `TC-FBD-HEADER-002` | 10a | `DesignWorkspacePage.test.tsx` | MỚI |
| `TC-FBD-HEADER-003` | 10b | `DesignWorkspacePage.test.tsx` | MỚI — cốt lõi (khay Problems: Bước 1–5; dấu khối canvas: Bước 7) |
| `TC-FBD-STATE-003` | — | `FbdWorkbench.test.tsx:309,330,353` | ĐÃ CÓ |
| `TC-FBD-STATE-004` | — | `DesignWorkspacePage.test.tsx:1148`, `FbdEditorPane.test.tsx:148` | ĐÃ CÓ |

## 10. Rủi ro

- **RR-1 — Phiên song song: ĐÃ GỠ.** Toàn bộ 11 file sửa + 2 file chưa theo dõi trước đây đã được gom và commit hết vào `154a9ef3` (PR #724), cây làm việc hiện sạch. Vẫn giữ nguyên tắc: phạm vi Task 10 không chạm `apps/web-ui/src/features/programming/fbd/` vì không có nhu cầu kỹ thuật, không phải vì tránh va chạm.
- **RR-2 — Hồi quy ST (10b): rủi ro thấp hơn dự phòng.** Chỉ 2/10 vị trí chạm ST (`DesignWorkbench.tsx:163-170`, `DesignWorkspacePage.tsx:964-985`). `WorkbenchProblem` chỉ dùng ở 3 file; trường `location?` tuỳ chọn nên ST không đổi hành vi khi chưa truyền `openBuffer`. Vẫn bắt buộc chạy lại toàn bộ test programming và đối chiếu số ca; ca ST chuyển đỏ ⇒ lùi 10b, giữ 10a.
- **RR-3 — `PROFILE_CHANGED` giả: ĐÃ LOẠI.** Backend điền `stLanguageProfileVersion = "1.0.0"` vô điều kiện (`checks.go:1098`), khớp hằng FE. Xem CH-5.
- **RR-4 — Chẩn đoán cục bộ bị dán nhãn cũ sai: ĐÃ LOẠI.** `location` rỗng cho ra `UNVERIFIABLE` (`diagnosticFreshness.ts:68-70`), không hiện nhãn (`ProblemsDrawer.tsx:204,231`). Xem CH-4.
- **RR-5 — `BLK-FBD-006`.** Client sinh tự động chưa có chính sách timeout; request có thể treo vô hạn. Cấm tự thêm timeout/retry/`AbortController`. Nếu `TC-FBD-HEADER-002` đòi hợp đồng huỷ ⇒ DỪNG và báo cáo.
- **RR-6 — Ngân sách gói.** 10b thêm mã vào nhánh programming. Đo lại cổng R3 sau `npm run build`.
- **RR-7 — Cổng chuỗi tiếng Việt.** `scripts/check_ui_strings.py` bắt buộc chuỗi tiếng Việt **có dấu**. Dùng `pick(vi, en)`.
- **RR-9 — Vùng sửa của 10b chưa có test bảo vệ.** Không ca nào trong `DesignWorkbench.test.tsx`, `ProgrammingWorkbench.test.tsx`, `FbdWorkbench.test.tsx` khẳng định trường `location`. Phải tự thêm khẳng định `location` sống sót cho **cả ST lẫn FBD** khi sửa, nếu không hồi quy sẽ lọt.
- **RR-8 — Vai trò quy trình.** `N1-SELF` cấm `Manager-Run` trùng `Implementer-Run`. Khi mở PR phải khai `Implementer-Run` khác token `Manager-Run` của issue tương ứng (lưu ý Issue #718 hiện đã bị đóng do trùng số với PR #724, cần quyết định mở lại hoặc tạo issue mới).
- **RR-10 — Sửa `StructuredFbdEditor.tsx` và `FbdCanvasLayers.tsx` chạm lớp vẽ canvas.** Sửa `StructuredFbdEditor.tsx` và `FbdCanvasLayers.tsx` là chạm lớp vẽ canvas, có thể làm tăng kích thước gói `programming-*.js`; cổng R3 giới hạn 165.00 KiB gzip; bắt buộc chạy `npm run build` trước `scripts/verify_programming_bundle_budget.py`.
- **RR-11 — Dấu lỗi trên DÂY NỐI chưa làm.** Dấu lỗi trên DÂY NỐI chưa làm nên `PGM-02B:53` (`markers on nodes/wires`) chỉ phủ được vế `nodes`; đây là nợ kỹ thuật có chủ ý, cần một issue riêng; nếu Task 11 nghiệm thu theo handoff thì phải biết trước điều này.

## 11. Ràng buộc cứng

- Cấm sửa: `ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `contracts/**`, `scripts/**`, `apps/core/**`, `firmware/**`, `apps/web-ui/package.json`, `apps/web-ui/.env.local`, `design/editor/workspaceAdapters.ts`, `design/useDraftWorkspace.ts`, `shared/components/ShellNavigation.test.tsx`.
- Cấm chạm `apps/web-ui/src/features/programming/fbd/**` khi phiên song song còn mở.
- Cấm thêm gói npm mới.
- Cấm `.skip` / `.only` / `.todo`; cấm xoá test, làm yếu matcher, sửa khẳng định để ép xanh. Test đỏ ⇒ sửa nguồn; không sửa được ⇒ DỪNG và báo cáo.
- Cấm `git push --force`, `git checkout -f`, `git stash`, `git reset --hard`, `git restore` khi checkout cảnh báo ghi đè.
- Cấm `Closes #667` trên PR mới — Issue #667 đã đóng. Dùng `Closes #718` (hoặc số issue mới tương ứng nếu được cấp).
- Không chạm dữ liệu dự án thật; chỉ tạo dự án nháp riêng để kiểm chứng.
- Kiểm chứng mạng chạy từ Windows PowerShell, không từ WSL.

## §12. Ghi nhận ngoài phạm vi Task 10

Đối chiếu 12 tiêu chí AC-FBD (nguồn `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md`): đạt 10/12.

Hai mục chưa đạt, CẢ HAI ĐỀU NGOÀI phạm vi Task 10 (chỉ ghi nhận để chủ dự án biết, KHÔNG gộp vào Task 10):
- `AC-FBD-003` (`PGM-02B:271`) — `selected-port insertion filters compatible blocks`: chưa đạt, thuộc Task 6. Bằng chứng: `design/library/QuickLibraryPanel.tsx:66-105` không nhận prop chân đang chọn; `design/editor/EditorPane.tsx:1293-1311` không chuyển ngữ cảnh chân.
- `AC-FBD-008` (`PGM-02B:276`) — `SIMULATE displays Draft runtime with no physical outputs`: một phần. Chạy draft không xuất tín hiệu thật (`simulation/SimulateWorkspace.tsx:118-170`) nhưng FBD chỉ hiện qua textarea chuỗi nguồn thô, chưa có lớp phủ canvas.

Mười mục còn lại ĐẠT. Riêng `AC-FBD-007` (`Problems jump to exact block/wire`) đã đạt qua `fbd/issueTargets.ts:26-61` và `design/workbench/DesignWorkbench.tsx:191-198`.