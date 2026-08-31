# Foxlinx — deploy FE trả lại bề mặt khai Published Signal (2026-08-31)

| Thuộc tính | Giá trị |
|---|---|
| Bo | `SOM-DDC-24-foxlinx` — `root@mekong-fac.ddns.net:2223` |
| Nền tảng | Linux OK1126B-buildroot 6.1.141 aarch64; `/` còn 7,4 GB (38 % dùng) |
| Phạm vi | Chỉ FE (`build/web-ui/dist` → `/opt/mkddc-web/dist`); không đụng binary Core/IObus |
| Commit | `main` `2bab307` (PR #347) trên nền `661a714` (PR #346) |
| Mức bằng chứng | **TARGET** cho §3–§5; HOST cho §1 |

Lát này đưa lên bo bản vá của PR #347 **cùng với** bố cục mapping workbench mới
của PR #346 — bo đang chạy bản trước cả hai.

## 1. Kiểm chứng trên host trước khi copy

Chạy lại trọn bộ trên base sau khi pull `main`, không dẫn lại số cũ:

| Gate | Lệnh | Kết quả |
|---|---|---|
| C++ | `cmake --fresh` + build + `ctest` (Modbus+BACnet+HMI ON) | cfg/build/ctest exit **0/0/0**; **1338/1338** pass |
| Go | `go vet ./...` + `go test ./... -count=1` | exit **0/0**; toàn bộ `ok` |
| FE unit | `npx vitest --run --environment jsdom src` | **2199/2200** ⇒ sau vá **2200/2200** |
| FE lint | `npm run lint` | exit **0** |
| FE build | `npm run build:release` | exit **0**; chunk `programming` 162,37 KiB gzip / ngân sách R3 165,00 KiB (dư 2,63 KiB) |
| Layout | `scripts/verify-project.sh --component layout` | exit **0** |

Exit code đọc từ dòng `*_EXIT=` ghi trong chuỗi lệnh, **không** lấy exit code
tiến trình nền báo về — exit đó là của `tail` ở cuối chuỗi.

Bản dựng dùng `npm run build:release`, không phải `npm run build`: cờ Programming
là **build-time**, bản thiếu cờ lên bo là một lát im lặng.

## 2. Sao lưu và đường lùi

`/opt/mkddc-web/dist` cũ được đổi tên tại chỗ, không xoá:

```
/opt/mkddc-web/dist.bak-pubsignal-20260831T015403Z
```

Rollback một lệnh:

```sh
rm -rf /opt/mkddc-web/dist && \
  mv /opt/mkddc-web/dist.bak-pubsignal-20260831T015403Z /opt/mkddc-web/dist && \
  systemctl restart mkddc-web-pi
```

Đây là deploy **chỉ tài sản tĩnh**, cùng một `mkddc-web` phục vụ cả API lẫn
`STATIC_DIR`; lùi lại chỉ trả giao diện về bản cũ, không đụng dữ liệu.
**Đường lùi này chưa được diễn tập** trong lát này.

Bo Buildroot **không có `rsync`** — copy bằng `scp -r` vào `/tmp/mkddc-web-dist-new`
rồi tráo, đúng như các lát trước.

## 3. Toàn vẹn bản đưa lên

So SHA-256 hai đầu, không suy từ việc `scp` đã chạy xong:

| Tệp | Host | Trên bo |
|---|---|---|
| `index.html` | `791ec85d…a2c5da13` | `791ec85d…a2c5da13` |
| `assets/programming-BQ6_a0hv.js` | `13992750…f8fe714c` | `13992750…f8fe714c` |

Khớp tuyệt đối.

## 4. Bundle mang đúng code mới

Phép đo quyết định — kéo chunk **qua chính HTTP của service**, không đọc file
trên đĩa, để bắt cả trường hợp `STATIC_DIR` trỏ chỗ khác:

| Phép đo | Kết quả |
|---|---|
| `GET /` | OK, SHA-256 khớp `index.html` host |
| `GET /assets/programming-BQ6_a0hv.js` | OK |
| `grep -c "Khai Published Signal"` trên chunk phục vụ qua HTTP | **1** |

Chuỗi `"Khai Published Signal"` là nút mở form của `PublishedSignalsPanel` —
thứ mà `8f851cc` đã làm rơi khỏi bundle. Nó có mặt ⇒ bề mặt authoring
`upsertSignal`/`removeSignal` đã trở lại trên bo.

Bo không có `curl` (Buildroot) — dùng `wget` sẵn có.

## 5. Trạng thái sau deploy

| Phép đo | Kết quả |
|---|---|
| `systemctl is-active mkddc-web-pi` | `active` |
| `NRestarts` sau 4 s và đo lại sau 15 s | **0** — không phải vòng restart |
| `mkddc-core` / `mkddc-iobus` | `active` / `active` (không đụng tới) |
| `GET /api/v1/health` | `status=ok`; 6/6 check `ok` (`core`, `io_shm`, `iobus`, `mcu_connection`, `plc_shm`, `web`) |
| `POST /api/v1/auth/login` (`admin`) | 200, token 167 ký tự |
| `GET /api/v1/programming/capabilities` | `targetState=READY`, `edit=true`, `live=true`, `simulation=true` |

## 6. Điều lát này KHÔNG chứng minh

- **Chưa bấm tay trên trình duyệt thật của bo.** Bằng chứng ở §4 là bundle phục
  vụ qua HTTP có mang code; nó không thay cho một lượt bấm "Khai Published
  Signal" → lưu → đọc lại. `e2e/programming-real.spec.ts` (F-P59-UI-001) mới là
  phép đo đó và lane này không chạy trong lát deploy.
- **Đường lùi chưa diễn tập** (§2).
- Không đo lại hiệu năng hay bố cục mapping workbench mới của PR #346 trên khổ
  màn của bo; lát này chỉ khẳng định bản đưa lên đúng bản đã kiểm trên host.
