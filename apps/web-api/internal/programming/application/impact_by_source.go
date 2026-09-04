package application

import (
	"encoding/json"
	"strings"

	programmingstore "mkddc-web/internal/programming/store"
)

/* ISS-PIO-29 — Commission Impact tách theo NGUỒN Point (F-PIO-027, đề bài §33).
 *
 * TRIỆU CHỨNG: `outputMappingChanges` gộp cả ba nguồn vào một con số. Người vận
 * hành đứng trước nút Commission nhìn thấy "3 thay đổi ánh xạ" và không biết đó
 * là ba mapping Modbus hay ba mapping AO.
 *
 * VÌ SAO ĐÓ LÀ HAI MỨC RỦI RO RẤT KHÁC NHAU: một mapping AO đổi nghĩa là một
 * cơ cấu chấp hành nối cứng vào tủ sẽ nhận lệnh từ chỗ khác — van, damper, biến
 * tần. Một mapping Modbus đổi thì slot `ext` được cấp lại theo cấu hình đang
 * chạy, và cái sai nếu có đã bị `AC-PIO-ID-02` chặn từ lớp Check. Còn một điểm
 * ảo đổi thì hậu quả nằm trong phần mềm.
 *
 * Gộp cả ba lại là bắt người vận hành đánh giá rủi ro cao nhất cho mọi thay đổi,
 * và khi mọi thứ đều đáng sợ thì không thứ gì còn đáng sợ nữa.
 *
 * `outputMappingChanges` GIỮ NGUYÊN: nó là một acknowledgement đã có trong hợp
 * đồng và trên giao diện. Bốn nhóm mới đứng CẠNH nó, không thay nó — đổi nghĩa
 * một nhóm đang được xác nhận là cách làm mọi acknowledgement đã cấp trở nên vô
 * nghĩa mà không ai nhận ra.
 */

// pointSourceImpact gom binding đã đổi theo nguồn Point.
type pointSourceImpact struct {
	Physical []string
	Virtual  []string
	Modbus   []string
	// Writable là các ĐIỂM (không phải binding) mà chương trình sẽ ghi vào.
	// Đếm theo điểm chứ không theo binding vì đó mới là bề mặt rủi ro thật:
	// hai binding cùng trỏ một đầu ra vẫn chỉ là một cơ cấu chấp hành.
	Writable []string
}

/* collectPointSourceImpact phân loại từng thay đổi BINDING theo nguồn.
 *
 * Đọc CẢ HAI phía before/after: một binding rebind từ LOCAL sang VP đổi rủi ro
 * ở cả hai nguồn, và chỉ đọc phía `after` sẽ giấu mất việc một đầu ra vật lý
 * vừa bị bỏ trống.
 */
func collectPointSourceImpact(before, after []programmingstore.RevisionObject) pointSourceImpact {
	beforeByID := indexRevisionObjects(before)
	afterByID := indexRevisionObjects(after)
	impact := pointSourceImpact{
		Physical: []string{}, Virtual: []string{}, Modbus: []string{}, Writable: []string{},
	}
	seen := map[string]bool{}
	classify := func(objectID string) {
		if seen[objectID] {
			return
		}
		seen[objectID] = true
		beforeObject, hasBefore := beforeByID[objectID]
		afterObject, hasAfter := afterByID[objectID]
		if hasBefore && hasAfter && string(beforeObject.PayloadJSON) == string(afterObject.PayloadJSON) {
			return
		}
		var sides []*programmingstore.RevisionObject
		if hasBefore {
			sides = append(sides, &beforeObject)
		}
		if hasAfter {
			sides = append(sides, &afterObject)
		}
		for _, side := range sides {
			category, pointID, writes := bindingPointFacts(side)
			if pointID == "" {
				continue
			}
			label := objectID
			switch strings.ToUpper(strings.TrimSpace(category)) {
			case "MB_RTU":
				impact.Modbus = append(impact.Modbus, label)
			case "VP":
				impact.Virtual = append(impact.Virtual, label)
			case "LOCAL":
				impact.Physical = append(impact.Physical, label)
			default:
				/* Category rỗng hoặc lạ KHÔNG bị bỏ qua im lặng: một binding
				 * không phân loại được vẫn là một binding sắp chạy trên thiết
				 * bị. Xếp nó vào nhóm Physical — nhóm rủi ro CAO NHẤT — vì đoán
				 * nhẹ đi ở đây là đúng chiều nguy hiểm. */
				impact.Physical = append(impact.Physical, label)
			}
			if writes {
				// Theo ĐIỂM, không theo binding: hai binding cùng trỏ một đầu
				// ra vẫn chỉ là một cơ cấu chấp hành.
				impact.Writable = append(impact.Writable, strings.ToUpper(strings.TrimSpace(pointID)))
			}
		}
	}
	for _, object := range after {
		if object.Kind == "BINDING" {
			classify(object.ObjectID)
		}
	}
	for _, object := range before {
		if object.Kind == "BINDING" {
			classify(object.ObjectID)
		}
	}
	return impact
}

func indexRevisionObjects(objects []programmingstore.RevisionObject) map[string]programmingstore.RevisionObject {
	index := make(map[string]programmingstore.RevisionObject, len(objects))
	for _, object := range objects {
		index[object.ObjectID] = object
	}
	return index
}

/* bindingPointFacts đọc nguồn, mã điểm và chiều ghi của một binding.
 *
 * Hỗ trợ CẢ HAI hình dạng payload: v1 lồng `point: {category, pointId}` (tab Ánh
 * xạ ghi) và v2 phẳng. Chỉ đọc một hình dạng là bỏ sót đúng lớp binding mà
 * `ISS-PIO-18` đã phải sửa một lần rồi — và bỏ sót thì im lặng chứ không kêu.
 */
func bindingPointFacts(object *programmingstore.RevisionObject) (category, pointID string, writes bool) {
	if object == nil {
		return "", "", false
	}
	var payload struct {
		Direction string `json:"direction"`
		Category  string `json:"category"`
		PointID   string `json:"pointId"`
		Point     struct {
			Category string `json:"category"`
			PointID  string `json:"pointId"`
		} `json:"point"`
	}
	if json.Unmarshal(object.PayloadJSON, &payload) != nil {
		return "", "", false
	}
	category, pointID = payload.Point.Category, strings.TrimSpace(payload.Point.PointID)
	if pointID == "" {
		category, pointID = payload.Category, strings.TrimSpace(payload.PointID)
	}
	writes = payload.Direction == "WRITE" || payload.Direction == "READ_WRITE"
	return strings.TrimSpace(category), pointID, writes
}
