package application

import (
	"encoding/json"
	"testing"

	programmingstore "mkddc-web/internal/programming/store"
)

/* ISS-PIO-29 — Commission Impact tách theo nguồn Point (F-PIO-027, đề bài §33).
 *
 * `outputMappingChanges` gộp cả ba nguồn vào một con số. Đổi 3 mapping Modbus
 * và đổi 3 mapping AO là HAI MỨC RỦI RO RẤT KHÁC NHAU khi bấm Commission: một
 * mapping AO đổi nghĩa là một cơ cấu chấp hành nối cứng vào tủ sẽ nhận lệnh từ
 * chỗ khác.
 */

func bindingObject(t *testing.T, objectID, category, pointID, direction string) programmingstore.RevisionObject {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"bindingId": objectID, "direction": direction,
		"point": map[string]any{"category": category, "pointId": pointID},
	})
	if err != nil {
		t.Fatal(err)
	}
	return programmingstore.RevisionObject{ObjectID: objectID, Kind: "BINDING", PayloadJSON: payload}
}

func flatBindingObject(t *testing.T, objectID, category, pointID, direction string) programmingstore.RevisionObject {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"bindingId": objectID, "direction": direction, "category": category, "pointId": pointID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return programmingstore.RevisionObject{ObjectID: objectID, Kind: "BINDING", PayloadJSON: payload}
}

// Đúng ví dụ trong issue: ba nguồn ra ba con số riêng.
func TestImpactSeparatesThreePointSources(t *testing.T) {
	after := []programmingstore.RevisionObject{
		bindingObject(t, "b-ao-1", "LOCAL", "AO-01", "WRITE"),
		bindingObject(t, "b-ao-2", "LOCAL", "AO-02", "WRITE"),
		bindingObject(t, "b-vp-1", "VP", "VP1", "READ"),
		bindingObject(t, "b-mb-1", "MB_RTU", "vfd-a", "READ"),
		bindingObject(t, "b-mb-2", "MB_RTU", "vfd-b", "READ"),
		bindingObject(t, "b-mb-3", "MB_RTU", "vfd-c", "READ"),
	}
	impact := collectPointSourceImpact(nil, after)
	if len(impact.Physical) != 2 {
		t.Fatalf("Physical = %v; muốn 2", impact.Physical)
	}
	if len(impact.Virtual) != 1 {
		t.Fatalf("Virtual = %v; muốn 1", impact.Virtual)
	}
	if len(impact.Modbus) != 3 {
		t.Fatalf("Modbus = %v; muốn 3", impact.Modbus)
	}
	if len(impact.Writable) != 2 {
		t.Fatalf("Writable = %v; muốn 2 (chỉ hai binding hướng WRITE)", impact.Writable)
	}
}

/* `WritableOutputsAffected` đếm theo ĐIỂM, không theo binding.
 *
 * Hai binding cùng trỏ một đầu ra vẫn chỉ là một cơ cấu chấp hành. Đếm theo
 * binding sẽ thổi phồng con số người vận hành dùng để đánh giá rủi ro. */
func TestWritableOutputsCountsPointsNotBindings(t *testing.T) {
	after := []programmingstore.RevisionObject{
		bindingObject(t, "b-1", "LOCAL", "AO-01", "WRITE"),
		bindingObject(t, "b-2", "LOCAL", "AO-01", "READ_WRITE"),
	}
	impact := collectPointSourceImpact(nil, after)
	group := impactFromItems(impact.Writable)
	if len(group.Items) != 1 {
		t.Fatalf("writableOutputs = %v; hai binding cùng một điểm phải đếm là một", group.Items)
	}
}

/* Rebind từ LOCAL sang VP đổi rủi ro ở CẢ HAI nguồn.
 *
 * Chỉ đọc phía `after` sẽ giấu mất việc một đầu ra vật lý vừa bị bỏ trống — thứ
 * người vận hành cần biết nhất. */
func TestRebindAcrossSourcesAppearsInBothGroups(t *testing.T) {
	before := []programmingstore.RevisionObject{bindingObject(t, "b-1", "LOCAL", "AO-01", "WRITE")}
	after := []programmingstore.RevisionObject{bindingObject(t, "b-1", "VP", "VP1", "WRITE")}
	impact := collectPointSourceImpact(before, after)
	if len(impact.Physical) != 1 {
		t.Fatalf("Physical = %v; đầu ra vật lý bị bỏ trống mà không hiện ra", impact.Physical)
	}
	if len(impact.Virtual) != 1 {
		t.Fatalf("Virtual = %v; điểm ảo mới nhận lệnh mà không hiện ra", impact.Virtual)
	}
}

// Binding bị XOÁ vẫn phải hiện ra: một đầu ra mất người lái là một thay đổi thật.
func TestDeletedBindingStillCounts(t *testing.T) {
	before := []programmingstore.RevisionObject{bindingObject(t, "b-1", "LOCAL", "AO-01", "WRITE")}
	impact := collectPointSourceImpact(before, nil)
	if len(impact.Physical) != 1 || len(impact.Writable) != 1 {
		t.Fatalf("binding bị xoá biến mất khỏi impact: %+v", impact)
	}
}

/* Binding KHÔNG đổi thì không được đếm.
 *
 * Impact là danh sách thứ người vận hành phải xác nhận; nhồi vào đó những thứ
 * không đổi là cách làm họ thôi đọc nó. */
func TestUnchangedBindingIsNotCounted(t *testing.T) {
	same := []programmingstore.RevisionObject{bindingObject(t, "b-1", "LOCAL", "AO-01", "WRITE")}
	impact := collectPointSourceImpact(same, same)
	if len(impact.Physical) != 0 || len(impact.Writable) != 0 {
		t.Fatalf("binding không đổi vẫn bị đếm: %+v", impact)
	}
}

/* Hình dạng payload v2 (phẳng) cũng phải đọc được.
 *
 * Chỉ đọc hình dạng lồng là bỏ sót đúng lớp binding mà `ISS-PIO-18` đã phải sửa
 * một lần rồi — và bỏ sót thì im lặng chứ không kêu. */
func TestFlatBindingShapeIsClassified(t *testing.T) {
	after := []programmingstore.RevisionObject{flatBindingObject(t, "b-1", "MB_RTU", "vfd-a", "WRITE")}
	impact := collectPointSourceImpact(nil, after)
	if len(impact.Modbus) != 1 {
		t.Fatalf("binding hình dạng phẳng không được phân loại: %+v", impact)
	}
	if len(impact.Writable) != 1 {
		t.Fatalf("chiều ghi của binding phẳng bị bỏ qua: %+v", impact)
	}
}

/* Category rỗng/lạ KHÔNG bị bỏ qua im lặng — xếp vào nhóm rủi ro CAO NHẤT.
 *
 * Một binding không phân loại được vẫn là một binding sắp chạy trên thiết bị.
 * Đoán nhẹ đi ở đây là đúng chiều nguy hiểm. */
func TestUnknownCategoryFallsIntoPhysical(t *testing.T) {
	after := []programmingstore.RevisionObject{
		flatBindingObject(t, "b-1", "", "AO-01", "WRITE"),
		flatBindingObject(t, "b-2", "GI_DO_LA", "X-01", "WRITE"),
	}
	impact := collectPointSourceImpact(nil, after)
	if len(impact.Physical) != 2 {
		t.Fatalf("Physical = %v; binding không phân loại được phải rơi vào nhóm rủi ro cao nhất", impact.Physical)
	}
}

// Object không phải BINDING không đi vào nhóm nào.
func TestNonBindingObjectsAreIgnored(t *testing.T) {
	after := []programmingstore.RevisionObject{
		{ObjectID: "p-1", Kind: "PROGRAM", PayloadJSON: []byte(`{"name":"AHU"}`)},
	}
	impact := collectPointSourceImpact(nil, after)
	if len(impact.Physical)+len(impact.Virtual)+len(impact.Modbus)+len(impact.Writable) != 0 {
		t.Fatalf("object không phải BINDING vẫn vào impact: %+v", impact)
	}
}

// Payload hỏng không làm sập, và không bịa ra phân loại.
func TestMalformedPayloadIsSkipped(t *testing.T) {
	after := []programmingstore.RevisionObject{
		{ObjectID: "b-1", Kind: "BINDING", PayloadJSON: []byte(`{khong-phai-json`)},
	}
	impact := collectPointSourceImpact(nil, after)
	if len(impact.Physical)+len(impact.Virtual)+len(impact.Modbus) != 0 {
		t.Fatalf("payload hỏng vẫn được phân loại: %+v", impact)
	}
}
