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
	// BudgetUs là ngân sách WCET một lần release, đơn vị µs (ADR-061 mục 4.3).
	// Đây là PHẦN CHIA của ngân sách một base step cho Program này theo kịch
	// bản xấu nhất (mọi Program release cùng một step), KHÔNG phải số đo WCET
	// thật — `budget.source` nói rõ điều đó để không ai đọc nhầm nó thành một
	// phép đo.
	BudgetUs int64 `json:"budgetUs"`
	// DesiredEnabled LUÔN false cho Program mới (DDD §0/§4.3). Package không
	// được tự bật thứ vừa được nạp: bật là một quyết định vận hành riêng, có
	// audit riêng, và người vận hành phải thấy nó trước khi nó chạy.
	DesiredEnabled bool `json:"desiredEnabled"`
}

type packagePeriodBudget struct {
	PeriodMs     int64 `json:"periodMs"`
	ProgramCount int   `json:"programCount"`
	// BudgetUs là trần µs cho MỘT Program của lớp chu kỳ này. Theo ADR-061 mục
	// 4.3 mọi lớp có cùng trần: ngân sách là của BASE STEP, không của chu kỳ.
	BudgetUs int64 `json:"budgetUs"`
}

type packageBudget struct {
	MaxProgramsTotal     int `json:"maxProgramsTotal"`
	MaxProgramsEnabled   int `json:"maxProgramsEnabled"`
	MaxTaskBudgetPercent int `json:"maxTaskBudgetPercent"`
	// Source nói ngân sách tới TỪ ĐÂU. Một con số không có nguồn gốc sẽ bị đọc
	// như một phép đo, và một trần profile bị hiểu nhầm là WCET đo được là đúng
	// loại nhầm lẫn dẫn tới ký release trên bằng chứng không tồn tại.
	Source string `json:"source"`
	// BaseStepMs là nhịp Core mà mọi Program release theo (ADR-061 C1).
	BaseStepMs int64 `json:"baseStepMs"`
	// StepBudgetUs là ngân sách MỘT base step: 20% base step = 2000 µs.
	StepBudgetUs int64 `json:"stepBudgetUs"`
	// WorstCaseStepUs là tổng `budgetUs` của mọi Program — kịch bản xấu nhất
	// khi mọi Program release cùng một step (t = siêu chu kỳ 50 s). Phải NHỎ
	// HƠN `stepBudgetUs`, cùng dấu `<` với Core (`budget·100 < period·20`).
	WorstCaseStepUs int64                 `json:"worstCaseStepUs"`
	Periods         []packagePeriodBudget `json:"periods"`
}

// budgetSourceProfileCeiling — ngân sách suy từ trần profile, chưa có số đo WCET
// thật trên phần cứng. Đo thật thuộc `T59-702`/`T59-703` (target).
const budgetSourceProfileCeiling = "PROFILE_CEILING"

// Mô hình ngân sách ADR-061 mục 4.3.
//
// Trước ADR-061 mỗi Program được cấp 20% CHU KỲ CỦA NÓ, trong khi Core chỉ đo
// cả Task ở mỗi base step. Với tập chu kỳ mới, tại t = 50 s mọi Program cùng
// release và tổng ngân sách kiểu cũ lên tới hàng giây — gấp hàng trăm lần một
// base step 10 ms (X4). Ngân sách vì vậy thuộc về BASE STEP: tổng WCET của mọi
// Program release trong một step phải nằm trong 20% của step đó.
const (
	// baseStepMs là base step Core (ADR-061 C1), bằng chu kỳ nhỏ nhất của tập
	// — `TestBaseStepIsFastestPeriodClass` canh hai con số không rời nhau.
	baseStepMs = 10
	// stepBudgetUs = 20% × 10 ms = 2000 µs.
	stepBudgetUs = baseStepMs * 1000 * domain.MaxTaskBudgetPercent / 100
	// detailCodeScheduleOutOfSet là mã chẩn đoán riêng của C1 (ADR-061 mục
	// 4.12): chu kỳ ngoài tập cho phép. Không dùng lại `ST-LIM-009` — mã đó nói
	// "quá nhiều Program", và người đọc sẽ đi sửa sai chỗ.
	detailCodeScheduleOutOfSet = "ST-SCHED-001"
)

// programBudgetUs chia ngân sách một base step cho `programCount` Program theo
// kịch bản xấu nhất. Tổng các phần phải NHỎ HƠN `stepBudgetUs` (cùng dấu `<`
// với Core), nên phần chia lấy từ `stepBudgetUs - 1`: với một Program là
// 1999 µs, với 32 Program là 62 µs. `programCount <= 0` trả 0 — không có
// Program nào để cấp.
func programBudgetUs(programCount int) int64 {
	if programCount <= 0 {
		return 0
	}
	return (stepBudgetUs - 1) / int64(programCount)
}

// allowedPeriodClass trả true khi chu kỳ thuộc ĐÚNG tập của profile (C1).
func allowedPeriodClass(periodMs int64) bool {
	for _, period := range domain.AllowedPeriodMs {
		if period == periodMs {
			return true
		}
	}
	return false
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
func packageTopology(documentSchemaVersion int, objects []revisionObjectView) ([]packageProgramTopology, packageBudget) {
	legacyPeriodMs := int64(0)
	if documentSchemaVersion == 1 {
		legacyPeriodMs = legacyTaskPeriodMs(objects)
	}
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
		// Revision schema v1 đặt chu kỳ ở TASK chung; schema v2 đặt chu kỳ ở
		// `programConfig` của từng PROGRAM. Phân nhánh bằng schema đã seal, không
		// suy đoán theo field đang có: nếu v2 thiếu config thì phải giữ 0 để
		// ST-POU-005 chặn, không được nhặt TASK legacy rồi hợp thức hoá ghost POU.
		period := legacyPeriodMs
		if documentSchemaVersion == 2 {
			period = int64(payload.Config.PeriodMs)
		}
		topology = append(topology, packageProgramTopology{
			ObjectID: object.ObjectID, ProgramID: programID, Name: payload.Name,
			PeriodMs: period, DesiredEnabled: false})
	}
	sort.Slice(topology, func(left, right int) bool { return topology[left].ObjectID < topology[right].ObjectID })
	// Phần chia chỉ tính trên Program ĐÃ schedule: Program chu kỳ 0 bị
	// `ST-POU-005` chặn, và cấp ngân sách cho nó là hợp thức hoá một ghost POU.
	scheduled := 0
	for _, item := range topology {
		if item.PeriodMs > 0 {
			scheduled++
		}
	}
	share := programBudgetUs(scheduled)
	worstCase := int64(0)
	for index := range topology {
		topology[index].Order = index
		if topology[index].PeriodMs > 0 {
			topology[index].BudgetUs = share
			worstCase += share
		}
	}

	counts := make(map[int64]int, len(domain.AllowedPeriodMs))
	for _, item := range topology {
		counts[item.PeriodMs]++
	}
	periods := make([]packagePeriodBudget, 0, len(domain.AllowedPeriodMs))
	for _, period := range domain.AllowedPeriodMs {
		periods = append(periods, packagePeriodBudget{PeriodMs: period, ProgramCount: counts[period],
			BudgetUs: share})
	}
	budget := packageBudget{
		MaxProgramsTotal:     domain.MaxProgramsTotal,
		MaxProgramsEnabled:   domain.MaxProgramsEnabled,
		MaxTaskBudgetPercent: domain.MaxTaskBudgetPercent,
		Source:               budgetSourceProfileCeiling,
		BaseStepMs:           baseStepMs,
		StepBudgetUs:         stepBudgetUs,
		WorstCaseStepUs:      worstCase,
		Periods:              periods,
	}
	return topology, budget
}

// legacyTaskPeriodMs đọc đúng mô hình Revision schema v1: một TASK chung mang
// chu kỳ của mọi PROGRAM. Thiếu, hỏng hoặc có nhiều TASK đều trả 0 để diagnostic
// fail-closed; hàm không tạo chu kỳ mặc định và không được dùng cho schema v2.
func legacyTaskPeriodMs(objects []revisionObjectView) int64 {
	periodMs := int64(0)
	found := false
	for _, object := range objects {
		if object.Kind != "TASK" {
			continue
		}
		if found {
			return 0
		}
		found = true
		var payload struct {
			PeriodMs int64 `json:"periodMs"`
		}
		if json.Unmarshal(object.Payload, &payload) != nil {
			return 0
		}
		periodMs = payload.PeriodMs
	}
	return periodMs
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
	scheduled := 0
	for _, item := range topology {
		if item.PeriodMs > 0 {
			scheduled++
		}
	}
	share := programBudgetUs(scheduled)
	worstCase := int64(0)
	for _, item := range topology {
		if item.PeriodMs == 0 {
			diagnostics = append(diagnostics, packageDiagnostic("ST-POU-005",
				map[string]any{"programId": item.ProgramID}, nil))
			continue
		}
		worstCase += item.BudgetUs
		if !allowedPeriodClass(item.PeriodMs) {
			// C1 (ADR-061): chu kỳ ngoài tập nghĩa là một lớp lập lịch không tồn
			// tại; chấp nhận nó ở đây sẽ đẩy lỗi xuống runtime. Revision cũ mang
			// 30000 ms (profile 2.1) rơi đúng vào nhánh này khi Check LẠI — còn
			// Restore dùng artifact đã PASSED nên không đi qua đây.
			diagnostics = append(diagnostics, packageDiagnostic(detailCodeScheduleOutOfSet,
				map[string]any{"programId": item.ProgramID},
				map[string]any{"profile": checkTargetProfile}))
			continue
		}
		// Phần chia vượt trần là một Program được hứa nhiều thời gian hơn base
		// step có (ADR-061 mục 4.3). Kiểm ở đây chứ không chỉ ở validator
		// manifest vì Check là chỗ người dùng đọc được lý do; validator là lưới
		// an toàn cho dữ liệu tới từ nơi khác.
		if item.BudgetUs <= 0 || item.BudgetUs > share {
			diagnostics = append(diagnostics, packageDiagnostic("ST-LIM-009",
				map[string]any{"programId": item.ProgramID},
				map[string]any{"actual": int(item.BudgetUs), "limit": int(share)}))
		}
		if item.DesiredEnabled {
			// Không có đường nào đặt cờ này true ở đây; kiểm vẫn giữ vì nó là
			// bất biến an toàn: một package tự bật Program là một package tự
			// triển khai chính nó.
			diagnostics = append(diagnostics, packageDiagnostic("ST-POU-004",
				map[string]any{"programId": item.ProgramID}, nil))
		}
	}
	// Kịch bản xấu nhất: mọi Program release cùng một base step. Tổng phải NHỎ
	// HƠN ngân sách step — cùng dấu `<` với Core (X5), để không có package nào
	// Go cho qua mà Core từ chối ở lúc nạp.
	if worstCase >= stepBudgetUs {
		diagnostics = append(diagnostics, packageDiagnostic("ST-LIM-009",
			map[string]any{},
			map[string]any{"actual": int(worstCase), "limit": int(stepBudgetUs - 1)}))
	}
	return diagnostics
}
