# Yêu cầu Firmware MCU — MK-DDC-24 (giao cho team MCU)

**Document ID:** FW-REQ-MK-DDC-24-VI
**Phiên bản:** 3.1
**Bản rà soát:** R2 — thêm truy vết tới quy trình kiểm và đầu vào HW; 74 ID giữ nguyên
**Cập nhật:** 2026-09-30
**Trạng thái:** IOP **V3.0 duy nhất đã được chủ dự án chọn** theo ADR-064; yêu cầu chi tiết vẫn Draft để **team SOM, team MCU và Safety thống nhất**, chưa ký (§9)
**Chủ quản:** System Architect
**Người nhận thực hiện:** Team MCU (team riêng, tự thiết kế bên trong firmware)
**Người review:** MCU team lead, SOM lead, Safety, Verification
**Người phê duyệt:** System Architect + Safety
**Đi cùng:** [ICD SOM ↔ MCU `IOP-SPEC-MK-DDC-24-VI` v3.0](SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) (Kinexus-IOP v3.0) · [Header nháp `iop_protocol_v3_DRAFT.h`](iop_protocol_v3_DRAFT.h) · [Ví dụ tích hợp](IOP_V3_INTEGRATION_EXAMPLES_MK-DDC-24_VI.md) · [Ma trận và quy trình kiểm chứng](IOP_V3_VERIFICATION_PLAN_MK-DDC-24_VI.md) · [Phiếu đầu vào HW](IOP_V3_HW_INPUT_FORM_MK-DDC-24_VI.md). Mọi yêu cầu giao tiếp trong tài liệu này trỏ về ICD, không định nghĩa lại.
**Thay thế:** bản 3.0 (cùng ngày, chưa phát hành) và bản 2.1 (2026-06-30) của chính file này. Bản 2.1 trộn yêu cầu với thiết kế bên trong; bản này chỉ giữ **hành vi quan sát được từ bên ngoài MCU**.
**Nguồn:** [REQUIREMENTS.md](../02_requirements/REQUIREMENTS.md) (`SAFE-REQ-001`, `IF-REQ-001`, `HW-REQ-001`, `FW-REQ-MCU-001/002`), quyết định chủ sở hữu 2026-09-30 ([DECISIONS.md](../00_governance/DECISIONS.md)), rà soát [`REC-DDC-FWSOM-MCU-PAIR-20260930`](../07_records/reviews/DDC24_FW_SOM_MCU_PAIR_INTEGRATION_REVIEW_2026-09-30.md)

---

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| Tài liệu này là gì? | Danh sách **yêu cầu hộp đen** mà firmware STM32G0B1 phải đạt: MCU làm gì, trong bao lâu, khi lỗi thì ra sao, và giao gì khi bàn giao. |
| Bo nào? | **Hai biến thể**: 16 UI / 4 AO / 4 DO và 16 UI / 8 AO / 8 DO. Firmware khai số kênh thực lắp qua giao thức (ICD §2.1). Từ đây `N_AO`, `N_DO` là số AO/DO thực lắp của bo đang chạy. |
| Nó không nói gì? | **Cách** làm bên trong: RTOS hay superloop, task, ngắt, DMA, driver, bộ nhớ, coding style. Team MCU tự quyết (§5). |
| Giao tiếp với SOM quy định ở đâu? | Chỉ [ICD V3.0](SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) và [header nháp](iop_protocol_v3_DRAFT.h) là hợp đồng mục tiêu; không giữ V2.x làm fallback. Tài liệu này thêm tiêu chí nghiệm thu. |
| Phần cứng lấy ở đâu? | Từ **tài liệu HW của từng biến thể** (schematic, BOM, bảng chân) do HW cung cấp **riêng**, ngoài bộ tài liệu này. Mâu thuẫn về chân hay mạch đưa lên HW quyết. |
| Bao nhiêu yêu cầu? | 74 yêu cầu hiệu lực (69 MUST, 5 SHOULD), 5 yêu cầu hoãn sang Rev B, 16 ID cũ đã rút. Bảng đầy đủ ở §7. |
| Nghiệm thu thế nào? | Ba cổng G-MCU-1 (host), G-MCU-2 (bo rời nối SOM thật), G-MCU-3 (HIL trên carrier) ở §6. |

## 1. Phạm vi và ranh giới trách nhiệm

| Việc | Team MCU | Team SOM | HW | Safety |
|---|:---:|:---:|:---:|:---:|
| Thiết kế và code firmware STM32 (BSP, driver, lịch, xử lý IOP) | **R/A** | C | C | — |
| Hợp đồng giao tiếp (ICD, header) | C | C | — | C |
| Tài liệu phần cứng từng biến thể: pinout, mạch, cách ly, chip DAC, driver relay | C | I | **R/A** | C |
| iobus, đổi đơn vị, lọc, debounce, alarm, cấu hình kênh | I | **R/A** | — | — |
| Safe value mặc định và chính sách safe | C | C | C | **A** |
| Kiểm thử host và bo của firmware | **R** | I | — | — |
| Kiểm thử cặp (P1/P2) | R | **R** | C | I |
| HIL (P3) | R | R | **R** | A |

R = thực hiện · A = chịu trách nhiệm cuối · C = tham vấn · I = được báo. Chủ sở hữu hợp đồng giao tiếp là **System Architect**.

## 2. Tài liệu ràng buộc và tài liệu tham khảo

**Ràng buộc** (team MCU phải tuân):

| Tài liệu | Nội dung ràng buộc |
|---|---|
| [ICD `IOP-SPEC-MK-DDC-24-VI` v3.0](SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | toàn bộ hành vi giao tiếp |
| [`iop_protocol_v3_DRAFT.h`](iop_protocol_v3_DRAFT.h) | byte và hằng số. Sau khi ký, chính nội dung này thành `contracts/iop/iop_protocol.h` v3.0. Include trực tiếp, **không sao chép hằng số**. |
| Tài liệu HW của biến thể bo (do HW cung cấp riêng) | part, clock, chân, ngoại vi, mạch UI/AO/DO, cách chọn mode UI/AO |

**Không kèm và không ràng buộc:** các tài liệu thiết kế firmware cũ của dự án (FW_ARCH_SPEC, FW_DDD, `FW_MOD_*`, FW_PINOUT_MASTER, guide 04, PROGRAMMING_FW_MCU_DESIGN). Chúng mô tả bản 4 AO / 4 DO và IOP V2.x; team MCU không dùng chúng làm đầu vào triển khai V3.0. Tài liệu cũ chỉ được giữ trong repo để tra lịch sử, không là đường tương thích dự phòng.

## 3. Quy ước

- **PHẢI (MUST)**: thiếu thì không nghiệm thu. **NÊN (SHOULD)**: không đạt phải giải trình bằng văn bản. **CÓ THỂ (MAY)**: tùy chọn.
- Mọi yêu cầu **phân bổ cho firmware MCU**, trừ khi ghi khác. Yêu cầu có chữ "mọi kênh thực lắp" áp cho AO1..AO`N_AO` và DO1..DO`N_DO` của biến thể đang chạy.
- Phương pháp kiểm:

| Mã | Phương pháp |
|---|---|
| `I` | kiểm tài liệu hoặc artefact bàn giao |
| `A` | phân tích |
| `H` | test trên host do team MCU chạy |
| `B` | test trên bo (bo rời hoặc carrier), có log |
| `P` | kiểm cặp với SOM theo `ICD-T-*` |
| `L` | HIL có thiết bị đo đã hiệu chuẩn |

- ID giữ ổn định theo bản 2.1. Yêu cầu mới dùng số chưa cấp. ID đã rút **không được tái sử dụng** (§7).

## 4. Yêu cầu

### 4.1 Giao tiếp IOP (`FW-IOP`)

| ID | Yêu cầu | Mức | Kiểm | Tiêu chí chấp nhận |
|---|---|---|---|---|
| FW-IOP-001 | MCU PHẢI thực hiện IOP v3.0 đúng ICD §3–§13: frame, lệnh, payload, trạng thái §7 và luật `ICD-R-01..09`. | MUST | H, P | `ICD-T-01..06`, `ICD-T-10`, `ICD-T-16` PASS |
| FW-IOP-003 | Thời gian từ hết frame request tới start bit của response (`T_turn`) PHẢI ≤ 0,5 ms ở p99,9 và ≤ 1,0 ms tối đa, với mọi lệnh. | MUST | B, P | `ICD-T-11`: 24 h ở poll 500 Hz, log logic analyzer hoặc dấu thời gian phía SOM |
| FW-IOP-004 | Với `LEN ≤ 252`, MCU PHẢI nhận đủ frame và kiểm CRC trước kiểm CMD/LEN/giá trị/trạng thái; frame sai CRC không được làm đổi bất kỳ trạng thái hay output nào. Khung `LEN > 252` bị bỏ theo ICD §4.3. | MUST | H | `ICD-T-01`, `ICD-T-02`; CMD/LEN sai đồng thời CRC sai phải trả `ERR_CRC_FAIL` |
| FW-IOP-005 | MCU PHẢI trả NACK đúng mã theo ICD §10.1, gồm các mã `0x07`–`0x09`. | MUST | H | `ICD-T-02`, `ICD-T-03` |
| FW-IOP-006 | MCU PHẢI thương lượng phiên bản theo ICD §6.10, §12.1: trả `INCOMPAT` cho SOM khác major (gồm v2.0 và v1), và khai `BOARD_FEATURES` đúng tính năng của bo. | MUST | H, P, I | `ICD-T-10` kể cả vector âm; `BOARD_FEATURES` khớp bo |
| FW-IOP-007 | Chỉ `GET_IO` hợp lệ khi đang có phiên mới được nuôi watchdog liên lạc (`ICD-R-01`). | MUST | H, B | `ICD-T-04`: frame khác và frame lỗi không làm lùi thời điểm vào safe |
| FW-IOP-008 | `FAULT_FLAGS` PHẢI là uint16 theo bảng ICD §6.1.2 (bit 5 = `WDG_RESET`, bit 7 = `VDD_FAULT`). | MUST | H, B | từng bit bật và xoá đúng điều kiện |
| FW-IOP-010 | MCU PHẢI chịu được luồng byte bất kỳ (chia mảnh, dính frame, rác, khoảng trống > 1 ms, LEN sai hoặc > 252, CMD lạ) mà không treo, không tràn bộ đệm, không mất đồng bộ lâu hơn một frame. | MUST | H, B | `ICD-T-02`; fuzz ≥ 10⁷ byte ngẫu nhiên không crash, không treo, vẫn trả lời `GET_IO` hợp lệ ngay sau đó |
| FW-IOP-011 | MCU PHẢI trả đúng một response cho mỗi request nhận đủ khung với `LEN ≤ 252` (gồm NACK khi lỗi) và không bao giờ tự gửi frame (`ICD-R-08`). | MUST | H, P | 24 h capture: số response = số request nhận đủ khung trong miền LEN; 0 frame tự phát |
| FW-IOP-012 | MCU PHẢI xử lý frame lặp theo `ICD-R-06`: gửi lại response cũ, không thực thi lại lệnh ghi. | MUST | H | `ICD-T-05` |
| FW-IOP-013 | Trong 24 h ở poll 500 Hz trên đường truyền sạch (0 lỗi CRC phía nhận), tỉ lệ giao dịch không có response đúng PHẢI ≤ 1 × 10⁻⁶. | MUST | P | `ICD-T-11` |
| FW-IOP-014 | `MCU_STATE` và mọi field của `STATE_RESP` PHẢI đúng ICD §6.1.3, §6.9 ở mọi trạng thái. | MUST | H, P | kiểm từng field qua các chuyển trạng thái §7.2 của ICD |
| FW-IOP-015 | `HANDSHAKE_RESP` PHẢI khai **đúng** `N_UI`, `N_AO`, `N_DO`, `N_DI` của bo đang chạy (16/4/4/0 hoặc 16/8/8/0), kể cả khi trả `INCOMPAT`. | MUST | H, B, P | `ICD-T-16` trên từng biến thể |

### 4.2 Đầu vào UI (`FW-IO`)

| ID | Yêu cầu | Mức | Kiểm | Tiêu chí chấp nhận |
|---|---|---|---|---|
| FW-IO-001 | MCU PHẢI lấy mẫu liên tục 16 kênh UI với tốc độ ≥ 1 kSPS mỗi kênh, và điền `UI_RAW` là trung bình các mẫu kể từ `IO_RESP` trước (ICD §6.1). | MUST | B, L | `ADC_SAMPLE_RATE` ≥ 1000; `UI_RAW` lệch ≤ 1 LSB so với trung bình tính từ bản ghi SPI cùng khoảng |
| FW-IO-002 | MCU KHÔNG lọc thêm ngoài phép trung bình trên. Lọc, loại gai và debounce do SOM làm. | MUST | I, H | review mã nguồn của team MCU; test bước nhảy thấy đúng trung bình |
| FW-IO-004 | Mã 24 bit PHẢI được mở rộng dấu lên int32 và truyền big-endian. | MUST | H | biên `0x7FFFFF`, `0x800000`, `0xFFFFFF` ra đúng +8388607, −8388608, −1 |
| FW-IO-005 | `SAMPLE_CNT` PHẢI theo ngữ nghĩa ICD §6.1. | MUST | H, B | ở 1 kSPS tăng 2 ± 1 mỗi poll 2 ms |
| FW-IO-006 | Mỗi ADC của UI1..UI8 và UI9..UI16 không có mẫu hợp lệ trong 100 ms thì PHẢI bật đúng `ADC1_FAULT` hoặc `ADC2_FAULT`, kèm bit `ADC_STAT` phù hợp (ICD §6.1.1). | MUST | B, L | ngắt từng chip: chỉ bit của chip đó bật, trong 100–150 ms |
| FW-IO-008 | Khi ADC lỗi, MCU NÊN tự khởi tạo lại chip ít nhất mỗi 1 s và tự hồi phục khi chip trở lại, không cần reset MCU. | SHOULD | B | nối lại chip: bit lỗi tự tắt trong ≤ 2 s |
| FW-IO-010 | MCU PHẢI áp `SET_UI_CFG` vào phần cứng chọn mode từng kênh theo tài liệu HW của biến thể. | MUST | B, L | 5 mode × 16 kênh, đo đường tín hiệu đúng mode |
| FW-IO-011 | Kênh không đổi mode PHẢI mất tối đa 1 mẫu khi kênh khác đổi mode. | MUST | B | `ICD-T-12` |
| FW-IO-012 | Sau khi đổi mode, `SETTLING` PHẢI bật cho tới khi mạch settle và mẫu đầu đã bị bỏ, và PHẢI tắt trong ≤ 100 ms sau ACK. | MUST | B, L | `ICD-T-12` |
| FW-IO-013 | Mode UI đang áp PHẢI phản ánh trong `CFG_DIGEST`. Mode không hỗ trợ bị NACK `ERR_BAD_VALUE`, không áp phần nào. | MUST | H | vector §6.12 của ICD; lệnh có một kênh sai giữ nguyên toàn bộ mode cũ |
| FW-IO-014 | Rev A không có PT100/PT1000: `BOARD_FEATURES.RTD = 0` và không có mode RTD. | MUST | I | `HANDSHAKE_RESP` |
| FW-IO-015 | Từ lúc nhả reset tới khi nhận `SET_UI_CFG`, mọi kênh UI PHẢI ở `DISABLED` (trạng thái an toàn của phần cứng chọn mode). | MUST | B, L | đo khi cấp nguồn 20 lần |
| FW-IO-016 | `UI_OV` PHẢI bật khi có kênh đang bật mà \|UI_RAW\| ≥ 8 136 950, và tắt khi mọi kênh dưới ngưỡng. | MUST | H | biên 8 136 949 / 8 136 950 |
| FW-IO-024 | Rev A khai `N_DI = 0`; `IO_RESP` không có DI. SKU có DI cách ly cần thay đổi hợp đồng riêng. | MUST | I | — |

### 4.3 Đầu ra analog (`FW-AO`)

| ID | Yêu cầu | Mức | Kiểm | Tiêu chí chấp nhận |
|---|---|---|---|---|
| FW-AO-001 | Ở `SESSION_RUN`, mọi AO thực lắp PHẢI được cập nhật trước start bit của ACK cho `SET_AO`, **cùng một lần** cho cả `N_AO` kênh. | MUST | B | `ICD-T-06`: cạnh cập nhật DAC xảy ra trước ACK trên cả biến thể 4 và 8 AO |
| FW-AO-003 | Ghi DAC thất bại thì PHẢI bật `DAC_FAULT`, trả NACK `ERR_HW_FAULT` và chuyển `SESSION_SAFE`. | MUST | H, B | chèn lỗi SPI |
| FW-AO-004 | Khi `RESET_IO`, mọi AO thực lắp PHẢI về safe value trước start bit của ACK. | MUST | B, L | đo ở đầu ra DAC |
| FW-AO-005 | Chỉ khi chưa đủ 200 ms kể từ `GET_IO` hợp lệ cuối, MCU mới giữ giá trị AO đã lệnh (`ICD-R-02`). Hết cửa sổ thì theo FW-WDG-005. | MUST | H, L | `ICD-T-04` |
| FW-AO-006 | Kênh hoặc bit AO không lắp (≥ `N_AO`) khác 0 trong `SET_AO`, `SET_AO_CFG` hoặc `SET_SAFE_CFG` PHẢI bị NACK `ERR_BAD_VALUE`, không áp phần nào. | MUST | H | V19 của ICD; biến thể 4 AO nhận AO5..AO8 ≠ 0 |
| FW-AO-007 | MCU PHẢI chuyển đường 0–10 V / 4–20 mA của từng AO thực lắp theo `SET_AO_CFG`. Đổi mode khi đang `SESSION_RUN` PHẢI đưa MCU về `SESSION_SAFE` (ICD §6.5). | MUST | B, L | đo cả hai mode ở mọi AO thực lắp |
| FW-AO-008 | Khi khởi động, mode AO PHẢI lấy từ bản đã lưu (FW-CFG-001); không có bản hợp lệ thì dùng 0–10 V. | MUST | B | cắt nguồn sau khi đặt 4–20 mA: khởi động lên vẫn 4–20 mA |
| FW-AO-009 | Safe value AO lấy theo `SET_SAFE_CFG` (bản đã lưu), mặc định raw 0. Ở mode 4–20 mA, raw 0 PHẢI ra 4,0 mA tại cực, trong dung sai HW đã duyệt; nếu đường DAC thật là 0–20 mA thì MCU tự quy đổi. | MUST | L | đo tại cực ở cả hai mode |
| FW-AO-010 | Khi `VDD_FAULT` bật, mọi output PHẢI về safe value, MCU về `SESSION_SAFE` nếu đang chạy và `OUTPUT_MISMATCH = 1` cho tới khi VDD hồi phục; không tự chạy lại khi VDD hồi phục. | MUST | B, L | hạ rồi khôi phục VDD: output giữ safe tới khi RESYNC, đo tại cực |

### 4.4 Đầu ra relay (`FW-DO`)

| ID | Yêu cầu | Mức | Kiểm | Tiêu chí chấp nhận |
|---|---|---|---|---|
| FW-DO-001 | Ở `SESSION_RUN`, chân drive của mọi DO được `MASK` chọn PHẢI được đặt trước start bit của ACK cho `SET_DO`. | MUST | B | `ICD-T-06` trên cả biến thể 4 và 8 DO |
| FW-DO-002 | `DO_FB_MASK` PHẢI là trạng thái relay đo được khi `BOARD_FEATURES.DO_FB = 1`, và là trạng thái chân drive khi `= 0`; bit ≥ `N_DO` luôn 0. | MUST | B, L | theo từng biến thể bo |
| FW-DO-003 | Khi `BOARD_FEATURES.DO_FB = 1`: feedback khác lệnh liên tục > 20 ms thì PHẢI bật `RELAY_STUCK`. Khi `= 0`: không bao giờ bật. | MUST | L | kẹt cơ khí hoặc ngắt cuộn relay |
| FW-DO-004 | Safe value DO lấy theo `DO_SAFE_MASK`, mặc định mở hết (không cấp điện cuộn). | MUST | L | đo tiếp điểm |
| FW-DO-007 | Bit ≥ `N_DO` khác 0 trong `MASK`/`VALUE` của `SET_DO`, hoặc trong `DO_SAFE_MASK`, PHẢI bị NACK `ERR_BAD_VALUE`, không áp phần nào. | MUST | H | biến thể 4 DO nhận bit 4..7 ≠ 0 |

### 4.5 An toàn, watchdog, khởi động (`FW-WDG`, `FW-BOOT`)

| ID | Yêu cầu | Mức | Kiểm | Tiêu chí chấp nhận |
|---|---|---|---|---|
| FW-WDG-001 | Nếu việc lấy mẫu UI hoặc xử lý IOP ngừng tiến triển ≥ 1 s, MCU PHẢI tự reset. Output PHẢI ở safe trong và sau khi reset. Cơ chế do team MCU chọn. | MUST | B, L | build test có điểm chèn treo; đo output và `RESET_CAUSE` |
| FW-WDG-005 | Không có `GET_IO` hợp lệ khi đang có phiên thì MCU PHẢI đưa mọi output về safe value trong khoảng [200 ; 205] ms, và không được làm sớm hơn 200 ms (`ICD-R-03`). | MUST | H, B, L | `ICD-T-04`; HIL đo bằng logic analyzer và DAQ |
| FW-WDG-006 | MCU PHẢI ghi nhận nguyên nhân reset và báo qua `RESET_CAUSE`, bit sticky `WDG_RESET`, `WDG_RESET_CNT` (ICD §6.1.2, §6.8, §6.9). | MUST | B | tạo từng loại reset: POR, NRST, watchdog, phần mềm |
| FW-WDG-007 | Từ lúc nhả reset, output không được rời safe. Firmware PHẢI đặt xong safe value trong ≤ 10 ms sau khi nhả reset. Trong lúc reset, HW bảo đảm output không cấp điện. | MUST | L | scope 20 lần cấp nguồn và 20 lần xung nRESET |
| FW-WDG-008 | MCU chỉ rời trạng thái safe theo `ICD-R-04` và `ICD-R-05`: phải có HANDSHAKE, `CFG_VALID = 1`, ít nhất một `GET_IO` hợp lệ, không có lỗi phần cứng ngăn chạy, sau đó đủ `SET_AO` và bit của **mọi DO thực lắp**; AO và DO chuyển cùng lúc trước ACK lệnh cuối. | MUST | H, P | `ICD-T-03`, `ICD-T-07`, `ICD-T-16`; thiếu bất kỳ điều kiện nào thì output giữ safe |
| FW-BOOT-001 | MCU PHẢI trả lời được IOP trong ≤ 500 ms sau khi nhả reset. | MUST | B | 20 lần đo |
| FW-BOOT-004 | Khi khởi động, MCU PHẢI tự kiểm giao tiếp với các ADC, các DAC và VDD trong dải. Lỗi thì bật bit fault tương ứng và `LAST_SAFE_REASON = SELF_TEST`. | MUST | B | chèn lỗi từng khối |
| FW-BOOT-005 | Khi tự kiểm lỗi, MCU không được vào `SESSION_RUN`; `SET_AO`/`SET_DO` bị NACK `ERR_HW_FAULT`. | MUST | H, B | — |

### 4.6 Chẩn đoán (`FW-DIAG`)

| ID | Yêu cầu | Mức | Kiểm | Tiêu chí chấp nhận |
|---|---|---|---|---|
| FW-DIAG-001 | Nhiệt độ die PHẢI được đo và cập nhật vào `MCU_TEMP` ít nhất mỗi 1 s. | MUST | B | so với nhiệt kế ngoài, sai số theo datasheet STM32 |
| FW-DIAG-002 | `MCU_OVERTEMP` bật ở > 85,0 °C, tắt ở < 80,0 °C. Quá nhiệt **không** được làm đổi tốc độ lấy mẫu. | MUST | H, B | mô phỏng giá trị nhiệt |
| FW-DIAG-003 | VDD PHẢI được đo và báo ở `VDD_MV`. | MUST | B | sai số ≤ ±50 mV so với đồng hồ |
| FW-DIAG-004 | VDD ngoài [3,0 ; 3,6] V thì PHẢI bật `VDD_FAULT` và áp FW-AO-010. | MUST | B, L | nguồn điều chỉnh được |
| FW-DIAG-005 | Các bộ đếm `DIAG_RESP` PHẢI theo ngữ nghĩa ICD §6.8. | MUST | H | — |
| FW-DIAG-006 | `WDG_RESET_CNT` NÊN giữ qua các lần reset không phải do mất nguồn. | SHOULD | B | — |
| FW-DIAG-007 | `FAULT_OUT` PHẢI theo hành vi logic ở ICD §3.3. | MUST | B, P | `ICD-T-14` |

### 4.7 Cấu hình lưu bền (`FW-CFG`)

| ID | Yêu cầu | Mức | Kiểm | Tiêu chí chấp nhận |
|---|---|---|---|---|
| FW-CFG-001 | MCU PHẢI lưu bền mode AO và `SET_SAFE_CFG`, và chỉ ghi khi giá trị thực sự đổi. Bản lưu có số kênh khác biến thể đang chạy thì coi là không hợp lệ và dùng mặc định. | MUST | B | đếm số lần ghi sau 1000 lệnh cấu hình trùng giá trị: 0; nạp firmware khác biến thể: dùng mặc định |
| FW-CFG-002 | Mất điện đúng lúc đang ghi không được để lại cấu hình hỏng: sau khi khởi động phải là giá trị cũ, giá trị mới hoặc mặc định. | MUST | B | `ICD-T-13`: ≥ 100 lần cắt nguồn ngẫu nhiên trong lúc ghi |
| FW-CFG-003 | Mode UI **không** được lưu bền (FW-IO-015). | MUST | I, B | — |
| FW-CFG-004 | `CFG_DIGEST` PHẢI tính theo ICD §6.12 (34 byte, CRC-32). | MUST | H | 2 vector trong ICD |
| FW-CFG-005 | Bộ nhớ bền PHẢI chịu được ≥ 10 000 lần đổi cấu hình trong vòng đời thiết bị. | MUST | A | phân tích độ bền flash theo datasheet và cách ghi của team MCU |

### 4.8 Nạp firmware (`FW-OTA`)

| ID | Yêu cầu | Mức | Kiểm | Tiêu chí chấp nhận |
|---|---|---|---|---|
| FW-OTA-001..005 | Cập nhật firmware MCU qua SOM | **Rev B** | — | Hoãn theo quyết định 2026-08-20; giữ ID, chưa thuộc Rev A |
| FW-OTA-006 | Rev A nạp firmware qua SWD tại nhà máy. Khởi động bình thường không được phụ thuộc chân BOOT0 ngoài việc BOOT0 được giữ ở mức khởi động bình thường. Option byte cần đặt PHẢI được ghi trong hồ sơ bàn giao. | MUST | I, B | nạp theo hướng dẫn trên 3 bo trắng |

### 4.9 Nền phần cứng và biến thể (`FW-HW`)

| ID | Yêu cầu | Mức | Kiểm | Tiêu chí chấp nhận |
|---|---|---|---|---|
| FW-HW-001 | Firmware chạy trên STM32G0B1RBT6 và dùng chân/ngoại vi đúng tài liệu HW của biến thể bo. Chỗ nào mâu thuẫn thì đưa lên HW, không tự chọn. | MUST | I | đối chiếu cấu hình chân với tài liệu HW |
| FW-HW-002 | MCU là SPI master duy nhất của các ADC UI (`HW-REQ-001`). | MUST | I | — |
| FW-HW-003 | Liên kết IOP dùng một USART do HW chỉ định, 921 600 8N1, sai số baud ≤ ±1,5 % (ICD §3.1). | MUST | B | đo baud thực |
| FW-HW-004 | Firmware PHẢI hỗ trợ **cả hai biến thể** 16/4/4 và 16/8/8, bằng một image tự nhận biến thể hoặc một image riêng cho mỗi biến thể. Cách nhận biết (chân nhận diện, cấu hình build) do team MCU và HW thống nhất; team SOM không phụ thuộc cách đó. | MUST | I, B, P | `ICD-T-16` PASS trên cả hai biến thể; release note nêu rõ image nào cho biến thể nào |

### 4.10 Bàn giao và chất lượng (`FW-REL`)

| ID | Yêu cầu | Mức | Kiểm | Tiêu chí chấp nhận |
|---|---|---|---|---|
| FW-REL-001 | Image PHẢI nhúng phiên bản, commit, thời điểm build, toolchain và biến thể hỗ trợ. `FW_VERSION` báo qua IOP PHẢI khớp release note. | MUST | I, P | đọc chuỗi trong ELF và `HANDSHAKE_RESP` |
| FW-REL-002 | Mỗi lần bàn giao PHẢI gồm: ELF, HEX hoặc BIN, SHA-256 của từng file, map file, release note (phiên bản IOP, biến thể và `BOARD_FEATURES` hỗ trợ, thay đổi, lỗi đã biết). | MUST | I | checklist bàn giao |
| FW-REL-003 | Build NÊN tái lập được từ source có tag với toolchain đã ghi; build lại cho cùng SHA-256. | SHOULD | I | build lại một lần ở phía nhận |
| FW-REL-004 | Mỗi lần bàn giao PHẢI kèm kết quả các bài kiểm phía MCU của ICD §15.2 ở mức host, và log bo nếu đã tới cổng G-MCU-2. | MUST | I | báo cáo có số đo thật, ngày chạy, commit |
| FW-REL-005 | `FW_VERSION` PHẢI tăng mỗi lần bàn giao; đổi hành vi giao tiếp thì tăng minor trở lên. | MUST | I | — |
| FW-REL-006 | Image NÊN chừa ≥ 32 KB flash trống cho bootloader Rev B và vùng cấu hình. | SHOULD | I | map file |
| FW-REL-007 | Team MCU NÊN công bố coding standard và công cụ phân tích tĩnh đã dùng, và không còn cảnh báo mức cao chưa xử lý ở mỗi lần bàn giao. | SHOULD | I | báo cáo phân tích tĩnh |
| FW-REL-008 | Team MCU PHẢI cung cấp một bản build chạy trên Linux x86-64 của **phần xử lý IOP và trạng thái** (không cần driver thật), nói chuyện qua PTY, có hành vi giao tiếp giống firmware thật và **chọn được biến thể** 4/4 hoặc 8/8 khi chạy. Dùng cho chặng P1. | MUST | I, P | iobus chạy với bản này qua `ICD-T-01..10` và `ICD-T-16` cho cả hai biến thể |

## 5. Những điều **không** bị ràng buộc

Team MCU tự quyết, không cần xin duyệt, miễn đạt §4 và ICD:

- dùng RTOS hay superloop, cách tổ chức task/ngắt/ưu tiên;
- dùng DMA, ngắt hay polling cho UART/SPI; dùng HAL, LL hay tự viết driver;
- bố trí bộ nhớ, bộ đệm, stack, cách lưu bền (miễn đạt FW-CFG-*);
- cơ chế watchdog cụ thể (miễn đạt FW-WDG-001);
- cách đồng bộ ADC (DRDY hay timer), miễn đạt FW-IO-001/005/006;
- cách nhận biết biến thể bo (miễn đạt FW-HW-004, FW-IOP-015);
- coding standard và công cụ (có khuyến nghị ở FW-REL-007).

## 6. Nghiệm thu

[Kế hoạch kiểm chứng](IOP_V3_VERIFICATION_PLAN_MK-DDC-24_VI.md) §2 mô tả điều kiện/bước/kỳ vọng/bằng chứng cho `ICD-T-01..16`; §3–§4 phủ **74/74** yêu cầu hiệu lực bằng quy trình dự kiến. Đây là ma trận kế hoạch, mọi Test Result vẫn `NOT RUN` cho tới khi team MCU/SOM/HW thực hiện và người có thẩm quyền review.

| Cổng | Môi trường | Yêu cầu phải PASS | Bằng chứng |
|---|---|---|---|
| **G-MCU-1** | Host (P1): bản build FW-REL-008 nối iobus qua PTY, chạy **cả hai biến thể**, cộng test host của team MCU | FW-IOP-001, 004, 005, 006, 007, 008, 010, 011, 012, 014, 015 · FW-IO-004, 013, 016 · FW-AO-005, 006 · FW-DO-007 · FW-WDG-008 · FW-CFG-004 · FW-DIAG-005 · FW-HW-004 (phần host) · FW-REL-001, 002, 004, 008 | kết quả `ICD-T-01..10`, `ICD-T-16`; báo cáo test host của team MCU |
| **G-MCU-2** | Bo rời nối SOM qua UART thật (P2) | G-MCU-1, cộng: FW-IOP-003, 013 · FW-WDG-001, 005 (phần thời gian), 006 · FW-BOOT-001, 004, 005 · FW-DIAG-001, 002, 007 · FW-CFG-001, 002 · FW-HW-003 · FW-OTA-006 | log logic analyzer, capture 24 h, `ICD-T-03..14`, `ICD-T-16` |
| **G-MCU-3** | Carrier của từng biến thể có sẵn, HIL (P3) | toàn bộ yêu cầu MUST còn lại, đặc biệt FW-IO-001/006/010/012/015 · FW-AO-* · FW-DO-* · FW-WDG-005/007 · FW-DIAG-003/004 · FW-HW-001, 004 | ma trận HIL vật lý, thiết bị đo đã hiệu chuẩn, SHA-256 firmware, revision và biến thể bo |

Chỉ bằng chứng có SHA-256 firmware, revision và biến thể bo, thiết bị đo, quy trình và kết quả mới được dùng để đóng cổng. Test host không chứng minh được ADC, DAC, relay hay UART thật.

## 7. Truy vết và trạng thái so với bản 2.1

### 7.1 Liên kết yêu cầu hệ thống

| Yêu cầu hệ thống | Yêu cầu MCU tương ứng |
|---|---|
| `IF-REQ-001` (921600, poll 2 ms, timeout 3 ms, retry 3, fault 20 ms) | FW-IOP-001, 003, FW-HW-003 |
| `SAFE-REQ-001` (safe khi không có poll hợp lệ 200 ms) | FW-IOP-007, FW-WDG-005, FW-AO-005 |
| `FW-REQ-MCU-001` (IOP và driver I/O) | toàn bộ §4.1–§4.4 |
| `FW-REQ-MCU-002` (safe output 200 ms) | FW-WDG-005, FW-WDG-008, FW-AO-009, FW-DO-004 |
| `HW-REQ-001` (STM32 là SPI master duy nhất) | FW-HW-002 |

### 7.2 Trạng thái từng ID

| Trạng thái | ID |
|---|---|
| **Giữ nguyên nghĩa** | FW-IOP-004, 005 · FW-IO-004, 008, 014, 024 · FW-AO-003 · FW-DO-003 · FW-WDG-006 · FW-BOOT-001, 005 · FW-DIAG-001, 003, 004, 005 |
| **Đổi nội dung** (cùng chủ đề) | FW-IOP-001 (v1 → ICD v3.0) · FW-IOP-003 (≤ 5 ms → `T_turn` ≤ 1 ms) · FW-IOP-006 (thêm từ chối v2/v1 và `BOARD_FEATURES`) · FW-IOP-007 (thêm luật nuôi watchdog) · FW-IOP-008 (sửa layout bit) · FW-IO-001 (thêm ngữ nghĩa trung bình) · FW-IO-002 (MA-8 → không lọc thêm) · FW-IO-005, 006, 010, 011, 012, 013 · FW-AO-001 (≤ 5 ms → trước ACK, mọi AO thực lắp) · FW-AO-004 · FW-AO-005 (hold-last vô hạn → chỉ < 200 ms) · FW-AO-006 (kiểm miền vô nghĩa → kênh không lắp) · FW-AO-007, 008, 009 · FW-DO-001, 002, 004 · FW-WDG-001 (IWDG → yêu cầu hộp đen) · FW-WDG-005 (thêm cửa sổ 200–205 ms) · FW-BOOT-004 · FW-DIAG-002 (bỏ giảm tốc lấy mẫu) · FW-DIAG-006 |
| **Mới** | FW-IOP-010, 011, 012, 013, 014, 015 · FW-IO-015, 016 · FW-AO-010 · FW-DO-007 · FW-WDG-007, 008 · FW-DIAG-007 · FW-CFG-001..005 · FW-OTA-006 · FW-HW-001..004 · FW-REL-001..008 |
| **Hoãn Rev B** | FW-OTA-001..005 |
| **Rút** (không tái sử dụng ID) | FW-IOP-002 (bắt buộc DMA: thiết kế nội bộ) · FW-IOP-009 (hành vi SOM: chuyển sang `SW-IOP-012`/ADR-011) · FW-IO-003 (lọc gai: chuyển SOM) · FW-IO-007 (bắt buộc DMA) · FW-IO-020..023 (debounce dry-contact: chuyển SOM, ICD §6.6) · FW-AO-002 (bắt buộc DMA) · FW-DO-005 (giới hạn tần suất relay: SOM có `RELAY_GUARD`) · FW-DO-006 (bộ đếm vòng đời relay: không có đường giao tiếp) · FW-WDG-002, 003, 004 (chu kỳ kick, health task, WWDG: thiết kế nội bộ; ý đồ gộp vào FW-WDG-001) · FW-BOOT-002 (thứ tự khởi tạo: thiết kế nội bộ) · FW-BOOT-003 (gộp vào FW-WDG-006) · §10 ngân sách bộ nhớ theo task (thiết kế nội bộ; phần flash trống còn lại ở FW-REL-006) |

Số đếm hiện hành (đếm bằng script ngày 2026-09-30): **74** yêu cầu hiệu lực gồm **69 MUST** và **5 SHOULD**; trong đó **15** giữ nguyên, **28** đổi nội dung, **31** mới. Thêm **5** hoãn Rev B và **16** ID đã rút (cộng mục ngân sách bộ nhớ §10 cũ).

## 8. Mục mở

| # | Nội dung | Ảnh hưởng yêu cầu | Ai quyết | Cổng và điều kiện mở |
|---|---|---|---|---|
| O-1, O-3, O-4, O-5, O-8, O-9 | Các mục còn chờ của [ICD §16.1](SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | theo từng mục; O-9 ảnh hưởng FW-AO-001, FW-DO-001 và FW-WDG-008 | theo ICD | P0/P2/P3 theo từng hàng ICD; cần chữ ký ghi trong ICD |
| M-2 | Dung sai điện của safe value AO và của `VDD_MV` | FW-AO-009, FW-DIAG-003 | HW + Safety | G-MCU-3: HW ban hành giới hạn điện theo revision bo, Safety duyệt rồi mới chấm PASS/FAIL HIL |
| M-4 | Cách firmware nhận biết biến thể bo | FW-HW-004, FW-IOP-015 | team MCU + HW | G-MCU-2/3: HW ban hành bảng nhận dạng hoặc team MCU ban hành mapping image→revision, đối chiếu `HANDSHAKE_RESP` trên từng bo |

Các mục M-1 (relay có feedback) và M-3 (hợp nhất pinout) của bản 3.0 chuyển thành việc của HW theo từng biến thể: firmware khai `BOARD_FEATURES.DO_FB` theo bo thật, và chân lấy theo tài liệu HW (FW-HW-001).

### 8.1 Tự rà mức sẵn sàng review của yêu cầu FW

Tự rà theo loại **hồ sơ yêu cầu** của [DOC-GOV-001](../00_governance/DOC_GOVERNANCE.md), không áp checklist thiết kế nội bộ MCU cho team nhận việc. Bảng này không thay review của team tiêu thụ.

| Kiểm | Bằng chứng | Trạng thái / điều kiện còn cần |
|---|---|---|
| ID, mức, phân bổ, phương pháp và tiêu chí | 74 dòng §4, bảng trách nhiệm §1 | Có để review; 5 SHOULD cần giải trình nếu không đạt |
| Nguồn, biến thể, hợp đồng byte/hành vi | Đầu file, ICD và header nháp | Có; O-1/O-3/O-4/O-5/O-9 chờ ký |
| Yêu cầu → quy trình → bằng chứng | [VVP §2–§4](IOP_V3_VERIFICATION_PLAN_MK-DDC-24_VI.md) phủ 74/74 dòng | Chỉ là kế hoạch; mọi kết quả `NOT RUN` |
| Điều kiện vật lý và dung sai | [Phiếu HW](IOP_V3_HW_INPUT_FORM_MK-DDC-24_VI.md) | HW cần cung cấp theo revision bo trước G-MCU-2/3 |
| Review/phê duyệt | §9 | Chưa ký; chưa đạt M4/M5 theo DOC-GOV-001 |

## 9. Phê duyệt

| Vai trò | Người | Trạng thái |
|---|---|---|
| System Architect | — | Chưa ký |
| MCU team lead (nhận yêu cầu) | — | Chưa ký |
| SOM lead | — | Chưa ký |
| Safety (§4.3–§4.5, §4.7) | — | Chưa ký |

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 3.1 | 2026-09-30 | Theo quyết định chủ sở hữu: hỗ trợ cả hai biến thể 16/4/4 và 16/8/8 qua khai số kênh (thêm FW-IOP-015, FW-DO-007, FW-HW-004); trỏ ICD v3.0 và header nháp; phần cứng lấy theo tài liệu HW của từng biến thể do HW cung cấp riêng; bản build host phải chọn được biến thể. Bản rà soát R2 liên kết ma trận 74/74, quy trình kiểm và phiếu đầu vào HW; 74 ID/tiêu chí giữ nguyên. Draft, chưa ký. |
| 3.0 | 2026-09-30 | Viết lại thành yêu cầu hộp đen cho team MCU riêng (không phát hành, thay bởi 3.1 cùng ngày) |
| 2.1 | 2026-06-30 | §7: FW-IOP-008..009 (fault_flags, ADC fault → COMMUNICATION_FAILURE theo ADR-011) |
| 2.0 | 2026-06-30 | Căn chỉnh I/O và IOP theo ADR-010 (breaking) |
