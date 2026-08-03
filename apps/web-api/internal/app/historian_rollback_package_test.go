package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestHistorianRollbackPackageCommandBuildsCandidateAndBindsFixtures(t *testing.T) {
	fixtureDir := t.TempDir()
	legacyPath := filepath.Join(fixtureDir, "legacy.sqlite")
	store, err := OpenHistorianStore(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	app, policy, cancel := historianMaintenanceAppTest(t)
	defer cancel()
	_, err = app.RunHistorianMaintenanceCutover(context.Background(), HistorianMaintenanceRequest{
		Manifest: MigrationManifest{
			MigrationID: "package-active", NamespaceRevision: 1, PolicyRevision: 1,
			SchemaID: "hist-v1", TimestampRuleVersion: 1, AliasRuleVersion: 1,
			Mappings: []MigrationMapping{{LegacyStorageID: "UI-01", CanonicalPointID: "UI-01", Generation: 1}},
		},
		PolicyConfig: policy, BackupPath: filepath.Join(fixtureDir, "final.sqlite"), StableUTCMS: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	activePath := app.historianV2.path
	if err := app.historianV2.Close(); err != nil {
		t.Fatal(err)
	}

	archivePath := filepath.Join(fixtureDir, "archive.block")
	evidencePath := filepath.Join(fixtureDir, "cutover-evidence.json")
	legacyWALPath := legacyPath + "-wal"
	if err := os.WriteFile(archivePath, []byte("immutable archive"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(evidencePath, []byte(`{"kind":"fixture-evidence"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacyWALPath, []byte("frozen sidecar evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	paths := []string{legacyPath, legacyWALPath, activePath, archivePath, evidencePath}
	before := make(map[string][]byte, len(paths))
	for _, path := range paths {
		before[path], err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
	}

	outputDir := t.TempDir()
	_, testFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("không xác định được đường dẫn tệp kiểm thử")
	}
	sourceDir := filepath.Clean(filepath.Join(filepath.Dir(testFile), "..", ".."))
	var stdout strings.Builder
	err = runHistorianRollbackPackageCommand([]string{
		"--source-dir", sourceDir,
		"--output-dir", outputDir,
		"--fixture", legacyPath,
		"--fixture", activePath,
		"--artifact", archivePath,
		"--artifact", evidencePath,
	}, &stdout)
	if err != nil {
		t.Fatal(err)
	}
	manifestBytes, err := os.ReadFile(filepath.Join(outputDir, "historian-rollback-package-evidence.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest HistorianRollbackPackageEvidence
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.SchemaVersion != historianRollbackPackageSchemaVersion || manifest.Kind != "historian-rollback-package" {
		t.Fatalf("manifest header=%+v", manifest)
	}
	if manifest.Current.SHA256 == "" || manifest.Rollback.SHA256 == "" || manifest.Current.SHA256 != manifest.Rollback.SHA256 {
		t.Fatalf("binary parity=%+v", manifest)
	}
	if manifest.Current.GOOS != runtime.GOOS || manifest.Current.GOARCH != runtime.GOARCH || manifest.Rollback.CGOEnabled != manifest.Current.CGOEnabled {
		t.Fatalf("build metadata current=%+v rollback=%+v", manifest.Current, manifest.Rollback)
	}
	if len(manifest.Artifacts) != len(paths) {
		t.Fatalf("artifact evidence=%+v", manifest.Artifacts)
	}
	states := make(map[string]bool)
	for _, artifact := range manifest.Artifacts {
		if !artifact.Unchanged || artifact.SHA256Before != artifact.SHA256After {
			t.Fatalf("artifact evidence=%+v", manifest.Artifacts)
		}
		if artifact.Role == "sqlite-fixture" {
			if !strings.Contains(artifact.CurrentVerificationOutput, `"schemaVersion":5`) || !strings.Contains(artifact.VerificationOutput, `"schemaVersion":5`) {
				t.Fatalf("verification output current=%q rollback=%q", artifact.CurrentVerificationOutput, artifact.VerificationOutput)
			}
			if strings.Contains(artifact.VerificationOutput, `"state":"legacy"`) {
				states["legacy"] = true
			}
			if strings.Contains(artifact.VerificationOutput, `"state":"active"`) {
				states["active"] = true
			}
		}
	}
	if !states["legacy"] || !states["active"] {
		t.Fatalf("fixture states=%v", states)
	}
	for _, path := range paths {
		after, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if string(before[path]) != string(after) {
			t.Fatalf("packaged verifier mutated %s", path)
		}
	}
	if !strings.Contains(stdout.String(), "historian-rollback-package-evidence.json") {
		t.Fatalf("stdout=%q", stdout.String())
	}
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	prebuiltOutput := t.TempDir()
	stdout.Reset()
	if err := runHistorianRollbackPackageCommand([]string{
		"--output-dir", prebuiltOutput,
		"--current-binary", filepath.Join(outputDir, "mkddc-web-current"+suffix),
		"--rollback-binary", filepath.Join(outputDir, "mkddc-web-rollback-candidate"+suffix),
		"--fixture", legacyPath,
		"--fixture", activePath,
		"--artifact", archivePath,
		"--artifact", evidencePath,
	}, &stdout); err != nil {
		t.Fatal(err)
	}
	prebuiltBytes, err := os.ReadFile(filepath.Join(prebuiltOutput, historianRollbackPackageManifestName))
	if err != nil {
		t.Fatal(err)
	}
	var prebuilt HistorianRollbackPackageEvidence
	if err := json.Unmarshal(prebuiltBytes, &prebuilt); err != nil {
		t.Fatal(err)
	}
	if prebuilt.PackageMode != "prebuilt-native" || prebuilt.Current.SHA256 != manifest.Current.SHA256 || len(prebuilt.Artifacts) != len(manifest.Artifacts) {
		t.Fatalf("prebuilt evidence=%+v", prebuilt)
	}
}

func TestHistorianRollbackPackageCommandRequiresFixture(t *testing.T) {
	var stdout strings.Builder
	if err := runHistorianRollbackPackageCommand([]string{"--output-dir", t.TempDir()}, &stdout); err == nil {
		t.Fatal("expected missing fixture rejection")
	}
}

func TestHistorianRollbackPackageCommandRequiresBothPrebuiltBinaries(t *testing.T) {
	var stdout strings.Builder
	if err := runHistorianRollbackPackageCommand([]string{
		"--output-dir", t.TempDir(),
		"--fixture", filepath.Join(t.TempDir(), "missing.sqlite"),
		"--current-binary", "current",
	}, &stdout); err == nil {
		t.Fatal("expected incomplete prebuilt pair rejection")
	}
}
