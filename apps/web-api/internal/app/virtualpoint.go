package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	virtualPointSignalBoolean  = "boolean"
	virtualPointSignalInteger  = "integer"
	virtualPointSignalFloat    = "float"
	virtualPointSignalString   = "string"
	virtualPointSignalDateTime = "datetime"

	virtualPointTotalCapacity  = 464
	virtualPointNoLogCapacity  = 256
	virtualPointLog1sCapacity  = 128
	virtualPointLog100Capacity = 64
	virtualPointLog10Capacity  = 16
)

var virtualPointLogCapacities = map[int]int{
	1000: virtualPointLog1sCapacity,
	100:  virtualPointLog100Capacity,
	10:   virtualPointLog10Capacity,
}

var virtualPointRetentionMaxS = map[int]int{
	1000: 30 * 24 * 60 * 60,
	100:  7 * 24 * 60 * 60,
	10:   60 * 60,
}

func (item *VirtualPoint) UnmarshalJSON(data []byte) error {
	type virtualPointJSON VirtualPoint
	var raw struct {
		virtualPointJSON
		Enabled  *bool `json:"enabled"`
		Writable *bool `json:"writable"`
	}
	raw.virtualPointJSON = virtualPointJSON(*item)
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	next := VirtualPoint(raw.virtualPointJSON)
	if raw.Enabled != nil {
		next.Enabled = *raw.Enabled
	} else if item.ID == "" && !item.Enabled {
		next.Enabled = true
	} else {
		next.Enabled = item.Enabled
	}
	if raw.Writable != nil {
		next.Writable = *raw.Writable
	} else if item.ID == "" && !item.Writable {
		next.Writable = true
	} else {
		next.Writable = item.Writable
	}
	*item = VirtualPoint(next)
	return nil
}

// syncVirtualPointToCore đẩy giá trị VP đã "bound" (BoundPointID != "") sang
// slot AV/BV thật của Core qua đường WebIpc `write` sẵn có (F-PROG-ASBUILT-014
// phần READ) — tái dùng pointTTLForcer.ForcePointTTL với ttlS=0 (không tự
// nhả, giữ tới lần sync kế tiếp) thay vì dựng message IPC mới. Không lỗi khi
// Core tạm không sẵn sàng (ForcePointTTL tự trả degraded, err=nil) — VP vẫn
// là nguồn sự thật ở virtual_points.conf, đồng bộ Core chỉ là bản sao cho ST
// Program đọc, không phải ngược lại.
// virtualPointSourceProgram — slot do ST Program sở hữu; web-api không ghi.
const virtualPointSourceProgram = "PROGRAM"

func (a *App) syncVirtualPointToCore(ctx context.Context, item VirtualPoint) {
	if item.BoundPointID == "" {
		return
	}
	// Slot do chương trình sở hữu thì web-api KHÔNG đẩy giá trị cấu hình vào
	// nữa. Đẩy vào là ghi đè kết quả điều khiển bằng một hằng số cấu hình —
	// đúng một chu kỳ sau chương trình lại ghi đè ngược, và ô điểm nhấp nháy
	// giữa hai nguồn mà không dấu hiệu nào chỉ ra vì sao.
	if strings.EqualFold(item.Source, virtualPointSourceProgram) {
		return
	}
	forcer, ok := a.core.(pointTTLForcer)
	if !ok {
		return
	}
	value := item.Value
	if value == nil {
		value = defaultVirtualPointValue(item.SignalType)
	}
	if _, err := forcer.ForcePointTTL(ctx, item.BoundPointID, value, false, 0, "virtual-point-sync"); err != nil {
		a.logger.Printf("virtual-point-sync: %s -> %s failed: %v", item.ID, item.BoundPointID, err)
	}
}

// syncBoundVirtualPointsToCore đẩy lại toàn bộ VP đã "bound" sang Core một
// lần — gọi lúc web-api khởi động (xem main.go NewApp) để tự phục hồi sau khi
// Core hoặc web-api restart, không đợi người vận hành vô tình ghi lại VP.
func (a *App) syncBoundVirtualPointsToCore(ctx context.Context) {
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return
	}
	for _, item := range normalizeVirtualPointsConfig(cfg).Items {
		if item.Enabled && item.BoundPointID != "" {
			a.syncVirtualPointToCore(ctx, item)
		}
	}
}

// virtualPointReconcileInterval — nhịp đối chiếu VP ↔ Core.
//
// Đủ thưa để không thành tải cho một thiết bị nhúng đang chạy điều khiển, đủ
// dày để một lần Core restart không để chương trình đọc giá trị sai quá lâu.
const virtualPointReconcileInterval = 10 * time.Second

// runVirtualPointReconciler giữ av_[]/bv_[]/msv_[] của Core khớp cấu hình VP.
//
// `syncBoundVirtualPointsToCore` chỉ chạy MỘT LẦN lúc web-api khởi động. Nếu
// Core khởi động lại SAU đó — nâng cấp, watchdog, hay chỉ là `systemctl restart
// mkddc-core` — các slot ảo reset về 0/BAD và KHÔNG có gì đẩy lại. Mọi ST
// Program bind VP khi đó đọc thành 0/false một cách IM LẶNG. Quan sát được
// trên bo Foxlinx 2026-08-28: sau khi restart Core, `VP_OCCUPIED` đọc false
// nên AHU không rời trạng thái OFF, và không thông điệp nào nói vì sao.
//
// `plc_shm` không có "boot id" để bắt riêng sự kiện restart, nên đây là vòng
// ĐỐI CHIẾU chứ không phải vòng phát hiện: so giá trị Core với cấu hình và chỉ
// ghi khi lệch. Nó tự lành bất kể nguyên nhân (restart, ai đó ghi đè, SHM mới
// dựng) và không ghi gì khi mọi thứ đã khớp.
func (a *App) runVirtualPointReconciler(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.reconcileBoundVirtualPointsOnce(ctx)
		}
	}
}

func (a *App) reconcileBoundVirtualPointsOnce(ctx context.Context) {
	reader, ok := a.core.(pointReader)
	if !ok {
		return
	}
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return
	}
	items := normalizeVirtualPointsConfig(cfg).Items

	// Không đọc Core khi không có gì để đối chiếu: slot do CHƯƠNG TRÌNH sở hữu
	// nằm ngoài phạm vi vòng này — ghi vào đó là giẫm lên kết quả điều khiển.
	pending := make([]VirtualPoint, 0, len(items))
	for _, item := range items {
		if item.Enabled && item.BoundPointID != "" &&
			!strings.EqualFold(item.Source, virtualPointSourceProgram) {
			pending = append(pending, item)
		}
	}
	if len(pending) == 0 {
		return
	}

	corePoints, err := reader.ReadPoints(ctx)
	if err != nil || corePoints == nil {
		return
	}
	slots := make(map[string]PointDTO, len(corePoints))
	for _, p := range corePoints {
		if prefix, _, good := parsePointID(p.ID); good &&
			(prefix == "AV" || prefix == "BV" || prefix == "MSV") {
			slots[canonicalBoundPointID(p.ID)] = p
		}
	}

	for _, item := range pending {
		slot, found := slots[canonicalBoundPointID(item.BoundPointID)]
		if found && virtualPointMatchesSlot(item, slot) {
			continue
		}
		a.syncVirtualPointToCore(ctx, item)
	}
}

// virtualPointMatchesSlot — cấu hình VP và slot Core đang nói cùng một điều?
//
// Chất lượng khác `good` cũng tính là LỆCH: một slot BAD nghĩa là chương trình
// đọc nó sẽ fail-closed, nên phải đẩy lại dù con số tình cờ trùng.
func virtualPointMatchesSlot(item VirtualPoint, slot PointDTO) bool {
	if !strings.EqualFold(slot.Quality, "good") {
		return false
	}
	want := item.Value
	if want == nil {
		want = defaultVirtualPointValue(item.SignalType)
	}
	if item.SignalType == virtualPointSignalBoolean {
		wantBool, okWant := virtualPointBool(want)
		gotBool, okGot := virtualPointBool(slot.Value)
		return okWant && okGot && wantBool == gotBool
	}
	wantNum, okWant := virtualPointFloat(want)
	gotNum, okGot := virtualPointFloat(slot.Value)
	if !okWant || !okGot {
		return false
	}
	// So số thực bằng `==` sẽ đẩy lại vô hạn vì float32 ở SHM không tái lập
	// đúng bit của float64 trong cấu hình.
	diff := wantNum - gotNum
	if diff < 0 {
		diff = -diff
	}
	return diff <= 1e-4
}

func virtualPointBool(value any) (bool, bool) {
	switch v := value.(type) {
	case bool:
		return v, true
	case float32:
		return v > 0.5, true
	case float64:
		return v > 0.5, true
	case int:
		return v > 0, true
	}
	return false, false
}

func virtualPointFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case bool:
		if v {
			return 1, true
		}
		return 0, true
	}
	return 0, false
}

func (a *App) handleListVirtualPoints(w http.ResponseWriter, r *http.Request) {
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, normalizeVirtualPointsConfig(cfg).Items)
}

func (a *App) handleCreateVirtualPoint(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	item := defaultVirtualPoint()
	if err := decodeConfigBody(w, r, &item); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if item.ID == "" {
		item.ID = nextVirtualPointID(cfg.Items)
	}
	if strings.TrimSpace(item.Tag) == "" {
		item.Tag = item.ID
	}
	beforeVP := clonePointVirtualConfig(cfg)
	beforeIO, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	next := ConfigVirtualPoints{Items: append(append([]VirtualPoint(nil), cfg.Items...), item)}
	if errs := append(validateConfigVirtualPoints(next), validateVirtualPointMetadata(next)...); len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	item = normalizeVirtualPoint(item)
	next.Items[len(next.Items)-1] = item
	ioCfg := beforeIO
	if errs := validatePointNamespaceTransition(beforeIO, beforeVP, ioCfg, next); len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	if err := a.writeVirtualPointsConfig(r, next, "create"); err != nil {
		if writeVirtualPointSlotError(w, err) {
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	/* `ISS-PIO-03`: allocator chạy TRONG phễu ghi, nên `boundPointId` chỉ tồn
	 * tại ở bản vừa được ghi xuống đĩa. Lấy lại bản đó cho đáp ứng — trả về một
	 * VP không có slot trong khi tệp đã có slot là hai sự thật khác nhau cho
	 * cùng một điểm, và FE sẽ tin bản sai. */
	item = next.Items[len(next.Items)-1]
	if authority, err := a.readPointNamespaceAuthority(); err == nil {
		item.Generation = authority.Generations[item.ID]
	}
	a.syncVirtualPointToCore(r.Context(), item)
	writeJSON(w, http.StatusCreated, item)
}

func (a *App) handleUpdateVirtualPoint(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	id := canonicalVirtualPointID(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing virtual point id")
		return
	}
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	index := virtualPointIndex(cfg.Items, id)
	if index < 0 {
		writeError(w, http.StatusNotFound, "virtual point not found")
		return
	}
	beforeVP := clonePointVirtualConfig(cfg)
	beforeIO, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	item := cfg.Items[index]
	if err := decodeConfigBody(w, r, &item); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	item.ID = id
	cfg.Items[index] = item
	if errs := append(validateConfigVirtualPoints(cfg), validateVirtualPointMetadata(cfg)...); len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	item = normalizeVirtualPoint(item)
	cfg.Items[index] = item
	ioCfg := beforeIO
	if errs := validatePointNamespaceTransition(beforeIO, beforeVP, ioCfg, cfg); len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	if err := a.writeVirtualPointsConfig(r, cfg, "update"); err != nil {
		if writeVirtualPointSlotError(w, err) {
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.syncVirtualPointToCore(r.Context(), item)
	writeJSON(w, http.StatusOK, item)
}

func (a *App) handleDeleteVirtualPoint(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	id := canonicalVirtualPointID(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing virtual point id")
		return
	}
	cfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	index := virtualPointIndex(cfg.Items, id)
	if index < 0 {
		writeError(w, http.StatusNotFound, "virtual point not found")
		return
	}
	beforeVP := clonePointVirtualConfig(cfg)
	beforeIO, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	cfg.Items = append(append([]VirtualPoint(nil), cfg.Items[:index]...), cfg.Items[index+1:]...)
	if errs := validatePointNamespaceTransition(beforeIO, beforeVP, beforeIO, cfg); len(errs) > 0 {
		writePointTagErrors(w, errs)
		return
	}
	if err := a.writeVirtualPointsConfig(r, cfg, "delete"); err != nil {
		if writeVirtualPointSlotError(w, err) {
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ConfigPutResult{Result: "success", Applied: true, Reload: reloadNone, Warnings: []string{}})
}

// errVirtualPointSlotAllocation là lỗi CẤU HÌNH (hết slot), không phải lỗi hệ
// thống. Tách ra để nơi gọi trả 400 kèm lý do đọc được, thay vì một 500 nói
// "lỗi máy chủ" cho một tình huống mà người vận hành xử lý được.
type errVirtualPointSlotAllocation struct{ details []configValidationError }

func (e errVirtualPointSlotAllocation) Error() string {
	if len(e.details) == 0 {
		return "không cấp phát được slot Virtual Point"
	}
	return e.details[0].Message
}

func (a *App) writeVirtualPointsConfig(r *http.Request, cfg ConfigVirtualPoints, op string) error {
	cfg = normalizeVirtualPointsConfig(cfg)
	/* `ISS-PIO-03`: cấp `boundPointId` NGAY TẠI PHỄU GHI, không ở từng handler.
	 * Mọi đường ghi VP — create, update, delete, PUT cấu hình, ghi giá trị —
	 * đều đi qua đây, nên đặt allocator ở đúng một chỗ là cách bảo đảm không có
	 * cửa nào tạo ra một VP không bao giờ map được. */
	cfg, allocErrs := assignVirtualPointSlots(cfg)
	if len(allocErrs) > 0 {
		return errVirtualPointSlotAllocation{details: allocErrs}
	}
	ioCfg, _ := readConfig(a, configGroupIO, ConfigIO{})
	fieldbus, _ := readConfig(a, configGroupFieldbus, ConfigFieldbus{})
	if errs := validateUnifiedPointTags(ioCfg, cfg, fieldbus); len(errs) > 0 {
		return fmt.Errorf("point tag conflict với Modbus RTU: %s", errs[0].Message)
	}
	current, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return err
	}
	authority, err := a.readPointNamespaceAuthority()
	if err != nil {
		return err
	}
	currentGeneration := make(map[string]uint64, len(current.Items))
	for _, point := range current.Items {
		generation := point.Generation
		if generation == 0 {
			generation = authority.Generations[point.ID]
		}
		if generation == 0 {
			generation = 1
		}
		currentGeneration[point.ID] = generation
		if authority.Generations[point.ID] < generation {
			authority.Generations[point.ID] = generation
		}
	}
	for i := range cfg.Items {
		generation := currentGeneration[cfg.Items[i].ID]
		if generation == 0 {
			generation = authority.Generations[cfg.Items[i].ID] + 1
		}
		cfg.Items[i].Generation = generation
		authority.Generations[cfg.Items[i].ID] = generation
	}
	authority.Revision++
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode virtual points config: %w", err)
	}
	data = append(data, '\n')
	path := a.configPath(configGroupVirtualPoints.file)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("prepare config dir: %w", err)
	}
	if err := writeConfigFileAtomic(path, data, 0o644); err != nil {
		return err
	}
	if err := a.writePointNamespaceAuthority(authority); err != nil {
		return err
	}
	user := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		user = principal.Username
	}
	a.audit.Change(user, "virtual-points."+op, configGroupVirtualPoints.file, "applied", r.RemoteAddr)
	return nil
}

func validateConfigVirtualPoints(cfg ConfigVirtualPoints) []configValidationError {
	var errs []configValidationError
	if len(cfg.Items) > virtualPointTotalCapacity {
		addConfigErr(&errs, "items", fmt.Sprintf("must contain at most %d VP points", virtualPointTotalCapacity))
	}
	ids := make(map[string]bool, len(cfg.Items))
	noLogCount := 0
	logCounts := map[int]int{}
	for i, item := range cfg.Items {
		base := fmt.Sprintf("items[%d]", i)
		item = normalizeVirtualPoint(item)
		if item.ID == "" {
			addConfigErr(&errs, base+".id", "is required")
		} else if !validVirtualPointID(item.ID) {
			addConfigErr(&errs, base+".id", fmt.Sprintf("must be VP1..VP%d", virtualPointTotalCapacity))
		} else if ids[item.ID] {
			addConfigErr(&errs, base+".id", "must be unique")
		}
		ids[item.ID] = true
		expectedChannel, channelOK := globalPointChannel(item.ID)
		if item.Channel != 0 && (!channelOK || item.Channel != expectedChannel) {
			addConfigErr(&errs, base+".channel", "must match the global channel derived from id")
		}
		if !validVirtualPointSignalType(item.SignalType) {
			addConfigErr(&errs, base+".signalType", "must be boolean, integer, float, string, or datetime")
		}
		if item.LogEnabled {
			if item.LogIntervalMs == nil {
				addConfigErr(&errs, base+".logIntervalMs", "is required when logEnabled=true")
			} else if _, ok := virtualPointLogCapacities[*item.LogIntervalMs]; !ok {
				addConfigErr(&errs, base+".logIntervalMs", "must be 1000, 100, or 10")
			} else {
				logCounts[*item.LogIntervalMs]++
				if !virtualPointLoggableSignalType(item.SignalType) {
					addConfigErr(&errs, base+".signalType", "must be boolean, integer, or float when logEnabled=true")
				}
				if maxRetention := virtualPointRetentionMaxS[*item.LogIntervalMs]; item.RetentionS > maxRetention {
					addConfigErr(&errs, base+".retentionS", fmt.Sprintf("must be <= %d for %dms logging", maxRetention, *item.LogIntervalMs))
				}
			}
		} else {
			noLogCount++
		}
		if item.RetentionS < 0 {
			addConfigErr(&errs, base+".retentionS", "must be >= 0")
		}
		rangeMin, rangeMax := virtualPointDisplayRangeLimits(item.Unit)
		if item.DisplayMin < rangeMin || item.DisplayMin > rangeMax {
			addConfigErr(&errs, base+".displayMin", fmt.Sprintf("must be between %g and %g", rangeMin, rangeMax))
		}
		if item.DisplayMax < rangeMin || item.DisplayMax > rangeMax {
			addConfigErr(&errs, base+".displayMax", fmt.Sprintf("must be between %g and %g", rangeMin, rangeMax))
		}
		if item.DisplayMin > item.DisplayMax {
			addConfigErr(&errs, base+".displayMax", "must be >= displayMin")
		}
		if item.RangeMultiplier < 0 || item.RangeMultiplier > 5 {
			addConfigErr(&errs, base+".rangeMultiplier", "must be 0..5")
		}
		if item.FilterSamples < 0 || item.FilterSamples > 100 {
			addConfigErr(&errs, base+".filterSamples", "must be 0..100")
		}
		if item.SensorCal < -12.7 || item.SensorCal > 12.8 {
			addConfigErr(&errs, base+".sensorCal", "must be between -12.7 and 12.8")
		}
		if item.MathFunction < 0 || item.MathFunction > 3 {
			addConfigErr(&errs, base+".mathFunction", "must be 0..3")
		}
		if !validVirtualPointUnit(item.Unit) {
			addConfigErr(&errs, base+".unit", "must be empty, percent, degC, Pa, or ppm")
		}
		if item.Value != nil {
			if _, ok := normalizeVirtualPointValue(item.SignalType, item.Value); !ok {
				addConfigErr(&errs, base+".value", "must match signalType")
			}
		}
		if item.BoundPointID != "" {
			prefix, channel, ok := parsePointID(item.BoundPointID)
			switch {
			case !ok || (prefix != "AV" && prefix != "BV"):
				addConfigErr(&errs, base+".boundPointId", "must be AV-1..AV-32 or BV-1..BV-16")
			case prefix == "AV" && (channel < 1 || channel > kxNAV):
				addConfigErr(&errs, base+".boundPointId", fmt.Sprintf("AV channel must be 1..%d", kxNAV))
			case prefix == "BV" && (channel < 1 || channel > kxNBV):
				addConfigErr(&errs, base+".boundPointId", fmt.Sprintf("BV channel must be 1..%d", kxNBV))
			case prefix == "AV" && !virtualPointNumericSignalType(item.SignalType):
				addConfigErr(&errs, base+".boundPointId", "AV binding requires signalType integer or float")
			case prefix == "BV" && item.SignalType != virtualPointSignalBoolean:
				addConfigErr(&errs, base+".boundPointId", "BV binding requires signalType boolean")
			}
		}
		// `source` chỉ nhận hai giá trị. Một chuỗi lạ ở đây sẽ lặng lẽ rơi về
		// nhánh "web-api sở hữu" và ghi đè chương trình — nên nó phải là lỗi
		// cấu hình, không phải một mặc định êm ái.
		if item.Source != "" &&
			!strings.EqualFold(item.Source, virtualPointSourceProgram) &&
			!strings.EqualFold(item.Source, "WEB") {
			addConfigErr(&errs, base+".source", "must be WEB or PROGRAM")
		}
		// Sở hữu chỉ có nghĩa khi đã bind vào một slot Core.
		if strings.EqualFold(item.Source, virtualPointSourceProgram) && item.BoundPointID == "" {
			addConfigErr(&errs, base+".source", "PROGRAM requires boundPointId")
		}
	}
	boundOwner := make(map[string]string, len(cfg.Items))
	for i, item := range cfg.Items {
		if item.BoundPointID == "" || !item.Enabled {
			continue
		}
		key := canonicalBoundPointID(item.BoundPointID)
		if owner, taken := boundOwner[key]; taken && owner != item.ID {
			addConfigErr(&errs, fmt.Sprintf("items[%d].boundPointId", i), fmt.Sprintf("already bound to %s", owner))
		}
		boundOwner[key] = item.ID
	}
	if noLogCount > virtualPointNoLogCapacity {
		addConfigErr(&errs, "items", fmt.Sprintf("non-logged VP count must be <= %d", virtualPointNoLogCapacity))
	}
	for interval, maxCount := range virtualPointLogCapacities {
		if logCounts[interval] > maxCount {
			addConfigErr(&errs, "items", fmt.Sprintf("VP log %dms count must be <= %d", interval, maxCount))
		}
	}
	return errs
}

func defaultVirtualPoint() VirtualPoint {
	return VirtualPoint{
		SignalType:    virtualPointSignalFloat,
		Enabled:       true,
		Writable:      true,
		Value:         0,
		DisplayMax:    100,
		FilterSamples: 3,
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
}

func defaultVirtualPointsConfig() ConfigVirtualPoints {
	return ConfigVirtualPoints{Items: []VirtualPoint{}}
}

func normalizeVirtualPointsConfig(cfg ConfigVirtualPoints) ConfigVirtualPoints {
	if cfg.Items == nil {
		cfg.Items = []VirtualPoint{}
	}
	for i, item := range cfg.Items {
		cfg.Items[i] = normalizeVirtualPoint(item)
	}
	return cfg
}

func normalizeVirtualPoint(item VirtualPoint) VirtualPoint {
	item.ID = canonicalVirtualPointID(item.ID)
	item.Channel, _ = globalPointChannel(item.ID)
	if display, _, err := normalizePointTag(fallbackPointTag(item.Tag, item.ID)); err == nil {
		item.Tag = display
	}
	item.SignalType = strings.ToLower(strings.TrimSpace(item.SignalType))
	item.Label = ""
	item.Unit = normalizeVirtualPointUnit(item.Unit)
	item.Note = strings.TrimSpace(item.Note)
	if item.SignalType == "" {
		item.SignalType = virtualPointSignalFloat
	}
	if item.UpdatedAt == "" {
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	item.RetentionS = normalizeVirtualRetentionS(item)
	if item.Value != nil {
		if value, ok := normalizeVirtualPointValue(item.SignalType, item.Value); ok {
			item.Value = value
		}
	}
	if item.BoundPointID != "" {
		item.BoundPointID = canonicalBoundPointID(item.BoundPointID)
	}
	return item
}

// canonicalBoundPointID chuẩn hoá "av1"/"AV-1"/"av-01" về đúng một dạng
// "AV-01" để so khớp trùng lặp (boundOwner) ổn định bất kể người dùng gõ
// kiểu nào; đầu vào không hợp lệ trả nguyên bản (đã validate riêng ở
// validateConfigVirtualPoints, không cần chặn ở đây).
func canonicalBoundPointID(id string) string {
	prefix, channel, ok := parsePointID(id)
	if !ok {
		return strings.ToUpper(strings.TrimSpace(id))
	}
	return formatPointID(prefix, channel)
}

func normalizeVirtualPointUnit(unit string) string {
	switch strings.ToLower(strings.TrimSpace(unit)) {
	case "percent", "%", "%rh":
		return "percent"
	case "degc", "degf", "c", "f", "°c", "°f":
		return "degC"
	case "pa", "pascal", "pascals":
		return "Pa"
	case "ppm":
		return "ppm"
	default:
		return ""
	}
}

func validVirtualPointUnit(unit string) bool {
	switch unit {
	case "", "percent", "degC", "Pa", "ppm":
		return true
	default:
		return false
	}
}

// virtualPointDisplayRangeLimits trả biên hợp lệ cho displayMin/displayMax
// theo unit — trước đây dùng chung [-50,205] (khớp dải cảm biến nhiệt độ
// PT1000/NTC) cho MỌI unit kể cả Pa/ppm đã được validVirtualPointUnit cho
// phép, khiến không thể khai báo setpoint áp suất tĩnh (vd 250 Pa cho quạt
// AHU) hay CO2 (vd 1000+ ppm cho DCV) đúng thang hiển thị thật.
func virtualPointDisplayRangeLimits(unit string) (min float64, max float64) {
	switch unit {
	case "Pa":
		return -50, 2000
	case "ppm":
		return 0, 5000
	default:
		return -50, 205
	}
}

func canonicalVirtualPointID(id string) string {
	prefix, channel, ok := parsePointID(id)
	if !ok || !virtualPointIDPrefix(prefix) {
		return strings.ToUpper(strings.TrimSpace(id))
	}
	return formatVirtualPointID(channel)
}

func formatVirtualPointID(channel int) string {
	return fmt.Sprintf("VP%d", channel)
}

func validVirtualPointID(id string) bool {
	prefix, channel, ok := parsePointID(id)
	return ok && prefix == "VP" && channel >= 1 && channel <= virtualPointTotalCapacity
}

func virtualPointIDPrefix(prefix string) bool {
	return prefix == "VP" || prefix == "AV"
}

func virtualPointChannel(id string) (int, bool) {
	prefix, channel, ok := parsePointID(id)
	return channel, ok && virtualPointIDPrefix(prefix) && channel >= 1 && channel <= virtualPointTotalCapacity
}

func virtualPointIndex(items []VirtualPoint, id string) int {
	for i, item := range items {
		if canonicalVirtualPointID(item.ID) == id {
			return i
		}
	}
	return -1
}

func nextVirtualPointID(items []VirtualPoint) string {
	used := make(map[int]bool, len(items))
	for _, item := range items {
		if channel, ok := virtualPointChannel(item.ID); ok {
			used[channel] = true
		}
	}
	for channel := 1; channel <= virtualPointTotalCapacity; channel++ {
		if !used[channel] {
			return formatVirtualPointID(channel)
		}
	}
	return ""
}

func validVirtualPointSignalType(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case virtualPointSignalBoolean, virtualPointSignalInteger, virtualPointSignalFloat, virtualPointSignalString, virtualPointSignalDateTime:
		return true
	default:
		return false
	}
}

func virtualPointLoggableSignalType(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case virtualPointSignalBoolean, virtualPointSignalInteger, virtualPointSignalFloat:
		return true
	default:
		return false
	}
}

func virtualPointNumericSignalType(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case virtualPointSignalInteger, virtualPointSignalFloat:
		return true
	default:
		return false
	}
}

func virtualPointTrendVisible(item VirtualPoint) bool {
	item = normalizeVirtualPoint(item)
	return item.Enabled && item.LogEnabled && item.LogIntervalMs != nil && virtualPointLoggableSignalType(item.SignalType)
}

func normalizeVirtualRetentionS(item VirtualPoint) int {
	if !item.LogEnabled {
		return 0
	}
	if item.RetentionS > 0 {
		return item.RetentionS
	}
	if item.LogIntervalMs == nil {
		return 0
	}
	switch *item.LogIntervalMs {
	case 10:
		return 60 * 60
	case 100:
		return 7 * 24 * 60 * 60
	case 1000:
		return 30 * 24 * 60 * 60
	default:
		return 0
	}
}

func normalizeVirtualPointValue(signalType string, value any) (any, bool) {
	switch signalType {
	case virtualPointSignalBoolean:
		switch typed := value.(type) {
		case bool:
			return typed, true
		case string:
			text := strings.ToLower(strings.TrimSpace(typed))
			if text == "true" || text == "1" || text == "on" {
				return true, true
			}
			if text == "false" || text == "0" || text == "off" {
				return false, true
			}
		case json.Number:
			i, err := typed.Int64()
			if err == nil && (i == 0 || i == 1) {
				return i == 1, true
			}
		}
	case virtualPointSignalInteger:
		if n, ok := virtualPointNumber(value); ok && n == float64(int64(n)) {
			return int64(n), true
		}
	case virtualPointSignalFloat:
		if n, ok := virtualPointNumber(value); ok {
			return n, true
		}
	case virtualPointSignalString:
		if value == nil {
			return "", true
		}
		return fmt.Sprint(value), true
	case virtualPointSignalDateTime:
		text := strings.TrimSpace(fmt.Sprint(value))
		if _, err := time.Parse(time.RFC3339, text); err == nil {
			return text, true
		}
		if _, err := time.Parse(time.RFC3339Nano, text); err == nil {
			return text, true
		}
	}
	return nil, false
}

func virtualPointNumber(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		n, err := typed.Float64()
		return n, err == nil
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case int32:
		return float64(typed), true
	default:
		return 0, false
	}
}

func virtualPointDTO(item VirtualPoint) PointDTO {
	item = normalizeVirtualPoint(item)
	value := item.Value
	if value == nil {
		value = defaultVirtualPointValue(item.SignalType)
	}
	tag := fallbackPointTag(item.Tag, item.ID)
	readWrite := "read"
	if item.Writable {
		readWrite = "read_write"
	}
	dataType := map[string]string{
		virtualPointSignalBoolean: "bool", virtualPointSignalInteger: "int32",
		virtualPointSignalFloat: "float32", virtualPointSignalString: "string",
		virtualPointSignalDateTime: "datetime",
	}[item.SignalType]
	defaultValue := defaultVirtualPointValue(item.SignalType)
	dto := PointDTO{
		ID:            item.ID,
		Channel:       item.Channel,
		Tag:           tag,
		Name:          tag,
		Kind:          "virtual",
		Value:         value,
		Unit:          item.Unit,
		Quality:       "good",
		Source:        "virtual_point",
		Priority:      "Virtual Point",
		UpdatedAt:     item.UpdatedAt,
		SignalType:    item.SignalType,
		Writable:      item.Writable,
		LogEnabled:    item.LogEnabled,
		LogIntervalMs: item.LogIntervalMs,
		BoundPointID:  item.BoundPointID,
		Equipment:     normalizeEquipmentTag(item.Equipment),
		Note:          item.Note,
		Enabled:       item.Enabled,
		PointID:       item.ID,
		TagName:       tag,
		DisplayName:   tag,
		DataType:      dataType,
		Timestamp:     item.UpdatedAt,
		ReadWrite:     readWrite,
		DefaultValue:  defaultValue,
		SafeValue:     defaultValue,
	}
	dto.VirtualSource = item.Source
	return dto
}

func defaultVirtualPointValue(signalType string) any {
	switch signalType {
	case virtualPointSignalBoolean:
		return false
	case virtualPointSignalInteger:
		return int64(0)
	case virtualPointSignalString, virtualPointSignalDateTime:
		return ""
	default:
		return float64(0)
	}
}

// normalizeVirtualPointKind: "AV" là tên cũ của điểm ảo, chuẩn hoá về "VP".
// Trước 2026-08-07 hàm này nằm trong scheduleapi.go; module lịch không còn dùng
// nó (core v3.1 ghi thẳng AV/BV/MSV), nhưng cấu hình cảnh báo thì vẫn.
func normalizeVirtualPointKind(kind string) string {
	kind = strings.ToUpper(strings.TrimSpace(kind))
	if kind == "AV" {
		return "VP"
	}
	return kind
}

// writeVirtualPointSlotError trả 400 kèm chi tiết khi lỗi là hết slot; trả
// `false` để nơi gọi xử lý như lỗi hệ thống trong mọi ca khác.
func writeVirtualPointSlotError(w http.ResponseWriter, err error) bool {
	var slotErr errVirtualPointSlotAllocation
	if !errors.As(err, &slotErr) {
		return false
	}
	writeValidationErrors(w, slotErr.details)
	return true
}
