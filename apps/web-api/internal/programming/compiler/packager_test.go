package compiler

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"mkddc-web/internal/programming/domain"
)

func packageProgramPeriods(t *testing.T, data []byte) []uint32 {
	t.Helper()
	const (
		headerBytes       = 128
		sectionEntryBytes = 16
		programTableType  = 2
	)
	if len(data) < headerBytes || string(data[:8]) != "MKDDCIR2" {
		t.Fatalf("không phải container v2 hợp lệ: bytes=%d", len(data))
	}
	if schema := binary.LittleEndian.Uint16(data[8:10]); schema != 2 {
		t.Fatalf("schemaVersion=%d; muốn 2", schema)
	}
	sections := int(binary.LittleEndian.Uint16(data[18:20]))
	if sections < 1 || headerBytes+sections*sectionEntryBytes > len(data) {
		t.Fatalf("section table sai: count=%d bytes=%d", sections, len(data))
	}
	for index := 0; index < sections; index++ {
		base := headerBytes + index*sectionEntryBytes
		if binary.LittleEndian.Uint16(data[base:base+2]) != programTableType {
			continue
		}
		offset := int(binary.LittleEndian.Uint32(data[base+4 : base+8]))
		sectionBytes := int(binary.LittleEndian.Uint32(data[base+8 : base+12]))
		items := int(binary.LittleEndian.Uint32(data[base+12 : base+16]))
		if offset < 0 || sectionBytes < 0 || offset+sectionBytes > len(data) {
			t.Fatalf("PROGRAM_TABLE vượt artifact: offset=%d size=%d", offset, sectionBytes)
		}
		cursor, end := offset, offset+sectionBytes
		periods := make([]uint32, 0, items)
		for item := 0; item < items; item++ {
			if cursor+2 > end {
				t.Fatalf("PROGRAM_TABLE thiếu độ dài tên ở record %d", item)
			}
			nameBytes := int(binary.LittleEndian.Uint16(data[cursor : cursor+2]))
			cursor += 2
			if cursor+nameBytes+8 > end {
				t.Fatalf("PROGRAM_TABLE record %d vượt section", item)
			}
			cursor += nameBytes
			periods = append(periods, binary.LittleEndian.Uint32(data[cursor:cursor+4]))
			cursor += 8 // periodMs + budgetUs
		}
		if cursor != end {
			t.Fatalf("PROGRAM_TABLE còn %d byte thừa", end-cursor)
		}
		return periods
	}
	t.Fatal("container thiếu PROGRAM_TABLE")
	return nil
}

func packagerBinary(t *testing.T) string {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("packager sandbox chỉ hỗ trợ Linux")
	}
	_, current, _, _ := runtime.Caller(0)
	repo := filepath.Clean(filepath.Join(filepath.Dir(current), "..", "..", "..", "..", ".."))
	candidates := []string{}
	if explicit := os.Getenv("MKDDC_ST_PACKAGER_BINARY"); explicit != "" {
		candidates = append(candidates, explicit)
	} else {
		candidates = append(candidates,
			filepath.Join(repo, "build", "verify", "cpp-full", "core", "mkddc-st-package"),
			filepath.Join(repo, "build", "fw", "core", "mkddc-st-package"))
	}
	problems := make([]string, 0, len(candidates))
	for _, binary := range candidates {
		if info, err := os.Stat(binary); err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", binary, err))
			continue
		} else if info.Mode().Perm()&0o111 == 0 {
			problems = append(problems, fmt.Sprintf("%s: không executable", binary))
			continue
		}
		out, err := exec.Command(binary, "--version").Output()
		if err != nil {
			problems = append(problems, fmt.Sprintf("%s: --version: %v", binary, err))
			continue
		}
		version := string(out)
		if strings.Contains(version, "profile_sha256="+domain.ProfileSHA256) {
			return binary
		}
		problems = append(problems, fmt.Sprintf("%s: profile không khớp %s (%s)",
			binary, domain.ProfileSHA256[:12], strings.TrimSpace(version)))
	}
	message := "không có packager production đúng profile: " + strings.Join(problems, "; ")
	if os.Getenv("MKDDC_REQUIRE_PRODUCTION_TOOLS") == "1" {
		t.Fatal(message)
	}
	t.Skip(message + " — chạy cổng cpp trước hoặc đặt MKDDC_ST_PACKAGER_BINARY")
	return ""
}

// Package thật phải BYTE-STABLE: cùng input cho đúng cùng byte và cùng hash.
// Không có tính chất này thì mọi provenance của package đều vô nghĩa.
func TestProcessPackagerIsByteStable(t *testing.T) {
	packager := ProcessPackager{BinaryPath: packagerBinary(t),
		ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second}
	programs := []PackageProgram{
		{Name: "P_AHU", Artifact: []byte("IR-AHU-BLOB"), PeriodMs: 1000},
		{Name: "P_BOILER", Artifact: []byte("IR-BOILER-BLOB"), PeriodMs: 5000},
	}
	first, err := packager.Package(context.Background(), programs, nil, nil, LibraryLock{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := packager.Package(context.Background(), programs, nil, nil, LibraryLock{})
	if err != nil {
		t.Fatal(err)
	}
	if first.SHA256 != second.SHA256 || first.ByteSize != second.ByteSize {
		t.Fatalf("package không byte-stable: %x/%d vs %x/%d",
			first.SHA256, first.ByteSize, second.SHA256, second.ByteSize)
	}
	if first.SchemaVersion != 2 || first.ProgramCount != 2 || first.ByteSize < 1 {
		t.Fatalf("kết quả package sai: %+v", first)
	}
	// Magic của container v2 phải nằm ngay đầu file — nếu không thì thứ vừa ghi
	// không phải package v2 dù CLI báo thành công.
	if string(first.Package[:8]) != "MKDDCIR2" {
		t.Fatalf("magic=%q", string(first.Package[:8]))
	}
}

func TestProcessPackagerSingleProgramPreservesScheduleInV2Container(t *testing.T) {
	for _, periodMs := range []int64{5000, 30000} {
		t.Run(fmt.Sprintf("period_%d_ms", periodMs), func(t *testing.T) {
			packager := ProcessPackager{BinaryPath: packagerBinary(t),
				ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second}
			result, err := packager.Package(context.Background(), []PackageProgram{{
				Name: "P_SINGLE", Artifact: []byte("IR-SINGLE-BLOB"), PeriodMs: periodMs,
			}}, nil, nil, LibraryLock{})
			if err != nil {
				t.Fatal(err)
			}
			if result.SchemaVersion != 2 || result.ProgramCount != 1 {
				t.Fatalf("kết quả package sai: %+v", result)
			}
			periods := packageProgramPeriods(t, result.Package)
			if len(periods) != 1 || periods[0] != uint32(periodMs) {
				t.Fatalf("period read-back=%v; muốn [%d]", periods, periodMs)
			}
		})
	}
}

// Đổi thứ tự Program là đổi package: thứ tự là ngữ nghĩa của container, không
// phải chi tiết trình bày.
func TestProcessPackagerOrderIsSemantic(t *testing.T) {
	packager := ProcessPackager{BinaryPath: packagerBinary(t),
		ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second}
	forward, err := packager.Package(context.Background(), []PackageProgram{
		{Name: "P_A", Artifact: []byte("A"), PeriodMs: 1000},
		{Name: "P_B", Artifact: []byte("B"), PeriodMs: 5000}}, nil, nil, LibraryLock{})
	if err != nil {
		t.Fatal(err)
	}
	reverse, err := packager.Package(context.Background(), []PackageProgram{
		{Name: "P_B", Artifact: []byte("B"), PeriodMs: 5000},
		{Name: "P_A", Artifact: []byte("A"), PeriodMs: 1000}}, nil, nil, LibraryLock{})
	if err != nil {
		t.Fatal(err)
	}
	if forward.SHA256 == reverse.SHA256 {
		t.Fatal("đổi thứ tự Program không đổi package")
	}
}

// Tham số độc hại không được đi vào argv của CLI. Không có shell nào ở đây nên
// quoting không cứu được — validate là lớp duy nhất.
func TestProcessPackagerRejectsHostileProgramNames(t *testing.T) {
	packager := ProcessPackager{BinaryPath: packagerBinary(t),
		ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second}
	for name, program := range map[string]PackageProgram{
		"tên có dấu bằng":      {Name: "P=X", Artifact: []byte("A"), PeriodMs: 1000},
		"tên có dấu gạch chéo": {Name: "../etc/passwd", Artifact: []byte("A"), PeriodMs: 1000},
		"tên rỗng":             {Name: "", Artifact: []byte("A"), PeriodMs: 1000},
		"artifact rỗng":        {Name: "P_OK", Artifact: nil, PeriodMs: 1000},
	} {
		if _, err := packager.Package(context.Background(), []PackageProgram{program}, nil, nil, LibraryLock{}); err == nil {
			t.Fatalf("%s: được chấp nhận", name)
		}
	}
	if _, err := packager.Package(context.Background(), nil, nil, nil, LibraryLock{}); err == nil {
		t.Fatal("package rỗng được chấp nhận")
	}
}

func TestProcessPackagerRejectsMissingProgramScheduleBeforeSpawn(t *testing.T) {
	packager := ProcessPackager{BinaryPath: "/binary-khong-duoc-chay",
		ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second}
	_, err := packager.Package(context.Background(), []PackageProgram{{
		Name: "P_GHOST", Artifact: []byte("IR"), PeriodMs: 0,
	}}, nil, nil, LibraryLock{})
	if err == nil || !strings.Contains(err.Error(), "ST-POU-005") {
		t.Fatalf("periodMs=0 không bị từ chối bằng ST-POU-005: %v", err)
	}
}

// T59-303: `extIndex` chỉ có nghĩa với MB_RTU. Runner phải chặn cả hai chiều —
// MB_RTU thiếu slot, và category khác lại mang slot — trước khi spawn compiler.
func TestRunnerValidatesModbusExtIndexBothWays(t *testing.T) {
	runner := ProcessRunner{BinaryPath: "/nonexistent", ScratchRoot: t.TempDir(), Timeout: 5 * time.Second}
	source := []byte("PROGRAM P\nVAR_INPUT X : REAL; END_VAR\nEND_PROGRAM\n")
	base := Input{SourceID: "11111111-1111-4111-8111-111111111111", Language: "ST", Source: source}

	for name, entry := range map[string]IoMapEntry{
		"MB_RTU thiếu extIndex": {Variable: "X", Direction: "input", PointID: "d.t", Type: "REAL",
			Category: "MB_RTU", DeviceID: "mb-1"},
		"MB_RTU thiếu deviceId": {Variable: "X", Direction: "input", PointID: "d.t", Type: "REAL",
			Category: "MB_RTU", ExtIndex: 3},
		"MB_RTU vượt trần EXT": {Variable: "X", Direction: "input", PointID: "d.t", Type: "REAL",
			Category: "MB_RTU", DeviceID: "mb-1", ExtIndex: 257},
		"LOCAL mang extIndex": {Variable: "X", Direction: "input", PointID: "UI-01", Type: "REAL",
			Category: "LOCAL", ExtIndex: 3},
	} {
		input := base
		input.IoMap = []IoMapEntry{entry}
		if _, err := runner.Compile(context.Background(), input); err == nil {
			t.Fatalf("%s: được chấp nhận", name)
		}
	}

	// Chiều khẳng định: entry MB_RTU đủ dữ liệu phải QUA lớp validate và chỉ
	// hỏng vì binary không tồn tại — nếu không, guard đang chặn cả dữ liệu đúng.
	input := base
	input.IoMap = []IoMapEntry{{Variable: "X", Direction: "input", PointID: "d.t", Type: "REAL",
		Category: "MB_RTU", DeviceID: "mb-1", ExtIndex: 3}}
	err := func() error { _, err := runner.Compile(context.Background(), input); return err }()
	if err == nil || strings.Contains(err.Error(), "tham số compiler worker không hợp lệ") {
		t.Fatalf("entry MB_RTU hợp lệ bị guard chặn: %v", err)
	}
}
