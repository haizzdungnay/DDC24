package compiler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"time"
)

const (
	MaxArtifactBytes = 1 << 20
	maxManifestBytes = 256 << 10
	maxStdoutBytes   = 2 << 20
	maxStderrBytes   = 64 << 10
)

var (
	ErrTimeout       = errors.New("compiler timeout")
	ErrCrashed       = errors.New("compiler crash")
	ErrInvalidOutput = errors.New("compiler output không hợp lệ")
)

type Input struct {
	SourceID string
	Language string
	Source   []byte
	// IoMap là Binding Manifest (F-PROG-ASBUILT-013/D-07,
	// REV-PROG-ASBUILT-GAP-2026-08-14) — mỗi entry map một VAR_INPUT/VAR_OUTPUT
	// ST khai báo trong Source tới một Point thật. Rỗng = hành vi cũ trước vá
	// (không --io-map-in, artifact không mang binding nào). Validate/reject
	// (unknown var, type/direction sai, category không hỗ trợ, trùng
	// biến/trùng physical output...) là trách nhiệm của compiler CLI
	// (`resolve_io_bindings()`), không lặp logic đó ở đây.
	IoMap []IoMapEntry
}

// IoMapEntry khớp field-for-field với `core::StIoMapEntry` JSON shape mà
// `read_io_map()` (st_compile_main.cpp) parse — đổi tên field ở một phía mà
// không đổi phía kia sẽ làm mọi Check có binding fail ở bước io_map (không
// silently mất binding).
type IoMapEntry struct {
	Variable  string  `json:"variable"`
	Direction string  `json:"direction"`
	PointID   string  `json:"pointId"`
	Type      string  `json:"type"`
	Unit      string  `json:"unit,omitempty"`
	HasRange  bool    `json:"hasRange,omitempty"`
	RangeMin  float64 `json:"rangeMin,omitempty"`
	RangeMax  float64 `json:"rangeMax,omitempty"`
	Category  string  `json:"category"`
	DeviceID  string  `json:"deviceId,omitempty"`
	Writable  bool    `json:"writable"`
}

type Diagnostic struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
	SourceID string `json:"sourceId"`
	Line     uint32 `json:"line"`
	Column   uint32 `json:"column"`
	Length   uint32 `json:"length"`
}

type Result struct {
	OK                    bool
	Diagnostics           []Diagnostic
	Artifact              []byte
	ArtifactSHA256        [32]byte
	Manifest              json.RawMessage
	CompilerVersion       string
	ArtifactSchemaVersion int
	CompilerProfile       int
	ProfileID             string
	ProfileSHA256         string
	LibraryVersion        string
	IntegrityMode         string
	TargetABI             int64
	// IoBindingCount là bằng chứng artifact THẬT SỰ mang binding (không chỉ
	// tin request đã gửi IoMap) — validateSuccess() ép bằng đúng
	// len(input.IoMap), 0 khi Check không gửi io_map (hành vi cũ, hợp lệ).
	IoBindingCount int64
}

type Runner interface {
	Compile(context.Context, Input) (Result, error)
}

type ProcessRunner struct {
	BinaryPath  string
	ScratchRoot string
	Timeout     time.Duration
}

type cliResponse struct {
	OK                      bool            `json:"ok"`
	Diagnostics             []Diagnostic    `json:"diagnostics"`
	ProgramName             *string         `json:"programName"`
	SourceID                *string         `json:"sourceId"`
	Language                *string         `json:"language"`
	Symbols                 json.RawMessage `json:"symbols"`
	Artifact                *string         `json:"artifact"`
	ArtifactBytes           *int64          `json:"artifactBytes"`
	ArtifactSHA256          *string         `json:"artifactSha256"`
	ArtifactFileSHA256      *string         `json:"artifactFileSha256"`
	ArtifactIntegritySHA256 *string         `json:"artifactIntegritySha256"`
	SourceSHA256            *string         `json:"sourceSha256"`
	BuildKeySHA256          *string         `json:"buildKeySha256"`
	Manifest                json.RawMessage `json:"manifest"`
	InstructionCount        *int64          `json:"instructionCount"`
	SlotCount               *int64          `json:"slotCount"`
	IoBindingCount          *int64          `json:"ioBindingCount"`
	HasRetain               *bool           `json:"hasRetain"`
	CompilerVersion         string          `json:"compilerVersion"`
	ArtifactSchemaVersion   int             `json:"artifactSchemaVersion"`
	CompilerProfile         *int            `json:"compilerProfile"`
	ProfileID               *string         `json:"profileId"`
	ProfileSHA256           *string         `json:"profileSha256"`
	LibraryVersion          *string         `json:"libraryVersion"`
	IntegrityMode           *string         `json:"integrityMode"`
	SignaturePresent        *bool           `json:"signaturePresent"`
	TargetABI               int64           `json:"targetAbi"`
}

func (r ProcessRunner) Compile(ctx context.Context, input Input) (Result, error) {
	if r.BinaryPath == "" || r.ScratchRoot == "" || r.Timeout < time.Second || r.Timeout > time.Minute ||
		(input.Language != "ST" && input.Language != "FBD") || len(input.Source) == 0 || len(input.Source) > 65536 ||
		len(input.SourceID) < 1 || len(input.SourceID) > 128 || strings.ContainsAny(input.SourceID, "/\\") {
		return Result{}, fmt.Errorf("tham số compiler worker không hợp lệ")
	}
	if len(input.IoMap) > 256 {
		return Result{}, fmt.Errorf("tham số compiler worker không hợp lệ")
	}
	for _, entry := range input.IoMap {
		if !boundedLen(entry.Variable, 1, 128) || !boundedLen(entry.PointID, 1, 64) ||
			(entry.Direction != "input" && entry.Direction != "output") ||
			!boundedLen(entry.Type, 1, 16) || !boundedLen(entry.Category, 1, 16) ||
			len(entry.Unit) > 32 || len(entry.DeviceID) > 64 {
			return Result{}, fmt.Errorf("tham số compiler worker không hợp lệ")
		}
	}
	if err := ensurePrivateDirectory(r.ScratchRoot); err != nil {
		return Result{}, err
	}
	jobRoot, err := os.MkdirTemp(r.ScratchRoot, "check-")
	if err != nil {
		return Result{}, fmt.Errorf("tạo compiler scratch: %w", err)
	}
	defer os.RemoveAll(jobRoot)
	if err := os.Chmod(jobRoot, 0o700); err != nil {
		return Result{}, err
	}
	sourcePath := filepath.Join(jobRoot, "source.input")
	artifactPath := filepath.Join(jobRoot, "artifact.mkir")
	manifestPath := filepath.Join(jobRoot, "manifest.json")
	if err := writeExclusive(sourcePath, input.Source, 0o600); err != nil {
		return Result{}, err
	}
	args := []string{"--source", sourcePath, "--language", input.Language, "--source-id", input.SourceID,
		"--out", artifactPath, "--manifest-out", manifestPath}
	if len(input.IoMap) > 0 {
		ioMapPath := filepath.Join(jobRoot, "io_map.json")
		ioMapJSON, err := json.Marshal(struct {
			Entries []IoMapEntry `json:"entries"`
		}{Entries: input.IoMap})
		if err != nil {
			return Result{}, err
		}
		if err := writeExclusive(ioMapPath, ioMapJSON, 0o600); err != nil {
			return Result{}, err
		}
		args = append(args, "--io-map-in", ioMapPath)
	}
	args = append(args, "--sandbox")

	compileCtx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()
	stdout, stderr := &boundedBuffer{limit: maxStdoutBytes}, &boundedBuffer{limit: maxStderrBytes}
	cmd := exec.CommandContext(compileCtx, r.BinaryPath, args...)
	cmd.Dir = jobRoot
	cmd.Env = []string{"LANG=C", "LC_ALL=C", "TZ=UTC", "PATH=/usr/bin:/bin"}
	cmd.Stdin = nil
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
			return err
		}
		return nil
	}
	cmd.WaitDelay = 500 * time.Millisecond
	runErr := cmd.Run()
	if compileCtx.Err() != nil {
		return Result{}, fmt.Errorf("%w: deadline", ErrTimeout)
	}
	if stdout.overflow || stderr.overflow {
		return Result{}, fmt.Errorf("%w: stdout/stderr vượt giới hạn", ErrInvalidOutput)
	}
	response, decodeErr := decodeCLIResponse(stdout.Bytes())
	if decodeErr != nil {
		if runErr != nil {
			return Result{}, fmt.Errorf("%w: exit không có JSON hợp lệ", ErrCrashed)
		}
		return Result{}, decodeErr
	}
	if runErr != nil {
		var exitErr *exec.ExitError
		if !errors.As(runErr, &exitErr) || !exitErr.Exited() {
			return Result{}, fmt.Errorf("%w: process bị signal", ErrCrashed)
		}
		if exitErr.ExitCode() != 1 && exitErr.ExitCode() != 2 {
			return Result{}, fmt.Errorf("%w: exit=%d", ErrCrashed, exitErr.ExitCode())
		}
		if response.OK || len(response.Diagnostics) == 0 {
			return Result{}, fmt.Errorf("%w: exit lỗi nhưng response thành công/rỗng", ErrInvalidOutput)
		}
		return Result{OK: false, Diagnostics: response.Diagnostics, CompilerVersion: response.CompilerVersion,
			ArtifactSchemaVersion: response.ArtifactSchemaVersion, TargetABI: response.TargetABI}, nil
	}
	if !response.OK {
		return Result{}, fmt.Errorf("%w: exit 0 nhưng ok=false", ErrInvalidOutput)
	}
	return validateSuccess(response, artifactPath, manifestPath, input)
}

func boundedLen(text string, min, max int) bool {
	return len(text) >= min && len(text) <= max
}

func decodeCLIResponse(raw []byte) (cliResponse, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var response cliResponse
	if err := decoder.Decode(&response); err != nil {
		return cliResponse{}, fmt.Errorf("%w: JSON: %v", ErrInvalidOutput, err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return cliResponse{}, fmt.Errorf("%w: nhiều JSON value", ErrInvalidOutput)
	}
	if response.CompilerVersion != "fwsom-st-1.2.0" || response.ArtifactSchemaVersion != 1 || response.TargetABI != 3841 {
		return cliResponse{}, fmt.Errorf("%w: version/ABI", ErrInvalidOutput)
	}
	return response, nil
}

func validateSuccess(response cliResponse, artifactPath, manifestPath string, input Input) (Result, error) {
	if response.Artifact == nil || response.ArtifactBytes == nil || response.ArtifactSHA256 == nil ||
		response.ArtifactFileSHA256 == nil || response.ArtifactIntegritySHA256 == nil || response.Manifest == nil || response.CompilerProfile == nil ||
		response.ProfileID == nil || response.ProfileSHA256 == nil || response.LibraryVersion == nil ||
		response.IntegrityMode == nil || response.SignaturePresent == nil || *response.SignaturePresent ||
		response.SourceSHA256 == nil || response.BuildKeySHA256 == nil ||
		response.SourceID == nil || *response.SourceID != input.SourceID || response.Language == nil || *response.Language != input.Language ||
		response.IoBindingCount == nil || *response.IoBindingCount != int64(len(input.IoMap)) ||
		*response.CompilerProfile != 1 || *response.ProfileID != "revA-1t-1-5-30" ||
		*response.ProfileSHA256 != "94c58ffa552f33cbcef530c82cd0203d492a5308f8312040e569f4354a1f3bdc" ||
		*response.LibraryVersion != "rev-a.1" ||
		*response.IntegrityMode != "HASH_ONLY" {
		return Result{}, fmt.Errorf("%w: metadata success thiếu/sai", ErrInvalidOutput)
	}
	artifact, err := readBoundedRegularFile(artifactPath, MaxArtifactBytes)
	if err != nil {
		return Result{}, err
	}
	if int64(len(artifact)) != *response.ArtifactBytes || len(artifact) == 0 {
		return Result{}, fmt.Errorf("%w: artifact size", ErrInvalidOutput)
	}
	stdoutArtifact, err := base64.StdEncoding.DecodeString(*response.Artifact)
	if err != nil || !bytes.Equal(stdoutArtifact, artifact) {
		return Result{}, fmt.Errorf("%w: artifact stdout/file", ErrInvalidOutput)
	}
	digest := sha256.Sum256(artifact)
	if *response.ArtifactFileSHA256 != hex.EncodeToString(digest[:]) {
		return Result{}, fmt.Errorf("%w: artifact file hash", ErrInvalidOutput)
	}
	rawDigest, err := base64.StdEncoding.DecodeString(*response.ArtifactSHA256)
	integrityDigest, integrityErr := hex.DecodeString(*response.ArtifactIntegritySHA256)
	if err != nil || integrityErr != nil || len(rawDigest) != sha256.Size || !bytes.Equal(rawDigest, integrityDigest) {
		return Result{}, fmt.Errorf("%w: artifact digest", ErrInvalidOutput)
	}
	manifestRaw, err := readBoundedRegularFile(manifestPath, maxManifestBytes)
	if err != nil {
		return Result{}, err
	}
	var stdoutManifest, fileManifest any
	if json.Unmarshal(response.Manifest, &stdoutManifest) != nil || json.Unmarshal(manifestRaw, &fileManifest) != nil || !reflect.DeepEqual(stdoutManifest, fileManifest) {
		return Result{}, fmt.Errorf("%w: manifest stdout/file", ErrInvalidOutput)
	}
	canonicalManifest, err := json.Marshal(fileManifest)
	if err != nil {
		return Result{}, err
	}
	var envelope struct {
		ManifestVersion int `json:"manifestVersion"`
		Source          struct {
			SourceID        string `json:"sourceId"`
			Language        string `json:"language"`
			CanonicalSHA256 string `json:"canonicalSha256"`
		} `json:"source"`
		Artifact struct {
			Bytes            int64  `json:"bytes"`
			FileSHA256       string `json:"fileSha256"`
			IntegritySHA256  string `json:"integritySha256"`
			IntegrityMode    string `json:"integrityMode"`
			SchemaVersion    int    `json:"schemaVersion"`
			SignaturePresent bool   `json:"signaturePresent"`
		} `json:"artifact"`
		Profile struct {
			Code           int    `json:"code"`
			ID             string `json:"id"`
			SHA256         string `json:"sha256"`
			LibraryVersion string `json:"libraryVersion"`
		} `json:"profile"`
		Target struct {
			ABI int64 `json:"abi"`
		} `json:"target"`
		Compiler struct {
			Version string `json:"version"`
		} `json:"compiler"`
		BuildKeySHA256 string `json:"buildKeySha256"`
	}
	if json.Unmarshal(canonicalManifest, &envelope) != nil || envelope.ManifestVersion != 1 ||
		envelope.Source.SourceID != input.SourceID || envelope.Source.Language != input.Language || envelope.Source.CanonicalSHA256 != *response.SourceSHA256 ||
		envelope.Artifact.Bytes != int64(len(artifact)) || envelope.Artifact.FileSHA256 != *response.ArtifactFileSHA256 ||
		envelope.Artifact.IntegritySHA256 != *response.ArtifactIntegritySHA256 || envelope.Artifact.IntegrityMode != "HASH_ONLY" ||
		envelope.Artifact.SchemaVersion != 1 || envelope.Artifact.SignaturePresent || envelope.Profile.Code != 1 ||
		envelope.Profile.ID != *response.ProfileID || envelope.Profile.SHA256 != *response.ProfileSHA256 || envelope.Profile.LibraryVersion != *response.LibraryVersion ||
		envelope.Target.ABI != response.TargetABI || envelope.Compiler.Version != response.CompilerVersion || envelope.BuildKeySHA256 != *response.BuildKeySHA256 {
		return Result{}, fmt.Errorf("%w: manifest metadata/provenance", ErrInvalidOutput)
	}
	return Result{OK: true, Diagnostics: response.Diagnostics, Artifact: artifact, ArtifactSHA256: digest,
		Manifest: canonicalManifest, CompilerVersion: response.CompilerVersion, ArtifactSchemaVersion: response.ArtifactSchemaVersion,
		CompilerProfile: *response.CompilerProfile, ProfileID: *response.ProfileID, ProfileSHA256: *response.ProfileSHA256,
		LibraryVersion: *response.LibraryVersion, IntegrityMode: *response.IntegrityMode, TargetABI: response.TargetABI,
		IoBindingCount: *response.IoBindingCount}, nil
}

func ensurePrivateDirectory(root string) error {
	abs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return fmt.Errorf("tạo scratch root: %w", err)
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("scratch root phải là directory, không symlink")
	}
	return os.Chmod(abs, 0o700)
}

func writeExclusive(path string, data []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	return err
}

func readBoundedRegularFile(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("%w: output thiếu", ErrInvalidOutput)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() < 1 || info.Size() > limit {
		return nil, fmt.Errorf("%w: output type/size", ErrInvalidOutput)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, limit+1))
}

type boundedBuffer struct {
	bytes.Buffer
	limit    int
	overflow bool
}

func (b *boundedBuffer) Write(value []byte) (int, error) {
	remaining := b.limit - b.Len()
	if remaining > 0 {
		chunk := value
		if len(chunk) > remaining {
			chunk = chunk[:remaining]
		}
		_, _ = b.Buffer.Write(chunk)
	}
	if len(value) > remaining {
		b.overflow = true
	}
	return len(value), nil
}
