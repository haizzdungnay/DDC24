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

	"mkddc-web/internal/programming/domain"
)

const (
	// MaxArtifactBytes phải bằng trần artifact trong profile machine-readable.
	MaxArtifactBytes = domain.MaxProfileArtifactBytes
	maxManifestBytes = 1 << 20
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
	// ProgramID là identity runtime ghi trong PROGRAM_TABLE và signal publisher.
	// SourceID vẫn là objectId/source-map; hai identity được phép khác nhau.
	ProgramID string
	Language  string
	Source    []byte
	// LinkedPOUs là toàn bộ implementation FUNCTION/FUNCTION_BLOCK mà Program
	// có thể gọi. Worker ghi từng source vào scratch riêng rồi truyền một
	// pou-manifest content-addressed; không có path nào đến từ payload người dùng.
	LinkedPOUs []LinkedPOUSource
	// RootRequiresLibrary là dependency của chính PROGRAM root. Root đi qua
	// --source nên không xuất hiện trong pous[]; thiếu field riêng sẽ làm call
	// library không khai dependency vẫn được resolver chấp nhận.
	RootRequiresLibrary []LibraryRequirement
	// LibraryLock là version pin đã seal cùng Revision. Giá trị zero giữ đường
	// tương thích cho Revision v1 không dùng user POU/PROJECT Library.
	LibraryLock LibraryLock
	// PublishedSignals là contract cấp package mà semantic/lowering dùng để
	// chấp nhận SIGNAL_READ/SIGNAL_PUBLISH và đóng ref thật vào artifact.
	PublishedSignals []PublishedSignalContract
	// IoMap là Binding Manifest (F-PROG-ASBUILT-013/D-07,
	// REV-PROG-ASBUILT-GAP-2026-08-14) — mỗi entry map một VAR_INPUT/VAR_OUTPUT
	// ST khai báo trong Source tới một Point thật. Rỗng = hành vi cũ trước vá
	// (không --io-map-in, artifact không mang binding nào). Validate/reject
	// (unknown var, type/direction sai, category không hỗ trợ, trùng
	// biến/trùng physical output...) là trách nhiệm của compiler CLI
	// (`resolve_io_bindings()`), không lặp logic đó ở đây.
	IoMap []IoMapEntry
}

type PublishedSignalContract struct {
	Name               string `json:"name"`
	Type               string `json:"type"`
	PublisherProgramID string `json:"publisherProgramId"`
}

type LibraryRequirement struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Origin  string `json:"origin,omitempty"`
}

// LinkedPOUSource phân biệt POU cục bộ với implementation lấy từ Control
// Library. PROJECT_LIBRARY không được gộp với PROJECT: gộp hai nguồn làm
// package khai sai provenance và loader không thể ép library lock.
type LinkedPOUSource struct {
	Name            string
	Kind            string
	Language        string
	Source          []byte
	Origin          string
	FromLibrary     bool
	LibraryEntryID  string
	Version         string
	RequiresLibrary []LibraryRequirement
}

type LibraryLockEntry struct {
	EntryID string `json:"entryId"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Version string `json:"version"`
	Origin  string `json:"origin"`
}

type LibraryLock struct {
	SystemVersion     string             `json:"systemVersion"`
	ProjectRevisionID string             `json:"projectRevisionId"`
	Entries           []LibraryLockEntry `json:"entries"`
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
	// ExtIndex là slot EXT 1..256 do Point Catalog phân giải, CHỈ dùng cho
	// MB_RTU. Compiler không tự suy nó từ `PointID`: ánh xạ điểm Modbus sang
	// slot (register, function code, endian, chu kỳ poll) thuộc hệ Modbus RTU.
	ExtIndex int  `json:"extIndex,omitempty"`
	Writable bool `json:"writable"`
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
	LinkedPOUs     []LinkedPOU
	SignalRefs     []SignalRef
	// Symbols là bảng biến GIAO DIỆN (`VAR_INPUT`/`VAR_OUTPUT`) do compiler
	// công bố — nguồn duy nhất biết chắc một POU có những cổng nào, vì nó là
	// thứ đã thực sự parse nguồn.
	//
	// `ISS-STED-13`: CLI đã phát mảng này từ lâu và runner đã đọc nó vào
	// `compileResponse`, nhưng nó dừng lại ở đó — không ai dùng. FE trong khi
	// đó dựng chỉ mục ký hiệu bằng regex và không có cách nào biết mình đọc
	// lệch. Đem `Symbols` đi tiếp là điều kiện cần để có một phép đối chiếu.
	Symbols []Symbol
}

// Symbol là một biến giao diện của POU, đúng hình dạng CLI phát ra.
type Symbol struct {
	Name      string `json:"name"`
	Direction string `json:"direction"`
	Type      string `json:"type"`
	Slot      int    `json:"slot"`
}

type SignalRef struct {
	Name            string          `json:"name"`
	Type            string          `json:"type"`
	Read            bool            `json:"read"`
	Publish         bool            `json:"publish"`
	ReadLocation    *SourceLocation `json:"readLocation"`
	PublishLocation *SourceLocation `json:"publishLocation"`
}

type SourceLocation struct {
	Line   int `json:"line"`
	Column int `json:"column"`
	Length int `json:"length"`
}

// LinkedPOU là record compiler đã lower THẬT SỰ và là nguồn duy nhất để
// ProcessPackager sinh SEC_POU_TABLE. Backend không tự dựng lại signature từ
// Draft vì đó sẽ là một bảng thứ hai có thể trôi khỏi code đang chạy.
type LinkedPOU struct {
	Name             string   `json:"name"`
	Kind             string   `json:"kind"`
	Origin           string   `json:"origin"`
	FromLibrary      bool     `json:"fromLibrary"`
	LibraryEntryID   string   `json:"libraryEntryId"`
	Version          string   `json:"version"`
	ContentSHA256    string   `json:"contentSha256"`
	BodySHA256       string   `json:"bodySha256"`
	InstructionCount uint32   `json:"instructionCount"`
	InputNames       []string `json:"inputNames"`
	InputTypes       []string `json:"inputTypes"`
	OutputNames      []string `json:"outputNames"`
	OutputTypes      []string `json:"outputTypes"`
	HasReturnType    bool     `json:"hasReturnType"`
	ReturnType       string   `json:"returnType"`
}

type Runner interface {
	Compile(context.Context, Input) (Result, error)
}

type ProcessRunner struct {
	BinaryPath  string
	ScratchRoot string
	Timeout     time.Duration
	// SigningKeyPath — khoá RIÊNG của chính bo, dùng để ký artifact do bo biên
	// dịch (ADR-052 lớp khoá thiết bị). Bắt buộc khi profile contract đặt
	// `SIGNATURE_REQUIRED`: thiếu nó thì compiler sinh artifact không ký, Core
	// từ chối lúc nạp, và triệu chứng chỉ lộ ra ở bước Commission — xa chỗ hỏng.
	// Vì vậy Compile() từ chối NGAY khi thiếu, thay vì đẻ ra một artifact chắc
	// chắn vô dụng.
	SigningKeyPath string
}

type cliResponse struct {
	OK                      bool            `json:"ok"`
	Diagnostics             []Diagnostic    `json:"diagnostics"`
	ProgramName             *string         `json:"programName"`
	SourceID                *string         `json:"sourceId"`
	Language                *string         `json:"language"`
	Symbols                 []Symbol        `json:"symbols"`
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
	LinkedPOUs              []LinkedPOU     `json:"linkedPous"`
	SignalRefs              []SignalRef     `json:"signalRefs"`
}

func (r ProcessRunner) Compile(ctx context.Context, input Input) (Result, error) {
	// Revision v1 không tách objectId/runtime programId. Giữ tương thích bằng
	// đúng identity nguồn; Revision v2 luôn truyền ProgramID tường minh.
	if input.ProgramID == "" {
		input.ProgramID = input.SourceID
	}
	// T59-607 — fail-closed ngay ở biên: profile đòi chữ ký mà worker không có
	// khoá thì mọi artifact sinh ra đều bị Core từ chối. Báo tại đây để lỗi chỉ
	// tay vào cấu hình, không tay vào Commission.
	if domain.ProfileIntegrityMode == "SIGNATURE_REQUIRED" && r.SigningKeyPath == "" {
		return Result{}, fmt.Errorf("profile %s đòi SIGNATURE_REQUIRED nhưng compiler worker không được cấu hình khoá ký (PROGRAMMING_SIGNING_KEY)", domain.ProfileID)
	}
	if r.BinaryPath == "" || r.ScratchRoot == "" || r.Timeout < time.Second || r.Timeout > time.Minute ||
		(input.Language != "ST" && input.Language != "FBD") || len(input.Source) == 0 || len(input.Source) > 65536 ||
		len(input.SourceID) < 1 || len(input.SourceID) > 128 || strings.ContainsAny(input.SourceID, "/\\") ||
		len(input.ProgramID) < 1 || len(input.ProgramID) > 64 || strings.ContainsAny(input.ProgramID, "/\\\x00") {
		return Result{}, fmt.Errorf("tham số compiler worker không hợp lệ")
	}
	if len(input.IoMap) > 256 {
		return Result{}, fmt.Errorf("tham số compiler worker không hợp lệ")
	}
	if err := validatePublishedSignals(input); err != nil {
		return Result{}, err
	}
	if err := validateLinkedInputs(input); err != nil {
		return Result{}, err
	}
	for _, entry := range input.IoMap {
		if !boundedLen(entry.Variable, 1, 128) || !boundedLen(entry.PointID, 1, 64) ||
			(entry.Direction != "input" && entry.Direction != "output") ||
			!boundedLen(entry.Type, 1, 16) || !boundedLen(entry.Category, 1, 16) ||
			len(entry.Unit) > 32 || len(entry.DeviceID) > 64 {
			return Result{}, fmt.Errorf("tham số compiler worker không hợp lệ")
		}
		// `extIndex` chỉ có nghĩa với MB_RTU. Cho nó đi kèm category khác là mở
		// một trường vô nghĩa mà lớp sau phải đoán xem có nên tin hay không.
		if entry.Category == "MB_RTU" {
			if entry.ExtIndex < 1 || entry.ExtIndex > 256 || entry.DeviceID == "" {
				return Result{}, fmt.Errorf("tham số compiler worker không hợp lệ")
			}
		} else if entry.ExtIndex != 0 {
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
	if r.SigningKeyPath != "" {
		args = append(args, "--key", r.SigningKeyPath)
	}
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
	if len(input.LinkedPOUs) > 0 || len(input.RootRequiresLibrary) > 0 {
		pouItems := make([]map[string]any, 0, len(input.LinkedPOUs))
		for index, pou := range input.LinkedPOUs {
			filename := fmt.Sprintf("pou-%04d.src", index)
			if err := writeExclusive(filepath.Join(jobRoot, filename), pou.Source, 0o600); err != nil {
				return Result{}, err
			}
			digest := sha256.Sum256(pou.Source)
			item := map[string]any{
				"name": pou.Name, "kind": pou.Kind, "language": pou.Language,
				"path": filename, "contentSha256": hex.EncodeToString(digest[:]),
				"origin": pou.Origin, "fromLibrary": pou.FromLibrary,
			}
			if pou.LibraryEntryID != "" {
				item["entryId"] = pou.LibraryEntryID
				item["version"] = pou.Version
			}
			if len(pou.RequiresLibrary) > 0 {
				item["requiresLibrary"] = pou.RequiresLibrary
			}
			pouItems = append(pouItems, item)
		}
		payload, err := json.Marshal(map[string]any{"schemaVersion": 1, "pous": pouItems,
			"rootRequiresLibrary": input.RootRequiresLibrary})
		if err != nil {
			return Result{}, err
		}
		path := filepath.Join(jobRoot, "pou-manifest.json")
		if err := writeExclusive(path, payload, 0o600); err != nil {
			return Result{}, err
		}
		args = append(args, "--pou-manifest", path)
	}
	if len(input.PublishedSignals) > 0 {
		payload, err := json.Marshal(struct {
			SchemaVersion int                       `json:"schemaVersion"`
			ProgramID     string                    `json:"programId"`
			Signals       []PublishedSignalContract `json:"signals"`
		}{SchemaVersion: 1, ProgramID: input.ProgramID, Signals: input.PublishedSignals})
		if err != nil {
			return Result{}, err
		}
		path := filepath.Join(jobRoot, "signal-manifest.json")
		if err := writeExclusive(path, payload, 0o600); err != nil {
			return Result{}, err
		}
		args = append(args, "--signal-manifest", path)
	}
	if input.LibraryLock.SystemVersion != "" {
		payload, err := json.Marshal(struct {
			SchemaVersion int `json:"schemaVersion"`
			LibraryLock
		}{SchemaVersion: 1, LibraryLock: input.LibraryLock})
		if err != nil {
			return Result{}, err
		}
		path := filepath.Join(jobRoot, "library-lock.json")
		if err := writeExclusive(path, payload, 0o600); err != nil {
			return Result{}, err
		}
		args = append(args, "--library-lock", path)
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

func validatePublishedSignals(input Input) error {
	if len(input.PublishedSignals) > 512 {
		return fmt.Errorf("tham số compiler worker không hợp lệ")
	}
	seen := make(map[string]struct{}, len(input.PublishedSignals))
	validType := func(value string) bool {
		switch value {
		case "BOOL", "INT", "DINT", "UINT", "REAL", "TIME":
			return true
		default:
			return false
		}
	}
	for _, signal := range input.PublishedSignals {
		key := strings.ToUpper(signal.Name)
		if !boundedLen(signal.Name, 1, 64) || strings.ContainsRune(signal.Name, '\x00') ||
			!validType(signal.Type) || !boundedLen(signal.PublisherProgramID, 1, 64) ||
			strings.ContainsAny(signal.PublisherProgramID, "/\\\x00") {
			return fmt.Errorf("tham số compiler worker không hợp lệ")
		}
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("tham số compiler worker không hợp lệ")
		}
		seen[key] = struct{}{}
	}
	return nil
}

func validateLinkedInputs(input Input) error {
	if len(input.LinkedPOUs) > domain.MaxUserPou || len(input.LibraryLock.Entries) > domain.MaxUserPou {
		return fmt.Errorf("tham số compiler worker không hợp lệ")
	}
	seenPOU := make(map[string]struct{}, len(input.LinkedPOUs))
	for _, requirement := range input.RootRequiresLibrary {
		if !boundedLen(requirement.Name, 1, 64) || !boundedLen(requirement.Version, 1, 64) ||
			(requirement.Origin != "" && requirement.Origin != "PROJECT" && requirement.Origin != "SYSTEM") {
			return fmt.Errorf("tham số compiler worker không hợp lệ")
		}
	}
	for _, pou := range input.LinkedPOUs {
		key := strings.ToUpper(pou.Name)
		if !boundedLen(pou.Name, 1, 64) || strings.ContainsAny(pou.Name, "/\\\x00") ||
			(pou.Kind != "FUNCTION" && pou.Kind != "FUNCTION_BLOCK") ||
			(pou.Language != "ST" && pou.Language != "FBD") || len(pou.Source) < 1 ||
			len(pou.Source) > domain.MaxSourceBytes {
			return fmt.Errorf("tham số compiler worker không hợp lệ")
		}
		if _, duplicate := seenPOU[key]; duplicate {
			return fmt.Errorf("tham số compiler worker không hợp lệ")
		}
		seenPOU[key] = struct{}{}
		switch pou.Origin {
		case "PROJECT":
			if !pou.FromLibrary && (pou.LibraryEntryID != "" || pou.Version != "") {
				return fmt.Errorf("tham số compiler worker không hợp lệ")
			}
		case "SYSTEM":
			if !pou.FromLibrary {
				return fmt.Errorf("tham số compiler worker không hợp lệ")
			}
		default:
			return fmt.Errorf("tham số compiler worker không hợp lệ")
		}
		if pou.FromLibrary && (!boundedLen(pou.LibraryEntryID, 1, 128) || !boundedLen(pou.Version, 1, 64)) {
			return fmt.Errorf("tham số compiler worker không hợp lệ")
		}
		for _, requirement := range pou.RequiresLibrary {
			if !boundedLen(requirement.Name, 1, 64) || !boundedLen(requirement.Version, 1, 64) ||
				(requirement.Origin != "" && requirement.Origin != "PROJECT" && requirement.Origin != "SYSTEM") {
				return fmt.Errorf("tham số compiler worker không hợp lệ")
			}
		}
	}
	if input.LibraryLock.SystemVersion == "" {
		if input.LibraryLock.ProjectRevisionID != "" || len(input.LibraryLock.Entries) != 0 {
			return fmt.Errorf("tham số compiler worker không hợp lệ")
		}
		return nil
	}
	if !boundedLen(input.LibraryLock.SystemVersion, 1, 64) || len(input.LibraryLock.ProjectRevisionID) > 128 {
		return fmt.Errorf("tham số compiler worker không hợp lệ")
	}
	seenLock := make(map[string]struct{}, len(input.LibraryLock.Entries))
	for _, entry := range input.LibraryLock.Entries {
		key := strings.ToUpper(entry.Name)
		if !boundedLen(entry.EntryID, 1, 128) || !boundedLen(entry.Name, 1, 64) ||
			(entry.Kind != "FUNCTION" && entry.Kind != "FUNCTION_BLOCK") ||
			!boundedLen(entry.Version, 1, 64) || (entry.Origin != "PROJECT" && entry.Origin != "SYSTEM") {
			return fmt.Errorf("tham số compiler worker không hợp lệ")
		}
		if _, duplicate := seenLock[key]; duplicate {
			return fmt.Errorf("tham số compiler worker không hợp lệ")
		}
		seenLock[key] = struct{}{}
	}
	return nil
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
	if response.CompilerVersion != "fwsom-st-1.2.0" || response.ArtifactSchemaVersion != 1 ||
		response.TargetABI != domain.ProfileTargetABI {
		return cliResponse{}, fmt.Errorf("%w: %w: version/ABI compilerVersion=%q artifactSchema=%d targetAbi=%d",
			ErrInvalidOutput, ErrToolchainMismatch, response.CompilerVersion, response.ArtifactSchemaVersion, response.TargetABI)
	}
	return response, nil
}

// expectedArtifactIntegrityMode — T59-607: CHÍNH SÁCH và TRẠNG THÁI có hai bộ
// tên khác nhau, và trộn chúng là một lỗi tốn tiền.
//
// `profile.integrityMode` nói hệ thống ĐÒI gì: `HASH_ONLY` hoặc
// `SIGNATURE_REQUIRED`. Còn một artifact cụ thể thì `HASH_ONLY` hoặc `SIGNED` —
// đúng bộ tên của `artifact_v2.schema.json` và của cột `integrity_mode` trong
// store (cột đó có CHECK constraint, nên ghi nhầm tên chính sách vào đây làm
// INSERT hỏng ở tận tầng DB, và Check kẹt `RUNNING` cho tới hết lease).
func expectedArtifactIntegrityMode() string {
	if domain.ProfileIntegrityMode == "SIGNATURE_REQUIRED" {
		return "SIGNED"
	}
	return "HASH_ONLY"
}

func validateSuccess(response cliResponse, artifactPath, manifestPath string, input Input) (Result, error) {
	// Token profile đủ mặt nhưng KHÁC hằng sinh từ contract nghĩa là compiler
	// trên máy được build cho profile khác (triển khai lệch bản), không phải
	// output hỏng ngẫu nhiên: tách riêng để Check dừng ngay với mã đúng.
	if response.CompilerProfile != nil && response.ProfileID != nil && response.ProfileSHA256 != nil &&
		response.LibraryVersion != nil &&
		(*response.CompilerProfile != domain.ProfileCode || *response.ProfileID != domain.ProfileID ||
			*response.ProfileSHA256 != domain.ProfileSHA256 || *response.LibraryVersion != domain.ProfileLibraryVersion) {
		return Result{}, fmt.Errorf("%w: %w: compiler profile %s sha256=%s library=%s, web cần %s sha256=%s library=%s",
			ErrInvalidOutput, ErrToolchainMismatch, *response.ProfileID, *response.ProfileSHA256, *response.LibraryVersion,
			domain.ProfileID, domain.ProfileSHA256, domain.ProfileLibraryVersion)
	}
	if response.Artifact == nil || response.ArtifactBytes == nil || response.ArtifactSHA256 == nil ||
		response.ArtifactFileSHA256 == nil || response.ArtifactIntegritySHA256 == nil || response.Manifest == nil || response.CompilerProfile == nil ||
		response.ProfileID == nil || response.ProfileSHA256 == nil || response.LibraryVersion == nil ||
		response.IntegrityMode == nil || response.SignaturePresent == nil ||
		response.SourceSHA256 == nil || response.BuildKeySHA256 == nil ||
		response.SourceID == nil || *response.SourceID != input.SourceID || response.Language == nil || *response.Language != input.Language ||
		response.IoBindingCount == nil || *response.IoBindingCount != int64(len(input.IoMap)) ||
		// Token profile phải so với hằng sinh từ contract. Trước đây bốn giá trị
		// này được chép tay, nên profile đổi là runner từ chối mọi artifact hợp lệ
		// (hoặc tệ hơn, chấp nhận artifact của profile khác nếu ai đó sửa literal).
		*response.CompilerProfile != domain.ProfileCode || *response.ProfileID != domain.ProfileID ||
		*response.ProfileSHA256 != domain.ProfileSHA256 ||
		*response.LibraryVersion != domain.ProfileLibraryVersion ||
		*response.IntegrityMode != expectedArtifactIntegrityMode() || response.LinkedPOUs == nil ||
		response.SignalRefs == nil {
		return Result{}, fmt.Errorf("%w: metadata success thiếu/sai", ErrInvalidOutput)
	}
	if err := validateLinkedOutput(response.LinkedPOUs, input.LinkedPOUs); err != nil {
		return Result{}, err
	}
	if err := validateSignalOutput(response.SignalRefs, input); err != nil {
		return Result{}, err
	}
	// T59-607 — chữ ký phải KHỚP CHÍNH SÁCH, theo cả hai chiều.
	//
	// Ràng buộc cũ là `!SignaturePresent` — hợp lý ở thời Rev A `HASH_ONLY`, khi
	// một artifact ký bất ngờ nghĩa là ai đó đã đổi đường build. Nay chính sách
	// đảo lại, và chiều ngược cũng quan trọng không kém: nhận một artifact CHƯA
	// ký khi profile đòi chữ ký nghĩa là để một gói chắc chắn bị Core từ chối đi
	// tiếp tới tận Commission rồi mới hỏng.
	if domain.ProfileIntegrityMode == "SIGNATURE_REQUIRED" && !*response.SignaturePresent {
		return Result{}, fmt.Errorf("%w: profile đòi chữ ký nhưng compiler trả artifact chưa ký", ErrInvalidOutput)
	}
	if domain.ProfileIntegrityMode == "HASH_ONLY" && *response.SignaturePresent {
		return Result{}, fmt.Errorf("%w: profile HASH_ONLY nhưng compiler trả artifact đã ký", ErrInvalidOutput)
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
		envelope.Artifact.IntegritySHA256 != *response.ArtifactIntegritySHA256 ||
		// T59-607 — manifest mô tả chính artifact này, nên hai trường phải nhất
		// quán với nhau VÀ với chính sách; so với hằng sinh từ contract thay vì
		// một literal, để đổi profile không phải nhớ sửa chỗ này.
		envelope.Artifact.IntegrityMode != expectedArtifactIntegrityMode() ||
		envelope.Artifact.SignaturePresent != *response.SignaturePresent ||
		envelope.Artifact.SchemaVersion != 1 || envelope.Profile.Code != 1 ||
		envelope.Profile.ID != *response.ProfileID || envelope.Profile.SHA256 != *response.ProfileSHA256 || envelope.Profile.LibraryVersion != *response.LibraryVersion ||
		envelope.Target.ABI != response.TargetABI || envelope.Compiler.Version != response.CompilerVersion || envelope.BuildKeySHA256 != *response.BuildKeySHA256 {
		return Result{}, fmt.Errorf("%w: manifest metadata/provenance", ErrInvalidOutput)
	}
	return Result{OK: true, Symbols: response.Symbols, Diagnostics: response.Diagnostics, Artifact: artifact, ArtifactSHA256: digest,
		Manifest: canonicalManifest, CompilerVersion: response.CompilerVersion, ArtifactSchemaVersion: response.ArtifactSchemaVersion,
		CompilerProfile: *response.CompilerProfile, ProfileID: *response.ProfileID, ProfileSHA256: *response.ProfileSHA256,
		LibraryVersion: *response.LibraryVersion, IntegrityMode: *response.IntegrityMode, TargetABI: response.TargetABI,
		IoBindingCount: *response.IoBindingCount, LinkedPOUs: response.LinkedPOUs,
		SignalRefs: response.SignalRefs}, nil
}

func validateSignalOutput(output []SignalRef, input Input) error {
	expected := make(map[string]PublishedSignalContract, len(input.PublishedSignals))
	for _, signal := range input.PublishedSignals {
		expected[strings.ToUpper(signal.Name)] = signal
	}
	seen := make(map[string]struct{}, len(output))
	for _, ref := range output {
		key := strings.ToUpper(ref.Name)
		contract, found := expected[key]
		if !found || ref.Name != contract.Name || ref.Type != contract.Type ||
			(!ref.Read && !ref.Publish) ||
			(ref.Publish && contract.PublisherProgramID != input.ProgramID) {
			return fmt.Errorf("%w: signalRefs không khớp contract", ErrInvalidOutput)
		}
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("%w: signalRefs trùng", ErrInvalidOutput)
		}
		for _, location := range []*SourceLocation{ref.ReadLocation, ref.PublishLocation} {
			if location != nil && (location.Line < 1 || location.Line > 65535 || location.Column < 1 ||
				location.Column > 65535 || location.Length < 1 || location.Length > 64) {
				return fmt.Errorf("%w: signalRefs source location không hợp lệ", ErrInvalidOutput)
			}
		}
		if (ref.ReadLocation != nil) != ref.Read || (ref.PublishLocation != nil) != ref.Publish {
			return fmt.Errorf("%w: signalRefs source location không khớp quyền", ErrInvalidOutput)
		}
		seen[key] = struct{}{}
	}
	return nil
}

func validateLinkedOutput(output []LinkedPOU, sources []LinkedPOUSource) error {
	expected := make(map[string]LinkedPOUSource, len(sources))
	for _, source := range sources {
		expected[strings.ToUpper(source.Name)] = source
	}
	seen := make(map[string]struct{}, len(output))
	previous := ""
	validType := func(value string) bool {
		switch value {
		case "BOOL", "INT", "DINT", "UINT", "REAL", "TIME":
			return true
		default:
			return false
		}
	}
	for _, item := range output {
		key := strings.ToUpper(item.Name)
		source, found := expected[key]
		if !found || (previous != "" && key < previous) {
			return fmt.Errorf("%w: linkedPous không khớp input/không tất định", ErrInvalidOutput)
		}
		previous = key
		if _, duplicate := seen[key]; duplicate {
			return fmt.Errorf("%w: linkedPous trùng", ErrInvalidOutput)
		}
		seen[key] = struct{}{}
		digest := sha256.Sum256(source.Source)
		expectedFromLibrary := source.FromLibrary
		if item.Name != source.Name || item.Kind != source.Kind || item.Origin != source.Origin ||
			item.FromLibrary != expectedFromLibrary ||
			item.LibraryEntryID != source.LibraryEntryID || item.Version != source.Version ||
			item.ContentSHA256 != hex.EncodeToString(digest[:]) || len(item.BodySHA256) != sha256.Size*2 ||
			len(item.InputNames) != len(item.InputTypes) || len(item.OutputNames) != len(item.OutputTypes) ||
			(item.Kind == "FUNCTION" && !item.HasReturnType) ||
			(item.Kind == "FUNCTION_BLOCK" && item.HasReturnType) ||
			(item.HasReturnType && !validType(item.ReturnType)) || (!item.HasReturnType && item.ReturnType != "") {
			return fmt.Errorf("%w: linkedPous metadata sai", ErrInvalidOutput)
		}
		if _, err := hex.DecodeString(item.BodySHA256); err != nil {
			return fmt.Errorf("%w: linkedPous body hash sai", ErrInvalidOutput)
		}
		for index, name := range item.InputNames {
			if !boundedLen(name, 1, 64) || !validType(item.InputTypes[index]) {
				return fmt.Errorf("%w: linkedPous input signature sai", ErrInvalidOutput)
			}
		}
		for index, name := range item.OutputNames {
			if !boundedLen(name, 1, 64) || !validType(item.OutputTypes[index]) {
				return fmt.Errorf("%w: linkedPous output signature sai", ErrInvalidOutput)
			}
		}
	}
	return nil
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
