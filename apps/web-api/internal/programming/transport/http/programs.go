package programminghttp

import (
	"net/http"

	programmingapplication "mkddc-web/internal/programming/application"
)

// handleProgramsRequest — `GET /api/v1/programming/projects/{projectId}/programs`
// (T60-013).
//
// # ĐIỂM NỐI CHO BƯỚC TÍCH HỢP
//
// Route đã CÓ SẴN trong `routeDefinitions` (`GET .../projects/{projectId}/
// programs`, quyền `viewer`) từ `T59-405`, nên KHÔNG cần thêm dòng nào vào bảng
// route và `contract_sync_test.go` không bị động tới. Việc còn lại chỉ là đổi
// người phục vụ: trong `handleProgrammingRequest` của `router.go`, chèn
//
//	if services.Runtime != nil && handleProgramsRequest(w, r, correlationID, services.Runtime) {
//		return
//	}
//
// TRƯỚC nhánh `handleProgramIntentRequest`, rồi xoá nhánh `GET .../programs` đã
// chết trong `runtime_intent.go`. `services.Runtime` là chỗ giữ service đúng vì
// `RuntimeService` đã có SẴN cả `store` (intent bền vững) lẫn `monitor`
// (read-back sống) — không phải thêm field nào vào `Services` hay đổi wiring ở
// `main.go`.
//
// Handler này KHÔNG được tự nối vào chuỗi dispatch trong phiên này: `router.go`
// đang có thay đổi chưa commit của phiên khác, và tự chèn vào đó sẽ vừa cuốn
// mất việc của họ vừa đổi hành vi của một endpoint FE đang gọi thật mà không ai
// duyệt.
func handleProgramsRequest(w http.ResponseWriter, r *http.Request, correlationID string,
	service *programmingapplication.RuntimeService) bool {
	// Khớp theo ĐƯỜNG DẪN tường minh dựng từ `projectId`, không theo hậu tố:
	// một handler khớp bằng `HasSuffix` sẽ nuốt route của module khác có cùng
	// đuôi, và lỗi đó chỉ lộ ra ở một endpoint chẳng liên quan gì.
	projectID := r.PathValue("projectId")
	if projectID == "" || r.Method != http.MethodGet ||
		r.URL.Path != "/api/v1/programming/projects/"+projectID+"/programs" {
		return false
	}
	page, err := service.ListPrograms(r.Context(), projectID)
	if err != nil {
		writeMappedError(w, err, correlationID)
		return true
	}
	// Luôn 200 kể cả khi Core im: trạng thái Core là NỘI DUNG của câu trả lời
	// (`runtimeStateSource = UNAVAILABLE`), không phải lỗi của request. Trả 503
	// ở đây sẽ xoá luôn phần ý định bền vững — thứ vẫn đọc được và vẫn đúng.
	writeRuntimeJSON(w, http.StatusOK, correlationID, page)
	return true
}
