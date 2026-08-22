package compiler

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func packagerBinary(t *testing.T) string {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("packager sandbox chỉ hỗ trợ Linux")
	}
	_, current, _, _ := runtime.Caller(0)
	repo := filepath.Clean(filepath.Join(filepath.Dir(current), "..", "..", "..", "..", ".."))
	binary := filepath.Join(repo, "build", "fw", "core", "mkddc-st-package")
	if _, err := os.Stat(binary); err != nil {
		t.Skip("hãy build CMake gate trước Go integration")
	}
	return binary
}

// Package thật phải BYTE-STABLE: cùng input cho đúng cùng byte và cùng hash.
// Không có tính chất này thì mọi provenance của package đều vô nghĩa.
func TestProcessPackagerIsByteStable(t *testing.T) {
	packager := ProcessPackager{BinaryPath: packagerBinary(t),
		ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second}
	programs := []PackageProgram{
		{Name: "P_AHU", Artifact: []byte("IR-AHU-BLOB")},
		{Name: "P_BOILER", Artifact: []byte("IR-BOILER-BLOB")},
	}
	first, err := packager.Package(context.Background(), programs, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := packager.Package(context.Background(), programs, nil)
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

// Đổi thứ tự Program là đổi package: thứ tự là ngữ nghĩa của container, không
// phải chi tiết trình bày.
func TestProcessPackagerOrderIsSemantic(t *testing.T) {
	packager := ProcessPackager{BinaryPath: packagerBinary(t),
		ScratchRoot: filepath.Join(t.TempDir(), "scratch"), Timeout: 10 * time.Second}
	forward, err := packager.Package(context.Background(), []PackageProgram{
		{Name: "P_A", Artifact: []byte("A")}, {Name: "P_B", Artifact: []byte("B")}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	reverse, err := packager.Package(context.Background(), []PackageProgram{
		{Name: "P_B", Artifact: []byte("B")}, {Name: "P_A", Artifact: []byte("A")}}, nil)
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
		"tên có dấu bằng":      {Name: "P=X", Artifact: []byte("A")},
		"tên có dấu gạch chéo": {Name: "../etc/passwd", Artifact: []byte("A")},
		"tên rỗng":             {Name: "", Artifact: []byte("A")},
		"artifact rỗng":        {Name: "P_OK", Artifact: nil},
	} {
		if _, err := packager.Package(context.Background(), []PackageProgram{program}, nil); err == nil {
			t.Fatalf("%s: được chấp nhận", name)
		}
	}
	if _, err := packager.Package(context.Background(), nil, nil); err == nil {
		t.Fatal("package rỗng được chấp nhận")
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
