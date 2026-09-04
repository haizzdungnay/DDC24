package app

import (
	"context"
	"strings"

	programmingapplication "mkddc-web/internal/programming/application"
)

/* ISS-PIO-28 — adapter cấp cấu hình Point ĐANG CHẠY cho lớp Check (đề bài §33).
 *
 * Đọc lại mỗi lần Check thay vì cache, cùng lý do đã ghi ở
 * `programmingModbusSlotAdapter`: cấu hình điểm chỉ có nghĩa so với bản đang
 * chạy, và một bản cache lại là một bản có thể cũ hơn thiết bị.
 *
 * Lỗi đọc cấu hình KHÔNG bị nuốt: nó đi ngược lên `RequestCheck` và làm Check
 * dừng có lý do. Trả về một ảnh chụp RỖNG khi đọc hỏng sẽ khiến mọi điểm hiện
 * thành "không có trong cấu hình" — một lời buộc tội sai, và người vận hành sẽ
 * đi sửa binding thay vì sửa cái đang thật sự hỏng.
 */
type programmingPointFactsAdapter struct{ app *App }

func (a *App) programmingPointFacts() programmingPointFactsAdapter {
	return programmingPointFactsAdapter{app: a}
}

func (adapter programmingPointFactsAdapter) ResolvePointBindingFacts(
	_ context.Context) (programmingapplication.PointBindingSnapshot, error) {
	snapshot := programmingapplication.PointBindingSnapshot{
		Local:   map[string]programmingapplication.LocalPointFacts{},
		Virtual: map[string]programmingapplication.VirtualPointFacts{},
	}
	ioCfg, err := readConfig(adapter.app, configGroupIO, ConfigIO{})
	if err != nil {
		return programmingapplication.PointBindingSnapshot{}, err
	}
	safeCfg, err := readConfig(adapter.app, configGroupSafeState, ConfigSafeState{})
	if err != nil {
		return programmingapplication.PointBindingSnapshot{}, err
	}
	safeDeclared := map[string]bool{}
	for _, group := range []struct {
		rows   []map[string]any
		prefix string
	}{{safeCfg.AO, "AO"}, {safeCfg.DO, "DO"}} {
		for _, row := range group.rows {
			channel, _, good := intField(row, "ch")
			if !good {
				continue
			}
			// Có HÀNG trong safe_state chưa đủ; phải có KHOÁ `safe`. Một hàng
			// trống là một lời hứa suông về chế độ an toàn.
			if _, present := row["safe"]; present {
				safeDeclared[formatPointID(group.prefix, channel)] = true
			}
		}
	}
	addRows := func(rows []map[string]any, prefix string) {
		for _, row := range rows {
			channel, _, good := intField(row, "ch")
			if !good {
				continue
			}
			id := formatPointID(prefix, channel)
			signalType, _, _ := stringField(row, "type")
			/* `enabled` VẮNG MẶT khác `enabled: false`: cấu hình đời cũ không
			 * có khoá này, và coi nó là "đã tắt" sẽ làm Check chặn mọi binding
			 * của một tủ đang chạy tốt. */
			enabled, present, _ := boolField(row, "enabled")
			snapshot.Local[id] = programmingapplication.LocalPointFacts{
				PointID:      id,
				Enabled:      !present || enabled,
				SignalType:   strings.TrimSpace(signalType),
				HasSafeValue: safeDeclared[id],
			}
		}
	}
	addRows(ioCfg.UI, "UI")
	addRows(ioCfg.AO, "AO")
	addRows(ioCfg.DO, "DO")

	vpCfg, err := readConfig(adapter.app, configGroupVirtualPoints, defaultVirtualPointsConfig())
	if err != nil {
		return programmingapplication.PointBindingSnapshot{}, err
	}
	for _, item := range normalizeVirtualPointsConfig(vpCfg).Items {
		facts := programmingapplication.VirtualPointFacts{
			PointID:       item.ID,
			Enabled:       item.Enabled,
			Writable:      item.Writable,
			SignalType:    item.SignalType,
			Source:        normalizeVirtualPointSource(item.Source),
			RestartPolicy: normalizeVirtualPointRestartPolicy(item.RestartPolicy),
			HasInitial:    item.InitialValue != nil,
			MinValue:      item.MinValue,
			MaxValue:      item.MaxValue,
		}
		snapshot.Virtual[strings.ToUpper(item.ID)] = facts
		/* Binding có thể mang mã slot (`AV-01`) thay vì mã điểm ảo (`VP1`):
		 * tab Ánh xạ phát mã slot cho category VP (`pointCatalogPointID`).
		 * Không đăng ký cả hai khoá thì mọi binding đi đường đó sẽ hiện thành
		 * "điểm ảo không tồn tại" — một lời buộc tội sai cho một binding đúng. */
		if item.BoundPointID != "" {
			snapshot.Virtual[strings.ToUpper(canonicalBoundPointID(item.BoundPointID))] = facts
		}
	}
	return snapshot, nil
}
