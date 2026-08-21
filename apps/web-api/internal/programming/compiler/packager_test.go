package compiler

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
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
	first, err := packager.Package(context.Background(), programs)
	if err != nil {
		t.Fatal(err)
	}
	second, err := packager.Package(context.Background(), programs)
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
		{Name: "P_A", Artifact: []byte("A")}, {Name: "P_B", Artifact: []byte("B")}})
	if err != nil {
		t.Fatal(err)
	}
	reverse, err := packager.Package(context.Background(), []PackageProgram{
		{Name: "P_B", Artifact: []byte("B")}, {Name: "P_A", Artifact: []byte("A")}})
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
		if _, err := packager.Package(context.Background(), []PackageProgram{program}); err == nil {
			t.Fatalf("%s: được chấp nhận", name)
		}
	}
	if _, err := packager.Package(context.Background(), nil); err == nil {
		t.Fatal("package rỗng được chấp nhận")
	}
}
