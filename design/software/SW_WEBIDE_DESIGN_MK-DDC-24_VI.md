# Service Design — `kinexus-webide` (SW)
## KinexusET Web IDE — code-ready

> **Document ID:** DDD-SWSVC-WEBIDE-MK-DDC-24-VI · **Rev** 1.0 | 2026-05-30
> 📘 [spec/README](../../spec/README.md) · **Trace:** `SW-IDE-001..023`, `IDE-001..034` · Python(backend)+Svelte(frontend)

---

## 1. Nhiệm vụ
IDE chạy trên trình duyệt (không cài app): soạn FBD/ST, cấu hình I/O, giám sát realtime, commissioning, quản lý user.

## 2. Kiến trúc
```
Browser (Svelte SPA) ──HTTPS──► webide backend (FastAPI, chung với agent)
                                   ├── /ide/programs   (CRUD .kxp)
                                   ├── /ide/compile     (FBD/ST → IR)
                                   ├── /ide/io-config   (D-5 config)
                                   ├── /ide/monitor     (WebSocket realtime ← plc_shm)
                                   └── auth (roles admin/operator/viewer)
```
- HTTP **8080** (LAN commissioning) → production redirect **HTTPS 8443** (IDE-034).

## 3. Tính năng (SW-IDE-001..015)
| Nhóm | Chức năng |
|------|-----------|
| Lập trình | FBD drag-drop, ST syntax-highlight, compile-check, upload/download, start/stop/reset PLC |
| Giám sát | watch table realtime (WebSocket), I/O live dashboard (refresh ≤1s), live wire values |
| Cấu hình | UI sensor type per kênh, AO mode, safe-state, BACnet Device ID/Name, IP/DHCP, RS-485 mode |
| Commissioning | Force I/O (auto-expire ≤10', admin), export point list CSV, checklist FAT/SAT |
| User | tạo/xoá/đổi mật khẩu (admin), roles |

## 4. Force I/O (an toàn)
```
Force AO/DO tạm thời (test) → ghi priority cao vào plc_shm
  → auto-expire sau ≤10 phút nếu không tương tác (IDE-013)
  → ghi audit log (IDE-033)
```

## 5. Lưu trữ
- Program `.kxp` (XML) ở `/data/plc/programs/`. Config JSON `/data/config/` (D-5).
- Compile → IR cho PLC engine (D-6) nạp.

## 6. Bảo mật
- Auth bắt buộc; session idle 30' (IDE-031); lockout 5 sai/15' (SW-IDE-022).
- Password bcrypt cost≥12 (SW-IDE-021); token không lưu localStorage.
- Action nhạy cảm (force/upload/config) → audit log + cần role phù hợp.

## 7. Trình duyệt hỗ trợ
Chrome 120+/Firefox 120+/Edge, không plugin (IDE-001/SW-IDE-002).

## 8. Test
Force I/O expire, export CSV, upload program, role enforcement (T-SW-130+).

## 9. Trace REQ
`SW-IDE-001..023`, `IDE-001..034`, `FR-021/023/034`.

---
**Rev** 1.0 | 2026-05-30
