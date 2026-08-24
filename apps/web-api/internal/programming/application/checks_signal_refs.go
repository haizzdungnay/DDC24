package application

import (
	"fmt"
	"sort"
	"strings"

	programmingcompiler "mkddc-web/internal/programming/compiler"
)

// compiledSignalPublishDiagnostics đối soát khai báo Published Signal với
// SIGNAL_PUBLISH mà compiler đã THỰC SỰ lower vào từng artifact. Manifest Draft
// chỉ nói ai *được phép* publish; nó không chứng minh source của publisher có
// lệnh publish. Thiếu phép đối soát này, một package có signal không bao giờ
// được ghi vẫn có thể Check PASSED rồi làm consumer chờ vô hạn ở runtime.
func compiledSignalPublishDiagnostics(objects []revisionObjectView,
	inputs []programmingcompiler.Input,
	results []programmingcompiler.Result) []DiagnosticView {
	_, declared, _ := collectPackageObjects(objects)
	if len(declared) == 0 {
		return nil
	}
	sort.Slice(declared, func(left, right int) bool {
		if !strings.EqualFold(declared[left].name, declared[right].name) {
			return strings.ToUpper(declared[left].name) < strings.ToUpper(declared[right].name)
		}
		return declared[left].signalID < declared[right].signalID
	})

	type actualPublish struct {
		name, dataType, programID string
	}
	actualByName := make(map[string][]actualPublish)
	diagnostics := make([]DiagnosticView, 0)
	for index, result := range results {
		programID := ""
		if index < len(inputs) {
			programID = inputs[index].ProgramID
			if programID == "" {
				programID = inputs[index].SourceID
			}
		}
		for _, ref := range result.SignalRefs {
			if !ref.Publish {
				continue
			}
			actualByName[strings.ToUpper(ref.Name)] = append(
				actualByName[strings.ToUpper(ref.Name)],
				actualPublish{name: ref.Name, dataType: ref.Type, programID: programID})
		}
	}

	declaredByName := make(map[string]packageSignal, len(declared))
	for _, signal := range declared {
		declaredByName[strings.ToUpper(signal.name)] = signal
	}
	// ProcessRunner đã từ chối ref ngoài contract. Kiểm lại tại application
	// boundary để Check không phụ thuộc vào một Runner thay thế/misconfigured.
	unknownNames := make([]string, 0)
	for folded := range actualByName {
		if _, found := declaredByName[folded]; !found {
			unknownNames = append(unknownNames, folded)
		}
	}
	sort.Strings(unknownNames)
	for _, folded := range unknownNames {
		for _, actual := range actualByName[folded] {
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-004",
				map[string]any{"signalId": actual.name, "programId": actual.programID},
				map[string]any{"signalId": actual.name,
					"conflictProgramId": actual.programID}))
		}
	}

	for _, signal := range declared {
		actual := actualByName[strings.ToUpper(signal.name)]
		for _, publish := range actual {
			if publish.name != signal.name || publish.dataType != signal.dataType {
				diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-002",
					map[string]any{"signalId": signal.signalID, "programId": publish.programID},
					map[string]any{"expected": fmt.Sprintf("%s:%s", signal.name, signal.dataType),
						"actual": fmt.Sprintf("%s:%s", publish.name, publish.dataType)}))
			}
		}

		switch len(actual) {
		case 0:
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-004",
				map[string]any{"signalId": signal.signalID, "programId": signal.publisherID},
				map[string]any{"signalId": signal.signalID,
					"ownerProgramId": signal.publisherID}))
		case 1:
			if actual[0].programID != signal.publisherID {
				diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-001",
					map[string]any{"signalId": signal.signalID, "programId": actual[0].programID},
					map[string]any{"signalId": signal.signalID,
						"ownerProgramId":    signal.publisherID,
						"conflictProgramId": actual[0].programID}))
			}
		default:
			publishers := make([]string, 0, len(actual))
			for _, publish := range actual {
				publishers = append(publishers, publish.programID)
			}
			sort.Strings(publishers)
			conflict := publishers[0]
			if conflict == signal.publisherID && len(publishers) > 1 {
				conflict = publishers[1]
			}
			diagnostics = append(diagnostics, packageDiagnostic("ST-SIG-001",
				map[string]any{"signalId": signal.signalID, "programId": conflict},
				map[string]any{"signalId": signal.signalID,
					"ownerProgramId":    signal.publisherID,
					"conflictProgramId": conflict}))
		}
	}
	return diagnostics
}
