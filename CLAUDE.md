# Claude Code — Quy tắc dự án MK-DDC-24

File này được Claude Code tự động nạp vào mỗi phiên làm việc trong repo (khác `AGENTS.md`, vốn không được harness này tự động đọc). Đồng bộ nội dung với `AGENTS.md` để các agent/tool khác dùng chung quy tắc.

- Luôn trả lời bằng tiếng Việt và viết tài liệu (docs, changelog, báo cáo, review) bằng tiếng Việt. Hạn chế tối đa tiếng Anh trong nội dung rule và skill của agent; chỉ giữ nguyên tiếng Anh cho thuật ngữ kỹ thuật/tên riêng không có bản dịch tương đương rõ ràng (ví dụ: BACnet, Modbus, CRC, endian, watchdog, tên biến/hàm/API trong code).
- Mọi thay đổi code, config, deployment, hoặc documentation phải cập nhật `CHANGELOG.md` trong cùng phiên làm việc.
- Thêm entry vào CHANGELOG dưới mục `[Unreleased]` kèm ngày, phạm vi, và ghi chú verification khi cần.
- Không được bỏ qua CHANGELOG trừ khi user nói rõ là không cần cập nhật.
- Giữ thay đổi FE cục bộ (local) làm nguồn chân lý; không ghi đè công việc FE cục bộ không liên quan.

## Làm hết việc, không chừa lại

Khi user giao việc, **làm trọn tới nơi**. Không được báo cáo giữa chừng rồi để lại
một danh sách "còn lại / nên làm tiếp / nói nếu muốn tôi làm". Nếu trong lúc làm
mà phát hiện lỗi hoặc thiếu sót thuộc phạm vi được giao thì **sửa luôn**, không
chỉ ghi vào tài liệu rồi bỏ đó.

Quy tắc cụ thể:

1. **Phát hiện lỗi trong phạm vi việc đang làm ⇒ sửa trong cùng phiên.** Ghi
   finding vào docs là bước bổ sung, không phải bước thay thế cho việc sửa.
2. **Không hỏi lại những gì có thể tự quyết.** Chỉ dừng hỏi khi hành động thực sự
   không thể hoàn tác, phá huỷ dữ liệu, hoặc ảnh hưởng ra ngoài (production thật,
   gửi mail, xoá dữ liệu người dùng). Cài/restart service trên board lab, tạo
   nhánh, commit, mở PR, chạy test, cài toolchain dev — **tự làm, không hỏi**.
3. **Bị chặn một nhánh thì làm hết các nhánh còn lại**, rồi mới báo đúng một mục
   bị chặn kèm lý do và thứ cần để mở khoá. Không lấy một chỗ bị chặn làm cớ dừng
   toàn bộ.
4. **Trước khi kết luận "xong", tự rà lại**: mọi lỗi phát hiện đã sửa chưa; mọi
   file đã commit/push/merge chưa; CHANGELOG đã cập nhật chưa; số đo đã đo lại
   thật chưa. Nếu còn mục nào chưa làm mà không bị chặn thì **chưa được báo xong**.
5. Việc bị chặn thật sự phải ghi rõ **bị chặn bởi cái gì** và **cần gì để mở**,
   không viết chung chung kiểu "nói nếu bạn muốn tôi làm tiếp".

## Quy trình khi user nói "commit" hoặc "merge"

Khi user chỉ nói ngắn gọn **"commit"**, **"merge"**, **"commit đi"**, **"merge đi"** — hiểu là **chạy trọn quy trình dưới đây cho toàn bộ thay đổi hiện có trong cây làm việc**, không hỏi lại từng bước:

1. **Kiểm chứng trước khi commit.** Chạy lại các bộ test tương ứng với phạm vi đã đổi và ghi số đo thật (không dẫn lại số cũ):
   - C++: `cmake -S services -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` rồi `ctest --test-dir build/fw` (**bật cả 3 option**, mặc định HMI là OFF nên dễ bỏ sót gate).
   - Go: `go vet ./...` + `go test ./... -count=1` (dùng `-count=1`, kết quả cache che được hồi quy).
   - FE: `npx vitest --run --environment jsdom src` + `npm run lint` + `npm run build`. Lưu ý `npm test` chỉ quét `src/`, **không** chạy `e2e/`.
   - E2E khi có đổi trang mạng: `npx playwright test e2e/network-qa.spec.ts`.
2. **Cập nhật `CHANGELOG.md`** dưới `[Unreleased]` như quy tắc phía trên.
3. **Commit tách theo nhóm logic, chi tiết để dễ truy xuất.** Không gom tất cả vào một commit. Mỗi commit: một nhóm mạch lạc (ví dụ hợp đồng SHM / netcfg / backend Go / frontend / CI / tài liệu), tiêu đề theo Conventional Commits, thân bài **tiếng Việt** nêu rõ **triệu chứng → nguyên nhân gốc → cách sửa**, dẫn mã finding và tài liệu liên quan (`Refs:`). Viết đủ để người đọc sau này hiểu *vì sao* chứ không chỉ *cái gì*.
4. **Push** lên nhánh hiện tại. Nếu đang ở nhánh mặc định thì tạo nhánh trước.
5. **Tạo PR** bằng `gh pr create`, mô tả tiếng Việt tổng hợp các nhóm commit + bảng số đo kiểm chứng.
6. **Merge PR**, rồi **xoá nhánh remote** sau khi merge xong.
7. Báo lại kết quả kèm link PR và số đo.

Nếu bước nào hỏng (thường gặp: token `gh`/git hết hạn), **làm hết các bước không bị chặn** rồi nói rõ bước nào còn lại và cần gì để mở khoá — không dừng ngang khi chưa commit xong.
