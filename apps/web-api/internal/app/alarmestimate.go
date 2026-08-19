package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Ước lượng tần suất cảnh báo từ lịch sử điểm — `T57-3.13` (§6.13-P2a).
//
// CÂU HỎI ĐANG TRẢ LỜI
//
// "Nếu đặt ngưỡng này, luật sẽ bật bao nhiêu lần mỗi ngày?" Hôm nay câu trả lời
// chỉ có được bằng cách lưu ngưỡng rồi chờ vài ngày — và nếu đặt sát quá thì cái
// giá phải trả là một trận alarm flood mà người trực gánh, chứ không phải người
// đặt ngưỡng.
//
// VÌ SAO VẪN LÀ VỎ GỌI CORE (`ADR-048`)
//
// Ước lượng này chỉ khác `T57-2.13` ở CHỖ LẤY MẪU: thay vì chuỗi người dùng gõ
// tay, nó lấy lịch sử thật của chính điểm đó. Phần đánh giá luật vẫn phải là
// `mkddc-alarm-sim` — nếu tự tính ở Go thì con số ước lượng sẽ lệch khỏi hành vi
// thật của thiết bị đúng vào lúc người dùng tin nó nhất.
//
// LUẬT HẠ TẦN PHẢI NÓI RA
//
// `mkddc-alarm-sim` nhận tối đa 1000 mẫu. Bảy ngày dữ liệu một điểm ghi mỗi giây
// là ~600k mẫu, nên **bắt buộc** hạ tần. Hạ tần làm mất các đỉnh ngắn hơn bước
// lấy mẫu, tức là ước lượng có xu hướng **THẤP HƠN** thực tế. Điều đó phải đi
// kèm kết quả; một con số ước lượng không nói ra sai số của chính nó sẽ được
// đọc như một lời hứa.

const (
	alarmEstimateMaxDays    = 7
	alarmEstimateMaxSamples = alarmSimMaxSamples
)

type AlarmEstimateRequest struct {
	Setting AlarmSetting `json:"setting"`
	PointID string       `json:"pointId"`
	Days    int          `json:"days"`
}

type AlarmEstimateResponse struct {
	SchemaVersion int    `json:"schemaVersion"`
	PointID       string `json:"pointId"`
	Days          int    `json:"days"`
	// SamplesAvailable là số mẫu lịch sử tìm được; SamplesUsed là số thực sự gửi
	// cho engine sau khi hạ tần. Hai số khác nhau ⇒ có hạ tần.
	SamplesAvailable int `json:"samplesAvailable"`
	SamplesUsed      int `json:"samplesUsed"`
	// StepS là bước lấy mẫu sau hạ tần — đỉnh ngắn hơn khoảng này KHÔNG được nhìn thấy.
	StepS          int             `json:"stepS"`
	Raises         int             `json:"raises"`
	RaisesPerDay   float64         `json:"raisesPerDay"`
	Events         []AlarmSimEvent `json:"events"`
	Engine         string          `json:"engine"`
	Downsampled    bool            `json:"downsampled"`
	UnderestimateS int             `json:"underestimateBelowS"`
	// HistorySource nói ra ĐÃ HỎI KHO NÀO: `historian-v2`, `legacy-trend` hay
	// `virtual-point-ring`. Thiếu trường này thì một kết quả rỗng không phân
	// biệt được "điểm im lặng" với "hỏi nhầm kho" — đúng lỗi đã xảy ra.
	HistorySource string `json:"historySource"`
}

func (a *App) handleEstimateAlarmSetting(w http.ResponseWriter, r *http.Request) {
	var req AlarmEstimateRequest
	if err := decodeConfigBody(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	pointID := canonicalPointID(strings.TrimSpace(req.PointID))
	if pointID == "" {
		writeError(w, http.StatusBadRequest, "pointId là bắt buộc")
		return
	}
	days := req.Days
	if days <= 0 {
		days = 1
	}
	if days > alarmEstimateMaxDays {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("tối đa %d ngày", alarmEstimateMaxDays))
		return
	}
	now := time.Now().UTC()
	fromMs := now.Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
	raw, source, err := a.readPointHistoryForEstimate(r.Context(), pointID, fromMs, now.UnixMilli())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "không đọc được lịch sử điểm: "+err.Error())
		return
	}
	if len(raw) == 0 {
		// Không có lịch sử ⇒ KHÔNG ước lượng. Trả 0 lần/ngày ở đây sẽ được đọc
		// thành "ngưỡng này an toàn", trong khi sự thật là ta không biết gì.
		writeError(w, http.StatusServiceUnavailable,
			fmt.Sprintf("không có mẫu lịch sử nào cho %s trong %d ngày (đã hỏi %s); chưa ước lượng được", pointID, days, source))
		return
	}

	samples, stepS := downsampleForAlarmSim(raw, days)
	simReq := AlarmSimulateRequest{Setting: req.Setting, Samples: samples}

	bin, err := alarmSimBinary()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable,
			fmt.Sprintf("không ước lượng được: %s. Ngữ nghĩa luật cảnh báo thuộc Core, "+
				"nên backend không tự tính thay — kể cả gần đúng.", err.Error()))
		return
	}
	events, err := runAlarmSim(r.Context(), bin, simReq)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "ước lượng thất bại: "+err.Error())
		return
	}

	raises := 0
	for _, event := range events {
		if isAlarmRaiseEvent(event.Event) {
			raises++
		}
	}

	writeJSON(w, http.StatusOK, AlarmEstimateResponse{
		SchemaVersion:    1,
		PointID:          pointID,
		Days:             days,
		SamplesAvailable: len(raw),
		SamplesUsed:      len(samples),
		StepS:            stepS,
		Raises:           raises,
		RaisesPerDay:     float64(raises) / float64(days),
		Events:           events,
		Engine:           bin,
		Downsampled:      len(samples) < len(raw),
		UnderestimateS:   stepS,
		HistorySource:    source,
	})
}

/*
readPointHistoryForEstimate đọc lịch sử điểm qua ĐÚNG kho đang được ghi.

BÀI HỌC PHẢI GHI LẠI Ở ĐÂY, VÌ NÓ ĐÃ LÀM TÍNH NĂNG NÀY CHẾT HẲN NGOÀI HIỆN TRƯỜNG

Bản đầu của `T57-3.13` gọi thẳng `a.trends.Query(...)` — kho trend **legacy**.
Trên máy dev nó không sai rõ ràng vì cả hai kho đều rỗng. Trên board thật thì:

    /data/config/historian-v2.sqlite   6,5 MB   sửa lúc 2026-08-19 12:05
    /data/mkddc/trend.sqlite           160 kB   sửa lần cuối 2026-08-04 10:53

Historian v2 đã là kho authoritative từ 15 ngày trước; kho legacy chết từ đó.
Hệ quả: **cả 28 điểm đều trả 503 "không có mẫu lịch sử"** dù dữ liệu vẫn đang
được ghi đều đặn. Endpoint không sai cú pháp, không crash, test trên host vẫn
xanh — nó chỉ hỏi nhầm chỗ, và kiểu hỏng đó chỉ lộ ra trên thiết bị thật.

Nay đi cùng đường với `/api/v1/history`: engine hợp nhất trước, legacy chỉ là
đường lùi khi v2 chưa sẵn sàng. Trả kèm `source` để lần sau ai đọc một kết quả
lạ còn biết nó đến từ kho nào — không phải đoán như lần này.
*/
func (a *App) readPointHistoryForEstimate(ctx context.Context, pointID string, fromMs, toMs int64) ([]Sample, string, error) {
	if engine, err := a.newHistorianQueryEngine(); err == nil {
		result, queryErr := engine.Query(ctx, HistorianQueryRequest{
			PointIDs:  []string{pointID},
			FromUTCMS: fromMs,
			ToUTCMS:   toMs,
			MaxPoints: alarmEstimateMaxSamples,
		})
		if queryErr != nil {
			return nil, "historian-v2", queryErr
		}
		samples := make([]Sample, 0, alarmEstimateMaxSamples)
		for _, series := range result.Series {
			for _, sample := range series.Samples {
				samples = append(samples, Sample{TS: sample.TimeUTCMS, PointID: series.PointID, Value: sample.Value})
			}
		}
		if len(samples) > 0 {
			return samples, "historian-v2", nil
		}
		/* v2 chạy nhưng không có mẫu cho điểm này: vẫn thử vòng nhớ điểm ảo
		   trước khi kết luận, vì VP không đi qua historian. */
		virtual := a.virtualPointRing.Query([]string{pointID}, fromMs, toMs)
		if len(virtual) > 0 {
			return virtual, "virtual-point-ring", nil
		}
		return nil, "historian-v2", nil
	}

	if a.trends == nil {
		return nil, "legacy-trend", fmt.Errorf("historian v2 chưa sẵn sàng và kho trend legacy không mở được")
	}
	raw, err := a.trends.Query(ctx, []string{pointID}, fromMs, toMs)
	if err != nil {
		return nil, "legacy-trend", err
	}
	raw = append(raw, a.virtualPointRing.Query([]string{pointID}, fromMs, toMs)...)
	return raw, "legacy-trend", nil
}

// downsampleForAlarmSim hạ tần chuỗi mẫu xuống trần của engine.
//
// Lấy mẫu theo BƯỚC THỜI GIAN đều chứ không lấy mỗi N phần tử: khoảng cách giữa
// hai mẫu là dữ liệu thật với luật có trễ kích hoạt, nên một chuỗi thưa đều
// phản ánh đúng hơn một chuỗi bị rút theo chỉ số.
func downsampleForAlarmSim(raw []Sample, days int) ([]AlarmSimSampleDTO, int) {
	sorted := append([]Sample(nil), raw...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].TS < sorted[j].TS })

	windowS := days * 24 * 3600
	stepS := 1
	if len(sorted) > alarmEstimateMaxSamples {
		stepS = windowS / alarmEstimateMaxSamples
		if stepS < 1 {
			stepS = 1
		}
	}

	out := make([]AlarmSimSampleDTO, 0, min(len(sorted), alarmEstimateMaxSamples))
	var lastTS int64 = -1 << 62
	for _, row := range sorted {
		ts := row.TS
		if ts < 1_000_000_000_000 {
			ts *= 1000 // mẫu legacy ghi bằng giây
		}
		if ts-lastTS < int64(stepS)*1000 {
			continue
		}
		lastTS = ts
		value, ok := numericSampleValue(row.Value)
		if !ok {
			// Mẫu không phải số (chuỗi, datetime của điểm ảo) không đưa vào được
			// một luật ngưỡng; bỏ qua thay vì ép kiểu và bịa ra một con số.
			continue
		}
		out = append(out, AlarmSimSampleDTO{
			T:     time.UnixMilli(ts).UTC().Format(time.RFC3339),
			Value: value,
		})
		if len(out) >= alarmEstimateMaxSamples {
			break
		}
	}
	return out, stepS
}

// numericSampleValue ép mẫu về số nếu nó THẬT SỰ là số. Boolean quy về 0/1 vì
// luật ngưỡng trên điểm nhị phân là ca dùng hợp lệ.
func numericSampleValue(raw any) (float64, bool) {
	switch value := raw.(type) {
	case float64:
		return value, true
	case float32:
		return float64(value), true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	case bool:
		if value {
			return 1, true
		}
		return 0, true
	default:
		return 0, false
	}
}

func min(left, right int) int {
	if left < right {
		return left
	}
	return right
}

// runAlarmSim tách khỏi handler để `handleSimulateAlarmSetting` và
// `handleEstimateAlarmSetting` gọi CÙNG một đường tới engine — hai đường riêng
// là hai cơ hội để chúng trôi khỏi nhau.
func runAlarmSim(ctx context.Context, bin string, req AlarmSimulateRequest) ([]AlarmSimEvent, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	stdout, err := runAlarmSimProcess(ctx, bin, payload)
	if err != nil {
		return nil, err
	}
	var events []AlarmSimEvent
	if err := json.Unmarshal(stdout, &events); err != nil {
		return nil, fmt.Errorf("không đọc được kết quả mô phỏng: %w", err)
	}
	if events == nil {
		events = []AlarmSimEvent{}
	}
	return events, nil
}
