package application

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"testing"

	programmingcompiler "mkddc-web/internal/programming/compiler"
	programmingstore "mkddc-web/internal/programming/store"
)

type signalEvidenceRunner struct {
	refs   map[string][]programmingcompiler.SignalRef
	inputs []programmingcompiler.Input
}

func (r *signalEvidenceRunner) Compile(_ context.Context,
	input programmingcompiler.Input) (programmingcompiler.Result, error) {
	r.inputs = append(r.inputs, input)
	artifact := []byte("artifact-signal:" + input.SourceID)
	return programmingcompiler.Result{OK: true, Artifact: artifact,
		ArtifactSHA256: sha256.Sum256(artifact), Manifest: json.RawMessage(`{"manifestVersion":1}`),
		CompilerVersion: checkCompilerVersion, ArtifactSchemaVersion: 1, CompilerProfile: 1,
		ProfileID: "revA-1t-1-5-30", LibraryVersion: "rev-a.1", IntegrityMode: "HASH_ONLY",
		TargetABI: 3841, SignalRefs: append([]programmingcompiler.SignalRef(nil), r.refs[input.SourceID]...)}, nil
}

func signalCheckRevisionFixture(t *testing.T) (*programmingstore.Store, string, string, string) {
	t.Helper()
	service, projectID, draftID, etag := newV2Project(t)
	producer := objectUUID(41)
	consumer := objectUUID(42)
	signalID := objectUUID(43)
	producerSource := op(map[string]any{"op": "upsertObject", "object": map[string]any{
		"objectId": producer, "kind": "PROGRAM", "name": "PRODUCER", "language": "ST",
		"source": "PROGRAM PRODUCER\nVAR X : REAL; END_VAR\nSIGNAL_PUBLISH(SUPPLY_TEMP, X);\nEND_PROGRAM\n"}})
	consumerSource := op(map[string]any{"op": "upsertObject", "object": map[string]any{
		"objectId": consumer, "kind": "PROGRAM", "name": "CONSUMER", "language": "ST",
		"source": "PROGRAM CONSUMER\nVAR X : REAL; END_VAR\nX := SIGNAL_READ(SUPPLY_TEMP);\nEND_PROGRAM\n"}})
	signal := op(map[string]any{"op": "upsertSignal", "signal": map[string]any{
		"signalId": signalID, "name": "SUPPLY_TEMP", "type": "REAL",
		"publisherProgramId": producer, "freshnessMs": 5000, "stalePolicy": "WAIT"}})
	saved, err := saveOps(t, service, projectID, draftID, etag,
		"78000000-0000-4000-8000-000000000001", producerSource,
		programOp(producer, producer, 1000), consumerSource,
		programOp(consumer, consumer, 1000), signal)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := service.SealRevision(context.Background(), Actor{ID: testActorID, Role: "admin"},
		SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0", BaseRevisionID: draftID,
			Label: "Signal refs", IfMatch: saved.ETag,
			IdempotencyKey: "78000000-0000-4000-8000-000000000002",
			CorrelationID:  testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	return service.store, sealed.Resource["revisionId"].(string), producer, consumer
}

func TestCompiledSignalPublishDiagnosticsAcceptsExactlyOneActualPublisher(t *testing.T) {
	producer := "a1111111-1111-4111-8111-111111111111"
	consumer := "b2222222-2222-4222-8222-222222222222"
	objects := []revisionObjectView{
		programView(producer), programView(consumer),
		signalView("d4444444-4444-4444-8444-444444444441", "SUPPLY_TEMP", "REAL",
			producer, "WAIT", 5000, nil),
	}
	inputs := []programmingcompiler.Input{{SourceID: "producer-source", ProgramID: producer},
		{SourceID: "consumer-source", ProgramID: consumer}}
	results := []programmingcompiler.Result{
		{SignalRefs: []programmingcompiler.SignalRef{{Name: "SUPPLY_TEMP", Type: "REAL", Publish: true}}},
		{SignalRefs: []programmingcompiler.SignalRef{{Name: "SUPPLY_TEMP", Type: "REAL", Read: true}}},
	}
	if diagnostics := compiledSignalPublishDiagnostics(objects, inputs, results); len(diagnostics) != 0 {
		t.Fatalf("publisher thực tế hợp lệ bị từ chối: %+v", diagnostics)
	}
}

func TestCompiledSignalPublishDiagnosticsRejectsManifestOnlyPublisher(t *testing.T) {
	producer := "a1111111-1111-4111-8111-111111111111"
	consumer := "b2222222-2222-4222-8222-222222222222"
	signalID := "d4444444-4444-4444-8444-444444444441"
	objects := []revisionObjectView{
		programView(producer), programView(consumer),
		signalView(signalID, "SUPPLY_TEMP", "REAL", producer, "WAIT", 5000, nil),
	}
	inputs := []programmingcompiler.Input{{SourceID: "producer-source", ProgramID: producer},
		{SourceID: "consumer-source", ProgramID: consumer}}
	results := []programmingcompiler.Result{{SignalRefs: []programmingcompiler.SignalRef{}},
		{SignalRefs: []programmingcompiler.SignalRef{{Name: "SUPPLY_TEMP", Type: "REAL", Read: true}}}}

	diagnostics := compiledSignalPublishDiagnostics(objects, inputs, results)
	if counts := detailCodes(diagnostics); counts["ST-SIG-004"] != 1 {
		t.Fatalf("signal chỉ có trong manifest không làm Check fail: %+v", diagnostics)
	}
	if diagnostics[0].Location["signalId"] != signalID {
		t.Fatalf("diagnostic không trỏ đúng signal: %+v", diagnostics[0])
	}
}

func TestCompiledSignalPublishDiagnosticsRejectsWrongOrDuplicateProducer(t *testing.T) {
	producer := "a1111111-1111-4111-8111-111111111111"
	consumer := "b2222222-2222-4222-8222-222222222222"
	objects := []revisionObjectView{
		programView(producer), programView(consumer),
		signalView("d4444444-4444-4444-8444-444444444441", "SUPPLY_TEMP", "REAL",
			producer, "WAIT", 5000, nil),
	}
	inputs := []programmingcompiler.Input{{SourceID: "producer-source", ProgramID: producer},
		{SourceID: "consumer-source", ProgramID: consumer}}

	for name, results := range map[string][]programmingcompiler.Result{
		"sai producer": {
			{SignalRefs: []programmingcompiler.SignalRef{}},
			{SignalRefs: []programmingcompiler.SignalRef{{Name: "SUPPLY_TEMP", Type: "REAL", Publish: true}}},
		},
		"hai publish": {
			{SignalRefs: []programmingcompiler.SignalRef{{Name: "SUPPLY_TEMP", Type: "REAL", Publish: true}}},
			{SignalRefs: []programmingcompiler.SignalRef{{Name: "SUPPLY_TEMP", Type: "REAL", Publish: true}}},
		},
	} {
		t.Run(name, func(t *testing.T) {
			diagnostics := compiledSignalPublishDiagnostics(objects, inputs, results)
			if counts := detailCodes(diagnostics); counts["ST-SIG-001"] != 1 {
				t.Fatalf("publisher thực tế sai không bị từ chối: %+v", diagnostics)
			}
		})
	}
}

func TestProgrammingCheckRequiresActualSignalPublishEvidence(t *testing.T) {
	for _, testCase := range []struct {
		name          string
		actualPublish bool
		wantState     string
		wantDetail    string
	}{
		{name: "đủ publish thực tế", actualPublish: true, wantState: "PASSED"},
		{name: "chỉ khai publisher trong manifest", wantState: "FAILED", wantDetail: "ST-SIG-004"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			store, revisionID, producer, consumer := signalCheckRevisionFixture(t)
			refs := map[string][]programmingcompiler.SignalRef{
				consumer: {{Name: "SUPPLY_TEMP", Type: "REAL", Read: true}},
			}
			if testCase.actualPublish {
				refs[producer] = []programmingcompiler.SignalRef{{Name: "SUPPLY_TEMP", Type: "REAL", Publish: true}}
			}
			runner := &signalEvidenceRunner{refs: refs}
			checks := newCheckServiceForPackage(t, store, runner)
			view := runCheck(t, checks, revisionID,
				fmt.Sprintf("79000000-0000-4000-8000-%012d", len(testCase.name)))
			if view.State != testCase.wantState {
				t.Fatalf("state=%s, muốn %s; diagnostics=%+v", view.State, testCase.wantState, view.Diagnostics)
			}
			if len(runner.inputs) != 2 {
				t.Fatalf("Check không compile đủ hai Program: %d", len(runner.inputs))
			}
			for _, input := range runner.inputs {
				if len(input.PublishedSignals) != 1 ||
					input.PublishedSignals[0].PublisherProgramID != producer {
					t.Fatalf("compiler input không nhận cùng signal contract: %+v", input.PublishedSignals)
				}
			}
			if testCase.wantDetail != "" {
				if counts := detailCodes(view.Diagnostics); counts[testCase.wantDetail] != 1 {
					t.Fatalf("thiếu diagnostic %s: %+v", testCase.wantDetail, view.Diagnostics)
				}
			} else if view.Artifact == nil {
				t.Fatal("Check hợp lệ không sinh package artifact")
			}
		})
	}
}
