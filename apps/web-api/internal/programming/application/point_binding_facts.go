package application

import (
	"context"
	"fmt"
	"strings"
)

/* ISS-PIO-28 — Check kiểm phần ĐẶC THÙ của từng nguồn Point (F-PIO-028, đề bài §33).
 *
 * TRIỆU CHỨNG: `Check` kiểm cú pháp/kiểu ST, danh tính điểm, hướng, quyền ghi,
 * đơn vị, quality policy, chủ sở hữu OUTPUT và trùng thanh ghi MB_RTU — nhưng
 * KHÔNG kiểm bất cứ thứ gì thuộc riêng từng nguồn:
 *
 *   Physical — kênh có đang bật không, đã khai kiểu tín hiệu chưa, đầu ra có
 *              safe-state chưa.
 *   Virtual  — điểm có thật không, ai sở hữu, kiểu có khớp, chính sách khởi
 *              động lại có đầy đủ không.
 *
 * (Phần Modbus đã được `AC-PIO-ID-02` phủ ở `resolveModbusExtIndex`: phân giải
 * lại từ danh tính bền và chặn khi điểm không còn tồn tại. Không cài lần hai.)
 *
 * VÌ SAO PHẢI KIỂM Ở CHECK CHỨ KHÔNG ĐỂ RUNTIME PHÁT HIỆN: mọi lỗi trong nhóm
 * này đều KHÔNG làm gì hỏng ồn ào. Bind vào một kênh đang tắt cho ra một biến
 * đọc mãi một con số không ai cập nhật; bind OUTPUT vào một VP do web-api sở
 * hữu cho ra cuộc giằng co 10 giây một lần mà không bên nào thắng hẳn. Cả hai
 * đều chạy, đều GOOD, và chỉ lộ ra khi có người ngồi so số bằng tay.
 *
 * Check là cửa cuối trước khi một chương trình được duyệt để chạy trên tủ.
 */

// LocalPointFacts — những gì Check cần biết về một kênh vật lý.
type LocalPointFacts struct {
	PointID string
	// Enabled — kênh có đang được dùng không. Vắng khoá `enabled` trong cấu
	// hình đời cũ nghĩa là "đang dùng", không phải "đã tắt".
	Enabled bool
	// SignalType — kiểu tín hiệu đã cấu hình cho kênh UI ("0-10V", "ntc10k"…).
	// Rỗng/`none` = chưa khai, tức chưa biết kênh này đang đo gì.
	SignalType string
	// HasSafeValue — kênh đầu ra đã khai giá trị an toàn chưa.
	HasSafeValue bool
}

// VirtualPointFacts — những gì Check cần biết về một điểm ảo.
type VirtualPointFacts struct {
	PointID       string
	Enabled       bool
	Writable      bool
	SignalType    string
	Source        string
	RestartPolicy string
	HasInitial    bool
	MinValue      *float64
	MaxValue      *float64
}

// PointBindingSnapshot là ảnh chụp MỘT LẦN cho cả package.
//
// Cùng lý do đã ghi cho `ModbusSlotSnapshot`: tra từng binding sẽ cho hai
// binding của cùng một package được kiểm trên hai cấu hình khác nhau nếu ai đó
// sửa cấu hình giữa chừng.
type PointBindingSnapshot struct {
	Local   map[string]LocalPointFacts
	Virtual map[string]VirtualPointFacts
}

/* PointBindingFactsProvider do `internal/app` implement (adapter quanh
 * `io_config.conf` + `virtual_points.conf`). `application` KHÔNG import
 * `internal/app` — interface đứng ở đây theo đúng hướng phụ thuộc, giống
 * `ModbusSlotProvider` và `PointCatalogProvider`.
 */
type PointBindingFactsProvider interface {
	ResolvePointBindingFacts(ctx context.Context) (PointBindingSnapshot, error)
}

/* KHÔNG có provider ⇒ các phép kiểm dưới đây KHÔNG chạy, và chúng trả rỗng
 * (cho qua) thay vì chặn.
 *
 * Đây là một lựa chọn có cân nhắc, không phải sơ suất. Khác với slot Modbus —
 * nơi con số lưu trong binding là một DẤU VẾT có thể trôi, nên không xác minh
 * được thì không có gì bảo chứng — binding LOCAL/VP mang thẳng danh tính bền
 * của điểm. Chặn toàn bộ chúng khi thiếu provider sẽ biến một phép kiểm MỚI
 * thành một phụ thuộc cứng, và làm hỏng mọi triển khai chưa nối dây.
 *
 * Rủi ro của lựa chọn này là phép kiểm có thể IM LẶNG biến mất nếu ai đó gỡ
 * dây — đúng lớp lỗi đã xảy ra với bộ test `AlarmRuntime`. Nên chỗ bảo đảm nằm
 * ở CỔNG NỐI DÂY: `internal/app` có test khẳng định `CheckService` luôn được
 * dựng với `PointFacts` khác nil. Gỡ dây thì test đỏ, không phải im lặng.
 */

// lookupLocal / lookupVirtual tra không phân biệt hoa thường: mã điểm đi qua
// nhiều lớp và không lớp nào hứa giữ nguyên cách viết.
func (s PointBindingSnapshot) lookupLocal(pointID string) (LocalPointFacts, bool) {
	facts, ok := s.Local[strings.ToUpper(strings.TrimSpace(pointID))]
	return facts, ok
}

func (s PointBindingSnapshot) lookupVirtual(pointID string) (VirtualPointFacts, bool) {
	facts, ok := s.Virtual[strings.ToUpper(strings.TrimSpace(pointID))]
	return facts, ok
}

/* checkLocalBinding trả lý do CHẶN một binding LOCAL, rỗng nghĩa là qua.
 *
 * `direction` là "input"/"output" theo lớp biến ST.
 */
func checkLocalBinding(snapshot *PointBindingSnapshot, pointID, direction string) string {
	if snapshot == nil {
		return ""
	}
	facts, ok := snapshot.lookupLocal(pointID)
	if !ok {
		return fmt.Sprintf("kênh %s không có trong cấu hình I/O đang chạy", pointID)
	}
	if !facts.Enabled {
		return fmt.Sprintf("kênh %s đang TẮT trong cấu hình I/O; chương trình bind vào nó sẽ đọc/ghi "+
			"một kênh không ai cập nhật, và không có lỗi nào báo ra lúc chạy", pointID)
	}
	prefix, _, _ := splitPointPrefix(pointID)
	if prefix == "UI" && !hasConfiguredSignalType(facts.SignalType) {
		return fmt.Sprintf("kênh %s chưa khai kiểu tín hiệu (capability/scaling): chưa biết kênh này "+
			"đang đo gì thì con số nó trả về không có nghĩa vật lý nào", pointID)
	}
	if direction == "output" && !facts.HasSafeValue {
		return fmt.Sprintf("đầu ra %s chưa khai giá trị an toàn (safe-state): khi Core vào chế độ an toàn, "+
			"không ai biết phải đưa cơ cấu chấp hành này về đâu", pointID)
	}
	return ""
}

/* checkVirtualBinding trả lý do CHẶN một binding VP, rỗng nghĩa là qua.
 *
 * `dataType` là kiểu của biến ST (BOOL/REAL/INT/UINT…).
 */
func checkVirtualBinding(snapshot *PointBindingSnapshot, pointID, direction, dataType string) string {
	if snapshot == nil {
		return ""
	}
	facts, ok := snapshot.lookupVirtual(pointID)
	if !ok {
		return fmt.Sprintf("điểm ảo %s không có trong cấu hình đang chạy (bị xoá hoặc đổi mã)", pointID)
	}
	if !facts.Enabled {
		return fmt.Sprintf("điểm ảo %s đang TẮT; chương trình bind vào nó sẽ chạy trên một điểm "+
			"không được đồng bộ", pointID)
	}
	if direction == "output" {
		/* `ISS-PIO-16` — hai trục: `writable` (operator có được sửa không) và
		 * `source` (AI GHI slot). Chương trình ghi vào một VP do web-api sở hữu
		 * sẽ bị vòng đối chiếu 10 giây kéo về giá trị cấu hình — một cuộc giằng
		 * co im lặng mà không bên nào thắng hẳn. */
		if !strings.EqualFold(facts.Source, "PROGRAM") {
			return fmt.Sprintf("điểm ảo %s do web-api sở hữu (source=WEB) nhưng chương trình đang GHI vào nó; "+
				"vòng đối chiếu sẽ kéo giá trị về cấu hình mỗi 10 giây và không bên nào thắng hẳn — "+
				"đổi chủ sở hữu điểm sang PROGRAM rồi Check lại", pointID)
		}
		if !facts.Writable {
			return fmt.Sprintf("điểm ảo %s khai chỉ đọc (writable=false) nhưng chương trình đang GHI vào nó", pointID)
		}
	}
	if want, ok := virtualSignalTypeForST(dataType); ok && facts.SignalType != "" &&
		!strings.EqualFold(facts.SignalType, want) {
		return fmt.Sprintf("điểm ảo %s khai kiểu tín hiệu %q nhưng biến ST là %s (cần %q); "+
			"lệch kiểu ở đây cho ra một phép đổi ngầm chứ không phải một lỗi",
			pointID, facts.SignalType, dataType, want)
	}
	if facts.MinValue != nil && facts.MaxValue != nil && *facts.MinValue > *facts.MaxValue {
		return fmt.Sprintf("điểm ảo %s khai biên kỹ thuật đảo ngược (min %g > max %g): mọi lệnh ghi "+
			"đều sẽ bị từ chối", pointID, *facts.MinValue, *facts.MaxValue)
	}
	/* `ISS-PIO-14` — persistence. `initial` mà chưa đặt `initialValue` thì sau
	 * khởi động lại điểm về mặc định theo kiểu tín hiệu (0/false), KHÔNG phải
	 * con số người viết chương trình đang hình dung. */
	if strings.EqualFold(facts.RestartPolicy, "initial") && !facts.HasInitial {
		return fmt.Sprintf("điểm ảo %s khai restartPolicy=initial nhưng chưa đặt initialValue; "+
			"sau khởi động lại nó về mặc định theo kiểu tín hiệu, không phải giá trị chương trình "+
			"đang hình dung", pointID)
	}
	return ""
}

// hasConfiguredSignalType — kênh UI đã khai đang đo gì chưa.
func hasConfiguredSignalType(signalType string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(signalType))
	return trimmed != "" && trimmed != "none"
}

// virtualSignalTypeForST đổi kiểu biến ST sang kiểu tín hiệu VP tương ứng.
//
// `false` = kiểu ST không ràng buộc kiểu tín hiệu nào (ví dụ STRING/TIME), nên
// không có gì để đối chiếu — im lặng ở đó là đúng, khác hẳn im lặng vì bỏ sót.
func virtualSignalTypeForST(dataType string) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(dataType)) {
	case "BOOL":
		return "boolean", true
	case "REAL", "LREAL":
		return "float", true
	case "INT", "DINT", "UINT", "UDINT", "SINT", "USINT":
		return "integer", true
	default:
		return "", false
	}
}

// splitPointPrefix tách tiền tố chữ và số kênh của một mã điểm vật lý.
func splitPointPrefix(pointID string) (prefix string, channel string, ok bool) {
	raw := strings.ToUpper(strings.TrimSpace(pointID))
	i := 0
	for i < len(raw) && raw[i] >= 'A' && raw[i] <= 'Z' {
		i++
	}
	if i == 0 || i >= len(raw) {
		return "", "", false
	}
	rest := strings.TrimPrefix(raw[i:], "-")
	return raw[:i], rest, rest != ""
}
