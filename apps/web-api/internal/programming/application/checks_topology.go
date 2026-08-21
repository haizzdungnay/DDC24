package application

import (
	"encoding/json"
	"sort"

	"mkddc-web/internal/programming/domain"
)

// packageProgramTopology là một dòng topology cấp package: Program nào, chạy
// chu kỳ nào, và trạng thái mong muốn khi mới đưa vào.
type packageProgramTopology struct {
	ProgramID string `json:"programId"`
	Name      string `json:"name"`
	PeriodMs  int64  `json:"periodMs"`
	// DesiredEnabled LUÔN false cho Program mới (DDD §0/§4.3). Package không
	// được tự bật thứ vừa được nạp: bật là một quyết định vận hành riêng, có
	// audit riêng, và người vận hành phải thấy nó trước khi nó chạy.
	DesiredEnabled bool `json:"desiredEnabled"`
}

type packagePeriodBudget struct {
	PeriodMs     int64 `json:"periodMs"`
	ProgramCount int   `json:"programCount"`
}

type packageBudget struct {
	MaxProgramsTotal     int                   `json:"maxProgramsTotal"`
	MaxProgramsEnabled   int                   `json:"maxProgramsEnabled"`
	MaxTaskBudgetPercent int                   `json:"maxTaskBudgetPercent"`
	Periods              []packagePeriodBudget `json:"periods"`
}

// packageTopology dựng topology TẤT ĐỊNH từ các POU kind PROGRAM.
//
// Sắp theo `programId`, KHÔNG theo thứ tự xuất hiện trong tài liệu: thứ tự tạo
// là dữ liệu của quá khứ, không phải của package. Nếu manifest bám thứ tự tạo
// thì hai Project có cùng nội dung nhưng dựng theo thứ tự khác nhau sẽ cho hai
// package khác nhau — và mọi so sánh provenance mất nghĩa.
func packageTopology(objects []revisionObjectView) ([]packageProgramTopology, packageBudget) {
	topology := make([]packageProgramTopology, 0, len(objects))
	for _, object := range objects {
		if object.Kind != "PROGRAM" {
			continue
		}
		var payload struct {
			ObjectID string `json:"objectId"`
			Name     string `json:"name"`
			Config   struct {
				ProgramID string  `json:"programId"`
				PeriodMs  float64 `json:"periodMs"`
			} `json:"programConfig"`
		}
		if json.Unmarshal(object.Payload, &payload) != nil {
			continue
		}
		programID := payload.Config.ProgramID
		if programID == "" {
			programID = object.ObjectID
		}
		period := int64(payload.Config.PeriodMs)
		if period == 0 {
			period = domain.AllowedPeriodMs[0]
		}
		topology = append(topology, packageProgramTopology{
			ProgramID: programID, Name: payload.Name, PeriodMs: period, DesiredEnabled: false})
	}
	sort.Slice(topology, func(left, right int) bool { return topology[left].ProgramID < topology[right].ProgramID })

	counts := make(map[int64]int, len(domain.AllowedPeriodMs))
	for _, item := range topology {
		counts[item.PeriodMs]++
	}
	periods := make([]packagePeriodBudget, 0, len(domain.AllowedPeriodMs))
	for _, period := range domain.AllowedPeriodMs {
		periods = append(periods, packagePeriodBudget{PeriodMs: period, ProgramCount: counts[period]})
	}
	budget := packageBudget{
		MaxProgramsTotal:     domain.MaxProgramsTotal,
		MaxProgramsEnabled:   domain.MaxProgramsEnabled,
		MaxTaskBudgetPercent: domain.MaxTaskBudgetPercent,
		Periods:              periods,
	}
	return topology, budget
}

// packageTopologyDiagnostics kiểm trần cấp package ở Check.
//
// Trần 32 đã được ép ở Draft (`T59-301`), nhưng một Revision có thể tới từ bundle
// import hoặc từ một Draft cũ hơn — Check là biên cuối trước khi package thành
// artifact, nên nó phải tự kiểm chứ không tin lớp trước.
func packageTopologyDiagnostics(topology []packageProgramTopology) []DiagnosticView {
	diagnostics := make([]DiagnosticView, 0)
	if len(topology) > domain.MaxProgramsTotal {
		diagnostics = append(diagnostics, programLimitDiagnostic(len(topology), domain.MaxProgramsTotal))
	}
	allowed := make(map[int64]struct{}, len(domain.AllowedPeriodMs))
	for _, period := range domain.AllowedPeriodMs {
		allowed[period] = struct{}{}
	}
	for _, item := range topology {
		if _, ok := allowed[item.PeriodMs]; !ok {
			// Chu kỳ ngoài ba lớp của profile nghĩa là một lớp lập lịch không tồn
			// tại; chấp nhận nó ở đây sẽ đẩy lỗi xuống runtime.
			diagnostics = append(diagnostics, packageDiagnostic("ST-LIM-009",
				map[string]any{"programId": item.ProgramID},
				map[string]any{"actual": int(item.PeriodMs), "limit": int(domain.AllowedPeriodMs[len(domain.AllowedPeriodMs)-1])}))
		}
		if item.DesiredEnabled {
			// Không có đường nào đặt cờ này true ở đây; kiểm vẫn giữ vì nó là
			// bất biến an toàn: một package tự bật Program là một package tự
			// triển khai chính nó.
			diagnostics = append(diagnostics, packageDiagnostic("ST-POU-004",
				map[string]any{"programId": item.ProgramID}, nil))
		}
	}
	return diagnostics
}
