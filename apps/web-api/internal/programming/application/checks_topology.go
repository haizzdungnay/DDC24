package application

import (
	"encoding/json"
	"sort"

	"mkddc-web/internal/programming/domain"
)

// packageProgramTopology là một dòng topology cấp package: Program nào, chạy
// chu kỳ nào, ở vị trí nào trong package, với ngân sách nào, và trạng thái mong
// muốn khi mới đưa vào.
type packageProgramTopology struct {
	// ObjectID là identity mà MỌI lớp phía sau dùng: `compilerInputs` sắp theo
	// nó, `SourceID` của compiler là nó, và tên Program trong `PROGRAM_TABLE`
	// cũng là nó (`programPackageName`). Topology phải mang nó để việc tra chu
	// kỳ/ngân sách lúc đóng gói là một phép tra ĐÚNG KHOÁ — trước bản vá này
	// topology chỉ có `programId`, nên một Revision có `programConfig.programId`
	// khác `objectId` sẽ tra trượt và Program đi vào container với chu kỳ 0.
	ObjectID  string `json:"objectId"`
	ProgramID string `json:"programId"`
	Name      string `json:"name"`
	// Order là vị trí trong package, tính từ 0 theo `objectId`. Nó được GHI RA
	// chứ không để người đọc tự suy từ vị trí mảng: thứ tự là ngữ nghĩa của
	// container (`TestProcessPackagerOrderIsSemantic`), nên nó phải kiểm được
	// bằng một phép so trường chứ không bằng niềm tin vào thứ tự JSON.
	Order    int   `json:"order"`
	PeriodMs int64 `json:"periodMs"`
	// BudgetUs là ngân sách WCET một lần release, đơn vị µs (DDD §4.3). Đây là
	// TRẦN suy từ profile (`maxTaskBudgetPercent` của chu kỳ), KHÔNG phải số đo
	// WCET thật — `budget.source` nói rõ điều đó để không ai đọc nhầm nó thành
	// một phép đo.
	BudgetUs int64 `json:"budgetUs"`
	// DesiredEnabled LUÔN false cho Program mới (DDD §0/§4.3). Package không
	// được tự bật thứ vừa được nạp: bật là một quyết định vận hành riêng, có
	// audit riêng, và người vận hành phải thấy nó trước khi nó chạy.
	DesiredEnabled bool `json:"desiredEnabled"`
}

type packagePeriodBudget struct {
	PeriodMs     int64 `json:"periodMs"`
	ProgramCount int   `json:"programCount"`
	// BudgetUs là trần µs cho MỘT Program của lớp chu kỳ này.
	BudgetUs int64 `json:"budgetUs"`
}

type packageBudget struct {
	MaxProgramsTotal     int `json:"maxProgramsTotal"`
	MaxProgramsEnabled   int `json:"maxProgramsEnabled"`
	MaxTaskBudgetPercent int `json:"maxTaskBudgetPercent"`
	// Source nói ngân sách tới TỪ ĐÂU. Một con số không có nguồn gốc sẽ bị đọc
	// như một phép đo, và một trần profile bị hiểu nhầm là WCET đo được là đúng
	// loại nhầm lẫn dẫn tới ký release trên bằng chứng không tồn tại.
	Source  string                `json:"source"`
	Periods []packagePeriodBudget `json:"periods"`
}

// budgetSourceProfileCeiling — ngân sách suy từ trần profile, chưa có số đo WCET
// thật trên phần cứng. Đo thật thuộc `T59-702`/`T59-703` (target).
const budgetSourceProfileCeiling = "PROFILE_CEILING"

// programBudgetUs suy trần WCET của một chu kỳ: `maxTaskBudgetPercent`% của chu
// kỳ, quy sang µs. Chu kỳ ngoài ba lớp profile trả 0 — caller đã có
// `packageTopologyDiagnostics` để từ chối nó, và trả một con số cho dữ liệu sai
// là hợp thức hoá dữ liệu sai.
func programBudgetUs(periodMs int64) int64 {
	if periodMs <= 0 {
		return 0
	}
	return periodMs * 1000 * int64(domain.MaxTaskBudgetPercent) / 100
}

// packageTopology dựng topology TẤT ĐỊNH từ các POU kind PROGRAM.
//
// Sắp theo `objectId`, KHÔNG theo thứ tự xuất hiện trong tài liệu: thứ tự tạo
// là dữ liệu của quá khứ, không phải của package. Nếu manifest bám thứ tự tạo
// thì hai Project có cùng nội dung nhưng dựng theo thứ tự khác nhau sẽ cho hai
// package khác nhau — và mọi so sánh provenance mất nghĩa.
//
// Khoá sắp xếp là `objectId` chứ không phải `programId` vì `compilerInputs` sắp
// theo `objectId`: hai khoá khác nhau nghĩa là hai thứ tự khác nhau, và khi đó
// `order` mà manifest công bố không còn là thứ tự Program nằm trong container.
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
			ObjectID: object.ObjectID, ProgramID: programID, Name: payload.Name,
			PeriodMs: period, BudgetUs: programBudgetUs(period), DesiredEnabled: false})
	}
	sort.Slice(topology, func(left, right int) bool { return topology[left].ObjectID < topology[right].ObjectID })
	for index := range topology {
		topology[index].Order = index
	}

	counts := make(map[int64]int, len(domain.AllowedPeriodMs))
	for _, item := range topology {
		counts[item.PeriodMs]++
	}
	periods := make([]packagePeriodBudget, 0, len(domain.AllowedPeriodMs))
	for _, period := range domain.AllowedPeriodMs {
		periods = append(periods, packagePeriodBudget{PeriodMs: period, ProgramCount: counts[period],
			BudgetUs: programBudgetUs(period)})
	}
	budget := packageBudget{
		MaxProgramsTotal:     domain.MaxProgramsTotal,
		MaxProgramsEnabled:   domain.MaxProgramsEnabled,
		MaxTaskBudgetPercent: domain.MaxTaskBudgetPercent,
		Source:               budgetSourceProfileCeiling,
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
			continue
		}
		// Ngân sách vượt trần `maxTaskBudgetPercent` của chu kỳ là một Program
		// được hứa nhiều thời gian hơn lớp lập lịch của nó có (DDD §4.3). Kiểm ở
		// đây chứ không chỉ ở validator manifest vì Check là chỗ người dùng đọc
		// được lý do; validator là lưới an toàn cho dữ liệu tới từ nơi khác.
		if item.BudgetUs <= 0 || item.BudgetUs > programBudgetUs(item.PeriodMs) {
			diagnostics = append(diagnostics, packageDiagnostic("ST-LIM-009",
				map[string]any{"programId": item.ProgramID},
				map[string]any{"actual": int(item.BudgetUs), "limit": int(programBudgetUs(item.PeriodMs))}))
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
