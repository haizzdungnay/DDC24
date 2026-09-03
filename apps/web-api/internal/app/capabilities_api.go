package app

import (
	"context"
	"net/http"

	"mkddc-web/internal/capabilities"
)

// handleSystemCapabilities đáp `GET /api/v1/system/capabilities` (`ISS-PIO-12`).
//
// Đề bài §6.1: *"Hardware capability phải do firmware/backend cấp. FE không
// được hard-code số channel hoặc mode."* Trước endpoint này, FE không có gì để
// hỏi nên buộc phải đoán — và đoán đúng ba lần rồi sai lần thứ tư là cách
// `VISIBLE_UI_CHANNELS = 16` sống sót cạnh một `DigitalInputs: 0` viết cứng.
//
// KHÔNG BAO GIỜ trả 503 khi chưa đọc được bo. Một endpoint capability im lặng
// đẩy FE về đúng chỗ cũ: tự đoán. Thay vào đó luôn trả 200 kèm
// `board_cap_known: false` để FE biết mình đang đứng trên suy diễn từ ABI, và
// mọi mode đòi bằng chứng đều bị giữ lại.
func (a *App) handleSystemCapabilities(w http.ResponseWriter, r *http.Request) {
	status, err := a.core.ReadStatus(r.Context())
	if err != nil && a.logger != nil {
		a.logger.Printf("WARN capabilities core_status degraded err=%v", err)
	}
	writeJSON(w, http.StatusOK, capabilities.Build(status.BoardCap))
}

// boardCapability đọc bản đồ năng lực bo cho các đường ghi cấu hình.
//
// Lỗi đọc KHÔNG được lan ra ngoài: `CoreStatus` rỗng cho `BoardCap{Known:false}`
// — "chưa hỏi được" — và mọi kiểm dựa trên nó đều đã fail-closed đúng ở ca đó.
// Trả lỗi lên caller chỉ dẫn tới cám dỗ từ chối cả request vì một dữ kiện phụ.
func (a *App) boardCapability(ctx context.Context) capabilities.BoardCap {
	status, err := a.core.ReadStatus(ctx)
	if err != nil && a.logger != nil {
		a.logger.Printf("WARN board_capability degraded err=%v", err)
	}
	return status.BoardCap
}
