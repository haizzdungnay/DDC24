package application

import (
	"encoding/json"
	"strings"
	"testing"

	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
)

const (
	manifestObjectID  = "a1111111-1111-4111-8111-111111111111"
	manifestProgramID = "b2222222-2222-4222-8222-222222222222"
	manifestSignalID  = "c3333333-3333-4333-8333-333333333333"
)

func validManifestInput(t *testing.T) packageManifestInput {
	t.Helper()
	objects := []revisionObjectView{
		objectView("PROGRAM", manifestObjectID, map[string]any{
			"objectId": manifestObjectID, "kind": "PROGRAM", "name": "MAIN", "language": "ST",
			"source": "PROGRAM MAIN\nEND_PROGRAM\n", "dependencies": []string{},
			"programConfig": map[string]any{"programId": manifestProgramID,
				"objectId": manifestObjectID, "periodMs": 1000},
		}),
		signalView(manifestSignalID, "SUPPLY_TEMP", "REAL", manifestProgramID,
			"USE_FALLBACK", 5000, func() *float64 { value := 21.5; return &value }()),
	}
	topology, budget := packageTopology(2, objects)
	return packageManifestInput{
		Artifacts: []packageProgramArtifact{{
			ProgramID: manifestProgramID, SHA256: strings.Repeat("1", 64), ByteSize: 128,
			RelativePath: "11/artifact.mkir", SchemaVersion: 1,
			TargetABI: domain.ProfileTargetABI, CompilerVersion: checkCompilerVersion,
			LibraryVersion: domain.ProfileLibraryVersion, IntegrityMode: "HASH_ONLY",
		}},
		ProgramManifests: []json.RawMessage{json.RawMessage(`{"manifestVersion":1}`)},
		Topology:         topology, Budget: budget, PouGraph: packagePouGraph(objects),
		Signals: packageManifestSignals(objects,
			[]programmingcompiler.Input{{SourceID: manifestObjectID, ProgramID: manifestProgramID, Language: "ST"}},
			[]programmingcompiler.Result{{SignalRefs: []programmingcompiler.SignalRef{{
				Name: "SUPPLY_TEMP", Type: "REAL", Publish: true,
				PublishLocation: &programmingcompiler.SourceLocation{Line: 2, Column: 3, Length: 11},
			}}}}, topology), Bindings: []packageManifestBinding{},
		LibraryLock: packageLibraryLockFrom(objects, ""), IntegrityMode: "HASH_ONLY",
	}
}

func TestPackageManifestV4CarriesStableRuntimeIdentityAndValidatesItself(t *testing.T) {
	raw, err := buildPackageCheckManifest(validManifestInput(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := validatePackageCheckManifest(raw); err != nil {
		t.Fatalf("manifest writer sinh dữ liệu mà verifier từ chối: %v", err)
	}
	var document packageCheckManifest
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Topology) != 1 || document.Topology[0].ObjectID != manifestObjectID ||
		document.Topology[0].ProgramID != manifestProgramID {
		t.Fatalf("hai identity POU/runtime bị trộn: %+v", document.Topology)
	}
	if document.Artifacts[0].ProgramID != manifestProgramID ||
		document.Signals[0].PublisherProgramID != manifestProgramID {
		t.Fatalf("consumer runtime không cùng programId: artifact=%+v signal=%+v",
			document.Artifacts[0], document.Signals[0])
	}
	if document.Signals[0].FallbackValue == nil || *document.Signals[0].FallbackValue != 21.5 {
		t.Fatalf("manifest làm mất fallback typed: %+v", document.Signals[0])
	}
}

func TestPackageManifestV4CarriesCompilerVerifiedPublisherAndConsumers(t *testing.T) {
	consumerObjectID := "d4444444-4444-4444-8444-444444444444"
	consumerProgramID := "e5555555-5555-4555-8555-555555555555"
	objects := []revisionObjectView{
		objectView("PROGRAM", manifestObjectID, map[string]any{"objectId": manifestObjectID, "kind": "PROGRAM", "name": "PUBLISHER", "language": "ST", "source": "PROGRAM PUBLISHER END_PROGRAM", "dependencies": []string{}, "programConfig": map[string]any{"programId": manifestProgramID, "periodMs": 1000}}),
		objectView("PROGRAM", consumerObjectID, map[string]any{"objectId": consumerObjectID, "kind": "PROGRAM", "name": "CONSUMER", "language": "FBD", "source": `{}`, "dependencies": []string{}, "programConfig": map[string]any{"programId": consumerProgramID, "periodMs": 1000}}),
		signalView(manifestSignalID, "SUPPLY_TEMP", "REAL", manifestProgramID, "WAIT", 5000, nil),
	}
	topology, _ := packageTopology(2, objects)
	signals := packageManifestSignals(objects,
		[]programmingcompiler.Input{{SourceID: manifestObjectID, ProgramID: manifestProgramID, Language: "ST"}, {SourceID: consumerObjectID, ProgramID: consumerProgramID, Language: "FBD"}},
		[]programmingcompiler.Result{
			{SignalRefs: []programmingcompiler.SignalRef{{Name: "SUPPLY_TEMP", Type: "REAL", Publish: true, PublishLocation: &programmingcompiler.SourceLocation{Line: 3, Column: 2, Length: 11}}}},
			{SignalRefs: []programmingcompiler.SignalRef{{Name: "SUPPLY_TEMP", Type: "REAL", Read: true, ReadLocation: &programmingcompiler.SourceLocation{Line: 7, Column: 4, Length: 11}}}},
		}, topology)
	if len(signals) != 1 || signals[0].Publisher.ObjectID != manifestObjectID || len(signals[0].Consumers) != 1 ||
		signals[0].Consumers[0].ObjectID != consumerObjectID || signals[0].Consumers[0].Language != "FBD" ||
		signals[0].Consumers[0].Location == nil || signals[0].Consumers[0].Location.Line != 7 {
		t.Fatalf("dependency compiler bị mất provenance: %+v", signals)
	}
}

func TestPackageManifestV4RejectsSignalReferenceThatContradictsTopology(t *testing.T) {
	input := validManifestInput(t)
	raw, err := buildPackageCheckManifest(input)
	if err != nil {
		t.Fatal(err)
	}
	var document packageCheckManifest
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	document.Signals[0].Publisher.ObjectID = "d4444444-4444-4444-8444-444444444444"
	document.ContentSHA256, err = packageManifestContentHash(document)
	if err != nil {
		t.Fatal(err)
	}
	tampered, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if err := validatePackageCheckManifest(tampered); err == nil || !strings.Contains(err.Error(), "identity không khớp topology") {
		t.Fatalf("provenance tự mâu thuẫn phải bị từ chối dù content hash đã tính lại: %v", err)
	}
}

func TestPackageManifestV4DoesNotInferConsumersFromSourceText(t *testing.T) {
	objects := []revisionObjectView{
		objectView("PROGRAM", manifestObjectID, map[string]any{"objectId": manifestObjectID, "kind": "PROGRAM", "name": "PUBLISHER", "language": "ST", "source": "PROGRAM PUBLISHER END_PROGRAM", "dependencies": []string{}, "programConfig": map[string]any{"programId": manifestProgramID, "periodMs": 1000}}),
		objectView("PROGRAM", "d4444444-4444-4444-8444-444444444444", map[string]any{"objectId": "d4444444-4444-4444-8444-444444444444", "kind": "PROGRAM", "name": "COMMENT_ONLY", "language": "ST", "source": "PROGRAM COMMENT_ONLY\n// SUPPLY_TEMP is documentation only\nEND_PROGRAM", "dependencies": []string{}, "programConfig": map[string]any{"programId": "e5555555-5555-4555-8555-555555555555", "periodMs": 1000}}),
		signalView(manifestSignalID, "SUPPLY_TEMP", "REAL", manifestProgramID, "WAIT", 5000, nil),
	}
	topology, _ := packageTopology(2, objects)
	signals := packageManifestSignals(objects,
		[]programmingcompiler.Input{{SourceID: manifestObjectID, ProgramID: manifestProgramID, Language: "ST"}, {SourceID: "d4444444-4444-4444-8444-444444444444", ProgramID: "e5555555-5555-4555-8555-555555555555", Language: "ST"}},
		[]programmingcompiler.Result{{SignalRefs: []programmingcompiler.SignalRef{{Name: "SUPPLY_TEMP", Type: "REAL", Publish: true}}}, {}}, topology)
	if len(signals) != 1 || len(signals[0].Consumers) != 0 {
		t.Fatalf("tên signal chỉ xuất hiện trong comment không được suy diễn thành consumer: %+v", signals)
	}
}

func TestPackageManifestContentHashCoversTopologyAndExcludesContainer(t *testing.T) {
	input := validManifestInput(t)
	withoutContainer, err := buildPackageCheckManifest(input)
	if err != nil {
		t.Fatal(err)
	}
	input.ContainerSHA256 = strings.Repeat("a", 64)
	input.ContainerBytes = 4096
	withContainer, err := buildPackageCheckManifest(input)
	if err != nil {
		t.Fatal(err)
	}
	var first, second packageCheckManifest
	_ = json.Unmarshal(withoutContainer, &first)
	_ = json.Unmarshal(withContainer, &second)
	if first.ContentSHA256 != second.ContentSHA256 {
		t.Fatalf("container metadata không thuộc content hash: %s != %s",
			first.ContentSHA256, second.ContentSHA256)
	}

	// Sửa nội dung nhưng giữ hash cũ phải bị bắt ngay; chỉ kiểm định dạng hex là
	// không đủ để chứng minh manifest chưa bị thay đổi.
	tampered := strings.Replace(string(withContainer), `"periodMs":1000`, `"periodMs":5000`, 1)
	if err := validatePackageCheckManifest([]byte(tampered)); err == nil ||
		!strings.Contains(err.Error(), "contentSha256") {
		t.Fatalf("tamper topology không bị content hash bắt: %v", err)
	}
}

func TestPackageManifestRejectsUnrepresentableSignalFallback(t *testing.T) {
	input := validManifestInput(t)
	bad := 2.0
	input.Signals[0].Type = "BOOL"
	input.Signals[0].FallbackValue = &bad
	if _, err := buildPackageCheckManifest(input); err == nil ||
		!strings.Contains(err.Error(), "fallbackValue") {
		t.Fatalf("BOOL fallback=2 phải bị từ chối: %v", err)
	}
}

func TestPackageManifestRejectsBindingWithoutResolvedRuntimeOwner(t *testing.T) {
	input := validManifestInput(t)
	input.Bindings = []packageManifestBinding{{
		BindingID:  "d4444444-4444-4444-8444-444444444444",
		VariableID: "e5555555-5555-4555-8555-555555555555", Variable: "AO_CMD",
		Direction: "WRITE", Category: "LOCAL", PointID: "AO-01", Writable: true,
	}}
	if _, err := buildPackageCheckManifest(input); err == nil ||
		!strings.Contains(err.Error(), "programId") {
		t.Fatalf("binding chưa phân giải owner không được đi vào manifest PASS: %v", err)
	}
}
