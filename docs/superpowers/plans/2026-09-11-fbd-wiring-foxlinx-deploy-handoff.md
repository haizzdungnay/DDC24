# Session Handoff — FBD Wiring & Foxlinx Deploy

### 1. SESSION OBJECTIVE
Chẩn đoán và khắc phục triệt để lỗi không thể nối dây (wiring) và tương tác kéo thả khối FBD trên web-ui sau khi deploy lên board Foxlinx (SOM-DDC-24-foxlinx). Sau khi sửa và kiểm chứng toàn bộ tests/build FE, thực hiện build Go backend và deploy đồng bộ lên board Foxlinx theo quy trình skill `foxlinx-deploy`.

### 2. USER REQUIREMENTS & HARD CONSTRAINTS
- **Yêu cầu của user**:
  - "sau khi deploy lên foxlink ( xem sklill foxlink ) thì không còn kéo thả được (không có kéo thả được( xem ảnh minh họa không có nối được ) kiểm tra xem lỗi gì và deploy lại với skill foxlink".
  - Sửa frontend tại `http://localhost:5173/eng/programming/projects/` (cụ thể phần FBD).
  - Khắc phục hiện tượng dây nối xem trước (preview wire đứt nét) bị kẹt đơ giữa `#1 · AND` (OUT) và `#0 · AND` (IN1), nút "Hủy nối" trên toolbar bị kẹt sáng, không thể hoàn tất nối hoặc hủy kết nối.
- **Ràng buộc cứng & bảo mật**:
  - Deploy lên board Foxlinx: `root@mekong-fac.ddns.net:2223`, key `~/.ssh/mkddc24_som`.
  - **TUYỆT ĐỐI KHÔNG** ghi đè, làm lộ hoặc in giá trị `JWT_SECRET` ra command line, terminal log hay file mã nguồn. Trên board `JWT_SECRET` đã được provision sẵn tại `/data/mkddc/jwt.secret` hoặc đọc từ `/proc/<pid>/environ`.
  - Tuân thủ quy trình tuần tự của `foxlinx-deploy`: Check SSH → Build Go backend (cross-compile aarch64) → Build FE (`npm run build`) → Backup binary/dist trên board kèm TIMESTAMP → `pkill -x mkddc-web` → Copy artifacts via `scp -P 2223` → Chown/chmod + nohup chạy lại process dưới user `mkddc` → Smoke test bằng `wget`.
  - Không merge, không push git branch từ subagent nếu chưa được phép.
  - Không phá vỡ contract JSON canonical của FBD (`verify_programming_fbd_contract.py` và `apps/core/application/st/st_fbd_model.cpp`).

### 3. WORKING METHOD / USER-DEFINED WORKFLOW

#### USER-DEFINED WORKFLOW
1. **Khảo sát & chẩn đoán nguyên nhân gốc**: Truy vết từ hành vi tương tác trên canvas (`FbdCanvas.tsx`), máy trạng thái reducer (`commands.ts`), các tầng render (`FbdCanvasLayers.tsx`), và quy tắc kiểm tra hợp lệ của backend/contract.
2. **Sửa code tối giản & chính xác**: Chỉ sửa đúng chỗ gây lỗi, không tái cấu trúc lan man, giữ tính bất biến (immutability) và tuân thủ chặt chẽ kiến trúc FBD.
3. **Kiểm chứng cục bộ (Verification)**:
   - Chạy Vitest cho các module liên quan (`commands.wiring.test.ts`, `FbdCanvas.placement.test.tsx`, `ProgramsTab.test.tsx`).
   - Chạy toàn bộ test suite của web-ui: `npm run test:run` (hoặc `npx vitest --run`).
   - Chạy build FE: `npm run build` (kiểm tra TypeScript typecheck và bundle budget chunk ≤ 125 KiB).
4. **Deploy Foxlinx**:
   - Cross-compile Go API (`GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o /tmp/mkddc-web-foxlinx ./cmd/mkddc-web`).
   - Triển khai remote qua SSH/SCP port 2223 theo `docs/03_implementation/DEPLOY_FOXLINX.md`.
   - Thực hiện smoke test bằng `wget` trên board xác nhận Health OK, Login OK, Programming READY, FE HTML served.

#### SESSION-ESTABLISHED WORKFLOW
- Phân tích nguyên nhân trước khi đụng vào code.
- Đối chiếu song song giữa frontend TypeScript (`commands.ts`, `FbdCanvas.tsx`) với backend C++ model (`st_fbd_model.cpp`) và Python contract validator (`verify_programming_fbd_contract.py`) để không tạo ra xung đột contract.

#### WORKFLOW INVARIANTS
- Không bỏ qua bước kiểm tra local build trước khi deploy lên phần cứng thật.
- Luôn backup binary và dist trên board trước khi ghi đè (`cp` và `mv` kèm timestamp).
- Đảm bảo `connectionFromPortId` luôn được giải phóng sạch sẽ khi tương tác kết thúc hoặc gặp lỗi từ chối (reject).

### 4. CURRENT WORKFLOW POSITION
```
Workflow:          Chẩn đoán lỗi → Sửa code FE → Test & Build FE → Cross-compile Backend → Deploy Foxlinx & Smoke test
Completed:         Chẩn đoán lỗi (Đã xác định 2 nguyên nhân gốc)
Currently working: Chuẩn bị thực hiện sửa code FE (commands.ts & FbdCanvas.tsx)
Next:              Sửa FE → Chạy Vitest & Build → Deploy Foxlinx
```

### 5. WORKSPACE / ENVIRONMENT
- **Thư mục làm việc hiện tại**: `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24\apps\web-ui`
- **Root Repository**: `E:\TuanDuong\INTERN\DDC24_project\MK-DDC-24`
- **Git branch**: `main` (clean, up to date with origin/main)
- **OS**: Windows 11 Home Single Language (10.0.26200), chạy shell Git Bash.
- **Node & Toolchain**: Vite, TypeScript 5+, Vitest, Tailwind CSS.
- **Target board (Foxlinx)**:
  - Host: `mekong-fac.ddns.net`
  - Port SSH: `2223`
  - User: `root` (dịch vụ chạy dưới user `mkddc`)
  - Key: `~/.ssh/mkddc24_som`
  - Arch: `aarch64` (Rockchip RV1126B, Buildroot)

### 6. CURRENT VERIFIED STATE

#### VERIFIED
1. **Lỗi 1 — Kẹt trạng thái nối dây (`connectionFromPortId` không được reset khi reject)**:
   - Trong `apps/web-ui/src/features/programming/fbd/commands.ts:135-137`:
     ```typescript
     function reject(state: FbdEditorState, announcement: FbdAnnouncement): FbdEditorState {
       return { ...state, announcement }
     }
     ```
     Hàm `reject()` không xoá `connectionFromPortId`. Khi người dùng bấm port nguồn OUT rồi bấm port đích IN bị reject (do thứ tự hoặc không tương thích), `connectionFromPortId` vẫn còn nguyên. Do đó nút "Hủy nối" tiếp tục sáng, và preview dây đứt nét vẫn hiển thị.
   - Trong `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx:444-447`:
     ```typescript
     if (!moved) {
       dispatch({ type: 'SELECT', selection: null })
       setClickSourcePort(null)
     }
     ```
     Khi click vào background canvas, `FbdCanvas` chỉ reset `clickSourcePort` nội bộ mà **không dispatch `CANCEL_CONNECTION`**, làm `state.connectionFromPortId` trong reducer không bị huỷ.
   - `handlePortClick` tại dòng 568 trong `FbdCanvas.tsx` khi dispatch `ADD_WIRE` thành công hoặc thất bại: nếu `connectionFromPortId` đang có từ trước, khi `ADD_WIRE` thất bại, reducer reject giữ nguyên `connectionFromPortId`.
2. **Lỗi 2 — Từ chối nối dây combinational ngược executionOrder (`connect-reverse-order`)**:
   - Khi người dùng kéo thả các khối vào canvas, `ADD_NODE` gán `executionOrder = network.nodes.length`.
   - Nếu người dùng thả khối nhận `#0` trước, rồi thả khối phát `#1` sau, thì `#1` có `executionOrder = 1`, `#0` có `executionOrder = 0`.
   - Khi nối `#1` (OUT) sang `#0` (IN), `validateFbdWireCandidate` kiểm tra:
     ```typescript
     if (
       source.node.kind !== 'FUNCTION_BLOCK' &&
       target.node.kind !== 'FUNCTION_BLOCK' &&
       source.node.executionOrder >= target.node.executionOrder
     ) {
       return { ok: false, code: 'connect-reverse-order' }
     }
     ```
     Điều này khiến kết nối feedforward hoàn toàn hợp lệ trong đồ thị có hướng (DAG) bị chặn đứng với mã lỗi `'connect-reverse-order'` chỉ vì thứ tự người dùng kéo thả khối ra canvas.
   - Khi bị chặn, kết hợp với Lỗi 1, dây preview bị đóng băng vĩnh viễn trên màn hình đúng như ảnh user đã chụp!

#### UNVERIFIED
- Liệu có cần tự động tính toán lại topological sort cho `executionOrder` của các khối combinational khi một wire được thêm vào (`ADD_WIRE` / `connect`), hay cho phép nối và re-index topo-orderContiguous 0..N-1? (Cần cập nhật topo order sao cho vẫn thỏa mãn contract `source.executionOrder < target.executionOrder`).

### 7. COMPLETED WORK
- Điều tra toàn diện luồng dữ liệu từ UI (`StructuredFbdEditor.tsx`, `FbdCanvas.tsx`, `FbdCanvasLayers.tsx`, `useFbdNodeDrag.ts`) đến Reducer (`commands.ts`), C++ Core (`st_fbd_model.cpp`) và Contract Validator (`verify_programming_fbd_contract.py`).
- Xác định chính xác 100% hai nguyên nhân kỹ thuật gây ra lỗi trong ảnh người dùng cung cấp.
- Đọc và nắm vững quy trình deploy Foxlinx trong `.claude/skills/foxlinx-deploy/SKILL.md` và `docs/03_implementation/DEPLOY_FOXLINX.md`.

### 8. WORK IN PROGRESS
- Chuẩn bị thực hiện cập nhật `commands.ts` và `FbdCanvas.tsx` để:
  1. Reset `connectionFromPortId: null` khi kết nối bị reject hoặc bị hủy, và xử lý background click dispatch `CANCEL_CONNECTION`.
  2. Xử lý logic `executionOrder`: Khi thêm dây nối giữa các khối combinational, nếu đồ thị không có chu trình (acyclic), thực hiện topological sort sắp xếp lại `executionOrder` (0..N-1) của các node trong network để thỏa mãn contract `source.executionOrder < target.executionOrder`, thay vì từ chối thẳng thừng dựa trên thứ tự đặt khối ban đầu.

### 9. IMPORTANT DECISIONS
- **Topological sort khi nối dây**: Thay vì bắt người dùng phải đặt khối nguồn trước khối đích một cách cứng nhắc (điều vô lý trong trải nghiệm UX vẽ mạch FBD), khi tạo dây nối ta kiểm tra chu trình:
  - Nếu tạo chu trình combinational (cycle): từ chối với lỗi hợp lệ (ví dụ `combinational-cycle` hoặc `connect-reverse-order`).
  - Nếu là đồ thị DAG hợp lệ: tự động cập nhật lại `executionOrder` (0..N-1) theo thứ tự tô-pô. Điều này vừa thỏa mãn contract C++ backend (`combinational_order_is_valid`) vừa giúp UX vẽ mạch mượt mà.
- **Dọn dẹp `connectionFromPortId`**: Bất kể kết nối thành công hay thất bại, khi kết thúc thao tác nối (kể cả click ra ngoài canvas hay bấm Hủy nối), trạng thái nối tạm phải được reset về `null`.

### 10. RELEVANT FILES & ARTIFACTS
- `apps/web-ui/src/features/programming/fbd/commands.ts`: Chứa reducer `fbdEditorReducer`, `validateFbdWireCandidate`, `connect`, `reject`, `ADD_WIRE`, `ADD_NODE`.
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx`: Chứa xử lý sự kiện chuột/chạm trên canvas, `handlePortClick`, `handleBgPointerUp`, `wirePreview`, `clickSourcePort`.
- `apps/web-ui/src/features/programming/fbd/commands.wiring.test.ts`: Bộ test cho `ADD_NODE` và `ADD_WIRE`.
- `scripts/verify_programming_fbd_contract.py`: Contract validator kiểm tra `executionOrder`.
- `apps/core/application/st/st_fbd_model.cpp`: Backend parser kiểm tra `combinational_order_is_valid`.
- `.claude/skills/foxlinx-deploy/SKILL.md`: Hướng dẫn các bước deploy lên board Foxlinx.
- `docs/03_implementation/DEPLOY_FOXLINX.md`: Tài liệu chi tiết thông số kết nối và lệnh deploy.

### 11. CODE CHANGES
*(Chưa commit thay đổi nào, chuẩn bị thực hiện ở phiên kế tiếp)*

### 12. COMMANDS RUN
- `git status`
- `git log -n 5 --oneline`
- `git log -p -S connect-reverse-order -n 2`
- `git log -p -2 -S clickSourcePort src/features/programming/fbd/FbdCanvas.tsx`

### 13. TEST / VALIDATION STATUS
- Trạng thái git hiện tại: sạch (clean working tree trên `apps/web-ui`).
- Unit tests và build FE sẽ được chạy ngay sau khi áp dụng bản sửa lỗi.

### 14. ERRORS / BLOCKERS
- **Vấn đề trên board**: Người dùng không thể nối dây và bị kẹt dây đứt nét vĩnh viễn trên canvas, nút "Hủy nối" kẹt không nhả.
- **Nguyên nhân cốt lõi**:
  1. `source.executionOrder >= target.executionOrder` gây `'connect-reverse-order'` do khối `#0` được tạo trước khối `#1`.
  2. `reject()` trong `commands.ts` giữ nguyên `connectionFromPortId`.
  3. `FbdCanvas.tsx` không dispatch `CANCEL_CONNECTION` khi click vào khoảng trống canvas.

### 15. FAILED ATTEMPTS — DO NOT REPEAT
- **DO NOT REPEAT**: Không được chỉ đơn giản xóa bỏ điều kiện kiểm tra `executionOrder` mà không sắp xếp lại tô-pô. Vì backend C++ (`combinational_order_is_valid`) và Python validator (`verify_programming_fbd_contract.py`) bắt buộc `source.executionOrder < target.executionOrder` đối với các khối không phải `FUNCTION_BLOCK`. Do đó, giải pháp bắt buộc là re-toposort `executionOrder` khi add wire.

### 16. IMPORTANT CONVERSATION CONTEXT
- User đang cần test trực tiếp trên phần cứng thật Foxlinx (SOM-DDC-24-foxlinx).
- User yêu cầu làm nhanh, tập trung, dứt điểm lỗi và deploy lại ngay.

### 17. NEXT ACTIONS
1. **Sửa `commands.ts`**:
   - Thêm hàm tính topological order cho nodes trong network khi thêm wire. Nếu phát hiện cycle trong combinational nodes, reject `'connect-reverse-order'`. Nếu không có cycle, reassign `executionOrder = 0..N-1` theo topo sort.
   - Đảm bảo `reject(state, ...)` hoặc các action hủy kết nối giải phóng `connectionFromPortId: null`.
2. **Sửa `FbdCanvas.tsx`**:
   - Trong `handleBgPointerUp`, khi click vào background canvas (`!moved`), dispatch `{ type: 'CANCEL_CONNECTION' }` ngoài việc clear selection và `clickSourcePort`.
   - Trong `handlePortClick`, đảm bảo khi xảy ra lỗi hoặc hủy thì dispatch hủy kết nối đầy đủ.
3. **Cập nhật & chạy test**:
   - Chạy Vitest: `npx vitest run src/features/programming/fbd/commands.wiring.test.ts`.
   - Chạy toàn bộ test: `npm run test:run`.
   - Chạy build FE: `npm run build`.
4. **Triển khai Foxlinx (`foxlinx-deploy`)**:
   - Bước 1: Kiểm tra kết nối SSH `ssh -p 2223 -i ~/.ssh/mkddc24_som root@mekong-fac.ddns.net 'uname -m && echo SSH_OK'`
   - Bước 2: Build Go backend `cd apps/web-api && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o /tmp/mkddc-web-foxlinx ./cmd/mkddc-web`
   - Bước 3: Backup & dừng process cũ trên board.
   - Bước 4: Copy artifacts `mkddc-web-foxlinx` và `build/web-ui/dist` lên board.
   - Bước 5: Chown, chmod và khởi động lại với `JWT_SECRET` hiện hữu.
   - Bước 6: Smoke test bằng `wget` và báo cáo kết quả cho user.

### 18. DEFINITION OF DONE
- [ ] Người dùng có thể kéo thả bất kỳ khối nào ra trước/sau và nối dây từ OUT sang IN mà không bị lỗi `connect-reverse-order` (DAG được auto-sort executionOrder hợp lệ).
- [ ] Khi click ra ngoài canvas hoặc bấm "Hủy nối", dây preview đứt nét biến mất hoàn toàn và trạng thái nối kết thúc.
- [ ] Tất cả unit tests trong `apps/web-ui` pass 100%.
- [ ] `npm run build` thành công, không vi phạm bundle budget.
- [ ] Backend và Frontend được deploy thành công lên board Foxlinx.
- [ ] Smoke test trên board xác nhận: Health OK, Login OK, Programming capabilities READY, FE HTML served.

---

# INSTRUCTION FOR NEXT CLAUDE CODE SESSION

Coi đây là **continuation của cùng một phiên làm việc**, không phải task mới.

1. Đọc toàn bộ handoff trước khi hành động.
2. Kiểm tra workspace, git status và các artifact/file được reference để xác minh trạng thái thực tế.
3. Nếu handoff và filesystem khác nhau, ưu tiên trạng thái thực tế của filesystem/code/git nhưng phải xác định nguyên nhân khác biệt trước khi thay đổi.
4. Không bắt đầu phân tích lại project từ đầu nếu thông tin đã có trong handoff.
5. Không yêu cầu user giải thích lại những yêu cầu đã ghi trong handoff.
6. Giữ nguyên phương thức làm việc của phiên trước.
7. Tuân thủ chính xác USER-DEFINED WORKFLOW và WORKFLOW INVARIANTS.
8. Nếu user đã yêu cầu thứ tự `A → B → C` thì tiếp tục theo `A → B → C`. Không tự ý đổi thứ tự, skip bước, gộp bước, thay workflow khác, hoặc làm trước những bước chưa đến lượt — trừ khi có lý do kỹ thuật bắt buộc hoặc user đưa yêu cầu mới.
9. Kiểm tra mục CURRENT WORKFLOW POSITION để xác định đang đứng ở bước nào và tiếp tục từ đúng vị trí đó.
10. Không thực hiện lại những bước đã hoàn thành và verify trừ khi có bằng chứng cho thấy chúng sai.
11. Không refactor hoặc redesign những phần đã hoàn thành nếu không liên quan trực tiếp đến task hiện tại.
12. Không đảo ngược quyết định đã được user chốt.
13. Không lặp lại các phương án trong FAILED ATTEMPTS — DO NOT REPEAT.
14. Tiếp tục trực tiếp từ NEXT ACTIONS.
15. Sau mỗi bước quan trọng, thực hiện đúng validation procedure đã quy định trước khi chuyển sang bước tiếp theo.
16. Nếu workflow yêu cầu hoàn thành và xác minh từng bước trước khi tiếp tục, phải tuân thủ nguyên tắc đó.
17. Giữ nguyên cách báo cáo tiến độ, cách tổ chức công việc và cách tương tác với user nếu user đã quy định trong phiên trước.
18. Chỉ thay đổi workflow khi user trực tiếp yêu cầu, hoặc workflow hiện tại về mặt kỹ thuật không thể tiếp tục. Trường hợp thứ hai phải nêu rõ vấn đề trước khi áp dụng phương án thay thế.
