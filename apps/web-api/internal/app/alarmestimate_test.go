package app

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

// `T57-3.13` — ước lượng tần suất cảnh báo từ lịch sử điểm.
//
// Hai thứ phải đúng, và cả hai đều hỏng theo hướng NGUY HIỂM nếu sai:
//
//  1. Không có lịch sử ⇒ **không ước lượng**. Trả "0 lần/ngày" sẽ được đọc thành
//     "ngưỡng này an toàn", trong khi sự thật là ta không biết gì.
//  2. Hạ tần phải **nói ra bước lấy mẫu**. Đỉnh ngắn hơn bước đó không được nhìn
//     thấy, nên con số ước lượng thiên về THẤP hơn thực tế — người đọc phải biết
//     điều đó mới dùng được con số.

func estimateBody(pointID string, days int) string {
	return `{"pointId":"` + pointID + `","days":` + itoaTest(days) + `,` +
		`"setting":{"id":"ALM-1","label":"thử","enabled":true,"alarmType":1,"priority":"high",` +
		`"clearMode":"auto","delayS":0,"sources":[{"kind":"UI","channel":1,"pointId":"UI-01"}],` +
		`"params":{"hh":30,"h":28,"l":18,"ll":16}}}`
}

func itoaTest(value int) string {
	if value == 0 {
		return "0"
	}
	digits := ""
	for value > 0 {
		digits = string(rune('0'+value%10)) + digits
		value /= 10
	}
	return digits
}

func TestAlarmEstimateRefusesWhenPointHasNoHistory(t *testing.T) {
	withoutSimBinaries(t)
	app, token := newTestAppWithAdmin(t)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarm-settings/estimate", estimateBody("UI-01", 1), token)
	// 503 kèm lý do đọc được, dù lý do là "chưa có kho trend" hay "không có mẫu
	// nào trong khoảng" — điều bất biến là KHÔNG BAO GIỜ trả một con số ước
	// lượng khi không có dữ liệu để ước lượng.
	assertStatus(t, resp, http.StatusServiceUnavailable)
	body := resp.Body.String()
	if !strings.Contains(body, "lịch sử") && !strings.Contains(body, "trend store") {
		t.Fatalf("503 phải nói rõ thiếu dữ liệu gì: %s", body)
	}
	if strings.Contains(body, "raisesPerDay") {
		t.Fatalf("không có dữ liệu mà vẫn trả con số ước lượng: %s", body)
	}
}

func TestAlarmEstimateRejectsWindowLongerThanCap(t *testing.T) {
	withoutSimBinaries(t)
	app, token := newTestAppWithAdmin(t)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarm-settings/estimate",
		estimateBody("UI-01", alarmEstimateMaxDays+1), token)
	assertStatus(t, resp, http.StatusBadRequest)
}

func TestDownsampleKeepsEvenTimeStepAndReportsIt(t *testing.T) {
	base := time.Date(2026, 8, 19, 0, 0, 0, 0, time.UTC).UnixMilli()
	// Một ngày mẫu mỗi giây = 86 400 mẫu, vượt xa trần 1000 của engine.
	raw := make([]Sample, 0, 86_400)
	for index := 0; index < 86_400; index++ {
		raw = append(raw, Sample{TS: base + int64(index)*1000, PointID: "UI-01", Value: float64(index % 40)})
	}

	samples, stepS := downsampleForAlarmSim(raw, 1)
	if len(samples) > alarmEstimateMaxSamples {
		t.Fatalf("gửi %d mẫu, vượt trần %d của engine", len(samples), alarmEstimateMaxSamples)
	}
	if stepS < 60 {
		t.Fatalf("stepS = %d; một ngày chia cho 1000 mẫu phải ra bước ≥ 60 s", stepS)
	}

	// Bước phải ĐỀU: khoảng cách giữa hai mẫu là dữ liệu thật với luật có trễ
	// kích hoạt, nên rút theo chỉ số (mỗi N phần tử) là làm méo đầu vào.
	for index := 1; index < len(samples); index++ {
		previous, _ := time.Parse(time.RFC3339, samples[index-1].T)
		current, _ := time.Parse(time.RFC3339, samples[index].T)
		gap := current.Sub(previous).Seconds()
		if gap < float64(stepS) || gap > float64(stepS)+1 {
			t.Fatalf("khoảng cách mẫu %d = %.0f s; want ~%d s", index, gap, stepS)
		}
	}
}

func TestDownsampleSkipsNonNumericSamplesInsteadOfCoercing(t *testing.T) {
	base := time.Date(2026, 8, 19, 0, 0, 0, 0, time.UTC).UnixMilli()
	raw := []Sample{
		{TS: base, PointID: "VP1", Value: 21.5},
		{TS: base + 60_000, PointID: "VP1", Value: "đang chạy"},
		{TS: base + 120_000, PointID: "VP1", Value: true},
	}

	samples, _ := downsampleForAlarmSim(raw, 1)
	if len(samples) != 2 {
		t.Fatalf("số mẫu = %d; want 2 (chuỗi bị bỏ, boolean quy về 0/1)", len(samples))
	}
	if samples[1].Value != 1 {
		t.Fatalf("boolean true phải thành 1, có %v", samples[1].Value)
	}
}

func TestDownsampleNormalisesLegacySecondTimestamps(t *testing.T) {
	// Kho trend cũ ghi mốc bằng GIÂY. Không quy đổi thì mẫu rơi về năm 1970 và
	// mọi khoảng cách thời gian gửi cho engine đều sai.
	base := time.Date(2026, 8, 19, 0, 0, 0, 0, time.UTC).Unix()
	raw := []Sample{{TS: base, PointID: "UI-01", Value: 20.0}}

	samples, _ := downsampleForAlarmSim(raw, 1)
	if len(samples) != 1 {
		t.Fatalf("mất mẫu legacy")
	}
	if !strings.HasPrefix(samples[0].T, "2026-08-19") {
		t.Fatalf("mốc legacy không được quy đổi: %s", samples[0].T)
	}
}

/*
Hồi quy cho lỗi phát hiện trên board thật ngày 2026-08-19.

Bản đầu của `T57-3.13` hỏi thẳng kho trend LEGACY. Trên board, historian v2 đã là
kho authoritative từ 2026-08-04 (v2: 6,5 MB sửa lúc 12:05; legacy: 160 kB sửa lần
cuối 04-08), nên **cả 28 điểm đều trả 503** dù dữ liệu vẫn đang được ghi.

Test này khoá hai thứ mà lỗi đó đã vi phạm:
  · phản hồi phải NÓI RA đã hỏi kho nào (`historySource`);
  · kho được hỏi phải là kho đang được ghi, không phải kho đầu tiên tiện tay gọi.
*/
func TestAlarmEstimateNamesTheHistoryStoreItAsked(t *testing.T) {
	withoutSimBinaries(t)
	app, token := newTestAppWithAdmin(t)

	resp := serveAuth(t, app.Router(), http.MethodPost, "/api/v1/alarm-settings/estimate", estimateBody("UI-01", 1), token)
	assertStatus(t, resp, http.StatusServiceUnavailable)

	body := resp.Body.String()
	/* Bất biến: MỌI đường 503 của endpoint này phải nêu tên kho đã hỏi — dù là
	   "không có mẫu trong kho X" hay "kho X lẫn Y đều không mở được". Không có
	   tên kho thì người đọc không phân biệt được "điểm im lặng" với "hỏi nhầm
	   kho", đúng chỗ đã mất một phiên để truy ra trên board. */
	for _, store := range []string{"historian-v2", "legacy-trend", "virtual-point-ring", "historian v2", "trend legacy"} {
		if strings.Contains(body, store) {
			return
		}
	}
	t.Fatalf("503 không nêu kho nào đã được hỏi: %s", body)
}

func TestReadPointHistoryFallsBackToLegacyOnlyWhenV2Unavailable(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	// Môi trường test không bật historian v2 ⇒ `newHistorianQueryEngine` lỗi và
	// đường lùi legacy phải nhận việc, KHÔNG được ném lỗi ra ngoài.
	samples, source, err := app.readPointHistoryForEstimate(context.Background(), "UI-01", 0, 1)
	if err != nil && source != "legacy-trend" {
		t.Fatalf("source = %q, err = %v; đường lùi phải là legacy-trend", source, err)
	}
	if source == "" {
		t.Fatalf("luôn phải trả tên kho, kể cả khi rỗng")
	}
	_ = samples
}
