# Hồ sơ bằng chứng một phần — compiler ST trên target ARM64 (`#414`)

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-STED-21-TARGET-COMPILER-001` |
| Issue chính | `#414` (`ISS-STED-21`) |
| Cổng liên quan | `#369` (`ISS-STED-20`), chặng (d) |
| Ngày đo | 2026-09-06 ICT / 2026-09-05 UTC |
| Base | `origin/main@ad8c322e` |
| Target | Foxlinx `OK1126B-buildroot`, Linux `6.1.141`, `aarch64` |
| Verdict | **ĐẠT MỘT PHẦN** — binary compiler ARM64 chạy thật và JSON không rò đường dẫn; **CHƯA ĐẠT runtime/LIVE/HIL** |

## 1. Phạm vi và ranh giới

Lượt đo này đóng được phần độc lập với chương trình điều khiển đang chạy:

1. cross-build `mkddc-st-compile` bằng toolchain ARM64 của repository;
2. chép binary vào thư mục tạm trên Foxlinx và chạy trực tiếp trên CPU ARM64;
3. biên dịch mẫu `ST-WARN-004`, kiểm `ok=true`, WARNING giữ đủ mã/vị trí/mức và artifact được sinh;
4. đếm rò đường dẫn trên JSON do **binary target** sinh;
5. đối chiếu PID/NRestarts và health trước–sau để chứng minh phép đo không tác động dịch vụ.

Không cài binary vào `/usr/sbin`, không thay Core/IOBus/Web, không Save/Commission/Enable, không đổi
Active Revision và không ghi I/O. Khoá ký dùng cho mẫu là khoá thử nghiệm sinh trong
`/tmp/iss414-target-compiler-20260906/key`; nó không phải khoá thiết bị đang vận hành. Vì vậy artifact
trong hồ sơ này chứng minh **compiler target sinh artifact có WARNING**, nhưng không chứng minh artifact
được Core phát hành chấp nhận hoặc chạy LIVE.

## 2. Build và định danh artifact

Configure từ root bằng toolchain
`platform/cmake/toolchain-aarch64-linux-gnu.cmake`, chỉ dựng target compiler; test và các tính năng
không thuộc compiler được tắt để không sinh binary dịch vụ ngoài phạm vi:

```text
cmake --fresh -S . -B build/iss414-arm64 \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=platform/cmake/toolchain-aarch64-linux-gnu.cmake \
  -DCORE_BUILD_TESTS=OFF -DIOBUS_BUILD_TESTS=OFF -DNETCFG_BUILD_TESTS=OFF \
  -DMKDDC_ENABLE_FW_HOSTCHECK=OFF \
  -DMKDDC_ENABLE_MODBUS=OFF -DMKDDC_ENABLE_BACNET=OFF -DMKDDC_ENABLE_HMI=OFF
cmake --build build/iss414-arm64 --target mkddc-st-compile --parallel
```

| Thuộc tính | Kết quả |
|---|---|
| Toolchain | `aarch64-linux-gnu-g++ 13.3.0` |
| Loại binary | `ELF 64-bit LSB pie executable, ARM aarch64` |
| SHA-256 host | `20aa68d0189e1a256132f54f49d2d51c82663dca5865207e547f28e1e049ba25` |
| SHA-256 đọc lại trên target | cùng giá trị trên |
| Compiler | `fwsom-st-1.2.0` |
| Profile | `revA-1t-1-5-30` |
| Profile SHA-256 | `d2866c41065e2a51fba88460068df453d63b6e95b30879eba292f4b667b49ede` |
| Artifact schema / target ABI | `1` / `3841` |

Nguồn thô: [`build-provenance.txt`](2026-09-06-sted-21-target-compiler/build-provenance.txt),
[`binary-file.txt`](2026-09-06-sted-21-target-compiler/binary-file.txt),
[`binary-sha256.txt`](2026-09-06-sted-21-target-compiler/binary-sha256.txt) và
[`version.txt`](2026-09-06-sted-21-target-compiler/version.txt).

## 3. Kết quả compiler trên target

Fixture [`st-warn-004.st`](2026-09-06-sted-21-target-compiler/st-warn-004.st) đọc `timer.Q`
trước lời gọi `timer(...)` trong cùng chu kỳ. Lệnh chạy trên Foxlinx trả exit `0` và JSON:

```json
{
  "ok": true,
  "diagnostic": {
    "code": "ST-WARN-004",
    "severity": "warning",
    "line": 4,
    "column": 14,
    "length": 5,
    "sourceId": "iss414-target-st-warn-004"
  },
  "artifactSha256": "PottYn1GcOvSelQGIxzbu4EtrnEnOQ5vzCi6jbetodE=",
  "artifactIntegritySha256": "3e8b6d627d4670ebd27a5406231cdbbb812dae7127390e6fcc28ba8db7ada1d1"
}
```

Artifact file có SHA-256
`9b3e8bd049c4b710876a23aebf6d4435f8e5e63bb7de8e55788deac640fcc8fc` và giữ nguyên qua hai
lượt compile liên tiếp bằng cùng source/key. Manifest ghi `integrityMode=SIGNED`,
`signaturePresent=true`, đúng source SHA và target ABI.

Nguồn thô: [`compiler-target.json`](2026-09-06-sted-21-target-compiler/compiler-target.json),
[`compiler-target.exit`](2026-09-06-sted-21-target-compiler/compiler-target.exit),
[`compiler-target.stderr`](2026-09-06-sted-21-target-compiler/compiler-target.stderr),
[`st-warn-004.manifest.json`](2026-09-06-sted-21-target-compiler/st-warn-004.manifest.json),
[`output-sha256.txt`](2026-09-06-sted-21-target-compiler/output-sha256.txt) và
[`artifact-determinism.txt`](2026-09-06-sted-21-target-compiler/artifact-determinism.txt).

## 4. Đo rò đường dẫn trên JSON target

Phép đếm chạy trên toàn bộ JSON compiler, gồm cả diagnostic và artifact inline:

| Mẫu cấm | Số lần |
|---|---:|
| `/tmp/` | 0 |
| `/home/` | 0 |
| `/mnt/` | 0 |
| `mkddc-iss414` | 0 |
| `chuong` | 0 |
| hậu tố thư mục build ngẫu nhiên | 0 |
| **Tổng `PATH_LEAK_COUNT`** | **0** |

[`path-scan.json`](2026-09-06-sted-21-target-compiler/path-scan.json) khóa đồng thời bốn assertion:
`ok=true`, diagnostic exact, artifact hash có mặt và tổng rò bằng `0`.

Kết quả này đóng phép đo số 3 trong phần “Bốn thứ chỉ phần cứng thật mới trả lời được” của `#414`
ở phạm vi **binary ARM64 chạy trên target**. Nó không thay test `sanitizeCompilerMessage()` của Go và
không chứng minh đường LIVE, vì lượt này gọi compiler trực tiếp.

## 5. Bất biến vận hành và sự thật FakeMCU

Snapshot trước–sau compiler giữ nguyên toàn bộ PID/NRestarts:

| Service | PID trước = sau | NRestarts trước = sau | Trạng thái |
|---|---:|---:|---|
| `mkddc-core` | `1468376` | `0` | active |
| `mkddc-iobus` | `1468367` | `0` | active |
| `mkddc-web-pi` | `1476298` | `0` | active |
| `mkddc-fakemcu` | `1468363` | `0` | active |

Ba mẫu `/api/v1/health` lúc `18:33:12Z`, `18:33:14Z`, `18:33:16Z` đều
`status=ok`, đủ **6/6 check `ok`**. Nguồn:
[`preflight.txt`](2026-09-06-sted-21-target-compiler/preflight.txt),
[`postflight.txt`](2026-09-06-sted-21-target-compiler/postflight.txt) và
[`health-samples.txt`](2026-09-06-sted-21-target-compiler/health-samples.txt).

Target vẫn là đường **FakeMCU**:

- `mkddc-fakemcu.service` active, PID `1468363`;
- IOBus chạy `--uart /tmp/mkddc-iop-a`;
- `/tmp/mkddc-iop-a -> /dev/pts/0`.

`mcu_connection=ok` vì phiên IOP giả đang khỏe; nó không phải bằng chứng STM32/physical I/O. Cổng Modbus
riêng của IOBus có fd `/dev/ttyS5`, nhưng không liên quan tới local I/O/MCU của kịch bản này.

## 6. Đối chiếu tiêu chí `#414` và `#369`

| Tiêu chí | Trạng thái sau lượt đo | Bằng chứng / điều kiện còn thiếu |
|---|---|---|
| Cross-build compiler cho Foxlinx | **ĐẠT** | ELF ARM64, hash host=target, chạy trực tiếp trên SOM |
| `PATH_LEAK_COUNT` trên JSON binary target | **ĐẠT** | `0`, xem §4 |
| WARNING không chặn sinh artifact | **ĐẠT trên compiler target** | exit 0, `ok=true`, artifact + manifest SIGNED bằng khoá thử nghiệm |
| Nạp artifact vào Core phát hành | **CHƯA ĐẠT** | chưa dùng khoá thiết bị vận hành, chưa Commission |
| Đo `ST-WARN-004` qua hai chu kỳ LIVE | **CHƯA ĐẠT** | cần chương trình thử nghiệm Active và read-back hai chu kỳ |
| Problems UI nhận dữ liệu từ bo trong LIVE | **CHƯA ĐẠT** | cần Check/Commission/LIVE cùng revision trên target |
| Physical MCU/I/O | **CHƯA ĐẠT** | board hiện chạy `mkddc-fakemcu` qua PTY |

Vì ba hàng cuối chưa đạt, `#414` và chặng (d) của `#369` **phải giữ OPEN**. Để mở khóa cần cửa sổ
nghiệm thu cho phép thay Active Program bằng fixture, khoá ký đúng của controller, kế hoạch khôi phục
Active/LKG hiện tại, và nối IOBus sang STM32 thật thay cho `mkddc-fakemcu`. Không được dùng kết quả này để
nâng `RELEASE_READY`, HIL hoặc physical I/O thành PASS.

## 7. Toàn vẹn hồ sơ

[`SHA256SUMS`](2026-09-06-sted-21-target-compiler/SHA256SUMS) liệt kê hash cho toàn bộ tệp thô đã commit.
Khoá bí mật tạm thời và binary build không nằm trong repository.

---

## Revision History

| Phiên bản | Ngày | Người sửa | Mô tả |
|---|---|---|---|
| 1.0 | 2026-09-06 | Codex | Cross-build và chạy compiler ARM64 trên Foxlinx; đóng phép đo JSON/path leak, ghi rõ FakeMCU và các tiêu chí LIVE/HIL còn chặn |
