package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type pointReader interface {
	ReadPoints(context.Context) ([]PointDTO, error)
}

type pointForcer interface {
	ForcePoint(context.Context, string, any, bool) (PointDTO, error)
}

// pointTTLForcer là đường ghi có thời hạn do Core sở hữu. Tách khỏi
// `pointForcer` để một core client cũ (hoặc stub trong test) vẫn dùng được
// đường không TTL thay vì panic.
type pointTTLForcer interface {
	ForcePointTTL(ctx context.Context, id string, value any, release bool, ttlS uint32, user string) (PointDTO, error)
}

// maxOverrideTTLS khớp trần của Core (`web_ipc.cpp`: 1..86400). Kiểm ở đây để
// người dùng nhận lỗi 400 có nghĩa thay vì `rejected: bad_ttl` từ IPC.
const maxOverrideTTLS = 86400

type forcePointBody struct {
	value   any
	release bool
	ttlS    uint32
}

func (a *App) handlePoints(w http.ResponseWriter, r *http.Request) {
	points, err := a.ReadPoints(r.Context())
	if err != nil {
		// Đọc core hỏng thì nói ra bằng 503, không đáp 200 kèm danh sách rỗng:
		// một bảng point rỗng cạnh huy hiệu kết nối màu khoẻ là câu trả lời sai
		// nguy hiểm hơn một lỗi ồn ào (REV-BE-07).
		if a.logger != nil {
			a.logger.Printf("WARN points_read unavailable err=%v", err)
		}
		writeError(w, http.StatusServiceUnavailable, "không đọc được point từ core: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, points)
}

func (a *App) ReadPoints(ctx context.Context) ([]PointDTO, error) {
	reader, ok := a.core.(pointReader)
	points := []PointDTO{}
	if !ok {
		return a.overlayPointMetadata(a.overlayVirtualPoints(points)), nil
	}
	corePoints, err := reader.ReadPoints(ctx)
	if err == nil && corePoints != nil {
		points = corePoints
	} else {
		points = []PointDTO{}
	}
	return a.overlayOverrideState(ctx, a.overlayPointMetadata(a.overlayVirtualPoints(points))), err
}

// overlayOverrideState dán trạng thái ép tay do Core sở hữu lên danh sách point.
//
// PLC SHM không mang cờ forced hay TTL còn lại — nó chỉ có value/quality. Trước
// PA3, hệ quả là giao diện KHÔNG BAO GIỜ biết một output đang bị ép, trừ đúng
// lúc nó vừa gửi lệnh xong. Nay web-api hỏi Core bằng op `query` (không
// mutation) cho các point đang theo dõi, nên mở tab mới hay reload vẫn thấy
// đúng đồng hồ đếm ngược.
func (a *App) overlayOverrideState(ctx context.Context, points []PointDTO) []PointDTO {
	if a.overrides == nil {
		return points
	}
	if querier, ok := a.core.(overrideQuerier); ok {
		a.overrides.Refresh(ctx, querier)
	}
	snapshot := a.overrides.Snapshot()
	if len(snapshot) == 0 {
		return points
	}
	for i := range points {
		state, ok := snapshot[canonicalPointID(points[i].ID)]
		if !ok {
			continue
		}
		remaining := state.RemainingS
		points[i].Forced = true
		points[i].OverrideExpiresInS = &remaining
		if state.ActiveSource != "" {
			points[i].Priority = state.ActiveSource
		}
	}
	return points
}

// overlayVirtualPoints makes backend-created VP points the only visible
// virtual points. Raw core AV/BV/MSV slots are hidden until represented by
// virtual_points.conf.
func (a *App) overlayVirtualPoints(points []PointDTO) []PointDTO {
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		cfg = defaultVirtualPointsConfig()
	}
	cfg = normalizeVirtualPointsConfig(cfg)
	out := make([]PointDTO, 0, len(points)+len(cfg.Items))
	// Giữ lại slot AV/BV/MSV thô của Core để tra ngược. Chúng vẫn không được
	// phát ra ngoài (VP là bề mặt duy nhất người dùng thấy), nhưng slot do
	// CHƯƠNG TRÌNH sở hữu thì giá trị thật nằm ở đây chứ không ở cấu hình.
	coreSlots := make(map[string]PointDTO, len(points))
	for _, p := range points {
		if p.Kind == "virtual" {
			continue
		}
		if prefix, _, ok := parsePointID(p.ID); ok && (prefix == "AV" || prefix == "BV" || prefix == "MSV") {
			coreSlots[canonicalBoundPointID(p.ID)] = p
			continue
		}
		out = append(out, p)
	}
	for _, item := range cfg.Items {
		if !item.Enabled {
			continue
		}
		dto := virtualPointDTO(item)
		/* `source == PROGRAM` ⇒ ST Program ghi slot này mỗi chu kỳ, và `value`
		 * trong cấu hình chỉ còn là giá trị khởi tạo. Đọc từ cấu hình ở đây sẽ
		 * hiện một hằng số đứng yên cho một đại lượng đang thay đổi — đúng cái
		 * bẫy mà `F-PROG-ASBUILT-016` từng chặn cả chiều ghi để tránh. Nay
		 * chiều ghi được mở thì đường đọc ngược phải mở cùng lúc, không thì
		 * người vận hành nhìn vào một con số không bao giờ nhúc nhích. */
		if strings.EqualFold(item.Source, virtualPointSourceProgram) && item.BoundPointID != "" {
			if slot, ok := coreSlots[canonicalBoundPointID(item.BoundPointID)]; ok {
				dto.Value = slot.Value
				dto.Quality = slot.Quality
				dto.Source = slot.Source
				dto.UpdatedAt = slot.UpdatedAt
			} else {
				// Không tra được slot ⇒ KHÔNG rơi về giá trị cấu hình: đó là
				// hiện một con số bịa cho một điểm chưa đọc được.
				dto.Value = nil
				dto.Quality = "unknown"
			}
		}
		out = append(out, dto)
	}
	return out
}

func (a *App) overlayPointMetadata(points []PointDTO) []PointDTO {
	ioCfg, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		ioCfg = ConfigIO{}
	}
	metadata := map[string]struct {
		tag, name, unit, signalType, equipment string
		trend                                  bool
	}{}
	addRows := func(rows []map[string]any, prefix string) {
		for _, row := range rows {
			channel, _, good := intField(row, "ch")
			if !good {
				continue
			}
			id := formatPointID(prefix, channel)
			tag, _, _ := stringField(row, "tag")
			name, _, _ := stringField(row, "name")
			unit, _, _ := stringField(row, "display_unit")
			trend, _, _ := boolField(row, "trend_enabled")
			// `type` chỉ có ý nghĩa ở kênh UI ("0-10V", "none"...); AO/DO
			// không có field này nên signalType rỗng, không ảnh hưởng.
			signalType, _, _ := stringField(row, "type")
			// `T57-3.1` (`ADR-042`): thẻ thiết bị đi kèm điểm ra tới giao diện.
			// Core KHÔNG đọc trường này — nó là dữ liệu trình bày.
			equipment, _, _ := stringField(row, "equipment")
			metadata[id] = struct {
				tag, name, unit, signalType, equipment string
				trend                                  bool
			}{fallbackPointTag(tag, id), strings.TrimSpace(name), strings.TrimSpace(unit), strings.TrimSpace(signalType), normalizeEquipmentTag(equipment), trend}
		}
	}
	addRows(ioCfg.UI, "UI")
	addRows(ioCfg.AO, "AO")
	addRows(ioCfg.DO, "DO")
	fieldbus, _ := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	modbusMetadata := make(map[string]ModbusRTUPoint, len(fieldbus.Points))
	for _, point := range fieldbus.Points {
		modbusMetadata[point.PointID] = point
	}
	safeCfg, _ := readConfig(a, configGroupSafeState, ConfigSafeState{})
	safeValues := map[string]any{}
	for _, row := range safeCfg.AO {
		if ch, _, good := intField(row, "ch"); good {
			safeValues[formatPointID("AO", ch)] = row["safe"]
		}
	}
	for _, row := range safeCfg.DO {
		if ch, _, good := intField(row, "ch"); good {
			safeValues[formatPointID("DO", ch)] = row["safe"]
		}
	}
	out := make([]PointDTO, len(points))
	for i, point := range points {
		id := canonicalPointID(point.ID)
		point.ID = id
		point.Channel, _ = globalPointChannel(id)
		if point.Tag == "" {
			point.Tag = id
		}
		if meta, ok := metadata[id]; ok {
			point.Tag = meta.tag
			if meta.name != "" {
				point.Name = meta.name
			}
			if meta.unit != "" {
				point.Unit = meta.unit
			}
			point.LogEnabled = meta.trend
			point.SignalType = meta.signalType
			point.Equipment = meta.equipment
		}
		if point.Name == "" {
			point.Name = id
		}
		if meta, ok := modbusMetadata[id]; ok {
			point.Tag = meta.TagName
			point.Name = meta.DisplayName
			point.Unit = meta.Unit
			point.DataType = meta.DataType
			point.ReadWrite = meta.ReadWrite
			point.DefaultValue = meta.DefaultValue
			point.SafeValue = meta.SafeValue
			point.Writable = meta.ReadWrite == "read_write"
		}
		point.PointID = point.ID
		point.TagName = point.Tag
		point.DisplayName = point.Name
		if point.DataType == "" {
			if _, ok := point.Value.(bool); ok {
				point.DataType = "bool"
			} else {
				point.DataType = "float32"
			}
		}
		point.Timestamp = point.UpdatedAt
		if point.ReadWrite == "" {
			if point.Writable || point.Kind == "AO" || point.Kind == "DO" || point.Kind == "virtual" {
				point.ReadWrite = "read_write"
			} else {
				point.ReadWrite = "read"
			}
		}
		if point.DefaultValue == nil {
			if _, ok := point.Value.(bool); ok {
				point.DefaultValue = false
			} else {
				point.DefaultValue = float64(0)
			}
		}
		if point.SafeValue == nil {
			if configured, ok := safeValues[id]; ok {
				point.SafeValue = configured
			} else if _, ok := point.Value.(bool); ok {
				point.SafeValue = false
			} else {
				point.SafeValue = float64(0)
			}
		}
		// `Source` chỉ được ĐIỀN khi còn trống, không được ghi đè.
		//
		// `handleForcePoint` gọi `forcer.ForcePoint` — hàm đó đặt `Source` thành
		// "core" / "core_unavailable" / "rejected:…" để nói giá trị này đến từ
		// đâu — rồi đưa kết quả qua đây. Ghi đè theo mỗi `Kind` xoá sạch thông
		// tin đó: FE không bao giờ biết một giá trị là lệnh ép tay hay đến từ
		// một core đang suy giảm, và hợp đồng `strings.Contains(point.Source,
		// "core_unavailable")` mà `ws.go` đang dựa vào bị phá (REV-BE-08).
		if point.Source == "" {
			switch point.Kind {
			case "modbus_rtu":
				point.Source = "modbus_rtu"
			case "virtual":
				point.Source = "virtual_point"
			default:
				point.Source = "local_physical_io"
			}
		}
		out[i] = point
	}
	return out
}

func (a *App) handlePoint(w http.ResponseWriter, r *http.Request) {
	id := pointIDOrGlobalChannel(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing point id")
		return
	}
	if item, ok := a.findVirtualPoint(id); ok {
		writeJSON(w, http.StatusOK, virtualPointDTO(item))
		return
	}
	if prefix, _, ok := parsePointID(id); ok && (virtualPointIDPrefix(prefix) || prefix == "BV" || prefix == "MSV") {
		writeError(w, http.StatusNotFound, "point not found")
		return
	}
	targetID := canonicalPointID(id)
	reader, ok := a.core.(pointReader)
	if !ok {
		writeError(w, http.StatusNotFound, "point not found")
		return
	}
	points, err := reader.ReadPoints(r.Context())
	if err != nil {
		if a.logger != nil {
			a.logger.Printf("WARN point_read degraded id=%s err=%v", id, err)
		}
		writeError(w, http.StatusNotFound, "point not found")
		return
	}
	for _, point := range points {
		if canonicalPointID(point.ID) == targetID {
			projected := a.overlayPointMetadata([]PointDTO{point})
			writeJSON(w, http.StatusOK, a.withAuthoritativeOverride(r.Context(), projected[0]))
			return
		}
	}
	writeError(w, http.StatusNotFound, "point not found")
}

// withAuthoritativeOverride hỏi thẳng Core trạng thái ép tay của MỘT point.
//
// Đường này chỉ chạy ở màn chi tiết, nơi người dùng sắp bấm nút — chi phí một
// vòng IPC là xứng đáng để con số "còn 04:32" là của Core chứ không phải của
// bộ nhớ web-api. Reload trình duyệt hay restart web-api đều đi qua đây.
func (a *App) withAuthoritativeOverride(ctx context.Context, point PointDTO) PointDTO {
	if !commandablePointID(point.ID) {
		return point
	}
	// Bước 1 — dán trạng thái đã biết. Đây là thứ giữ được câu trả lời khi Core
	// im lặng ở bước 2: "không hỏi được" KHÔNG phải "đã nhả".
	if snapshot := a.overrides.Snapshot(); snapshot != nil {
		if state, ok := snapshot[canonicalPointID(point.ID)]; ok {
			remaining := state.RemainingS
			point.Forced = true
			point.OverrideExpiresInS = &remaining
			if state.ActiveSource != "" {
				point.Priority = state.ActiveSource
			}
		}
	}
	querier, ok := a.core.(overrideQuerier)
	if !ok {
		return point
	}
	authoritative, err := querier.QueryPoint(ctx, point.ID, "web")
	if err != nil {
		return point
	}
	remaining := uint32(0)
	if authoritative.OverrideExpiresInS != nil {
		remaining = *authoritative.OverrideExpiresInS
	}
	if authoritative.Priority != "" {
		point.Priority = authoritative.Priority
	}
	if remaining > 0 {
		point.Forced = true
		point.OverrideExpiresInS = &remaining
		a.overrides.Note(point.ID, "-", remaining, remaining, authoritative.Priority)
		return point
	}
	point.OverrideExpiresInS = nil
	point.Forced = strings.EqualFold(authoritative.Priority, "manual") || strings.EqualFold(authoritative.Priority, "local_manual")
	if !point.Forced {
		a.overrides.Forget(point.ID)
	}
	return point
}

func (a *App) handleForcePoint(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil || !RoleAllows(principal.Role, RoleOperator) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	id := pointIDOrGlobalChannel(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing point id")
		return
	}
	body, err := decodeForcePointBody(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if item, ok := a.findVirtualPoint(id); ok {
		if body.ttlS > 0 {
			// Không giả lập thời hạn cho thứ backend không cưỡng chế được:
			// VP đi đường ghi cấu hình, Core không giữ TTL cho nó.
			writeError(w, http.StatusBadRequest, "virtual point không hỗ trợ ttlS")
			return
		}
		point, err := a.writeVirtualPointValue(r, item.ID, body.value, body.release)
		if err != nil {
			a.audit.PointForce(principal, id, body.release, "rejected", r.RemoteAddr)
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		a.audit.PointForce(principal, id, body.release, "accepted", r.RemoteAddr)
		writeJSON(w, http.StatusOK, point)
		return
	}
	if prefix, _, ok := parsePointID(id); ok && (virtualPointIDPrefix(prefix) || prefix == "BV" || prefix == "MSV") {
		a.audit.PointForce(principal, id, body.release, "not_found", r.RemoteAddr)
		writeError(w, http.StatusNotFound, "point not found")
		return
	}
	point, err := a.commandCorePoint(r.Context(), id, body, principal)
	if err != nil {
		if err == errPointCommandUnsupported {
			a.audit.PointForce(principal, id, body.release, "unsupported", r.RemoteAddr)
			writeError(w, http.StatusConflict, "point force unsupported")
			return
		}
		a.audit.PointForce(principal, id, body.release, "rejected", r.RemoteAddr)
		a.audit.PointOverride(principal, id, body.ttlS, 0, "rejected", "core_rejected", "", r.RemoteAddr)
		writeError(w, http.StatusConflict, "point force rejected")
		return
	}
	result := "accepted"
	if point.Fault {
		result = "degraded"
	}
	a.audit.PointForce(principal, id, body.release, result, r.RemoteAddr)
	remaining := uint32(0)
	if point.OverrideExpiresInS != nil {
		remaining = *point.OverrideExpiresInS
	}
	if body.release {
		a.overrides.Forget(id)
		a.audit.PointOverride(principal, id, 0, 0, result, "released", "", r.RemoteAddr)
	} else if body.ttlS > 0 {
		a.overrides.Note(id, principalUsername(principal), body.ttlS, remaining, point.Priority)
		reason := "core_ttl"
		if remaining == 0 {
			// Core chấp nhận lệnh nhưng không báo TTL còn lại. Nói ra trong
			// audit thay vì để giao diện đếm ngược một con số không ai cưỡng chế.
			reason = "core_ttl_not_reported"
		}
		a.audit.PointOverride(principal, id, body.ttlS, remaining, result, reason, "", r.RemoteAddr)
	}
	projected := a.overlayPointMetadata([]PointDTO{point})
	writeJSON(w, http.StatusOK, projected[0])
}

var errPointCommandUnsupported = fmt.Errorf("point command unsupported")

func principalUsername(principal *Principal) string {
	if principal == nil {
		return "-"
	}
	return principal.Username
}

// commandCorePoint chọn đường ghi có TTL khi core client hỗ trợ, và rơi về
// đường cũ khi không. Không bao giờ tự dựng hẹn giờ thay thế.
func (a *App) commandCorePoint(ctx context.Context, id string, body forcePointBody, principal *Principal) (PointDTO, error) {
	if ttlForcer, ok := a.core.(pointTTLForcer); ok {
		return ttlForcer.ForcePointTTL(ctx, id, body.value, body.release, body.ttlS, principalUsername(principal))
	}
	forcer, ok := a.core.(pointForcer)
	if !ok {
		return PointDTO{}, errPointCommandUnsupported
	}
	if body.ttlS > 0 {
		return PointDTO{}, fmt.Errorf("core không hỗ trợ ttlS")
	}
	return forcer.ForcePoint(ctx, id, body.value, body.release)
}

func decodeForcePointBody(w http.ResponseWriter, r *http.Request) (forcePointBody, error) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.UseNumber()
	var raw map[string]json.RawMessage
	if err := dec.Decode(&raw); err != nil {
		return forcePointBody{}, fmt.Errorf("invalid json")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return forcePointBody{}, fmt.Errorf("invalid json")
	}
	for key := range raw {
		if key != "value" && key != "release" && key != "ttlS" {
			return forcePointBody{}, fmt.Errorf("unknown field %q", key)
		}
	}
	releaseRaw, hasRelease := raw["release"]
	valueRaw, hasValue := raw["value"]
	ttlRaw, hasTTL := raw["ttlS"]
	if hasRelease {
		var release bool
		if err := json.Unmarshal(releaseRaw, &release); err != nil {
			return forcePointBody{}, fmt.Errorf("invalid release")
		}
		if release {
			if hasValue {
				return forcePointBody{}, fmt.Errorf("release cannot include value")
			}
			if hasTTL {
				return forcePointBody{}, fmt.Errorf("release cannot include ttlS")
			}
			return forcePointBody{release: true}, nil
		}
	}
	if !hasValue {
		return forcePointBody{}, fmt.Errorf("missing value or release")
	}
	var value any
	valueDec := json.NewDecoder(bytes.NewReader(valueRaw))
	valueDec.UseNumber()
	if err := valueDec.Decode(&value); err != nil {
		return forcePointBody{}, fmt.Errorf("invalid value")
	}
	if !validPointCommandValue(value) {
		return forcePointBody{}, fmt.Errorf("value must be number or boolean")
	}
	body := forcePointBody{value: value}
	if hasTTL {
		var ttl int64
		if err := json.Unmarshal(ttlRaw, &ttl); err != nil {
			return forcePointBody{}, fmt.Errorf("invalid ttlS")
		}
		if ttl < 1 || ttl > maxOverrideTTLS {
			return forcePointBody{}, fmt.Errorf("ttlS must be between 1 and %d seconds", maxOverrideTTLS)
		}
		body.ttlS = uint32(ttl)
	}
	return body, nil
}

func (a *App) findVirtualPoint(id string) (VirtualPoint, bool) {
	target := canonicalVirtualPointID(id)
	if !validVirtualPointID(target) {
		return VirtualPoint{}, false
	}
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return VirtualPoint{}, false
	}
	for _, item := range cfg.Items {
		item = normalizeVirtualPoint(item)
		if item.ID == target {
			return item, true
		}
	}
	return VirtualPoint{}, false
}

func (a *App) writeVirtualPointValue(r *http.Request, id string, value any, release bool) (PointDTO, error) {
	if release {
		return PointDTO{}, fmt.Errorf("virtual point release unsupported")
	}
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return PointDTO{}, err
	}
	target := canonicalVirtualPointID(id)
	index := virtualPointIndex(cfg.Items, target)
	if index < 0 {
		return PointDTO{}, fmt.Errorf("virtual point not found")
	}
	item := normalizeVirtualPoint(cfg.Items[index])
	if !item.Writable {
		return PointDTO{}, fmt.Errorf("virtual point is read-only")
	}
	nextValue, ok := normalizeVirtualPointValue(item.SignalType, value)
	if !ok {
		return PointDTO{}, fmt.Errorf("value must match signalType")
	}
	item.Value = nextValue
	item.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	cfg.Items[index] = item
	if err := a.writeVirtualPointsConfig(r, cfg, "write"); err != nil {
		return PointDTO{}, err
	}
	a.virtualPointRuntime.Update(RuntimePoint{ID: item.ID, Kind: "VP", Value: item.Value, Quality: "GOOD", Source: "web", Role: "runtime_value", Unit: item.Unit, SignalType: item.SignalType, Generation: item.Generation})
	a.syncVirtualPointToCore(r.Context(), item)
	return virtualPointDTO(item), nil
}

func validPointCommandValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return true
	case string:
		return true
	case json.Number:
		_, err := typed.Float64()
		return err == nil
	default:
		return false
	}
}
