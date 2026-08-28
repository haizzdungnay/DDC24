package app

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"strings"
	"time"

	webPoints "mkddc-web/internal/points"
)

func canonicalPointMetadataValue(field, value string) string {
	if field == "tag" {
		if display, _, err := normalizePointTag(value); err == nil {
			return display
		}
	}
	if field == "name" {
		if display, _, err := normalizePointName(value); err == nil {
			return display
		}
	}
	return strings.TrimSpace(value)
}

func (a *App) auditPointMetadataPatch(r *http.Request, pointID, oldTag, oldName string, patch PointConfigPatch, result string) {
	if a == nil || a.audit == nil {
		return
	}
	actor := "-"
	if principal := principalFromContext(r.Context()); principal != nil {
		actor = principal.Username
	}
	requestID := r.Header.Get("X-Request-ID")
	if requestID == "" {
		requestID = "-"
	}
	if patch.Tag != nil {
		a.audit.PointMetadata(actor, pointID, "tag", canonicalPointMetadataValue("tag", oldTag), canonicalPointMetadataValue("tag", *patch.Tag), result, requestID, r.RemoteAddr)
	}
	if patch.Name != nil {
		a.audit.PointMetadata(actor, pointID, "name", canonicalPointMetadataValue("name", oldName), canonicalPointMetadataValue("name", *patch.Name), result, requestID, r.RemoteAddr)
	}
}

func (a *App) handlePutPointConfig(w http.ResponseWriter, r *http.Request) {
	a.pointConfigMu.Lock()
	defer a.pointConfigMu.Unlock()

	rawID := r.PathValue("id")
	id, ok := canonicalPointConfigID(rawID)
	if !ok {
		writeError(w, http.StatusBadRequest, "point config requires canonical point id")
		return
	}
	var patch PointConfigPatch
	if err := decodeConfigBody(w, r, &patch); err != nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: err.Error()}})
		return
	}
	if patch.Tag == nil && patch.Name == nil && patch.Unit == nil && patch.TrendEnabled == nil && patch.Equipment == nil {
		writeValidationErrors(w, []configValidationError{{Path: "$", Message: "tag, name, unit, trendEnabled hoặc equipment là bắt buộc"}})
		return
	}
	// `ADR-042`: chuẩn hoá và giới hạn ngay tại cửa. Thẻ dài vô hạn sẽ phá bố
	// cục nhóm trên Monitor, và khoảng trắng thừa sẽ đẻ ra hai nhóm cho cùng
	// một thiết bị.
	if patch.Equipment != nil {
		normalized := normalizeEquipmentTag(*patch.Equipment)
		if len([]byte(normalized)) > equipmentTagMaxBytes {
			writeValidationErrors(w, []configValidationError{{Path: "equipment", Message: fmt.Sprintf("tối đa %d byte", equipmentTagMaxBytes)}})
			return
		}
		patch.Equipment = &normalized
	}
	if patch.Tag != nil && !strings.HasPrefix(id, "VP") {
		writePointTagErrors(w, []configValidationError{{Path: "tag", Message: "physical point tag is fixed", Reason: "physical_point_tag_fixed", PointID: id, Tag: *patch.Tag}})
		return
	}
	ioCfg, err := readConfig(a, configGroupIO, ConfigIO{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	vpCfg, err := readConfig(a, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	beforeIO := clonePointIOConfig(ioCfg)
	beforeVP := clonePointVirtualConfig(vpCfg)

	if index := virtualPointIndex(vpCfg.Items, canonicalVirtualPointID(id)); index >= 0 {
		oldTag, oldName := vpCfg.Items[index].Tag, vpCfg.Items[index].Label
		if patch.Tag != nil {
			vpCfg.Items[index].Tag = *patch.Tag
		}
		if patch.Name != nil {
			vpCfg.Items[index].Label = *patch.Name
		}
		if patch.Unit != nil {
			vpCfg.Items[index].Unit = strings.TrimSpace(*patch.Unit)
		}
		if patch.TrendEnabled != nil {
			vpCfg.Items[index].LogEnabled = *patch.TrendEnabled
		}
		if patch.Equipment != nil {
			vpCfg.Items[index].Equipment = *patch.Equipment
		}
		if errs := append(validateConfigVirtualPoints(vpCfg), validateVirtualPointMetadata(vpCfg)...); len(errs) > 0 {
			a.auditPointMetadataPatch(r, id, oldTag, oldName, patch, "rejected")
			writePointTagErrors(w, errs)
			return
		}
		vpCfg = normalizeVirtualPointsConfig(vpCfg)
		if errs := validatePointNamespaceTransitionWithOptions(beforeIO, beforeVP, ioCfg, vpCfg, pointNamespaceTransitionOptions{Operation: pointNamespaceOperationSingleNamePatch, PointID: id, NameOnly: pointMetadataPatchIsNameOnly(patch, oldTag)}); len(errs) > 0 {
			a.auditPointMetadataPatch(r, id, oldTag, oldName, patch, "rejected")
			writePointTagErrors(w, errs)
			return
		}
		if err := a.writeVirtualPointsConfig(r, vpCfg, "metadata"); err != nil {
			a.auditPointMetadataPatch(r, id, oldTag, oldName, patch, "rejected")
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		a.auditPointMetadataPatch(r, id, oldTag, oldName, patch, "accepted")
		writeJSON(w, http.StatusOK, virtualPointDTO(vpCfg.Items[index]))
		return
	}

	prefix, channel, ok := parsePointID(id)
	if !ok {
		writeError(w, http.StatusNotFound, "point not found")
		return
	}
	var rows []map[string]any
	switch prefix {
	case "UI":
		rows = ioCfg.UI
	case "AO":
		rows = ioCfg.AO
	case "DO":
		rows = ioCfg.DO
	default:
		writeError(w, http.StatusNotFound, "point not found")
		return
	}
	index := configRowIndex(rows, channel)
	if index < 0 {
		writeError(w, http.StatusNotFound, "point not found")
		return
	}
	oldTag, _, _ := stringField(rows[index], "tag")
	oldName, _, _ := stringField(rows[index], "name")
	next := make(map[string]any, len(rows[index])+2)
	maps.Copy(next, rows[index])
	if patch.Tag != nil {
		next["tag"] = *patch.Tag
	}
	if patch.Name != nil {
		next["name"] = strings.TrimSpace(*patch.Name)
	}
	if patch.Unit != nil {
		next["display_unit"] = strings.TrimSpace(*patch.Unit)
	}
	if patch.TrendEnabled != nil {
		next["trend_enabled"] = *patch.TrendEnabled
	}
	if patch.Equipment != nil {
		if *patch.Equipment == "" {
			delete(next, "equipment")
		} else {
			next["equipment"] = *patch.Equipment
		}
	}
	rows[index] = next
	switch prefix {
	case "UI":
		ioCfg.UI = rows
	case "AO":
		ioCfg.AO = rows
	case "DO":
		ioCfg.DO = rows
	}
	if errs := append(validateConfigIO(ioCfg), validateConfigPointMetadata(ioCfg)...); len(errs) > 0 {
		a.auditPointMetadataPatch(r, id, oldTag, oldName, patch, "rejected")
		writePointTagErrors(w, errs)
		return
	}
	ioCfg, _ = normalizePointTags(ioCfg, ConfigVirtualPoints{})
	if errs := validatePointNamespaceTransitionWithOptions(beforeIO, beforeVP, ioCfg, vpCfg, pointNamespaceTransitionOptions{Operation: pointNamespaceOperationSingleNamePatch, PointID: id, NameOnly: pointMetadataPatchIsNameOnly(patch, oldTag)}); len(errs) > 0 {
		a.auditPointMetadataPatch(r, id, oldTag, oldName, patch, "rejected")
		writePointTagErrors(w, errs)
		return
	}
	safeCfg, safeErr := readConfig(a, configGroupSafeState, ConfigSafeState{})
	if safeErr != nil {
		writeError(w, http.StatusInternalServerError, safeErr.Error())
		return
	}
	if _, applyErrs, err := a.applyIOBundle(r, ioCfg, safeCfg, beforeIO.Revision); len(applyErrs) > 0 || err != nil {
		a.auditPointMetadataPatch(r, id, oldTag, oldName, patch, "rejected")
		if len(applyErrs) > 0 {
			writePointTagErrors(w, applyErrs)
		} else {
			writeError(w, http.StatusConflict, err.Error())
		}
		return
	}
	point := a.readPhysicalPointForConfig(r.Context(), id)
	point = a.overlayPointMetadata([]PointDTO{point})[0]
	a.auditPointMetadataPatch(r, id, oldTag, oldName, patch, "accepted")
	writeJSON(w, http.StatusOK, point)
}

func pointMetadataPatchIsNameOnly(patch PointConfigPatch, oldTag string) bool {
	if patch.Name == nil || patch.Unit != nil || patch.TrendEnabled != nil {
		return false
	}
	if patch.Tag == nil {
		return true
	}
	return canonicalPointMetadataValue("tag", oldTag) == canonicalPointMetadataValue("tag", *patch.Tag)
}

func canonicalPointConfigID(rawID string) (string, bool) {
	return webPoints.CanonicalConfigID(rawID, webPoints.Limits{UI: kxNUI, AO: kxNAO, DO: kxNDO, VP: virtualPointTotalCapacity})
}

func configRowIndex(rows []map[string]any, channel int) int {
	for index, row := range rows {
		value, ok, good := intField(row, "ch")
		if ok && good && value == channel {
			return index
		}
	}
	return -1
}

func (a *App) readPhysicalPointForConfig(ctx context.Context, id string) PointDTO {
	if reader, ok := a.core.(pointReader); ok {
		if points, err := reader.ReadPoints(ctx); err == nil {
			for _, point := range points {
				if canonicalPointID(point.ID) == id {
					return point
				}
			}
		}
	}
	prefix, channel, _ := parsePointID(id)
	value := any(float64(0))
	if prefix == "DO" {
		value = false
	}
	globalChannel, _ := globalPointChannel(id)
	return PointDTO{ID: id, Channel: globalChannel, Kind: prefix, Value: value, Quality: "good", Source: "config", UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano), Tag: id, Name: id, Priority: fmt.Sprintf("%s-%02d", prefix, channel)}
}

// ── Thẻ thiết bị công nghệ — `T57-3.1` (`ADR-042`) ─────────────────────────

// equipmentTagMaxBytes theo `ADR-042`: đủ cho "AHU-1 tầng 3", ngắn để nhãn nhóm
// trên Monitor còn đọc được ở một dòng.
const equipmentTagMaxBytes = 48

// normalizeEquipmentTag gom khoảng trắng và cắt hai đầu.
//
// Chuẩn hoá là điều kiện để NHÓM đúng: `AHU-1 ` và `AHU-1` phải rơi vào cùng
// một nhóm, nếu không màn hình sẽ có hai khối cùng tên và người đọc không có
// cách nào biết vì sao.
func normalizeEquipmentTag(raw string) string {
	return strings.Join(strings.Fields(raw), " ")
}
