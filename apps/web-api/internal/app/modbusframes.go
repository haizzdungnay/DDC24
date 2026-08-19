package app

import (
	"net/http"
	"strconv"
	"strings"

	webModbus "mkddc-web/internal/modbusrtu"
)

// FrameRecord — alias sang kiểu của lớp truyền, giữ hợp đồng ở đúng một chỗ.
type FrameRecord = webModbus.FrameRecord

// `GET /api/v1/modbus/frames` — `T57-3.9` (`ADR-046` bản sửa 2026-08-19).
//
// Trả các giao dịch Modbus RTU gần nhất mà chu kỳ poll BÌNH THƯỜNG đã thực
// hiện. Endpoint này KHÔNG phát gì ra bus: nó chỉ đọc một vòng nhớ trong tiến
// trình iobus. Đó là ranh giới tách nó khỏi `T57-3.8` (quét bus) — task đang
// hoãn sang Rev B vì quét là ghi ra RS-485 thật.
//
// Vòng nhớ mất khi iobus khởi động lại. Giao diện phải nói ra điều đó; mô tả nó
// như nhật ký lưu trữ là hứa một thứ không tồn tại.

const modbusFramesMaxLimit = 200

type ModbusFramesResponse struct {
	SchemaVersion int           `json:"schemaVersion"`
	Bus           int           `json:"bus"`
	Frames        []FrameRecord `json:"frames"`
	// Volatile luôn `true` ở Rev A: nhắc nơi hiển thị rằng dữ liệu này mất khi
	// iobus restart.
	Volatile bool `json:"volatile"`
	// RawBytes luôn `false`: `ADR-046` bản sửa nói rõ Rev A không có byte thô.
	RawBytes bool `json:"rawBytes"`
}

func (a *App) handleModbusFrames(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	bus := 0
	if raw := strings.TrimSpace(query.Get("bus")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			writeError(w, http.StatusBadRequest, "bus phải là số nguyên không âm")
			return
		}
		bus = parsed
	}
	limit := modbusFramesMaxLimit
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "limit phải là số nguyên dương")
			return
		}
		if parsed > modbusFramesMaxLimit {
			parsed = modbusFramesMaxLimit
		}
		limit = parsed
	}

	reply, err := a.modbusControl().Frames(bus, limit)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "không đọc được vòng nhớ khung từ iobus: "+err.Error())
		return
	}
	if reply.Result != "ok" {
		/* iobus bản cũ trả `unsupported`. Nói ra nguyên văn thay vì trả mảng
		   rỗng: mảng rỗng đọc thành "bus im lặng", và hai tình trạng đó dẫn tới
		   hai kết luận trái ngược khi người kỹ thuật đang đứng trước tủ. */
		reason := reply.Reason
		if reason == "" {
			reason = reply.Code
		}
		writeError(w, http.StatusServiceUnavailable, "iobus không trả được khung: "+reason)
		return
	}
	if reply.Frames == nil {
		reply.Frames = []FrameRecord{}
	}
	writeJSON(w, http.StatusOK, ModbusFramesResponse{
		SchemaVersion: 1, Bus: bus, Frames: reply.Frames, Volatile: true, RawBytes: false,
	})
}
