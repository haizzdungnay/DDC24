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
		programWithConfig("c3333333-3333-4333-8333-333333333333", "CHILLER", 30000),
	}
	reverse := []revisionObjectView{forward[2], forward[0], forward[1]}

	first, firstBudget := packageTopology(forward)
	second, secondBudget := packageTopology(reverse)
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
	topology, budget := packageTopology([]revisionObjectView{
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
	topology, _ := packageTopology(objects[:domain.MaxProgramsTotal])
	if diagnostics := packageTopologyDiagnostics(topology); len(diagnostics) != 0 {
		t.Fatalf("%d Program (đúng trần) bị từ chối: %+v", domain.MaxProgramsTotal, diagnostics)
	}

	overTopology, _ := packageTopology(objects)
	diagnostics := packageTopologyDiagnostics(overTopology)
	if len(diagnostics) != 1 || diagnostics[0].DetailCode != "ST-LIM-009" {
		t.Fatalf("một-trên-trần=%+v", diagnostics)
	}
	if limit, ok := diagnostics[0].Args["limit"].(int); !ok || limit != domain.MaxProgramsTotal {
		t.Fatalf("limit báo về=%v; want %d", diagnostics[0].Args["limit"], domain.MaxProgramsTotal)
	}
}

// Chu kỳ ngoài ba lớp của profile là một lớp lập lịch KHÔNG tồn tại; chấp nhận
// nó ở Check sẽ đẩy lỗi xuống runtime.
func TestPackageTopologyRejectsPeriodOutsideProfileClasses(t *testing.T) {
	topology, _ := packageTopology([]revisionObjectView{
		programWithConfig("a1111111-1111-4111-8111-111111111111", "AHU", 777),
	})
	diagnostics := packageTopologyDiagnostics(topology)
	if len(diagnostics) != 1 || diagnostics[0].DetailCode != "ST-LIM-009" {
		t.Fatalf("chu kỳ lạ=%+v", diagnostics)
	}
}

// Budget đếm đúng số Program theo từng lớp chu kỳ — đây là dữ liệu mà scheduler
// (T59-402) sẽ dùng để phân bổ, nên đếm sai ở đây là phân bổ sai ở đó.
func TestPackageBudgetCountsProgramsPerPeriodClass(t *testing.T) {
	_, budget := packageTopology([]revisionObjectView{
		programWithConfig("a1111111-1111-4111-8111-111111111111", "A", 1000),
		programWithConfig("b2222222-2222-4222-8222-222222222222", "B", 1000),
		programWithConfig("c3333333-3333-4333-8333-333333333333", "C", 30000),
	})
	counts := map[int64]int{}
	for _, period := range budget.Periods {
		counts[period.PeriodMs] = period.ProgramCount
	}
	if counts[1000] != 2 || counts[5000] != 0 || counts[30000] != 1 {
		t.Fatalf("budget theo lớp chu kỳ=%+v", budget.Periods)
	}
}
