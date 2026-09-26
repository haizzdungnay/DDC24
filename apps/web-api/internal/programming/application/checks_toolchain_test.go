package application

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	programmingartifact "mkddc-web/internal/programming/artifact"
	programmingcompiler "mkddc-web/internal/programming/compiler"
	"mkddc-web/internal/programming/domain"
)

type fakeToolchain struct {
	err   error
	calls int
}

func (f *fakeToolchain) Verify(context.Context) error {
	f.calls++
	return f.err
}

func newToolchainCheckService(t *testing.T, runner *fakeCheckRunner, toolchain ToolchainVerifier) (*CheckService, string) {
	t.Helper()
	projects, store := openProjectService(t)
	revisionID := createCheckRevisionFixture(t, projects)
	artifacts, err := programmingartifact.NewStore(filepath.Join(t.TempDir(), "artifacts"))
	if err != nil {
		t.Fatal(err)
	}
	options := CheckServiceOptions{Store: store, Runner: runner, Packager: &fakePackager{},
		Artifacts: artifacts, TargetID: "controller-local", LeaseDuration: time.Minute,
		Now: func() time.Time { return time.Date(2026, 9, 26, 5, 0, 0, 0, time.UTC) }}
	if toolchain != nil {
		options.Toolchain = toolchain
	}
	checks, err := NewCheckService(options)
	if err != nil {
		t.Fatal(err)
	}
	return checks, revisionID
}

func requestAndProcessCheck(t *testing.T, checks *CheckService, revisionID string) CheckView {
	t.Helper()
	accepted, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"}, RequestCheckCommand{
		RevisionID: revisionID, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
		IdempotencyKey: "30000000-0000-4000-8000-000000000904", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	processed, err := checks.ProcessNext(context.Background())
	if err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
	view, err := checks.GetCheck(context.Background(), accepted.CheckID)
	if err != nil {
		t.Fatal(err)
	}
	return view
}

func assertToolchainFailure(t *testing.T, view CheckView) {
	t.Helper()
	// Foxlinx 2026-09-26: lệch bản từng giữ Check RUNNING tới hết lease rồi đóng
	// bằng ST-WORKER-CRASH. Phải kết thúc NGAY ở lần xử lý đầu, với mã riêng.
	if view.State != "FAILED" || len(view.Diagnostics) != 1 {
		t.Fatalf("Check phải FAILED ngay với đúng một diagnostic, nhận state=%s diagnostics=%+v", view.State, view.Diagnostics)
	}
	diagnostic := view.Diagnostics[0]
	if diagnostic.DetailCode != "ST-WORKER-TOOLCHAIN" || diagnostic.Code != string(domain.ErrUnavailable) ||
		diagnostic.Severity != "ERROR" {
		t.Fatalf("diagnostic=%+v, muốn ST-WORKER-TOOLCHAIN / %s", diagnostic, domain.ErrUnavailable)
	}
	if view.AttemptCount != 1 {
		t.Fatalf("lệch bản là tất định, không được thử lại: attemptCount=%d", view.AttemptCount)
	}
}

func TestCheckServiceFailsFastWithoutCompilingWhenToolchainMismatch(t *testing.T) {
	runner := &fakeCheckRunner{}
	toolchain := &fakeToolchain{err: fmt.Errorf("%w: compiler /usr/sbin/mkddc-st-compile: profile_sha256=d2866c41 (web cần %s)",
		programmingcompiler.ErrToolchainMismatch, domain.ProfileSHA256)}
	checks, revisionID := newToolchainCheckService(t, runner, toolchain)
	view := requestAndProcessCheck(t, checks, revisionID)
	assertToolchainFailure(t, view)
	if toolchain.calls != 1 || runner.input.SourceID != "" {
		t.Fatalf("phải dò toolchain một lần và KHÔNG gọi compiler: probe=%d compiledSource=%q", toolchain.calls, runner.input.SourceID)
	}
}

func TestCheckServiceFailsFastWhenCompilerOutputBelongsToOtherProfile(t *testing.T) {
	runner := &fakeCheckRunner{err: fmt.Errorf("%w: %w: compiler profile revA-1t-1-5-30 sha256=d2866c41",
		programmingcompiler.ErrInvalidOutput, programmingcompiler.ErrToolchainMismatch)}
	checks, revisionID := newToolchainCheckService(t, runner, nil)
	assertToolchainFailure(t, requestAndProcessCheck(t, checks, revisionID))
}

func TestCheckServiceProbeErrorThatIsNotMismatchDoesNotBlockCheck(t *testing.T) {
	// `--version` quá hạn khi máy bận không phải bằng chứng lệch bản: Check vẫn
	// chạy và tự chịu kết quả của compiler.
	runner := &fakeCheckRunner{err: errors.New("compiler crash giả")}
	toolchain := &fakeToolchain{err: errors.New("compiler --version: signal: killed")}
	checks, revisionID := newToolchainCheckService(t, runner, toolchain)
	accepted, err := checks.RequestCheck(context.Background(), Actor{ID: testActorID, Role: "admin"}, RequestCheckCommand{
		RevisionID: revisionID, SchemaVersion: "1.0", TargetProfile: checkTargetProfile,
		IdempotencyKey: "30000000-0000-4000-8000-000000000905", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := checks.ProcessNext(context.Background()); err == nil {
		t.Fatal("lỗi compiler phải được trả ra để worker log, như trước")
	}
	view, err := checks.GetCheck(context.Background(), accepted.CheckID)
	if err != nil || view.State != "RUNNING" || runner.input.SourceID == "" {
		t.Fatalf("lỗi dò không tất định không được chặn biên dịch: view=%+v compiled=%q err=%v", view, runner.input.SourceID, err)
	}
}
