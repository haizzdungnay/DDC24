# Kho lưu trữ nguồn audit Programming

`raw-source-snapshots/` chứa 33 tài liệu được chụp trước lần tổ chức lại ngày
2026-08-08. Nội dung được giữ nguyên để tái hiện mâu thuẫn, lịch sử quyết định và
kết luận audit.

- `ORIGINAL_MANIFEST_PRE_REORGANIZATION.sha256`: checksum với đường dẫn trước khi
  di chuyển; dùng làm record lịch sử.
- `../00_document_control/SOURCE_MANIFEST.sha256`: checksum hiện hành của cùng 33
  file theo đường dẫn archive mới.

Không sửa trực tiếp các snapshot. Nếu nguồn bên ngoài thay đổi, tạo bộ snapshot
mới theo ngày, cập nhật Document Register và lập change/conflict impact trước khi
thay baseline.
