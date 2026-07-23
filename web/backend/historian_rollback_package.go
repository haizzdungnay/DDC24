package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"debug/buildinfo"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const (
	historianRollbackPackageSchemaVersion = 1
	historianRollbackPackageManifestName  = "historian-rollback-package-evidence.json"
	rollbackPackageOutputLimit            = 4096
)

type HistorianRollbackPackageBinary struct {
	Name          string            `json:"name"`
	Path          string            `json:"path"`
	SHA256        string            `json:"sha256"`
	Size          int64             `json:"size"`
	GoVersion     string            `json:"goVersion"`
	GOOS          string            `json:"goos"`
	GOARCH        string            `json:"goarch"`
	CGOEnabled    string            `json:"cgoEnabled"`
	BuildSettings map[string]string `json:"buildSettings"`
}

type HistorianRollbackPackageArtifact struct {
	Path                      string `json:"path"`
	Role                      string `json:"role"`
	SHA256Before              string `json:"sha256Before"`
	SHA256After               string `json:"sha256After"`
	SizeBefore                int64  `json:"sizeBefore"`
	SizeAfter                 int64  `json:"sizeAfter"`
	Unchanged                 bool   `json:"unchanged"`
	CurrentVerificationOutput string `json:"currentVerificationOutput,omitempty"`
	VerificationOutput        string `json:"rollbackVerificationOutput,omitempty"`
}

type HistorianRollbackPackageEvidence struct {
	SchemaVersion    int                                `json:"schemaVersion"`
	Kind             string                             `json:"kind"`
	PackageMode      string                             `json:"packageMode"`
	GeneratedAtUTC   string                             `json:"generatedAtUtc"`
	VerificationHost string                             `json:"verificationHost"`
	GoCommandVersion string                             `json:"goCommandVersion"`
	BuildCommand     []string                           `json:"buildCommand"`
	Current          HistorianRollbackPackageBinary     `json:"current"`
	Rollback         HistorianRollbackPackageBinary     `json:"rollback"`
	Artifacts        []HistorianRollbackPackageArtifact `json:"artifacts"`
}

type historianRollbackPackageOptions struct {
	SourceDir      string
	OutputDir      string
	CurrentBinary  string
	RollbackBinary string
	Fixtures       stringListFlag
	Artifacts      stringListFlag
	Timeout        time.Duration
}

type stringListFlag []string

func (values *stringListFlag) String() string { return strings.Join(*values, ",") }

func (values *stringListFlag) Set(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("path must not be empty")
	}
	*values = append(*values, value)
	return nil
}

func parseHistorianRollbackPackageCLI(args []string) (historianRollbackPackageOptions, error) {
	opts := historianRollbackPackageOptions{SourceDir: ".", Timeout: 30 * time.Minute}
	flags := flag.NewFlagSet("historian-rollback-package", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&opts.SourceDir, "source-dir", opts.SourceDir, "backend Go module directory")
	flags.StringVar(&opts.OutputDir, "output-dir", "", "new release evidence output directory")
	flags.StringVar(&opts.CurrentBinary, "current-binary", "", "prebuilt native current backend")
	flags.StringVar(&opts.RollbackBinary, "rollback-binary", "", "prebuilt native rollback candidate")
	flags.Var(&opts.Fixtures, "fixture", "schema-v5 SQLite fixture; repeat for legacy and active")
	flags.Var(&opts.Artifacts, "artifact", "immutable archive/evidence file; repeat as needed")
	flags.DurationVar(&opts.Timeout, "timeout", opts.Timeout, "maximum package gate duration")
	if err := flags.Parse(args); err != nil {
		return opts, err
	}
	if flags.NArg() != 0 {
		return opts, fmt.Errorf("unexpected positional arguments")
	}
	if opts.OutputDir == "" || len(opts.Fixtures) == 0 {
		return opts, fmt.Errorf("output-dir and at least one fixture are required")
	}
	if (opts.CurrentBinary == "") != (opts.RollbackBinary == "") {
		return opts, fmt.Errorf("current-binary and rollback-binary must be supplied together")
	}
	if opts.Timeout < time.Second || opts.Timeout > time.Hour {
		return opts, fmt.Errorf("timeout must be between 1s and 1h")
	}
	return opts, nil
}

func runHistorianRollbackPackageCommand(args []string, stdout io.Writer) error {
	opts, err := parseHistorianRollbackPackageCLI(args)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), opts.Timeout)
	defer cancel()

	outputDir, err := filepath.Abs(opts.OutputDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return fmt.Errorf("create package output: %w", err)
	}
	manifestPath := filepath.Join(outputDir, historianRollbackPackageManifestName)
	if _, err := os.Lstat(manifestPath); err == nil {
		return fmt.Errorf("release evidence manifest already exists")
	} else if !os.IsNotExist(err) {
		return err
	}

	packageMode := "source-build"
	goVersion := ""
	buildCommand := []string(nil)
	var currentPath, rollbackPath string
	var target [3]string
	if opts.CurrentBinary != "" {
		packageMode = "prebuilt-native"
		currentPath, err = filepath.Abs(opts.CurrentBinary)
		if err != nil {
			return err
		}
		rollbackPath, err = filepath.Abs(opts.RollbackBinary)
		if err != nil {
			return err
		}
		if currentPath == rollbackPath {
			return fmt.Errorf("current and rollback binaries must be separate files")
		}
		if _, err := absoluteUniqueRegularFiles([]string{currentPath, rollbackPath}, false); err != nil {
			return fmt.Errorf("validate prebuilt binaries: %w", err)
		}
		target, err = rollbackPackageNativeTarget(currentPath)
		if err != nil {
			return err
		}
	} else {
		sourceDir, err := filepath.Abs(opts.SourceDir)
		if err != nil {
			return err
		}
		if info, err := os.Stat(filepath.Join(sourceDir, "go.mod")); err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("source-dir must contain go.mod")
		}
		suffix := ""
		if runtime.GOOS == "windows" {
			suffix = ".exe"
		}
		currentPath = filepath.Join(outputDir, "mkddc-web-current"+suffix)
		rollbackPath = filepath.Join(outputDir, "mkddc-web-rollback-candidate"+suffix)
		buildArgs := []string{"build", "-trimpath", "-buildvcs=false", "-o"}
		if err := runRollbackPackageGoBuild(ctx, sourceDir, currentPath, buildArgs); err != nil {
			return fmt.Errorf("build current backend: %w", err)
		}
		if err := runRollbackPackageGoBuild(ctx, sourceDir, rollbackPath, buildArgs); err != nil {
			return fmt.Errorf("build rollback candidate: %w", err)
		}
		goVersion, target, err = rollbackPackageGoMetadata(ctx, sourceDir)
		if err != nil {
			return err
		}
		buildCommand = append(append([]string{"go"}, buildArgs...), "<binary>", ".")
	}
	current, err := rollbackPackageBinaryEvidence("current", currentPath, target)
	if err != nil {
		return err
	}
	rollback, err := rollbackPackageBinaryEvidence("rollback-candidate", rollbackPath, target)
	if err != nil {
		return err
	}
	if current.SHA256 != rollback.SHA256 || current.Size != rollback.Size || current.GOOS != rollback.GOOS || current.GOARCH != rollback.GOARCH || current.CGOEnabled != rollback.CGOEnabled {
		return fmt.Errorf("current and rollback candidate builds are not byte/build-metadata compatible")
	}

	fixtureSet, err := absoluteUniqueRegularFiles(opts.Fixtures, false)
	if err != nil {
		return err
	}
	artifactSet, err := absoluteUniqueRegularFiles(append(append([]string{}, opts.Fixtures...), opts.Artifacts...), true)
	if err != nil {
		return err
	}
	artifacts := make([]HistorianRollbackPackageArtifact, 0, len(artifactSet))
	for path := range artifactSet {
		digest, size, err := rollbackPackageHashFile(path)
		if err != nil {
			return err
		}
		role := "artifact"
		if _, ok := fixtureSet[path]; ok {
			role = "sqlite-fixture"
		}
		artifacts = append(artifacts, HistorianRollbackPackageArtifact{Path: path, Role: role, SHA256Before: digest, SizeBefore: size})
	}
	for i := range artifacts {
		if artifacts[i].Role != "sqlite-fixture" {
			continue
		}
		currentOutput, err := runPackagedRollbackVerifier(ctx, currentPath, artifacts[i].Path)
		if err != nil {
			return fmt.Errorf("current backend fixture %s: %w", artifacts[i].Path, err)
		}
		rollbackOutput, err := runPackagedRollbackVerifier(ctx, rollbackPath, artifacts[i].Path)
		if err != nil {
			return fmt.Errorf("rollback candidate fixture %s: %w", artifacts[i].Path, err)
		}
		artifacts[i].CurrentVerificationOutput = currentOutput
		artifacts[i].VerificationOutput = rollbackOutput
	}
	afterSet, err := absoluteUniqueRegularFiles(append(append([]string{}, opts.Fixtures...), opts.Artifacts...), true)
	if err != nil {
		return err
	}
	if len(afterSet) != len(artifactSet) {
		return fmt.Errorf("rollback package verification changed the artifact file set")
	}
	for path := range artifactSet {
		if _, ok := afterSet[path]; !ok {
			return fmt.Errorf("rollback package verification changed the artifact file set")
		}
	}
	for i := range artifacts {
		digest, size, err := rollbackPackageHashFile(artifacts[i].Path)
		if err != nil {
			return err
		}
		artifacts[i].SHA256After = digest
		artifacts[i].SizeAfter = size
		artifacts[i].Unchanged = digest == artifacts[i].SHA256Before && size == artifacts[i].SizeBefore
		if !artifacts[i].Unchanged {
			return fmt.Errorf("rollback package verification mutated artifact %s", artifacts[i].Path)
		}
	}

	evidence := HistorianRollbackPackageEvidence{
		SchemaVersion:    historianRollbackPackageSchemaVersion,
		Kind:             "historian-rollback-package",
		PackageMode:      packageMode,
		GeneratedAtUTC:   time.Now().UTC().Format(time.RFC3339Nano),
		VerificationHost: runtime.GOOS + "/" + runtime.GOARCH,
		GoCommandVersion: goVersion,
		BuildCommand:     buildCommand,
		Current:          current,
		Rollback:         rollback,
		Artifacts:        artifacts,
	}
	if err := writeRollbackPackageEvidence(manifestPath, evidence); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(stdout, "{\"manifest\":%q,\"currentSha256\":%q,\"rollbackSha256\":%q,\"artifacts\":%d}\n", manifestPath, current.SHA256, rollback.SHA256, len(artifacts))
	return nil
}

func rollbackPackageNativeTarget(path string) ([3]string, error) {
	info, err := buildinfo.ReadFile(path)
	if err != nil {
		return [3]string{}, fmt.Errorf("read prebuilt package metadata: %w", err)
	}
	settings := make(map[string]string)
	for _, setting := range info.Settings {
		settings[setting.Key] = setting.Value
	}
	target := [3]string{settings["GOOS"], settings["GOARCH"], settings["CGO_ENABLED"]}
	if target[0] != runtime.GOOS || target[1] != runtime.GOARCH || target[2] == "" {
		return [3]string{}, fmt.Errorf("prebuilt package must match the native host target")
	}
	return target, nil
}

func runRollbackPackageGoBuild(ctx context.Context, sourceDir, outputPath string, prefix []string) error {
	args := append(append([]string{}, prefix...), outputPath, ".")
	cmd := exec.CommandContext(ctx, "go", args...)
	cmd.Dir = sourceDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, boundedRollbackPackageOutput(output))
	}
	return nil
}

func rollbackPackageGoMetadata(ctx context.Context, sourceDir string) (string, [3]string, error) {
	versionCommand := exec.CommandContext(ctx, "go", "version")
	versionCommand.Dir = sourceDir
	versionOutput, err := versionCommand.CombinedOutput()
	if err != nil {
		return "", [3]string{}, fmt.Errorf("go version: %w", err)
	}
	envCommand := exec.CommandContext(ctx, "go", "env", "GOOS", "GOARCH", "CGO_ENABLED")
	envCommand.Dir = sourceDir
	envOutput, err := envCommand.CombinedOutput()
	if err != nil {
		return "", [3]string{}, fmt.Errorf("go env: %w", err)
	}
	lines := strings.Fields(string(envOutput))
	if len(lines) != 3 || lines[0] != runtime.GOOS || lines[1] != runtime.GOARCH {
		return "", [3]string{}, fmt.Errorf("package gate must build and execute for the native host target")
	}
	return strings.TrimSpace(string(versionOutput)), [3]string{lines[0], lines[1], lines[2]}, nil
}

func rollbackPackageBinaryEvidence(name, path string, target [3]string) (HistorianRollbackPackageBinary, error) {
	digest, size, err := rollbackPackageHashFile(path)
	if err != nil {
		return HistorianRollbackPackageBinary{}, err
	}
	info, err := buildinfo.ReadFile(path)
	if err != nil {
		return HistorianRollbackPackageBinary{}, fmt.Errorf("read package gate build info: %w", err)
	}
	settings := make(map[string]string)
	for _, setting := range info.Settings {
		switch setting.Key {
		case "GOOS", "GOARCH", "CGO_ENABLED", "vcs", "vcs.revision", "vcs.time", "vcs.modified":
			settings[setting.Key] = setting.Value
		}
	}
	if settings["GOOS"] != target[0] || settings["GOARCH"] != target[1] || settings["CGO_ENABLED"] != target[2] {
		return HistorianRollbackPackageBinary{}, fmt.Errorf("binary build metadata does not match native package target")
	}
	return HistorianRollbackPackageBinary{Name: name, Path: path, SHA256: digest, Size: size, GoVersion: info.GoVersion, GOOS: target[0], GOARCH: target[1], CGOEnabled: target[2], BuildSettings: settings}, nil
}

func runPackagedRollbackVerifier(ctx context.Context, binaryPath, fixturePath string) (string, error) {
	cmd := exec.CommandContext(ctx, binaryPath, "historian-rollback-verify", "--db", fixturePath)
	output, err := cmd.CombinedOutput()
	bounded := boundedRollbackPackageOutput(output)
	if err != nil {
		return "", fmt.Errorf("%w: %s", err, bounded)
	}
	var result struct {
		SchemaVersion int `json:"schemaVersion"`
	}
	if err := json.Unmarshal([]byte(bounded), &result); err != nil || result.SchemaVersion != historianSchemaVersion {
		return "", fmt.Errorf("candidate emitted invalid rollback evidence")
	}
	return bounded, nil
}

func absoluteUniqueRegularFiles(paths []string, includeSQLiteSidecars bool) (map[string]struct{}, error) {
	result := make(map[string]struct{})
	for _, candidate := range paths {
		absPath, err := filepath.Abs(candidate)
		if err != nil {
			return nil, err
		}
		candidates := []string{absPath}
		if includeSQLiteSidecars {
			for _, suffix := range []string{"-wal", "-shm", "-journal"} {
				if _, err := os.Lstat(absPath + suffix); err == nil {
					candidates = append(candidates, absPath+suffix)
				} else if !os.IsNotExist(err) {
					return nil, err
				}
			}
		}
		for _, path := range candidates {
			info, err := os.Lstat(path)
			if err != nil {
				return nil, fmt.Errorf("stat package artifact %s: %w", path, err)
			}
			if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
				return nil, fmt.Errorf("package artifact must be a regular non-symlink file: %s", path)
			}
			result[path] = struct{}{}
		}
	}
	return result, nil
}

func rollbackPackageHashFile(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hash.Sum(nil)), size, nil
}

func writeRollbackPackageEvidence(path string, evidence HistorianRollbackPackageEvidence) error {
	sort.Slice(evidence.Artifacts, func(i, j int) bool { return evidence.Artifacts[i].Path < evidence.Artifacts[j].Path })
	content, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		return err
	}
	content = append(content, '\n')
	temp, err := os.OpenFile(path+".tmp", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create release evidence temp: %w", err)
	}
	removeTemp := true
	defer func() {
		if removeTemp {
			_ = os.Remove(temp.Name())
		}
	}()
	if _, err := temp.Write(content); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(temp.Name(), path); err != nil {
		return fmt.Errorf("publish release evidence: %w", err)
	}
	removeTemp = false
	return syncDirectory(filepath.Dir(path))
}

func boundedRollbackPackageOutput(output []byte) string {
	output = bytes.TrimSpace(output)
	if len(output) > rollbackPackageOutputLimit {
		output = output[:rollbackPackageOutputLimit]
	}
	return string(output)
}
