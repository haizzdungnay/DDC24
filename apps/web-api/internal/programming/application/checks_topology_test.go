package application

import (
	"encoding/json"
	"fmt"
	"testing"

	"mkddc-web/internal/programming/domain"
)

func programWithConfig(objectID, name string, periodMs int) revisionObjectView {
	return objectView("PROGRAM", objectID, map[string]any{
		"objectId": objectID, "kind": "PROGRAM", "name": name, "language": "ST",
		"programConfig": map[string]any{"programId": objectID, "objectId": objectID, "periodMs": periodMs},
	})
}

// Topology KHÔNG được bám thứ tự tạo. Hai Project cùng nội dung nhưng dựng theo
// thứ tự khác nhau phải cho ĐÚNG cùng một topology — nếu không, mọi so sánh
// provenance giữa hai controller đều mất nghĩa.
func TestPackageTopologyIsIndependentOfCreationOrder(t *testing.T) {
	forward := []revisionObjectView{
		programWithConfig("a1111111-1111-4111-8111-111111111111", "AHU", 1000),
		programWithConfig("b2222222-2222-4222-8222-222222222222", "BOILER", 5000),
		programWithConfig("c3333333-3333-4333-8333-333333333333", "CHILLER", 50000),
	}
	reverse := []revisionObjectView{forward[2], forward[0], forward[1]}

	first, firstBudget := packageTopology(2, forward)
	second, secondBudget := packageTopology(2, reverse)
	firstJSON, _ := json.Marshal(struct {
		Topology []packageProgramTopology
		Budget   packageBudget
	}{first, firstBudget})
	secondJSON, _ := json.Marshal(struct {
		Topology []packageProgramTopology
		Budget   packageBudget
	}{second, secondBudget})
	if string(firstJSON) != string(secondJSON) {
		t.Fatalf("topology phụ thuộc thứ tự tạo:\n%s\n%s", firstJSON, secondJSON)
	}
	if len(first) != 3 || first[0].Name != "AHU" {
		t.Fatalf("topology=%+v", first)
	}
}

// Program mới LUÔN Disabled: package không được tự bật thứ vừa được nạp. Bật là
// một quyết định vận hành riêng, có audit riêng.
func TestPackageTopologyKeepsNewProgramsDisabled(t *testing.T) {
	topology, budget := packageTopology(2, []revisionObjectView{
		programWithConfig("a1111111-1111-4111-8111-111111111111", "AHU", 1000),
	})
	if len(topology) != 1 || topology[0].DesiredEnabled {
		t.Fatalf("Program mới không được bật sẵn: %+v", topology)
	}
	if budget.MaxProgramsEnabled != domain.MaxProgramsEnabled || budget.MaxProgramsTotal != domain.MaxProgramsTotal {
		t.Fatalf("budget=%+v", budget)
	}
	if len(budget.Periods) != len(domain.AllowedPeriodMs) {
		t.Fatalf("thiếu lớp chu kỳ: %+v", budget.Periods)
	}
	if diagnostics := packageTopologyDiagnostics(topology); len(diagnostics) != 0 {
		t.Fatalf("topology hợp lệ bị từ chối: %+v", diagnostics)
	}
}

// Trần 32 phải được ép LẠI ở Check: một Revision có thể tới từ bundle import
// hoặc từ Draft cũ hơn, nên Check không được tin lớp trước.
func TestPackageTopologyEnforcesProgramCeilingOneOver(t *testing.T) {
	objects := make([]revisionObjectView, 0, domain.MaxProgramsTotal+1)
	for index := 0; index <= domain.MaxProgramsTotal; index++ {
		objects = append(objects, programWithConfig(
			fmt.Sprintf("9%07d-0000-4000-8000-%012d", index, index),
			fmt.Sprintf("PRG_%02d", index), 1000))
	}
	topology, _ := packageTopology(2, objects[:domain.MaxProgramsTotal])
	if diagnostics := packageTopologyDiagnostics(topology); len(diagnostics) != 0 {
		t.Fatalf("%d Program (đúng trần) bị từ chối: %+v", domain.MaxProgramsTotal, diagnostics)
	}

	overTopology, _ := packageTopology(2, objects)
	diagnostics := packageTopologyDiagnostics(overTopology)
	if len(diagnostics) != 1 || diagnostics[0].DetailCode != "ST-LIM-009" {
		t.Fatalf("một-trên-trần=%+v", diagnostics)
	}
	if limit, ok := diagnostics[0].Args["limit"].(int); !ok || limit != domain.MaxProgramsTotal {
		t.Fatalf("limit báo về=%v; want %d", diagnostics[0].Args["limit"], domain.MaxProgramsTotal)
	}
}

// Chu kỳ ngoài tập của profile là một lớp lập lịch KHÔNG tồn tại; chấp nhận nó
// ở Check sẽ đẩy lỗi xuống runtime. ADR-061 C1: 5 ms (nhanh hơn base step) và
// 30000 ms (lớp của profile 2.1, nay đã bỏ) đều phải bị từ chối bằng mã riêng
// `ST-SCHED-001` — không phải `ST-LIM-009` "quá nhiều Program" (mục 4.12).
func TestPackageTopologyRejectsPeriodOutsideProfileClasses(t *testing.T) {
	for _, period := range []int{5, 777, 30000, 60000} {
		t.Run(fmt.Sprintf("period_%d_ms", period), func(t *testing.T) {
			topology, _ := packageTopology(2, []revisionObjectView{
				programWithConfig("a1111111-1111-4111-8111-111111111111", "AHU", period),
			})
			diagnostics := packageTopologyDiagnostics(topology)
			if len(diagnostics) != 1 || diagnostics[0].DetailCode != "ST-SCHED-001" ||
				diagnostics[0].Code != "PRG-ERR-SCOPE-001" {
				t.Fatalf("chu kỳ lạ=%+v", diagnostics)
			}
			if got, _ := diagnostics[0].Location["programId"].(string); got != "a1111111-1111-4111-8111-111111111111" {
				t.Fatalf("diagnostic không trỏ đúng Program: %+v", diagnostics[0].Location)
			}
		})
	}
}

// Mọi chu kỳ của tập mới đều qua Check — kể cả hai đầu 10 ms và 50000 ms.
func TestPackageTopologyAcceptsEveryProfilePeriod(t *testing.T) {
	for index, period := range domain.AllowedPeriodMs {
		topology, _ := packageTopology(2, []revisionObjectView{
			programWithConfig(fmt.Sprintf("a%07d-1111-4111-8111-111111111111", index), "AHU", int(period)),
		})
		if diagnostics := packageTopologyDiagnostics(topology); len(diagnostics) != 0 {
			t.Fatalf("chu kỳ %d ms của profile bị từ chối: %+v", period, diagnostics)
		}
	}
}

// Base step Go dùng để tính ngân sách phải là chu kỳ nhỏ nhất của profile, và
// tập chu kỳ phải là một CHUỖI BỘI (mỗi chu kỳ chia hết chu kỳ kế) để "mọi
// Program release cùng một step" thật sự xảy ra ở siêu chu kỳ 50 s — tiền đề
// của phép ước lượng kịch bản xấu nhất (ADR-061 mục 1, 4.3).
func TestBaseStepIsFastestPeriodClass(t *testing.T) {
	if domain.AllowedPeriodMs[0] != baseStepMs {
		t.Fatalf("base step=%d nhưng chu kỳ nhỏ nhất=%d", baseStepMs, domain.AllowedPeriodMs[0])
	}
	for index := 1; index < len(domain.AllowedPeriodMs); index++ {
		if domain.AllowedPeriodMs[index]%domain.AllowedPeriodMs[index-1] != 0 {
			t.Fatalf("tập chu kỳ không phải chuỗi bội tại %d/%d",
				domain.AllowedPeriodMs[index], domain.AllowedPeriodMs[index-1])
		}
	}
	if stepBudgetUs != 2000 {
		t.Fatalf("ngân sách base step=%d µs; ADR-061 4.3 đòi 2000 µs", stepBudgetUs)
	}
}

// Mô hình ngân sách µs (ADR-061 mục 4.3): tổng xấu nhất của mọi Program phải
// NHỎ HƠN 2000 µs (cùng dấu `<` với Core), với mọi số Program từ 1 tới trần.
func TestProgramBudgetShareKeepsWorstCaseBelowStepBudget(t *testing.T) {
	if got := programBudgetUs(1); got != 1999 {
		t.Fatalf("một Program nhận %d µs; want 1999 (< 2000)", got)
	}
	if got := programBudgetUs(0); got != 0 {
		t.Fatalf("không Program nào vẫn được cấp %d µs", got)
	}
	for count := 1; count <= domain.MaxProgramsTotal; count++ {
		share := programBudgetUs(count)
		if share <= 0 || share*int64(count) >= stepBudgetUs {
			t.Fatalf("%d Program: phần chia %d µs, tổng %d µs không < %d", count, share,
				share*int64(count), stepBudgetUs)
		}
	}
}

// Kịch bản xấu nhất: mỗi chu kỳ một Program, tất cả release cùng lúc tại t = 50 s.
// Mô hình cũ cấp 20% chu kỳ cho TỪNG Program nên tổng ≈ 13,3 s (X4); mô hình mới
// phải giữ tổng dưới một base step budget và ghi nó vào `worstCaseStepUs`.
func TestPackageBudgetWorstCaseAllProgramsReleaseSameStep(t *testing.T) {
	objects := make([]revisionObjectView, 0, len(domain.AllowedPeriodMs))
	for index, period := range domain.AllowedPeriodMs {
		objects = append(objects, programWithConfig(
			fmt.Sprintf("b%07d-2222-4222-8222-222222222222", index), fmt.Sprintf("P%d", index), int(period)))
	}
	topology, budget := packageTopology(2, objects)
	if diagnostics := packageTopologyDiagnostics(topology); len(diagnostics) != 0 {
		t.Fatalf("8 lớp chu kỳ hợp lệ bị từ chối: %+v", diagnostics)
	}
	sum := int64(0)
	for _, item := range topology {
		sum += item.BudgetUs
	}
	if budget.BaseStepMs != 10 || budget.StepBudgetUs != 2000 || budget.WorstCaseStepUs != sum ||
		sum >= budget.StepBudgetUs || sum != programBudgetUs(len(objects))*int64(len(objects)) {
		t.Fatalf("budget=%+v tổng=%d", budget, sum)
	}
}

// Dữ liệu tới từ nơi khác (bundle, Revision cũ) mang ngân sách vượt phần chia
// phải bị Check chặn — cả từng Program lẫn tổng xấu nhất.
func TestPackageTopologyRejectsBudgetAboveStepShare(t *testing.T) {
	topology, _ := packageTopology(2, []revisionObjectView{
		programWithConfig("a1111111-1111-4111-8111-111111111111", "A", 10),
		programWithConfig("b2222222-2222-4222-8222-222222222222", "B", 50000),
	})
	topology[0].BudgetUs = stepBudgetUs
	counts := detailCodes(packageTopologyDiagnostics(topology))
	if counts["ST-LIM-009"] != 2 {
		t.Fatalf("ngân sách vượt phần chia/tổng xấu nhất không bị chặn: %+v", counts)
	}
}

// PROGRAM POU chưa có `programConfig` là một Draft hợp lệ nhưng chưa được phép
// Check/Package. Quan trọng nhất: topology phải giữ 0 để báo thiếu schedule,
// tuyệt đối không tự biến nó thành lớp 1000 ms.
func TestPackageTopologyRejectsUnscheduledProgramWithoutSynthesizingPeriod(t *testing.T) {
	objectID := "d4444444-4444-4444-8444-444444444444"
	topology, budget := packageTopology(2, []revisionObjectView{
		objectView("PROGRAM", objectID, map[string]any{
			"objectId": objectID, "kind": "PROGRAM", "name": "UNSCHEDULED",
			"language": "ST", "source": "PROGRAM UNSCHEDULED\nEND_PROGRAM\n",
		}),
		// TASK legacy tồn tại không được cứu PROGRAM schema v2 thiếu config.
		objectView("TASK", "e5555555-5555-4555-8555-555555555555", map[string]any{
			"taskId": "e5555555-5555-4555-8555-555555555555", "periodMs": 5000,
			"programOrder": []string{objectID},
		}),
	})
	if len(topology) != 1 || topology[0].PeriodMs != 0 || topology[0].BudgetUs != 0 {
		t.Fatalf("POU chưa schedule bị gán chu kỳ/ngân sách ngầm: %+v", topology)
	}
	for _, period := range budget.Periods {
		if period.ProgramCount != 0 {
			t.Fatalf("POU chưa schedule bị tính vào lớp chu kỳ: %+v", budget.Periods)
		}
	}
	diagnostics := packageTopologyDiagnostics(topology)
	if len(diagnostics) != 1 || diagnostics[0].Code != "PRG-ERR-CHECK-001" ||
		diagnostics[0].DetailCode != "ST-POU-005" {
		t.Fatalf("diagnostic=%+v", diagnostics)
	}
	if got, _ := diagnostics[0].Location["programId"].(string); got != objectID {
		t.Fatalf("diagnostic không trỏ đúng POU: %+v", diagnostics[0].Location)
	}
}

// Revision schema v1 lịch sử không có `programConfig`; chu kỳ đã seal nằm ở
// TASK chung. Check lại lịch sử phải giữ đúng 5000 ms, không biến nó thành
// ghost POU và cũng không tự chọn 1000 ms.
func TestPackageTopologySchemaV1DerivesPeriodFromLegacyTask(t *testing.T) {
	programID := "d4444444-4444-4444-8444-444444444444"
	taskID := "e5555555-5555-4555-8555-555555555555"
	topology, budget := packageTopology(1, []revisionObjectView{
		objectView("PROGRAM", programID, map[string]any{
			"programId": programID, "kind": "PROGRAM", "name": "LEGACY",
			"language": "ST", "document": "PROGRAM LEGACY\nEND_PROGRAM\n",
		}),
		objectView("TASK", taskID, map[string]any{
			"taskId": taskID, "periodMs": 5000, "programOrder": []string{programID},
		}),
	})
	if len(topology) != 1 || topology[0].PeriodMs != 5000 ||
		topology[0].BudgetUs != programBudgetUs(1) {
		t.Fatalf("topology v1 không giữ chu kỳ TASK: %+v", topology)
	}
	if diagnostics := packageTopologyDiagnostics(topology); len(diagnostics) != 0 {
		t.Fatalf("Revision v1 hợp lệ bị từ chối: %+v", diagnostics)
	}
	counts := map[int64]int{}
	for _, period := range budget.Periods {
		counts[period.PeriodMs] = period.ProgramCount
	}
	if counts[5000] != 1 || counts[1000] != 0 || counts[50000] != 0 {
		t.Fatalf("budget v1 sai lớp TASK: %+v", budget.Periods)
	}
}

// Budget đếm đúng số Program theo từng lớp chu kỳ — đây là dữ liệu mà scheduler
// (T59-402) sẽ dùng để phân bổ, nên đếm sai ở đây là phân bổ sai ở đó.
func TestPackageBudgetCountsProgramsPerPeriodClass(t *testing.T) {
	_, budget := packageTopology(2, []revisionObjectView{
		programWithConfig("a1111111-1111-4111-8111-111111111111", "A", 1000),
		programWithConfig("b2222222-2222-4222-8222-222222222222", "B", 1000),
		programWithConfig("c3333333-3333-4333-8333-333333333333", "C", 50000),
		programWithConfig("d4444444-4444-4444-8444-444444444444", "D", 10),
	})
	counts := map[int64]int{}
	for _, period := range budget.Periods {
		counts[period.PeriodMs] = period.ProgramCount
		if period.BudgetUs != programBudgetUs(4) {
			t.Fatalf("lớp %d ms không nhận đúng phần chia base step: %+v", period.PeriodMs, period)
		}
	}
	if counts[1000] != 2 || counts[5000] != 0 || counts[50000] != 1 || counts[10] != 1 {
		t.Fatalf("budget theo lớp chu kỳ=%+v", budget.Periods)
	}
}
