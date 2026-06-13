# DOC_GOVERNANCE — Quy tắc quản lý tài liệu MK-DDC-24

> **Phiên bản:** 1.0 | 2026-06-13
> **Owner:** Project Lead
> **Áp dụng cho:** tất cả dev, tester, AI agent làm việc trên repo này

---

## Nguyên tắc cốt lõi

> **"Tài liệu thiết kế / quyết định phải tồn tại và được duyệt TRƯỚC KHI bất kỳ dòng code nào được viết."**

Vi phạm nguyên tắc này → PR bị reject, không exception.

---

## 1. Vòng đời một task

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────┐
│  Phát hiện  │───►│ Viết plan /  │───►│ Owner duyệt  │───►│   Code +     │───►│  Close   │
│   task mới  │    │  design doc  │    │   plan doc   │    │  update doc  │    │  task    │
└─────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────┘
                          ▲                                        │
                          └──── nếu phát hiện gap trong khi code ─┘
                               (DỪNG code, resolve gap, tiếp tục)
```

### Bước 1 — Viết plan/design doc

**Ai làm:** người thực thi task (Dev / AI agent)

**Nội dung tối thiểu của plan doc:**
- Tài liệu thiết kế đã có gì (link đến file cụ thể + section)
- Thiếu gì / mâu thuẫn gì (liệt kê từng GAP với ID)
- Spec bổ sung đề xuất cho từng GAP
- Task/microtask + effort estimate
- Phụ thuộc vào task nào trước

**Format:** theo 22_GRAPH_STATEFUL_COMPONENTS_PLAN.md làm mẫu.

**Không cần plan riêng nếu:** task nhỏ (<4h), spec đã đủ trong 02_design + 06/07, và task block trong 10_TASK_CHECKLIST đã có đủ Input/Output/Test/Done.

### Bước 2 — Owner duyệt

**Owner** = Project Lead (hoặc người được ủy quyền).

Khi duyệt, owner phải trả lời rõ từng GAP: chốt ✅ hay sửa ❌, và lý do.

**Output của bước này:** plan doc đổi trạng thái từ DRAFT → Approved (ghi vào header).

### Bước 3 — Code + update doc đồng thời

Sau khi code xong từng microtask, DEV phải cập nhật ngay (không để cuối sprint):

| Loại thay đổi | Doc phải update |
|---------------|----------------|
| Thêm module SOM iobus | `03_PHASE_PLAN` + `06_IOBUS_GUIDE` + `10_TASK_CHECKLIST` + `21_SOM_PLAN` |
| Thêm module SOM core | `03_PHASE_PLAN` + `07_CORE_GUIDE` + `10_TASK_CHECKLIST` + `21_SOM_PLAN` |
| Thêm component type | `SW_COMPONENT_LIBRARY` + `07 §graph` + `10` + `21` |
| Thêm config field | `CONFIG_SCHEMA` + `07` |
| Thêm API endpoint | `REST_API_OPENAPI` + `08_WEB_GUIDE` |
| Thay đổi state/persist | `SW_RUNTIME_EXECUTION_MODEL` + `07` |
| Thay đổi safety trigger | `07 §5.2 trigger matrix` + `10` |
| Thay đổi packaging/systemd | `06 §10` hoặc `07 §9` + `10` |
| Quyết định kiến trúc | ADR mới trong `docs/adr/` |

**Annotation format trong doc:**
```
Trạng thái: ĐÃ làm 2026-MM-DD — [tóm tắt 1 dòng]
```

**Rev bump:** minor (1.3→1.4) + thêm dòng vào footer Rev với ngày + tóm tắt.

### Bước 4 — Close task

Task chỉ được đánh Done khi:
- [ ] Code commit đã có test pass
- [ ] Tất cả doc trong bảng bước 3 đã được update
- [ ] Rev đã bump ở tất cả doc đó
- [ ] Không còn doc nào Approved bị mâu thuẫn với code mới

---

## 2. Xử lý mâu thuẫn giữa hai doc Approved

**DỪNG NGAY khi phát hiện.** Không được tự chọn rồi code.

```
Phát hiện mâu thuẫn
       │
       ▼
Ghi rõ mâu thuẫn (ID: GAP-XX, file A §Y vs file B §Z, nội dung cụ thể)
       │
       ▼
Đề xuất resolution + lý do kỹ thuật
       │
       ▼
Owner duyệt resolution
       │
       ▼
Sửa doc bị sai → bump Rev → ghi "sửa do mâu thuẫn vs [tên doc kia]"
       │
       ▼
Code theo resolution đã duyệt
```

---

## 3. Thứ tự ưu tiên tài liệu

Khi không rõ doc nào đúng, thứ tự ưu tiên từ cao → thấp:

```
1. shared/*.h                           (frozen contract — không được sửa nếu không có ADR)
2. docs/02_design/interfaces/*.md       (interface spec: CONFIG_SCHEMA, GRAPH_SCHEMA, REST_API...)
3. docs/02_design/software/*.md         (design spec: COMPLIB, RUNTIME_MODEL...)
4. docs/adr/*.md                        (architectural decision)
5. docs/03_implementation/0[678]_*GUIDE.md  (implementation guide)
6. docs/03_implementation/21_*.md       (plan)
7. docs/03_implementation/10_*.md       (task checklist)
```

Doc cấp thấp hơn **không được override** doc cấp cao hơn. Muốn override → phải có ADR mới hoặc amendment được duyệt trước.

---

## 4. Vòng đời tài liệu (trạng thái)

| Trạng thái | Ý nghĩa | Ai set |
|-----------|---------|--------|
| `DRAFT` | Đang soạn, chưa được duyệt — KHÔNG được code theo | Author |
| `Approved` | Đã được owner duyệt — được code theo | Owner |
| `Active` | Đang trong quá trình thực thi — có thể cập nhật trạng thái từng task | Dev |
| `ARCHIVED YYYY-MM-DD` | Không còn áp dụng — thay bởi doc khác (ghi rõ link) | Owner |

**Không bao giờ xóa doc cũ** — chỉ archive.

---

## 5. Khi nào cần ADR mới

| Tình huống | Cần ADR |
|-----------|---------|
| Thêm thư viện/dependency mới (ngoài stdlib) | Có |
| Thay đổi protocol inter-process (IOP, SHM, socket) | Có |
| Thêm/bớt process hệ thống | Có |
| Thay đổi security model (auth, audit, key) | Có |
| Thay đổi cách persist/restore state | Có |
| Thêm feature nhỏ không đổi architecture | Không |
| Bug fix không đổi contract | Không |

ADR template: `docs/02_design/_templates/TEMPLATE_DDD.md` (hoặc tạo mới theo cấu trúc ADR-004..ADR-008).

---

## 6. Checklist PR review

PR reviewer phải check các điểm sau trước khi Approve:

**Documentation:**
- [ ] Mọi doc liên quan trong bảng §1 Bước 3 đã được update
- [ ] Không còn DRAFT doc nào được code theo
- [ ] Rev đã bump ở tất cả doc bị thay đổi
- [ ] Không có doc Approved nào bị mâu thuẫn với code mới

**Code:**
- [ ] Không có module mới thiếu doc ở 06/07
- [ ] Không có config field mới thiếu trong CONFIG_SCHEMA
- [ ] Không có behavior thay đổi mà 07 chưa phản ánh

**Nếu PR chỉ là update doc** (không có code): vẫn phải check Rev bump và không tạo mâu thuẫn mới.

---

## 7. Người mới vào dự án

Đọc theo thứ tự này trước khi viết bất kỳ dòng code nào:

1. [docs/02_design/GETTING_STARTED_DEV.md](02_design/GETTING_STARTED_DEV.md)
2. [docs/03_implementation/15_CONTRACT_FREEZE.md](03_implementation/15_CONTRACT_FREEZE.md)
3. [docs/03_implementation/16_QUICK_START_SOM_DEV.md](03_implementation/16_QUICK_START_SOM_DEV.md)
4. [docs/03_implementation/03_PHASE_PLAN.md](03_implementation/03_PHASE_PLAN.md)
5. Module guide tương ứng: 06 (iobus) / 07 (core) / 08 (web)
6. File này (DOC_GOVERNANCE.md)

---

**Rev** 1.0 | 2026-06-13 — khởi tạo, enforce "doc trước code sau"
