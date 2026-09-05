# Bằng chứng Chrome DevTools cho PGM-04 — `T61-505` / `ISS-PGM04-18`

> **Lane:** `BROWSER/HOST`. Chrome thật (`--headless=new`, profile cô lập) nói
> chuyện qua **Chrome DevTools Protocol** với ứng dụng chạy trên **backend Go
> thật** + Core simulator production. PASS ở đây **không** phải target, HIL hay
> `RELEASE_READY`.
>
> **Chạy lại:** `bash scripts/run-pgm04-devtools-audit.sh`
> **Bằng chứng:** `artifacts/ui-audit/pgm04/` (15 ảnh + `evidence.json`)

## 1. Vì sao phiên audit trước không có bằng chứng này

Phiên `2026-09-03` không khởi động được Chrome DevTools MCP vì máy đo thiếu X
server, nên toàn bộ bằng chứng UI của PGM-04 dừng ở ảnh Playwright.
`ISS-PGM04-18` từ chối đóng với đúng tình trạng ấy, và điều đó đúng: ảnh
Playwright không mang Console, không mang Network, và không nói được gì về cây
`Accessibility`.

`--headless=new` khắc phục đúng chỗ đó — đây là Chrome thật, có DevTools
Protocol đầy đủ, và **không cần X server**. Lane này không đi qua Playwright:
nó nói CDP trực tiếp, đúng giao thức mà DevTools và `chrome-devtools-mcp` dùng.

## 2. Vì sao mọi trạng thái là trạng thái THẬT

Chặn request để dựng trạng thái sẽ biến lane BROWSER thành một lane mock thứ
hai. Ở đây:

| Trạng thái | Dựng bằng |
|---|---|
| `empty-project` | Project thật chưa có khối nào — chụp **trước** khi gieo dữ liệu |
| `ready` | ba khối PROJECT tạo qua `POST /library/entries` thật |
| `empty-filter` | gõ vào ô tìm kiếm; bộ lọc chạy **ở server** (`T61-302`) |
| `review-required` | `PID` của registry SYSTEM — `featureState: REVIEW_REQUIRED` thật |
| `authoring`, `target-chooser` | thao tác thật trên giao diện |
| `offline` | `Network.emulateNetworkConditions` — **khả năng của DevTools**, không phải fixture |
| `permission` | phiên `viewer` thật, tài khoản tạo qua `POST /api/v1/users` |

Một Project duy nhất: `capabilities.limits.projectsPerController = 1`, nên
"thư viện rỗng" dùng **thứ tự thời gian** thay cho hai Project song song.

## 3. Số đo bố cục — sáu khổ, đo bằng toạ độ thật

Số cột đếm bằng *"bao nhiêu thẻ nằm trên hàng đầu"*, không bằng lớp CSS: một
lớp Tailwind sai ngưỡng vẫn có mặt trong `className`, còn toạ độ thì không nói
dối.

| Khổ | Dải | Cột | Inspector | Bề rộng khay | Tràn ngang |
|---|---|---:|---|---:|---|
| 1440×900 | ≥1280 | 3 | dock | 352 px | không |
| 1280×800 | ≥1280 | 3 | dock | 352 px | không |
| 1024×768 | 1024–1279 | 2 | dock | 320 px | không |
| 768×1024 | 768–1023 | 2 | drawer | 352 px | không |
| 700×900 | <768 | 1 | fullscreen | 700 px | không |
| 390×844 | <768 | 1 | fullscreen | 390 px | không |

`700×900` không phải một điểm đo thêm cho đủ: dải 640–767 là dải **duy nhất**
phân biệt được ngưỡng `640` với `768`. Bỏ nó thì một lưới chuyển cột ở sai
ngưỡng vẫn "đạt" ở cả bốn khổ kia — và sai ngưỡng nghĩa là hai cột hiện ra
**dưới** ngưỡng chỉ-đọc.

Ba khối được gieo, không phải một: với một thẻ, số cột luôn bằng 1 ở mọi khổ —
nó "đạt" mọi ngưỡng và không nói được gì về bố cục.

## 4. Ngân sách lỗi

| Chỉ số | Kết quả |
|---|---|
| axe serious/critical (mỗi lần chụp, quét `main`) | **0** |
| `console.error` | **0** |
| `pageerror` (ngoại lệ JS chưa bắt) | **0** |
| HTTP ≥ 400 | **0** |

Lỗi mạng của ca `offline` được ghi riêng (`inducedRequestFailures`) vì chúng do
**chính phép đo bơm vào** — gộp chúng vào ngân sách chung sẽ làm ngân sách "0
lỗi" vô nghĩa ở mọi ca đường hỏng.

## 5. Tương tác thật, không phải ảnh chụp

| Phép kiểm | Cách đo | Kết quả |
|---|---|---|
| Trả tiêu điểm sau `Esc` | `Input.dispatchKeyEvent`, rồi đọc `document.activeElement` | về đúng nút **"Khối PROJECT mới"** |
| Khổ hẹp là chỉ-đọc | đọc `disabled` của bốn nút ghi | 4/4 khoá, `anyEnabled: false` |
| `REVIEW_REQUIRED` | đọc `disabled` của mọi nút Chèn | 1/1 khoá |
| Vai `viewer` | nút Tạo **vẫn thấy**, bị khoá, kèm lý do | "Vai hiện tại không sửa được Thư viện điều khiển." |
| Fail-closed khi mất mạng | cắt mạng bằng DevTools rồi kích một lượt đọc | banner "Chưa đọc được…" hiện |
| Hit target | quét mọi control có chiều cao < 24 px | **0** |

## 6. Lỗi sản phẩm mà lane này phát hiện

**Hộp thoại chỉ dựng lúc mở không trả tiêu điểm về nút vừa rời.**

`document.activeElement` sau `Esc` đọc được là `BODY`. Nguyên nhân: `Modal` ghi
nhớ nút mở bằng listener `focusin`/`pointerdown` cài lúc **mount**, nhưng nhiều
chỗ gọi chỉ dựng `Modal` KHI mở (`LibraryAuthoringDrawer`: `if (!mode) return
null`) — sự kiện của nút mở đã xảy ra trước khi listener tồn tại. Và hiệu ứng
trả tiêu điểm chỉ chạy khi `open` chuyển sang `false`; hộp thoại bị **gỡ khỏi
cây** thì nó không bao giờ chạy.

Hệ quả: người dùng bàn phím mở drawer soạn thảo, bấm `Esc`, và bị thả ở đầu tài
liệu — phải Tab lại từ đầu để về đúng nút họ vừa rời. `T61-306` ghi
"Esc/return-focus drawer" là `DONE`, nhưng phép đo trước đó chưa từng hỏi
`document.activeElement` sau khi đóng.

Đã sửa ở `Modal.tsx` (ghi nhớ nút mở ngay lúc mount **và** trả tiêu điểm khi
unmount), kèm test đơn vị dựng đúng hình dạng gây lỗi.

## 7. Bí mật

Không có token, cookie hay mật khẩu trong bằng chứng. Header nhạy cảm giữ lại
**tên** và thay giá trị bằng `[redacted]` — biết một request có gửi
`authorization` hay không là thông tin cần cho review, giá trị thì không. Trước
khi ghi ra đĩa, script tự quét chuỗi sắp ghi và **từ chối ghi** nếu thấy
`Bearer …`, mật khẩu viewer, hay một header nhạy cảm chưa che.

## 8. Giới hạn — đọc trước khi trích dẫn

- Lane này **không** thay Vitest, lint, build hay Playwright E2E. Nó là bằng
  chứng bổ sung về hành vi trên trình duyệt thật.
- Chrome DevTools **MCP** không có trong phiên đo (`codex` không cài trên máy
  này). Lane dùng CDP trực tiếp — cùng giao thức, cùng dữ liệu — nhưng ai cần
  đúng đường MCP thì vẫn phải cài `codex` và `chrome-devtools-mcp`.
- Số đo là `HOST`. Không có bo Forlinx trong vòng đo này.
