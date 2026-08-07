package app

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

// Di trú lịch được viết đầy đủ, có 9 test riêng… và KHÔNG AI GỌI.
//
// Lỗi lọt tới tận bo Foxlinx (2026-08-07): cài cấu hình v1 lên bo, khởi động
// lại dịch vụ, không có một dòng log `schedule.migrate` nào và tệp vẫn nguyên
// định dạng cũ. Mọi test của di trú đều gọi thẳng `MigrateSchedulesOnStartup`
// nên chúng xanh trong khi tính năng không tồn tại với người dùng.
//
// Đây là lỗi RANH GIỚI giữa gói `app` và điểm vào `main` — thêm bao nhiêu test
// bên trong gói cũng không chạm tới. Test này đọc cây cú pháp của `main.go` để
// khẳng định hai điều mà chỉ `main` mới trả lời được: lời gọi CÓ tồn tại, và
// nó đứng TRƯỚC khi cổng nghe mở.
//
// Vì sao thứ tự cũng phải khoá: nếu di trú chạy sau `ListenAndServe`, một `PUT`
// lọt vào giữa chừng sẽ ghi đè tệp v1 trước khi nó kịp được đọc — mất sạch lịch
// cũ, im lặng.
func TestMigrateSchedulesIsWiredIntoStartup(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "main.go", nil, 0)
	if err != nil {
		t.Fatalf("đọc main.go: %v", err)
	}

	// Điểm vào thật là `app.Main()`; `cmd/mkddc-web/main.go` chỉ gọi lại nó.
	mainFn := findFuncDecl(file, "Main")
	if mainFn == nil {
		t.Fatal("không tìm thấy func Main() trong main.go")
	}

	migratePos, listenPos := token.NoPos, token.NoPos
	ast.Inspect(mainFn, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		switch sel.Sel.Name {
		case "MigrateSchedulesOnStartup":
			if !migratePos.IsValid() {
				migratePos = call.Pos()
			}
		case "ListenAndServe":
			if !listenPos.IsValid() {
				listenPos = call.Pos()
			}
		}
		return true
	})

	if !migratePos.IsValid() {
		t.Fatal("func Main() không gọi MigrateSchedulesOnStartup: " +
			"bo có schedule.conf định dạng cũ sẽ kẹt HTTP 409 vĩnh viễn, " +
			"không có đường di trú nào khác")
	}
	if !listenPos.IsValid() {
		t.Fatal("không tìm thấy ListenAndServe trong Main() — test này cần nó làm mốc thứ tự")
	}
	if migratePos > listenPos {
		t.Errorf("MigrateSchedulesOnStartup (dòng %d) phải chạy TRƯỚC ListenAndServe (dòng %d); "+
			"chạy sau thì một PUT lọt vào giữa sẽ ghi đè tệp v1 trước khi kịp di trú",
			fset.Position(migratePos).Line, fset.Position(listenPos).Line)
	}
}

func findFuncDecl(file *ast.File, name string) *ast.FuncDecl {
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if ok && fn.Recv == nil && fn.Name.Name == name {
			return fn
		}
	}
	return nil
}
