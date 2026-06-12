# logs/ — log runtime & test (local, gitignored)

| Thư mục | Sinh bởi | Nội dung |
|---------|----------|----------|
| `demo/` | `tools/run_noboard_demo.sh` | socat/fake_mcu/iobus/core của demo no-board |
| `safety-e2e/` | `tools/test_safety_e2e.sh` | log 4 process + đo timing 3 lớp safety |
| `reload-e2e/` | `tools/test_reload_e2e.sh` | log 4 process + kiểm SIGHUP reload (COR-008) |
| `be-sim/` | `tools/test_be_ipc.py` | `transcript.log` (toàn bộ request/response BE↔core), `summary.txt` (PASS/FAIL từng case), log 4 process |
| `live` → symlink | phiên service đang chạy tay | log của chuỗi đang chạy (nếu start bằng tay vào /tmp) |

Đọc nhanh:
- Kết quả test BE: `cat logs/be-sim/summary.txt`
- Toàn bộ hội thoại sock: `less logs/be-sim/transcript.log`
- Service đang chạy: `tail -f logs/live/core.log`
