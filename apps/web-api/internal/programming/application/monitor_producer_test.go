package application

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"testing"
)

// T59-810 — dấu producer đi kèm mọi snapshot monitor.
//
// Điều test này thật sự khoá là KIỂU TRUYỀN: `capturedMonotonicNs` phải là
// CHUỖI. Nanosecond kể từ boot vượt `Number.MAX_SAFE_INTEGER` sau ~104 ngày
// uptime, nên truyền dạng number sẽ khiến client JavaScript làm tròn im lặng
// đúng lúc thiết bị chạy lâu nhất — tức đúng lúc dấu này cần thiết nhất.
func TestMonitorProducerStampIsStringAndSurvivesLongUptime(t *testing.T) {
	// 200 ngày uptime, vượt xa ngưỡng an toàn của JSON number.
	const twoHundredDaysNs uint64 = 200 * 24 * 60 * 60 * 1_000_000_000
	if float64(twoHundredDaysNs) <= math.MaxInt64 && twoHundredDaysNs <= 1<<53 {
		t.Fatalf("fixture phải vượt 2^53 để có ý nghĩa, nhận %d", twoHundredDaysNs)
	}

	page := MonitorPageView{
		SchemaVersion: "1.0",
		Producer:      ProducerStampView{CapturedMonotonicNs: strconv.FormatUint(twoHundredDaysNs, 10)},
		Items:         []MonitorSampleView{},
	}
	encoded, err := json.Marshal(page)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	body := string(encoded)

	want := `"capturedMonotonicNs":"` + strconv.FormatUint(twoHundredDaysNs, 10) + `"`
	if !strings.Contains(body, want) {
		t.Fatalf("dấu producer phải là chuỗi thập phân nguyên vẹn.\nmuốn chứa: %s\nnhận: %s", want, body)
	}

	// Đọc ngược qua `any` (đúng cách client JS đọc) và khẳng định không có
	// number nào bị dựng lên từ trường này.
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	producer, ok := decoded["producer"].(map[string]any)
	if !ok {
		t.Fatalf("thiếu `producer` trong payload: %s", body)
	}
	if _, isString := producer["capturedMonotonicNs"].(string); !isString {
		t.Fatalf("`capturedMonotonicNs` phải là string, nhận %T", producer["capturedMonotonicNs"])
	}
}

// Chưa có Revision active thì cũng chưa có producer nào để đóng dấu — nhưng
// hợp đồng khai `producer` là BẮT BUỘC, nên trường vẫn phải có mặt. `"0"` không
// bao giờ lớn hơn một mốc thật nên nó không thể vô tình qua phép so thứ tự ở
// client.
func TestMonitorProducerStampPresentWhenNoActiveRevision(t *testing.T) {
	page := MonitorPageView{SchemaVersion: "1.0", Producer: ProducerStampView{CapturedMonotonicNs: "0"}, Items: []MonitorSampleView{}}
	encoded, err := json.Marshal(page)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(encoded), `"capturedMonotonicNs":"0"`) {
		t.Fatalf("thiếu dấu producer khi chưa có Revision active: %s", encoded)
	}
}
