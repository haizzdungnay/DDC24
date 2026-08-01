# ADR-022: CI/CD tự động build và deploy xuống board qua self-hosted runner

> **Trạng thái:** Proposed | **Phiên bản:** 1.0 | **Ngày lập:** 2026-08-01 | **Owner:** SW Lead
> **Quyết định phạm vi bởi:** chủ dự án, 2026-08-01 — chọn self-hosted runner trên board, auto-deploy hoàn toàn khi merge vào `main`, với điều kiện board hiện là **lab/dev chưa đấu tải thật**.

## 1. Bối cảnh

Hiện tại repo có 2 workflow (`build-and-test.yml` 6 job, `security.yml`) chạy trên runner GitHub `ubuntu-22.04`, nhưng **không có bất kỳ tự động hoá deploy nào**. Mọi lần đưa bản mới xuống Orange Pi 5B đều làm tay, và bằng chứng ở `docs/07_records/test-evidence/fw-som/2026-07-31-network-page-board-e2e.md` cho thấy quy trình tay đó gồm nhiều bước dễ sai:

- Go `mkddc-web`: cross-compile x86-64 → arm64, `CGO_ENABLED=0`.
- C++ (`mkddc-core`, `mkddc-iobus`, `mkddc-netcfg`): **build native ngay trên board** (`cmake --parallel 6`) — không có toolchain cross trong repo.
- Backup tay trước khi cắt (`/opt/mkddc-backup-20260731-114544/`).
- Verify tay: `ctest` trên board, kiểm `systemctl`, mở trang web, đăng nhập.

Hệ quả: mỗi lần deploy tốn hàng chục phút thao tác, và bước backup/verify phụ thuộc trí nhớ người làm. Đợt deploy 2026-07-31 đã lộ ra đúng loại lỗi mà quy trình tay dễ bỏ sót — deploy đợt 1 quên `mkddc-core`, phải deploy lại ở đợt 2.

### 1.1 Ràng buộc mạng

Board nằm sau NAT trong LAN, GitHub không mở được kết nối vào. Chỉ hai kiểu topology khả thi: runner **chủ động kéo** job từ GitHub, hoặc runner cloud đẩy qua tunnel.

## 2. Quyết định

1. **Dùng self-hosted GitHub Actions runner cài trên chính Orange Pi 5B**, labels `[self-hosted, linux, ARM64, mkddc-board]`. Board kéo job qua HTTPS outbound, **không mở port inbound**, **không lưu SSH key trong secrets**. Đồng thời giải luôn bài toán build C++ native aarch64 mà không phải dựng toolchain cross.

2. **Workflow deploy chỉ chạy trên `push` vào `main`.** Tuyệt đối **không** chạy trên `pull_request`. Đây là ràng buộc an ninh cứng, không phải tuỳ chọn: self-hosted runner thực thi code của workflow, nên cho phép PR kích hoạt nó đồng nghĩa với việc bất kỳ ai mở được PR đều chạy được lệnh tuỳ ý trên board. Repo hiện là private nên bề mặt hẹp, nhưng quy tắc này phải giữ kể cả khi repo đổi trạng thái.

3. **Deploy tự động hoàn toàn, không có cổng duyệt thủ công**, theo quyết định phạm vi ở đầu tài liệu. Quyết định này **gắn với điều kiện board là lab/dev**. Khi board được đấu I/O thật hoặc chuẩn bị bàn giao site, ADR này **phải được sửa đổi** để thêm gate duyệt (GitHub Environment với required reviewer) trước khi cắt — xem §3.

4. **Gate chất lượng đi trước deploy.** Job deploy `needs:` toàn bộ job của `build-and-test.yml`. Không có đường nào cắt xuống board mà bỏ qua test.

5. **Build lại trên board, không tin artifact từ runner x86.** C++ build native đúng như quy trình tay hiện tại; `ctest` chạy đủ 3 option trên chính aarch64 trước khi cắt. Riêng `mkddc-web` (Go, `CGO_ENABLED=0`) và frontend build được ở cả hai nơi; chọn build trên board để một job duy nhất là nguồn chân lý cho bản được cắt.

6. **Cắt bản mới phải atomic, có backup, có health check, và tự rollback.** Thứ tự bắt buộc: backup → cài vào đường dẫn tạm → dừng service theo thứ tự an toàn → hoán đổi → khởi động → health check → nếu fail thì khôi phục backup và khởi động lại. Deploy chỉ được tuyên bố thành công sau khi health check pass.

7. **`mkddc-netcfg` không được restart mù.** Trước khi chạm vào nó, phải kiểm tra journal giao dịch `/data/mkddc/netcfg-transaction.json`: nếu đang có giao dịch chưa kết thúc thì **huỷ deploy** thay vì restart. Restart authority giữa cửa sổ rollback 120 giây có thể để interface ở trạng thái nửa vời và cắt luôn đường quản trị — đúng họ lỗi mà F-14 minh hoạ.

8. **Một deploy tại một thời điểm.** `concurrency: group: deploy-board`, `cancel-in-progress: false`. Không bao giờ huỷ một deploy đang dở, vì huỷ giữa bước hoán đổi để lại hệ thống ở trạng thái không xác định.

9. **Runner chạy bằng user không đặc quyền**, và chỉ được cấp `sudo` cho **một allowlist hẹp** các lệnh cần thiết (`systemctl` trên đúng danh sách unit, `install` vào đúng đường dẫn). Không cấp `NOPASSWD: ALL`. Cùng nguyên tắc đã áp cho `mkddc-reload-helper` ở F-01.

10. **Mỗi lần deploy sinh bằng chứng.** Ghi lại: commit SHA, SHA-256 từng binary, kết quả `ctest`, kết quả health check, đường dẫn backup, và thời điểm. Lưu thành artifact của workflow run. Đây là điều kiện để deploy tự động dùng được trong hồ sơ chứng nhận sau này.

11. **Giữ backup có giới hạn.** Lưu 5 bản gần nhất trong `/opt/mkddc-backup-<UTC>/`, prune bản cũ hơn. eMMC của board có dung lượng hữu hạn; backup không giới hạn sẽ tự làm đầy đĩa và biến chính cơ chế an toàn thành nguyên nhân sự cố.

## 3. Hệ quả

- **Quyết định "không có cổng duyệt" là có điều kiện.** Nó chỉ đúng khi board không điều khiển tải thật. Điều kiện này phải được kiểm lại trước khi đấu I/O thật; khi đó ADR-022 lên rev mới với gate duyệt bắt buộc.
- **Restart `mkddc-iobus` làm gián đoạn BACnet và Modbus**, và restart `mkddc-core` làm gián đoạn điều khiển. Với board lab điều này chấp nhận được, nhưng đó chính là lý do §2.3 bị ràng buộc điều kiện.
- Board phải luôn bật và có mạng thì merge mới deploy được. Runner offline khiến job xếp hàng chứ không fail ngay — cần theo dõi.
- Runner chiếm thêm RAM/CPU thường trực trên board (~100 MB). Không được để nó cạnh tranh với scan loop `SCHED_FIFO` của `mkddc-core`: runner phải chạy ở `Nice` thấp và không có realtime priority.
- Self-hosted runner trên repo private là bề mặt tấn công mới. Nếu repo chuyển sang public thì **phải tắt runner ngay** hoặc chuyển sang runner ephemeral trong container.
- Build native trên board chậm hơn runner cloud; `ctest` đủ 3 option mất vài phút. Chấp nhận đổi lấy việc bản được cắt đúng là bản đã test trên chính kiến trúc đích.

## 4. Kế hoạch triển khai

| WP | Nội dung | Phụ thuộc |
|---|---|---|
| **WP1** | Cài runner trên board: user riêng không đặc quyền, systemd unit, labels, `Nice` thấp; sudoers allowlist hẹp | — |
| **WP2** | Script `tools/deploy/deploy_board.sh` — backup, cài, hoán đổi, health check, rollback; chạy tay được và test được độc lập với CI | — |
| **WP3** | Workflow `.github/workflows/deploy-board.yml` gọi WP2, `needs:` build-and-test, guard `push`+`main`, concurrency | WP1, WP2 |
| **WP4** | Health check: `systemctl is-active` từng unit, HTTP `/api/v1/health`, magic + độ dài `io_shm`, `netcfg_tests` trên board | WP2 |
| **WP5** | Sinh và lưu bằng chứng deploy (SHA-256, ctest, health check) thành artifact | WP3 |
| **WP6** | Diễn tập rollback: cố ý deploy một bản hỏng, khẳng định tự khôi phục và service trở lại | WP2..WP5 |

**WP2 phải làm được trước và độc lập với CI.** Một script deploy chạy tay được là thứ có thể kiểm chứng và dùng để cứu hệ thống khi CI hỏng; nếu logic deploy chỉ tồn tại bên trong YAML của workflow thì không debug và không tái dùng được.

WP6 không phải thủ tục hình thức: cơ chế rollback chưa từng chạy thật là cơ chế chưa biết có hoạt động không.

## 5. Phương án đã cân nhắc và loại

| Phương án | Lý do loại |
|---|---|
| Runner cloud + tunnel (Tailscale/WireGuard) + `scp`/`ssh` | Phải dựng toolchain cross aarch64 cho toàn bộ C++ — công việc lớn và tạo khác biệt giữa bản test và bản cắt. Phải lưu SSH key trong secrets. Chỉ hơn khi có nhiều board, hiện chưa có. |
| Chỉ build artifact, deploy vẫn tay | Không giải quyết được vấn đề gốc là bước cắt thủ công dễ sai. |
| Deploy bằng image toàn hệ thống (A/B partition) | Đúng hướng cho sản phẩm thương mại và nên xem xét khi bàn giao site, nhưng quá nặng cho vòng lặp phát triển hiện tại. |
| Cắt qua container/OCI | Stack dùng systemd, quyền `CAP_NET_ADMIN`, SHM chia sẻ và `SCHED_FIFO`; đóng gói container sẽ phải phá nhiều ràng buộc đó. |

## 6. Tham chiếu

- `docs/07_records/test-evidence/fw-som/2026-07-31-network-page-board-e2e.md` — quy trình deploy tay hiện tại, làm cơ sở cho WP2.
- [ADR-017](ADR-017-settings-network-tabs-and-state-contract.md) §2.1 — `mkddc-netcfg` là authority mạng duy nhất; cơ sở cho quyết định §2.7.
- `packaging/systemd/` — danh sách unit và đường dẫn cài đặt.
- `docs/00_governance/CONTROL.md` — thứ tự thẩm quyền và gate thay đổi.

## Phụ lục A — Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-01 | Bản đầu. Chốt self-hosted runner trên board, auto-deploy khi merge `main` (có điều kiện board lab/dev), atomic swap + health check + tự rollback, và 6 work package. |
