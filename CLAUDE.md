# Claude Code — Quy tắc dự án MK-DDC-24

File này được Claude Code tự động nạp vào mỗi phiên làm việc trong repo (khác `AGENTS.md`, vốn không được harness này tự động đọc). Đồng bộ nội dung với `AGENTS.md` để các agent/tool khác dùng chung quy tắc.

- Luôn trả lời bằng tiếng Việt và viết tài liệu (docs, changelog, báo cáo, review) bằng tiếng Việt. Hạn chế tối đa tiếng Anh trong nội dung rule và skill của agent; chỉ giữ nguyên tiếng Anh cho thuật ngữ kỹ thuật/tên riêng không có bản dịch tương đương rõ ràng (ví dụ: BACnet, Modbus, CRC, endian, watchdog, tên biến/hàm/API trong code).
- Mọi thay đổi code, config, deployment, hoặc documentation phải cập nhật `CHANGELOG.md` trong cùng phiên làm việc.
- Thêm entry vào CHANGELOG dưới mục `[Unreleased]` kèm ngày, phạm vi, và ghi chú verification khi cần.
- Không được bỏ qua CHANGELOG trừ khi user nói rõ là không cần cập nhật.
- Giữ thay đổi FE cục bộ (local) làm nguồn chân lý; không ghi đè công việc FE cục bộ không liên quan.
