# CLAUDE.md — DDC-PROJECT AI Instructions
## MK-DDC-24 | Đọc file này TRƯỚC KHI làm bất cứ việc gì

---

## LUẬT SỐ 1 — DOC TRƯỚC, CODE SAU (HARD GATE)

**KHÔNG ĐƯỢC bắt đầu implement bất kỳ task nào khi chưa có tài liệu thiết kế/plan được duyệt.**

Nếu task mới phát sinh mà chưa có plan doc → DỪNG → viết plan → trình duyệt → SAU ĐÓ mới code.
Không có exception. Không có "nhỏ quá nên bỏ qua".

---

## LUẬT SỐ 2 — GATE "PLAN TRƯỚC KHI CODE"

Trước khi implement bất kỳ task nào, phải trả lời được 3 câu này:

| Câu | Nguồn tài liệu |
|-----|----------------|
| Spec/contract của feature này là gì? | `02_design/` hoặc `shared/*.h` |
| Task này có trong checklist chưa? | `11_TASK_CHECKLIST.md` |
| Có plan doc chi tiết chưa? | `22_SOM_SRC_IMPLEMENTATION_PLAN.md` hoặc file plan riêng |

Nếu bất kỳ câu nào trả lời "không" → **VIẾT DOC TRƯỚC**.

---

## LUẬT SỐ 3 — KHI NÀO CẦN LÀM GÌ

### A. Feature mới / module mới
1. Kiểm tra doc `02_design/` tương ứng — nếu chưa có hoặc chưa đủ: **viết/cập nhật trước**
2. Viết plan doc (như 23_GRAPH_STATEFUL_COMPONENTS_PLAN.md) hoặc thêm block vào 22
3. Trình owner duyệt plan
4. Sau khi duyệt: annotate 03 + 07/06 + 11 + 22 → MỚI code
5. Sau khi code xong: bump Rev tất cả doc đã annotate

### B. Sửa behavior đã có (bug fix, spec change)
1. Xác định doc nào đang mô tả behavior đó (`07` hoặc `06` hoặc `02_design/`)
2. Sửa doc TRƯỚC — ghi rõ lý do thay đổi
3. Nếu behavior thay đổi làm mâu thuẫn với doc khác → giải quyết mâu thuẫn TRƯỚC (xem Luật 5)
4. Sau đó code → annotate 11 + 03

### C. Architectural decision
1. Viết ADR trong `docs/adr/` TRƯỚC KHI code
2. ADR phải có: Context, Decision, Consequences, Status=Proposed
3. Trình owner duyệt → Status=Accepted → mới code

---

## LUẬT SỐ 4 — CHECKLIST CẬP NHẬT KHI TASK DONE

Task CHƯA được đánh Done nếu chưa update tất cả doc liên quan:

| Loại thay đổi | Bắt buộc update |
|---------------|----------------|
| SOM iobus | `03_PHASE_PLAN` + `06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE` + `11_TASK_CHECKLIST` + `22_SOM_SRC_IMPLEMENTATION_PLAN` |
| SOM core | `03_PHASE_PLAN` + `07_MKDDC_CORE_IMPLEMENTATION_GUIDE` + `11_TASK_CHECKLIST` + `22_SOM_SRC_IMPLEMENTATION_PLAN` |
| Component type mới | `SW_COMPONENT_LIBRARY` + `07` (§graph) + `11` + `22` |
| Config field mới | `CONFIG_SCHEMA` (02_design/interfaces) + `07` |
| API endpoint mới | `REST_API_OPENAPI` (02_design/interfaces) + `09_WEB_GUIDE` |
| State/persist behavior | `SW_RUNTIME_EXECUTION_MODEL` + `07` |
| Safety trigger | `07 §5.2` (trigger matrix) + `11` |
| Packaging/systemd | `06 §10` hoặc `07 §9` + `11` |

**Annotation format:** `Trạng thái: ĐÃ làm YYYY-MM-DD — [1 dòng tóm tắt]`
**Rev format:** bump minor (1.3→1.4) + thêm dòng vào Rev footer với ngày và tóm tắt.

---

## LUẬT SỐ 5 — KHI PHÁT HIỆN HAI DOC APPROVED MÂU THUẪN NHAU

**DỪNG NGAY. Không được chọn "theo doc nào" rồi code.**

Quy trình bắt buộc:
1. Ghi rõ mâu thuẫn ra (như GAP-01 trong 23_GRAPH_STATEFUL_COMPONENTS_PLAN.md)
2. Đề xuất resolution + lý do kỹ thuật
3. Trình owner duyệt
4. Sau khi duyệt: sửa doc bị sai → bump Rev → ghi "sửa do mâu thuẫn vs [tên doc kia]"
5. MỚI code theo resolution đã duyệt

---

## LUẬT SỐ 6 — THỨ TỰ ƯU TIÊN TÀI LIỆU (khi không rõ doc nào đúng)

```
shared/*.h (frozen contract)
  > docs/02_design/interfaces/*.md (interface spec)
  > docs/02_design/software/*.md (design spec)
  > docs/adr/*.md (architectural decision)
  > docs/03_implementation/0[67]_*_GUIDE.md (implementation guide)
  > docs/03_implementation/22_*.md (plan)
  > docs/03_implementation/11_*.md (task checklist)
```

Doc cấp thấp hơn KHÔNG được override doc cấp cao hơn mà không có ADR hoặc amendment.

---

## LUẬT SỐ 7 — KHÔNG TẠO DOC MỚI KHI ĐÃ CÓ DOC ĐÚNG CHỖ

Trước khi tạo file `.md` mới:
1. Kiểm tra `docs/03_implementation/` — đã có file nào cover topic này chưa?
2. Nếu có → cập nhật file cũ, không tạo file mới
3. Nếu phải tạo file mới → ghi rõ lý do tại sao không cập nhật file cũ

Doc cũ không còn dùng → đánh dấu `[ARCHIVED YYYY-MM-DD — thay bởi: X]` ở đầu file, KHÔNG xóa.

---

## CẤU TRÚC TÀI LIỆU DỰ ÁN

```
docs/
├── 01_specs/          — Product spec, scope, roadmap (KHÔNG tự sửa, chỉ đọc)
├── 02_design/
│   ├── firmware/      — FW design (Dev1 owner)
│   ├── interfaces/    — Contract: CONFIG_SCHEMA, GRAPH_SCHEMA, REST_API, BACnet PICS
│   └── software/      — SW design: COMPLIB, RUNTIME_MODEL, DDD...
├── adr/               — Architectural Decision Records
└── 03_implementation/
    ├── 03_PHASE_PLAN           — phase tracker (update khi phase đổi trạng thái)
    ├── 06_MKDDC_IOBUS_*        — iobus implementation guide (update khi IOB task done)
    ├── 07_MKDDC_CORE_*         — core implementation guide (update khi COR task done)
    ├── 09_MKDDC_WEB_*          — web implementation guide (update khi WEB task done)
    ├── 11_TASK_CHECKLIST       — task tracker (update khi task done)
    └── 22_SOM_SRC_IMPL_PLAN    — SOM microtask plan (update khi microtask done)
```

---

## LƯU Ý VỀ CODE REVIEW / VERIFY

Khi review code hoặc verify feature:
- Không chỉ check behavior — check xem doc có phản ánh đúng implementation không
- Nếu doc và code lệch → fix doc (hoặc fix code nếu code là sai), không bỏ qua

---

**File này được đọc tự động bởi Claude Code ở đầu mỗi session.**
**Dev người thật: đọc [docs/DOC_GOVERNANCE.md](docs/DOC_GOVERNANCE.md)**

## Documentation Governance

- Không trộn spec chính với report review.
- Không trộn protocol docs với implementation guide.
- Không xóa tài liệu cũ nếu chưa có quyết định; đưa vào docs/archive/.
- Mỗi thư mục docs chính phải có README hoặc index.
- Tài liệu chính phải có:
  - Purpose
  - Scope
  - Owner
  - Status: Draft / Review / Approved / Deprecated
  - Last Updated
- Khi đổi protocol/runtime/API phải cập nhật docs liên quan và ADR nếu thay đổi kiến trúc.
- Report theo ngày để trong docs/11_reports/, không để lẫn với spec chính.


