# Báo cáo đợt vá kế hoạch FBD EDIT Workspace

**Tài liệu áp dụng:** `docs/superpowers/plans/2026-08-31-fbd-edit.md`
**Ngày hoàn thành:** 2026-09-03
**Trạng thái:** Đã nghiệm thu kiểm chứng cơ học và tài liệu

---

## 1. Tóm tắt

Đợt vá đưa kế hoạch FBD EDIT đồng bộ hoàn toàn với baseline HEAD sau merge nhánh chính.
Quy mô tài liệu kế hoạch tăng từ 814 lên 871 dòng, xử lý triệt để 20 điểm khiếm khuyết.
Bổ sung 3 task thực thi mới gồm gỡ chặn môi trường, tối ưu bundle và phân rã component lớn.
Tái sử dụng tối đa các module hạ tầng mới xuất hiện sau merge thay vì viết mới trùng lặp.
Thiết lập cơ chế bảo vệ nghiêm ngặt 3 file frontend đang dirty của người dùng trên workspace.
Bảng truy vết kiểm thử mở rộng đạt độ phủ 100% đối chiếu 38 mã kịch bản kỹ thuật.
Toàn bộ đợt thực hiện chỉ hiệu chỉnh tài liệu kế hoạch và changelog, không viết code sản phẩm.

---

## 2. Bối cảnh và lý do vá

Kế hoạch ban đầu được xây dựng dựa trên commit baseline cũ `b066e5c6`. Sau khi repository thực hiện merge `origin/main` tại commit HEAD `70d70c596108efea6365300a10e6c5a714c95bb9`, toàn bộ codebase có biến động lớn với 146 file thay đổi (+12,328 dòng / −548 dòng). Sự dịch chuyển baseline này tạo ra nhiều sai lệch nghiêm trọng nếu giữ nguyên kế hoạch cũ:

1. **Lệch cấu trúc và số dòng:** File điều phối `ProgramsTab.tsx` tăng lên 3,190 dòng, vi phạm trần thiết kế 800 dòng và chứa sẵn các phần giao diện FBD cần bóc tách.
2. **Trùng lặp công việc:** Sau merge, hệ thống đã có sẵn module quản lý độ tươi chẩn đoán (`shared/diagnosticFreshness.ts` từ `ISS-STED-18`), ngăn kéo hiển thị sự cố (`shared/ProblemsDrawer.tsx`), và ngữ cảnh FBD Inspector (`design/inspector/inspectorContext.ts`). Kế hoạch cũ vẫn yêu cầu viết mới các phần này.
3. **Môi trường Windows bị chặn thực thi:** Lệnh `python3` trên môi trường Windows trỏ vào stub rỗng của hệ điều hành, khiến 7 script npm thiết yếu và khâu kiểm tra lint/build thất bại ngay từ đầu.
4. **Mâu thuẫn ranh giới thao tác:** Kế hoạch vừa ra lệnh cấm sửa đổi 3 file frontend đang dirty, vừa phân công task trực tiếp chỉnh sửa các file này.
5. **Sai lệch cổng kiểm soát bundle:** Cổng kiểm tra bundle budget thực tế toàn repo là `r3` (165 KiB), trong khi kế hoạch áp đặt cổng `r1` (125 KiB) nhưng không có phương án kỹ thuật xử lý con số thực đo 157.20 KiB.

Việc ban hành đợt vá là điều kiện tiên quyết để đảm bảo kế hoạch có tính khả thi, an toàn và sẵn sàng cho việc phân rã thực thi.

---

## 3. Bảng 20 điểm vá

| Mã | Nhóm | Vấn đề | Cách vá | Vị trí trong plan |
|---|---|---|---|---|
| A1 | Chặn | `python3` là stub WindowsApps khiến 7 script npm và lint/build hỏng | Thêm Task 0.5 tạo shim `python3` trỏ về `python` (3.13.2); không sửa `package.json` | §0.5 (dòng 60–89) |
| A2 | Chặn | Plan giả định cổng bundle là `r1` trong khi `package.json` cấu hình `r3` | Ghi nhận đúng cổng repo là `r3`; đưa việc đổi sang `r1` vào mục quyết định cần Owner | §0.3 (dòng 51) |
| A3 | Chặn | Chưa có task xử lý vượt budget R1 (`BLK-FBD-003`, đo thật 157.20 > 125 KiB) | Thêm Task 1.5 cấu hình `manualChunks` cho `programming` trong `vite.config.ts` | §1.5 (dòng 158–196) |
| A4 | Chặn | `expectedSelectionRevision` chỉ có trong văn xuôi, chưa có trong reducer | Task 3 bổ sung `selectionRevision: number` vào state và reducer atomic quản lý | §3 (dòng 253–268) |
| B1 | Cao | Plan yêu cầu commit 11 lần trực tiếp lên `main` vi phạm quy trình | Tạo nhánh riêng `feat/fbd-edit` ở Task 0; toàn bộ commit thực hiện trên nhánh này | §0.2 (dòng 39), §1 |
| B2 | Cao | `ProgramsTab.tsx` dài 3,190 dòng mà 5 task còn tiếp tục thêm code | Thêm Task 5.5 tách `FbdEditorPane` ra file riêng `design/editor/FbdEditorPane.tsx` | §0.1 (dòng 23–24), §5.5 (dòng 395–434) |
| B3 | Cao | Plan dùng lệnh tương tác `git add -p` gây treo harness tự động | Bỏ `git add -p`; commit/stash 3 file dirty trước, chỉ `git add` theo allowlist cụ thể | §0.2 (dòng 40–45) |
| B4 | Cao | Quy tắc rollback viện dẫn feature flag nhưng không có task tạo | Thêm vào Task 2 bước tạo `isFbdEditEnabled` / `FBD_EDIT_ENABLED` trong `shared/config.ts` | §2 (dòng 202, 209–211), §13 (dòng 784) |
| C1 | Trung bình | Thiếu kiểm tra cổng dấu tiếng Việt (`check:ui-strings`) chạy trong lint | Mọi task sinh chuỗi UI (2, 5, 6, 7, 8, 9) thêm tiêu chí nghiệm thu `npm run lint` xanh | Task 2, 5, 6, 7, 8, 9 |
| C2 | Trung bình | Mâu thuẫn file E2E: `programming.spec.ts` bị merge đụng và đang dirty | Phân lập E2E mới vào `apps/web-ui/e2e/fbd-edit.spec.ts`, không chạm file cũ | §0.1 (dòng 33), §11 (dòng 691, 715) |
| C3 | Trung bình | Trùng tên file test shell giữa `.test.ts` và `.test.tsx` trong Vite | Đổi tên test shell thành `FbdEditorPane.test.tsx` hoặc `ProgramsTabFbdShell.test.tsx` | §5.5 (dòng 401), §8 |
| C4 | Trung bình | Lệnh trong plan viết theo PowerShell và kèm cờ thừa `--environment jsdom` | Chuyển toàn bộ sang bash Unix (`/`), bỏ `--environment jsdom` vì Vite đã định nghĩa | §1, §3, §5, §11 |
| C5 | Trung bình | Bảng truy vết chỉ ánh xạ mục spec chung chung, thiếu ID kiểm thử | Bổ sung cột và mục 14.2 đối chiếu chi tiết 38 kịch bản `TC-FBD-*` | §14.1, §14.2 (dòng 793–856) |
| D1 | Do merge | Task 10 Step 2 lên kế hoạch tự làm phần stale diagnostic đã có sẵn | Tái dùng `shared/diagnosticFreshness.ts`, chỉ nối FBD vào context có sẵn | §0.1 (dòng 31), §10 (dòng 656–664) |
| D2 | Do merge | Task 9 lên kế hoạch tự xây dựng panel Problems đã có sẵn | Tái dùng trực tiếp component `shared/ProblemsDrawer.tsx` (348 dòng) có sẵn | §0.1 (dòng 30), §9 (dòng 600, 620–625) |
| D3 | Do merge | Task 7 định nghĩa lại cấu trúc Inspector context FBD đã có sẵn | Nối UI trực tiếp vào `InspectorFbdBlockContext`/`inspectorContextFor` trong context | §0.1 (dòng 29), §7 (dòng 496, 510–520) |
| D4 | Do merge | Khối PID chưa qua duyệt Controls+Safety (`BLK-FBD-005`) cần chốt kỹ thuật | Ghi nhận chốt chặn kỹ thuật `featureState: "REVIEW_REQUIRED"` có sẵn trong code | §0.3 (dòng 53), §6 (dòng 440, 465–470) |
| E1 | Kiểm bản vá | Plan mâu thuẫn: §0.2 cấm sửa file dirty nhưng Task 8 lại sửa | Task 8 dùng composition qua `design/DesignWorkspacePage.tsx`, bảo vệ file dirty | §0.1 (dòng 25), §0.2 (dòng 40–43), §8 (dòng 545, 560–575) |
| E2 | Kiểm bản vá | Plan vẫn ghim SHA baseline cũ `b066e5c6` tại §0.2 dòng 43 | Cập nhật SHA neo chuẩn xác vào commit HEAD sau merge `70d70c59` | §0.2 (dòng 47) |
| E3 | Kiểm bản vá | File test E2E mới chưa có cơ chế tự chủ dữ liệu để chạy độc lập | Khai báo `page.route` và storage state trong `fbd-edit.spec.ts`, không cần backend live | §11 (dòng 718–725) |

---

## 4. Ba task mới thêm

### Task 0.5: Gỡ chặn interpreter (Task 0.5)
- **Vị trí trong tài liệu:** Mục §0.5 (dòng 60–89), đặt trước Task 1.
- **Nội dung và kỹ thuật:** Tạo script shim `python3` trỏ về lệnh `python` (phiên bản 3.13.2) trong thư mục PATH của môi trường dev shell (`~/.local/bin/python3`). Tuyệt đối không can thiệp vào `package.json` của dự án để bảo toàn môi trường chạy của CI Linux.
- **Mục đích:** Gỡ bỏ trạng thái chặn đứng của 7 script npm kiểm tra (`check:ui-strings`, `check:bundle-budget`, v.v.) và script kiểm tra tổng thể dự án do vấp phải WindowsApps stub.
- **Tiêu chí hoàn thành:** Lệnh `python3 --version` trả về đúng chuỗi nhận diện Python 3.13.2. Mọi task có bước chạy lint/build đều khai báo phụ thuộc tường minh vào Task 0.5.

### Task 1.5: Tách chunk programming (Task 1.5 — Bundle Optimization)
- **Vị trí trong tài liệu:** Mục §1.5 (dòng 158–196), đặt giữa Task 1 và Task 2.
- **Nội dung và kỹ thuật:** Bổ sung quy tắc phân tách gói thủ công (`manualChunks`) cho đường dẫn `src/features/programming/**` bên trong cấu hình `build.rollupOptions.output` của file `apps/web-ui/vite.config.ts`.
- **Mục đích:** Xử lý triệt để blocker kỹ thuật `BLK-FBD-003` khi gói bundle R1 hiện tại đạt 157.20 KiB, vượt quá hạn mức thiết kế 125 KiB gzip.
- **Tiêu chí hoàn thành:** Chunk `programming` được tách riêng khi build; đo đạc số liệu thực tế bằng script chuyên dụng; ghi nhận kết quả minh bạch để Owner quyết định về hạn mức nếu không đạt 125 KiB.

### Task 5.5: Tách FbdEditorPane ra module riêng (Task 5.5)
- **Vị trí trong tài liệu:** Mục §5.5 (dòng 395–434), đặt ngay trước Task 6.
- **Nội dung và kỹ thuật:** Trích xuất toàn bộ khối hàm `FbdEditorPane` (từ dòng 2732 đến dòng 2832 trong `ProgramsTab.tsx`) sang file độc lập `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx`. Di chuyển các import đi kèm (`StructuredFbdEditor`, `canonicalFbdJson`, `fbdStatusFields`), giữ lại hàm dùng chung `parseFbdDocument`.
- **Mục đích:** Giảm tải cho file `ProgramsTab.tsx` đang có dung lượng 3,190 dòng, ngăn ngừa nguy cơ phình to mất kiểm soát khi bổ sung thêm các tính năng soạn thảo FBD mới.
- **Tiêu chí hoàn thành:** Thực hiện thuần túy cơ học không đổi hành vi; `ProgramsTab.tsx` giảm khoảng 100 dòng; các bộ kiểm tra `vitest` và `typecheck` đều duy trì trạng thái xanh.

---

## 5. Bằng chứng kiểm chứng

Toàn bộ các phép kiểm tra tính toàn vẹn cơ học và quy chuẩn tài liệu đã được thực thi và xác thực độc lập:

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả ghi nhận | Trạng thái |
|---|---|---|---|
| Kiểm tra git diff format | `git diff --check` | Đầu ra rỗng hoàn toàn, không có lỗi định dạng | PASS |
| Khoảng trắng cuối dòng | `grep -n '[ \t]$' docs/superpowers/plans/2026-08-31-fbd-edit.md` | 0 dòng vi phạm khoảng trắng thừa | PASS |
| Tính chẵn lẻ code fence | `grep -c '^```' docs/superpowers/plans/2026-08-31-fbd-edit.md` | 2 fence ở cột đầu dòng (chẵn); tính cả fence thụt lề bằng `grep -c '^\s*```'` được 68 (cũng chẵn) — mở đóng khớp cặp | PASS |
| Harness tài liệu ISO | `PYTHONUTF8=1 python scripts/docs_iso_harness.py --expect rc=0` | Đạt 17/17 file baseline, 5/5 support, 0 link gãy, 0 anchor lỗi | PASS |
| Đối chiếu kịch bản TC-FBD | `grep -c '^\| `TC-FBD-' docs/superpowers/plans/2026-08-31-fbd-edit.md` | Đúng 38 dòng tương ứng 38 mã kịch bản `TC-FBD-*` | PASS |
| Kích thước tài liệu plan | Đếm dòng file `2026-08-31-fbd-edit.md` | Đạt 871 dòng (tăng 57 dòng từ baseline 814) | PASS |

---

## 6. Việc còn mở: blocker và quyết định cần Owner

### Các Blocker kỹ thuật và quy trình tiếp tục mở
1. **`BLK-FBD-003` (Ngân sách bundle R1):** Đo thực tế hiện tại là 157.20 KiB, vượt trần 125 KiB gzip. Đợt vá này mới chỉ bổ sung giải pháp kỹ thuật tại Task 1.5 trong tài liệu kế hoạch chứ chưa tiến hành sửa code thực tế.
2. **`BLK-FBD-006` (Timeout transport client):** Client kết nối của phân hệ programming chưa thiết lập timeout mặc định. Kế hoạch tuân thủ nghiêm ngặt nguyên tắc fail-closed, không tự ý bổ sung retry/timeout mà chờ quyết định kiến trúc transport.
3. **`BLK-FBD-004` và `BLK-FBD-007` (Bằng chứng duyệt trình duyệt và phê duyệt baseline):** Việc nghiệm thu trên trình duyệt thực tế và ký duyệt baseline vẫn mở, bắt buộc phải có biên bản thực hiện khi chạy xong kế hoạch.
4. **`BLK-FBD-005` (Khối hàm PID):** Về mặt kỹ thuật, khối đã được khóa an toàn bằng cờ `featureState: "REVIEW_REQUIRED"` và trạng thái chặn kéo thả trong code hiện hữu; blocker này chuyển sang trạng thái đã có chốt chặn kỹ thuật, tiếp tục mở để chờ chữ ký phê duyệt từ hội đồng Controls + Safety.
5. **`BLK-FBD-001` (Khuyết thiếu `variableId`):** Schema FBD v1 chưa có trường định danh biến; bộ chọn biến chỉ dựa vào bộ 3 name/type/unit, chưa hỗ trợ identity ổn định.

### Quyết định CẦN OWNER phê duyệt
- **Chuyển đổi cổng kiểm tra bundle toàn repo:** Cấu hình hiện hành tại `package.json` là `"check:bundle-budget": "python3 ../../scripts/verify_programming_bundle_budget.py --increment r3"` (ngưỡng R3 là 165 KiB).
- **Vấn đề cần quyết định:** Có chính thức chuyển cờ kiểm tra từ `--increment r3` sang `--increment r1` (ngưỡng R1 là 125 KiB) hay không? Việc thay đổi cờ này là hành động thay đổi cổng kiểm soát trên quy mô toàn bộ repository, ảnh hưởng trực tiếp đến quy trình CI/CD của tất cả nhánh phát triển khác, do đó bắt buộc phải do Owner quyết định, không thuộc thẩm quyền của kế hoạch FBD.

---

## 7. Phạm vi KHÔNG chạm tới

Để đảm bảo tính toàn vẹn và độ an toàn cao nhất cho kho mã, đợt công tác tuân thủ tuyệt đối các giới hạn sau:

- **Không viết code sản phẩm:** Đợt này chỉ thực hiện công tác hiệu chỉnh tài liệu kế hoạch và cập nhật changelog dự án; không có bất kỳ dòng mã nguồn sản phẩm nào được tạo mới hoặc chỉnh sửa.
- **Không can thiệp cấu hình repo chung:** Không sửa đổi file `package.json` hoặc các script kiểm tra chung để tránh gây xung đột trên môi trường CI Linux.
- **Bảo vệ tuyệt đối 3 file frontend dirty:** Giữ nguyên trạng thái làm việc cục bộ của người dùng trên 3 file:
  - `apps/web-ui/e2e/programming.spec.ts`
  - `apps/web-ui/src/features/programming/layout/ProgrammingHeader.tsx`
  - `apps/web-ui/src/features/programming/layout/ProgrammingLayout.tsx`
- **Không đụng chạm mã nguồn lõi:** Toàn bộ thư mục backend/core (`apps/core/**`) và script kiểm tra cá nhân (`scripts/gate353-cpp.sh`) được giữ nguyên vẹn.
- **Không dùng lệnh git mang tính phá hủy:** Tuyệt đối không dùng `git reset`, `git checkout --`, `git clean` hoặc xóa tệp tin diện rộng.
- **Không tự ý mở rộng schema:** Không bịa thêm các trường dữ liệu ngoài đặc tả (như tự thêm `variableId`) hoặc tự ý tạo thêm endpoint API backend.
