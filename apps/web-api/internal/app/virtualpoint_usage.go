package app

import (
	"net/http"
	"strings"

	programmingapplication "mkddc-web/internal/programming/application"
)

// "Ai đang dùng điểm ảo này" — `T57-3.12` (Plan 57 §6.11-P2).
//
// VÌ SAO CẦN
//
// Xoá một điểm ảo hôm nay là một cú bấm không hậu quả nhìn thấy được. Hậu quả
// xuất hiện sau đó: một luật cảnh báo mất nguồn, một lịch vận hành mất đích
// ghi, một chương trình ST mất binding — và không ai nối được sự cố ngược lại
// với thao tác xoá vì giữa chúng có thể là vài ngày.
//
// Endpoint này trả lời câu hỏi đó TRƯỚC khi xoá. Nó **không** chặn xoá: quyết
// định vẫn thuộc về người vận hành, thứ họ thiếu chỉ là dữ kiện.
//
// NGUYÊN TẮC: chỉ liệt kê tham chiếu ĐỌC ĐƯỢC TỪ CẤU HÌNH THẬT. Không suy đoán
// theo tên, không "có thể liên quan" — một danh sách phỏng đoán sẽ khiến người
// dùng bỏ qua cả danh sách.

type VirtualPointReference struct {
	// Kind: `alarm` | `schedule` | `program`.
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
	// Detail nói rõ tham chiếu ở ĐÂU trong đối tượng đó.
	Detail string `json:"detail,omitempty"`
}

type VirtualPointUsageResponse struct {
	SchemaVersion int                     `json:"schemaVersion"`
	PointID       string                  `json:"pointId"`
	Tag           string                  `json:"tag,omitempty"`
	References    []VirtualPointReference `json:"references"`
	// Scanned nói ra PHẠM VI đã quét, để người đọc biết danh sách rỗng nghĩa là
	// gì. Thiếu điều này thì "không có tham chiếu" là một lời hứa không có cơ sở.
	Scanned []string `json:"scanned"`
	// Incomplete = có nguồn không đọc được. Danh sách khi đó là KHÔNG ĐẦY ĐỦ và
	// giao diện phải nói ra trước khi người dùng bấm xoá.
	Incomplete bool     `json:"incomplete"`
	Errors     []string `json:"errors,omitempty"`
}

func (a *App) handleVirtualPointUsage(w http.ResponseWriter, r *http.Request) {
	id := canonicalVirtualPointID(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing virtual point id")
		return
	}

	response := VirtualPointUsageResponse{
		SchemaVersion: 1,
		PointID:       id,
		References:    []VirtualPointReference{},
		/* `ISS-PIO-18` — hai nguồn Programming đứng ngang hàng với hai nguồn cũ.
		 *
		 * Chúng phải có mặt trong `Scanned` ngay cả khi dịch vụ Programming chưa
		 * bật: `Scanned` nói ra PHẠM VI CÂU HỎI, không phải phạm vi đã trả lời
		 * được. Phần "trả lời được tới đâu" là việc của `Incomplete`/`Errors`. */
		Scanned: []string{"alarm-settings", "schedules", "programming-drafts", "programming-active-revision"},
	}

	vpConfig, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err == nil {
		if index := virtualPointIndex(vpConfig.Items, id); index >= 0 {
			response.Tag = vpConfig.Items[index].Tag
		}
	}

	// Cảnh báo: một nguồn `VP` trỏ tới điểm này.
	if settings, err := a.LoadAlarmSettings(r.Context()); err != nil {
		response.Incomplete = true
		response.Errors = append(response.Errors, "alarm-settings: "+err.Error())
	} else {
		for _, setting := range settings {
			for _, source := range setting.Sources {
				if !matchesVirtualPoint(source.Kind, source.PointID, source.Channel, id, response.Tag) {
					continue
				}
				response.References = append(response.References, VirtualPointReference{
					Kind: "alarm", ID: setting.ID, Name: setting.Label,
					Detail: "nguồn kích hoạt",
				})
				break
			}
		}
	}

	// Lịch vận hành: một target trỏ tới điểm này.
	if schedules, _, err := a.loadSchedulesWithNotes(r.Context()); err != nil {
		response.Incomplete = true
		response.Errors = append(response.Errors, "schedules: "+err.Error())
	} else {
		for _, schedule := range schedules {
			for _, target := range schedule.TargetObjects {
				if !matchesVirtualPoint(target.PointKind, target.PointID, valueOrZero(target.Channel), id, response.Tag) {
					continue
				}
				response.References = append(response.References, VirtualPointReference{
					Kind: "schedule", ID: schedule.ScheduleID, Name: schedule.ScheduleName,
					Detail: "đối tượng đích",
				})
				break
			}
		}
	}

	/* Chương trình ST: một binding trỏ tới điểm này.
	 *
	 * Đây là nguồn mà `Kind: program` đã khai từ đầu nhưng chưa ai sinh ra
	 * (`ISS-PIO-18`). Thiếu nó, xoá một VP đang được chương trình bind cho ra
	 * danh sách rỗng kèm `incomplete = false` — một lời khẳng định SAI. */
	a.appendProgrammingReferences(r, &response, id)

	writeJSON(w, http.StatusOK, response)
}

// appendProgrammingReferences bổ sung tham chiếu từ binding Programming.
//
// Dịch vụ Programming CHƯA BẬT không được im lặng: `nil` ở đây nghĩa là hai
// nguồn trong `Scanned` không ai trả lời, nên câu trả lời phải hạ xuống "không
// đầy đủ". Coi nó là "không có tham chiếu nào" sẽ tái lập đúng lỗi đang sửa,
// chỉ đổi nguyên nhân.
func (a *App) appendProgrammingReferences(r *http.Request, response *VirtualPointUsageResponse, id string) {
	if a.programmingProjects == nil {
		response.Incomplete = true
		response.Errors = append(response.Errors, "programming: dịch vụ chưa bật, không quét được binding")
		return
	}
	tag, boundPointID := response.Tag, ""
	if cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig()); err == nil {
		if index := virtualPointIndex(cfg.Items, id); index >= 0 {
			boundPointID = cfg.Items[index].BoundPointID
		}
	}
	scan, err := a.programmingProjects.FindPointReferences(r.Context(), func(category, pointID string) bool {
		return matchesVirtualPointBinding(category, pointID, id, tag, boundPointID)
	})
	if err != nil {
		response.Incomplete = true
		response.Errors = append(response.Errors, "programming: "+err.Error())
		return
	}
	if len(scan.Errors) > 0 {
		response.Incomplete = true
		response.Errors = append(response.Errors, scan.Errors...)
	}
	for _, ref := range scan.References {
		response.References = append(response.References, VirtualPointReference{
			Kind: "program", ID: ref.ProjectID, Name: ref.ProjectName,
			Detail: programBindingDetail(ref),
		})
	}
}

// programBindingDetail nói tham chiếu nằm Ở ĐÂU, theo đúng nguyên tắc của
// `Detail`: đủ để người đọc mở đúng chỗ mà xem, không bắt họ đi dò.
func programBindingDetail(ref programmingapplication.PointReference) string {
	where := "bản đang soạn"
	if ref.Scope == "active-revision" {
		where = "Revision đang chạy"
	}
	detail := where + ": biến " + ref.Variable
	if ref.Direction != "" {
		detail += " (" + ref.Direction + ")"
	}
	return detail
}

/* matchesVirtualPointBinding so khớp một binding Programming với điểm ảo đang hỏi.
 *
 * KHÁC `matchesVirtualPoint` ở hai chỗ, và cả hai đều thiết yếu.
 *
 * 1. `category` RỖNG vẫn được xét tiếp thay vì loại ngay. Binding hình dạng v2
 *    (`upsertBindingV2`) chỉ có `pointId` phẳng và KHÔNG mang category — loại nó
 *    vì thiếu category chính là bỏ sót đúng lớp binding mà tính năng này sinh ra
 *    để tìm, và bỏ sót thì im lặng chứ không kêu. Ngược lại, category CÓ mặt mà
 *    không phải VP thì loại thật: một binding `LOCAL/UI-01` không liên quan.
 *
 * 2. So theo SLOT CORE (`boundPointId`), KHÔNG canonicalise theo kênh.
 *
 *    Đây là chỗ dễ sai nhất. `pointCatalogPointID` cố ý phát `BoundPointID`
 *    ("AV-01"/"BV-03") cho category VP, vì Core chỉ resolve được slot thật chứ
 *    không hiểu id thân thiện "VP7". Nếu ở đây dùng `canonicalVirtualPointID`
 *    thì "AV-01" bị quy về "VP1" — và VP1 gần như CHẮC CHẮN không phải điểm ảo
 *    đang giữ slot AV-01, vì số kênh VP và số slot Core là hai dãy độc lập do
 *    bộ cấp phát slot quyết định (`ISS-PIO-...`, `virtualpoint_allocator.go`).
 *    Kết quả sẽ là vừa khớp NHẦM một điểm không liên quan, vừa BỎ SÓT điểm thật
 *    — đúng hai kiểu sai mà endpoint này tồn tại để tránh.
 *
 *    VP chưa bind slot nào thì `boundPointID` rỗng và nhánh đó tự tắt: khi ấy
 *    không có gì để một Revision trỏ tới, đúng như sự thật.
 */
func matchesVirtualPointBinding(category, pointID, wantID, wantTag, boundPointID string) bool {
	kind := strings.TrimSpace(category)
	if kind != "" && !strings.EqualFold(kind, "VP") && !strings.EqualFold(kind, "virtual") {
		return false
	}
	written := strings.TrimSpace(pointID)
	if written == "" {
		return false
	}
	if boundPointID != "" && canonicalBoundPointID(written) == canonicalBoundPointID(boundPointID) {
		return true
	}
	// Binding ghi bằng id thân thiện ("VP7", "VP-07") vẫn phải bắt được: tab Ánh
	// xạ phát slot Core, nhưng tài liệu Draft là hình dạng MỞ và đã từng có nơi
	// ghi id thân thiện.
	if strings.EqualFold(written, wantID) || (isFriendlyVirtualPointID(written) && canonicalVirtualPointID(written) == wantID) {
		return true
	}
	return wantTag != "" && strings.EqualFold(written, wantTag)
}

// isFriendlyVirtualPointID chỉ nhận tiền tố "VP".
//
// KHÔNG nhận "AV"/"BV" dù `virtualPointIDPrefix` coi "AV" là bí danh hợp lệ: ở
// ngữ cảnh này "AV-01" là SLOT CORE, và quy nó về "VP1" theo số là chính phép
// suy diễn sai nêu trong chú thích trên.
func isFriendlyVirtualPointID(id string) bool {
	prefix, _, ok := parsePointID(id)
	return ok && strings.EqualFold(prefix, "VP")
}

// matchesVirtualPoint so khớp một tham chiếu với điểm ảo đang hỏi.
//
// So theo cả `pointId` chuẩn hoá lẫn `tag`: hai cách viết cùng tồn tại trong
// cấu hình thật (nguồn cảnh báo dùng `pointId`, một số nơi khác ghi tag), và bỏ
// sót một cách viết nghĩa là báo "không ai dùng" cho một điểm đang được dùng —
// đúng kiểu sai nguy hiểm nhất của tính năng này.
func matchesVirtualPoint(kind, pointID string, channel int, wantID, wantTag string) bool {
	if !strings.EqualFold(strings.TrimSpace(kind), "VP") && !strings.EqualFold(strings.TrimSpace(kind), "virtual") {
		return false
	}
	if canonicalVirtualPointID(pointID) == wantID {
		return true
	}
	if wantTag != "" && strings.EqualFold(strings.TrimSpace(pointID), wantTag) {
		return true
	}
	if channel > 0 && formatVirtualPointID(channel) == wantID {
		return true
	}
	return false
}

func valueOrZero(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}
