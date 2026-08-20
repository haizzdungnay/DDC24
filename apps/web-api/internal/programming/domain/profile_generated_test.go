package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type profileContract struct {
	ProfileID   string `json:"profileId"`
	ProfileCode int    `json:"profileCode"`
	TargetABI   int    `json:"targetAbi"`
	Version     struct {
		Major int `json:"major"`
		Minor int `json:"minor"`
	} `json:"version"`
	Capacity struct {
		MaxObjects                int `json:"maxObjects"`
		MaxProgramsTotal          int `json:"maxProgramsTotal"`
		MaxProgramsEnabled        int `json:"maxProgramsEnabled"`
		MaxUserPou                int `json:"maxUserPou"`
		MaxFunctionBlockInstances int `json:"maxFunctionBlockInstances"`
		MaxSignals                int `json:"maxSignals"`
		MaxBindings               int `json:"maxBindings"`
	} `json:"capacity"`
	Scheduler struct {
		MaxTasks             int     `json:"maxTasks"`
		MaxProgramsPerTask   int     `json:"maxProgramsPerTask"`
		MaxProgramsTotal     int     `json:"maxProgramsTotal"`
		AllowedPeriodMs      []int64 `json:"allowedPeriodMs"`
		MaxTaskBudgetPercent int     `json:"maxTaskBudgetPercent"`
	} `json:"scheduler"`
	Resources struct {
		MaxSourceBytes   int `json:"maxSourceBytes"`
		MaxArtifactBytes int `json:"maxArtifactBytes"`
		MaxBindings      int `json:"maxBindings"`
		MaxSlots         int `json:"maxSlots"`
		MaxWritableSlots int `json:"maxWritableSlots"`
	} `json:"resources"`
	CoreLibrary struct {
		Version string `json:"version"`
	} `json:"coreLibrary"`
	IntegrityMode string `json:"integrityMode"`
}

func readProfileContract(t *testing.T) ([]byte, profileContract) {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("không xác định được source path")
	}
	path := filepath.Clean(filepath.Join(filepath.Dir(currentFile),
		"../../../../../contracts/programming/product_profile_v2.json"))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var contract profileContract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatal(err)
	}
	return raw, contract
}

// Hằng Go phải sinh từ đúng contract; trước đây runner chép tay profileId và
// profileSha256 nên hai bên trôi khỏi nhau mà không gate nào bắt.
func TestProfileGeneratedMatchesContract(t *testing.T) {
	raw, contract := readProfileContract(t)

	if ProfileID != contract.ProfileID || ProfileCode != contract.ProfileCode ||
		ProfileTargetABI != contract.TargetABI {
		t.Fatalf("token profile lệch contract: id=%s code=%d abi=%d", ProfileID, ProfileCode, ProfileTargetABI)
	}
	if ProfileMajor != contract.Version.Major || ProfileMinor != contract.Version.Minor {
		t.Fatalf("document version lệch: code=%d.%d contract=%d.%d",
			ProfileMajor, ProfileMinor, contract.Version.Major, contract.Version.Minor)
	}
	if want := hex.EncodeToString(sha256Sum(raw)); ProfileSHA256 != want {
		t.Fatalf("ProfileSHA256 = %s; want %s", ProfileSHA256, want)
	}
	if ProfileLibraryVersion != contract.CoreLibrary.Version || ProfileIntegrityMode != contract.IntegrityMode {
		t.Fatalf("library/integrity lệch contract")
	}
}

func TestProfileCapacityMatchesContract(t *testing.T) {
	_, contract := readProfileContract(t)
	cases := []struct {
		name        string
		generated   int
		contractual int
	}{
		{"maxObjects", MaxObjects, contract.Capacity.MaxObjects},
		{"maxProgramsTotal", MaxProgramsTotal, contract.Capacity.MaxProgramsTotal},
		{"maxProgramsEnabled", MaxProgramsEnabled, contract.Capacity.MaxProgramsEnabled},
		{"maxUserPou", MaxUserPou, contract.Capacity.MaxUserPou},
		{"maxFunctionBlockInstances", MaxFunctionBlockInstances, contract.Capacity.MaxFunctionBlockInstances},
		{"maxSignals", MaxSignals, contract.Capacity.MaxSignals},
		{"maxPackageBindings", MaxPackageBindings, contract.Capacity.MaxBindings},
		{"maxTasks", MaxTasks, contract.Scheduler.MaxTasks},
		{"maxProgramsPerTask", MaxProgramsPerTask, contract.Scheduler.MaxProgramsPerTask},
		{"maxTaskBudgetPercent", MaxTaskBudgetPercent, contract.Scheduler.MaxTaskBudgetPercent},
		{"maxSourceBytes", MaxSourceBytes, contract.Resources.MaxSourceBytes},
		{"maxProfileArtifactBytes", MaxProfileArtifactBytes, contract.Resources.MaxArtifactBytes},
		{"maxProgramBindings", MaxProgramBindings, contract.Resources.MaxBindings},
	}
	for _, item := range cases {
		if item.generated != item.contractual {
			t.Fatalf("%s: generated=%d contract=%d", item.name, item.generated, item.contractual)
		}
	}
	if len(AllowedPeriodMs) != len(contract.Scheduler.AllowedPeriodMs) {
		t.Fatalf("số chu kỳ lệch: %d vs %d", len(AllowedPeriodMs), len(contract.Scheduler.AllowedPeriodMs))
	}
	for index, period := range contract.Scheduler.AllowedPeriodMs {
		if AllowedPeriodMs[index] != period {
			t.Fatalf("chu kỳ %d lệch: %d vs %d", index, AllowedPeriodMs[index], period)
		}
	}
}

// Capacity sản phẩm là quyết định Product (DDD-SW-PROG-UNIFIED-001 §0). Test này
// đỏ nếu ai đó hạ về capacity một Program như As-Built cũ.
func TestProductCapacityIsThirtyTwoProgramsAndSixteenEnabled(t *testing.T) {
	if MaxProgramsTotal != 32 || MaxProgramsEnabled != 16 {
		t.Fatalf("capacity sản phẩm = %d/%d; want 32/16", MaxProgramsTotal, MaxProgramsEnabled)
	}
	if MaxUserPou != 256 || MaxFunctionBlockInstances != 1024 || MaxSignals != 512 || MaxPackageBindings != 512 {
		t.Fatalf("capacity POU/FB/signal/binding lệch quyết định Product")
	}
	if MaxProgramsEnabled > MaxProgramsTotal {
		t.Fatal("số Program Enabled không được lớn hơn tổng Program")
	}
	if MaxProgramBindings > MaxPackageBindings {
		t.Fatal("trần binding của một Program vượt trần package")
	}
	if MaxTasks != len(AllowedPeriodMs) {
		t.Fatalf("maxTasks=%d phải bằng số lớp chu kỳ %d", MaxTasks, len(AllowedPeriodMs))
	}
}

func sha256Sum(raw []byte) []byte {
	sum := sha256.Sum256(raw)
	return sum[:]
}
