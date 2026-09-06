package application

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	programmingstore "mkddc-web/internal/programming/store"
)

/*
Golden test cho typed diff của `T59-819`.

Bộ này cố tình chạy thẳng trên hàm thuần thay vì qua store: cái đáng khoá ở đây
là NỘI DUNG và THỨ TỰ của diff, và một test đi qua store sẽ che mất chính chỗ
đó sau một lần đổi cách seal.
*/

func diffProgramObject(objectID, language, source string) programmingstore.RevisionObject {
	payload, err := json.Marshal(map[string]any{"language": language, "source": source})
	if err != nil {
		panic(err)
	}
	return programmingstore.RevisionObject{ObjectID: objectID, Kind: "PROGRAM", PayloadJSON: payload}
}

func TestStDiffAddedHunkKeepsSurroundingLinesOutOfTheChange(t *testing.T) {
	before := "A := 1;\nB := 2;"
	after := "A := 1;\nNEW := 9;\nB := 2;"
	hunks := diffStSource("obj", before, after)
	if len(hunks) != 1 {
		t.Fatalf("mong đợi đúng một hunk, có %d: %+v", len(hunks), hunks)
	}
	got := hunks[0]
	if got.ChangeType != "ADDED" {
		t.Fatalf("changeType=%q, mong đợi ADDED", got.ChangeType)
	}
	// Đây là điểm dễ hỏng nhất: một diff "cắt tiền tố/hậu tố rồi REPLACED phần
	// giữa" sẽ báo cả hai dòng cũ là đã đổi, và người đọc mất đúng thông tin
	// họ cần.
	if got.BeforeLineCount != 0 || got.AfterLineCount != 1 {
		t.Fatalf("hunk thêm phải rỗng phía before: %+v", got)
	}
	if len(got.AfterText) != 1 || got.AfterText[0] != "NEW := 9;" {
		t.Fatalf("afterText=%+v", got.AfterText)
	}
	if got.AfterStartLine != 2 {
		t.Fatalf("afterStartLine=%d, mong đợi 2", got.AfterStartLine)
	}
}

func TestStDiffRemovedHunk(t *testing.T) {
	hunks := diffStSource("obj", "A := 1;\nGONE := 0;\nB := 2;", "A := 1;\nB := 2;")
	if len(hunks) != 1 || hunks[0].ChangeType != "REMOVED" {
		t.Fatalf("hunks=%+v", hunks)
	}
	if hunks[0].BeforeLineCount != 1 || hunks[0].AfterLineCount != 0 {
		t.Fatalf("hunk xoá sai đếm dòng: %+v", hunks[0])
	}
	if len(hunks[0].BeforeText) != 1 || hunks[0].BeforeText[0] != "GONE := 0;" {
		t.Fatalf("beforeText=%+v", hunks[0].BeforeText)
	}
}

func TestStDiffReplacedHunk(t *testing.T) {
	hunks := diffStSource("obj", "A := 1;\nB := 2;", "A := 1;\nB := 99;")
	if len(hunks) != 1 || hunks[0].ChangeType != "REPLACED" {
		t.Fatalf("hunks=%+v", hunks)
	}
	if hunks[0].BeforeStartLine != 2 || hunks[0].AfterStartLine != 2 {
		t.Fatalf("vị trí hunk sai: %+v", hunks[0])
	}
}

func TestStDiffIgnoresTrailingNewlineAndCarriageReturn(t *testing.T) {
	// Thêm/bớt newline cuối tệp hay đổi EOL không phải một thay đổi chương
	// trình. Báo nó là một hunk sẽ dạy người vận hành bỏ qua Compare.
	if hunks := diffStSource("obj", "A := 1;", "A := 1;\n"); len(hunks) != 0 {
		t.Fatalf("newline cuối tệp không được thành hunk: %+v", hunks)
	}
	if hunks := diffStSource("obj", "A := 1;\nB := 2;", "A := 1;\r\nB := 2;"); len(hunks) != 0 {
		t.Fatalf("đổi EOL không được thành hunk: %+v", hunks)
	}
}

func TestStDiffIsDeterministicAcrossRuns(t *testing.T) {
	before := "L1;\nL2;\nL3;\nL4;\nL5;"
	after := "L1;\nX;\nL3;\nL4;\nY;\nL5;"
	first := fmt.Sprintf("%+v", diffStSource("obj", before, after))
	for attempt := 0; attempt < 20; attempt++ {
		if again := fmt.Sprintf("%+v", diffStSource("obj", before, after)); again != first {
			t.Fatalf("diff không tất định:\n%s\n%s", first, again)
		}
	}
}

func TestStDiffTruncatesHunkBodyButKeepsRealLineCount(t *testing.T) {
	before := ""
	lines := make([]string, 0, maxHunkLines+10)
	for index := 0; index < maxHunkLines+10; index++ {
		lines = append(lines, fmt.Sprintf("L%d;", index))
	}
	hunks := diffStSource("obj", before, strings.Join(lines, "\n"))
	if len(hunks) != 1 {
		t.Fatalf("hunks=%d", len(hunks))
	}
	if !hunks[0].Truncated {
		t.Fatal("thân hunk bị cắt mà không bật cờ truncated")
	}
	// Số dòng THẬT phải còn nguyên: cắt phần hiển thị không được làm người đọc
	// tưởng thay đổi nhỏ hơn thực tế.
	if hunks[0].AfterLineCount != maxHunkLines+10 {
		t.Fatalf("afterLineCount=%d, mong đợi %d", hunks[0].AfterLineCount, maxHunkLines+10)
	}
	if len(hunks[0].AfterText) != maxHunkLines {
		t.Fatalf("thân hunk không bị cắt về trần: %d", len(hunks[0].AfterText))
	}
}

func TestStDiffTruncatesPathologicalSingleLine(t *testing.T) {
	hunks := diffStSource("obj", "OLD;", strings.Repeat("ừ", maxHunkLineRunes+50))
	if len(hunks) != 1 || !hunks[0].Truncated {
		t.Fatalf("dòng quá dài phải bị cắt và nói ra: %+v", hunks)
	}
	if got := utf8.RuneCountInString(hunks[0].AfterText[0]); got != maxHunkLineRunes {
		t.Fatalf("dòng sau cắt có %d ký tự, mong đợi %d", got, maxHunkLineRunes)
	}
}

func TestStDiffFallsBackToCoarseHunkBeyondAlgorithmLimit(t *testing.T) {
	huge := strings.Repeat("X;\n", maxDiffLines+5)
	hunks := diffStSource("obj", huge, huge+"Y;\n")
	if len(hunks) != 1 || !hunks[0].Coarse {
		t.Fatalf("vượt trần phải hạ thành một hunk coarse: %+v", hunks)
	}
	if hunks[0].ChangeType != "REPLACED" {
		t.Fatalf("changeType=%q", hunks[0].ChangeType)
	}
}

func fbdDocument(nodes string, wires string, layout string) string {
	if layout == "" {
		layout = `{}`
	}
	return `{"networks":[{"id":"n1","nodes":[` + nodes + `],"wires":[` + wires + `]}],"layout":` + layout + `}`
}

const nodeAdd = `{"id":"blk-1","kind":"CALL","typeRef":"ADD","executionOrder":1,"parameters":{},` +
	`"ports":[{"id":"p-in","name":"IN1","direction":"INPUT","dataType":"REAL","order":0}]}`

func TestFbdDiffDetectsNodeAddRemove(t *testing.T) {
	changes := diffFbdSource("obj", fbdDocument("", "", ""), fbdDocument(nodeAdd, "", ""))
	if len(changes) != 1 || changes[0].ChangeType != "ADDED" || changes[0].Element != "NODE" {
		t.Fatalf("changes=%+v", changes)
	}
	back := diffFbdSource("obj", fbdDocument(nodeAdd, "", ""), fbdDocument("", "", ""))
	if len(back) != 1 || back[0].ChangeType != "REMOVED" || back[0].ElementID != "blk-1" {
		t.Fatalf("changes=%+v", back)
	}
}

func TestFbdDiffSeparatesOrderOnlyFromLogicChange(t *testing.T) {
	reordered := strings.Replace(nodeAdd, `"executionOrder":1`, `"executionOrder":2`, 1)
	changes := diffFbdSource("obj", fbdDocument(nodeAdd, "", ""), fbdDocument(reordered, "", ""))
	if len(changes) != 1 || changes[0].ChangeType != "ORDER_ONLY" || changes[0].Detail != "executionOrder" {
		t.Fatalf("đổi thứ tự thực thi phải là một loại riêng: %+v", changes)
	}
	retyped := strings.Replace(nodeAdd, `"typeRef":"ADD"`, `"typeRef":"SUB"`, 1)
	logic := diffFbdSource("obj", fbdDocument(nodeAdd, "", ""), fbdDocument(retyped, "", ""))
	if len(logic) != 1 || logic[0].ChangeType != "UPDATED" || logic[0].Detail != "typeRef" {
		t.Fatalf("đổi typeRef phải là UPDATED: %+v", logic)
	}
}

func TestFbdDiffSeparatesGeometryOnlyFromLogicChange(t *testing.T) {
	changes := diffFbdSource("obj",
		fbdDocument(nodeAdd, "", `{"blk-1":{"x":0,"y":0}}`),
		fbdDocument(nodeAdd, "", `{"blk-1":{"x":120,"y":40}}`))
	if len(changes) != 1 || changes[0].ChangeType != "GEOMETRY_ONLY" || changes[0].Detail != "layout" {
		t.Fatalf("kéo khối trên canvas không đổi hành vi, phải tách riêng: %+v", changes)
	}
}

func TestFbdDiffDetectsPortChanges(t *testing.T) {
	retyped := strings.Replace(nodeAdd, `"dataType":"REAL"`, `"dataType":"INT"`, 1)
	changes := diffFbdSource("obj", fbdDocument(nodeAdd, "", ""), fbdDocument(retyped, "", ""))
	if len(changes) != 1 || changes[0].Element != "PORT" || changes[0].Detail != "dataType" {
		t.Fatalf("changes=%+v", changes)
	}
	extraPort := strings.Replace(nodeAdd, `{"id":"p-in","name":"IN1","direction":"INPUT","dataType":"REAL","order":0}`,
		`{"id":"p-in","name":"IN1","direction":"INPUT","dataType":"REAL","order":0},`+
			`{"id":"p-out","name":"OUT","direction":"OUTPUT","dataType":"REAL","order":1}`, 1)
	added := diffFbdSource("obj", fbdDocument(nodeAdd, "", ""), fbdDocument(extraPort, "", ""))
	if len(added) != 1 || added[0].Element != "PORT" || added[0].ChangeType != "ADDED" || added[0].ElementID != "p-out" {
		t.Fatalf("changes=%+v", added)
	}
	withUnit := strings.Replace(nodeAdd, `"dataType":"REAL","order":0`, `"dataType":"REAL","unit":"°C","order":0`, 1)
	unit := diffFbdSource("obj", fbdDocument(nodeAdd, "", ""), fbdDocument(withUnit, "", ""))
	if len(unit) != 1 || unit[0].Element != "PORT" || unit[0].Detail != "unit" {
		t.Fatalf("đổi unit của port phải hiện ra: %+v", unit)
	}
}

func TestFbdDiffDetectsNetworkMetadataAndMembership(t *testing.T) {
	before := `{"networks":[{"id":"n1","name":"Main","order":0,"nodes":[` + nodeAdd + `],"wires":[]}],"layout":{}}`
	afterMetadata := `{"networks":[{"id":"n1","name":"Safety","order":2,"nodes":[` + nodeAdd + `],"wires":[]}],"layout":{}}`
	metadata := diffFbdSource("obj", before, afterMetadata)
	if len(metadata) != 2 || metadata[0].Element != "NETWORK" || metadata[0].Detail != "name" ||
		metadata[1].ChangeType != "ORDER_ONLY" || metadata[1].Detail != "order" {
		t.Fatalf("metadata network phải có diff typed: %+v", metadata)
	}
	afterMove := `{"networks":[{"id":"n1","name":"Main","order":0,"nodes":[],"wires":[]},` +
		`{"id":"n2","name":"Aux","order":1,"nodes":[` + nodeAdd + `],"wires":[]}],"layout":{}}`
	moved := diffFbdSource("obj", before, afterMove)
	if len(moved) != 2 || moved[0].Element != "NETWORK" || moved[0].ChangeType != "ADDED" ||
		moved[1].Element != "NODE" || moved[1].Detail != "networkId" {
		t.Fatalf("đổi network chứa node phải hiện ra: %+v", moved)
	}
}

func TestFbdDiffDetectsWireChanges(t *testing.T) {
	wireOne := `{"id":"w-1","from":{"nodeId":"a","portId":"o"},"to":{"nodeId":"b","portId":"i"}}`
	wireMoved := `{"id":"w-1","from":{"nodeId":"a","portId":"o"},"to":{"nodeId":"c","portId":"i"}}`
	added := diffFbdSource("obj", fbdDocument("", "", ""), fbdDocument("", wireOne, ""))
	if len(added) != 1 || added[0].Element != "WIRE" || added[0].ChangeType != "ADDED" {
		t.Fatalf("changes=%+v", added)
	}
	moved := diffFbdSource("obj", fbdDocument("", wireOne, ""), fbdDocument("", wireMoved, ""))
	if len(moved) != 1 || moved[0].ChangeType != "UPDATED" || moved[0].Detail != "endpoint" {
		t.Fatalf("đổi đầu nối phải hiện ra: %+v", moved)
	}
}

func TestFbdDiffIsDeterministicAcrossRuns(t *testing.T) {
	before := fbdDocument(nodeAdd, "", `{"blk-1":{"x":0}}`)
	nodeTwo := strings.ReplaceAll(nodeAdd, "blk-1", "blk-2")
	after := fbdDocument(nodeTwo+","+strings.Replace(nodeAdd, `"typeRef":"ADD"`, `"typeRef":"MUL"`, 1),
		`{"id":"w-9","from":{"nodeId":"blk-1","portId":"p-in"},"to":{"nodeId":"blk-2","portId":"p-in"}}`,
		`{"blk-1":{"x":10}}`)
	first := fmt.Sprintf("%+v", diffFbdSource("obj", before, after))
	for attempt := 0; attempt < 20; attempt++ {
		if again := fmt.Sprintf("%+v", diffFbdSource("obj", before, after)); again != first {
			t.Fatalf("diff FBD không tất định:\n%s\n%s", first, again)
		}
	}
}

func TestFbdDiffUnparsableDocumentDoesNotFabricateChanges(t *testing.T) {
	// Tài liệu không đọc được là "không biết", không phải "không đổi" và cũng
	// không phải "đổi hết". Không bịa ra thay đổi nào.
	if changes := diffFbdSource("obj", "{{{", "{{{"); len(changes) != 0 {
		t.Fatalf("changes=%+v", changes)
	}
}

func TestDiffRevisionSourcesOrdersByObjectIDAndPagesDeterministically(t *testing.T) {
	before := []programmingstore.RevisionObject{
		diffProgramObject("obj-b", "ST", "B1;"),
		diffProgramObject("obj-a", "ST", "A1;"),
	}
	after := []programmingstore.RevisionObject{
		diffProgramObject("obj-a", "ST", "A1;\nA2;"),
		diffProgramObject("obj-b", "ST", "B1;\nB2;"),
	}
	hunks, _, _, truncated, err := diffRevisionSources(before, after, 0)
	if err != nil {
		t.Fatal(err)
	}
	if truncated {
		t.Fatal("hai hunk không được coi là chạm trần")
	}
	if len(hunks) != 2 || hunks[0].ObjectID != "obj-a" || hunks[1].ObjectID != "obj-b" {
		// Thứ tự duyệt map trong Go là ngẫu nhiên có chủ ý; nếu nó lọt vào
		// output thì hai lần mở Compare trên cùng một cặp Revision sẽ cho hai
		// thứ tự khác nhau.
		t.Fatalf("phải sắp theo objectId: %+v", hunks)
	}
}

func TestDiffRevisionSourcesTruncatesLoudlyAndCursorResumesWithoutGapOrRepeat(t *testing.T) {
	before := make([]programmingstore.RevisionObject, 0, maxDiffEntries+20)
	after := make([]programmingstore.RevisionObject, 0, maxDiffEntries+20)
	for index := 0; index < maxDiffEntries+20; index++ {
		objectID := fmt.Sprintf("obj-%04d", index)
		before = append(before, diffProgramObject(objectID, "ST", "OLD;"))
		after = append(after, diffProgramObject(objectID, "ST", "NEW;"))
	}

	firstPage, _, nextCursor, truncated, err := diffRevisionSources(before, after, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !truncated || nextCursor != maxDiffEntries {
		t.Fatalf("chạm trần phải nói ra: truncated=%v nextCursor=%d", truncated, nextCursor)
	}
	if len(firstPage) != maxDiffEntries {
		t.Fatalf("trang một có %d mục", len(firstPage))
	}
	secondPage, _, secondCursor, secondTruncated, err := diffRevisionSources(before, after, nextCursor)
	if err != nil {
		t.Fatal(err)
	}
	if secondTruncated || secondCursor != 0 {
		t.Fatalf("trang cuối không được báo còn nữa: truncated=%v cursor=%d", secondTruncated, secondCursor)
	}
	if len(secondPage) != 20 {
		t.Fatalf("trang hai có %d mục", len(secondPage))
	}
	// Không hở và không lặp: ghép hai trang phải ra đúng tập đầy đủ.
	seen := make(map[string]int, len(before))
	for _, hunk := range append(append([]StHunk(nil), firstPage...), secondPage...) {
		seen[hunk.ObjectID]++
	}
	if len(seen) != maxDiffEntries+20 {
		t.Fatalf("ghép hai trang ra %d object", len(seen))
	}
	for objectID, count := range seen {
		if count != 1 {
			t.Fatalf("%s xuất hiện %d lần", objectID, count)
		}
	}
}

func TestDiffRevisionSourcesRejectsOutOfRangeCursor(t *testing.T) {
	before := []programmingstore.RevisionObject{diffProgramObject("obj-a", "ST", "A;")}
	after := []programmingstore.RevisionObject{diffProgramObject("obj-a", "ST", "B;")}
	_, _, _, _, err := diffRevisionSources(before, after, 9999)
	if !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("cursor ngoài phạm vi phải bị từ chối, có %v", err)
	}
}

func TestDiffRevisionSourcesFailsClosedForMalformedChangedPayload(t *testing.T) {
	before := []programmingstore.RevisionObject{diffProgramObject("obj-a", "FBD", fbdDocument("", "", ""))}
	after := []programmingstore.RevisionObject{{ObjectID: "obj-a", Kind: "PROGRAM", PayloadJSON: json.RawMessage(`{"language":"FBD","source":"{{{"}`)}}
	_, _, _, _, err := diffRevisionSources(before, after, 0)
	if err == nil || errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("FBD hỏng phải fail-closed bằng lỗi unavailable, có %v", err)
	}
}

func TestDiffRevisionSourcesSkipsNonProgramObjects(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{"variableId": "v", "retain": true})
	before := []programmingstore.RevisionObject{{ObjectID: "obj-v", Kind: "VARIABLE", PayloadJSON: payload}}
	after := []programmingstore.RevisionObject{{ObjectID: "obj-v", Kind: "VARIABLE", PayloadJSON: payload}}
	hunks, fbdChanges, _, _, err := diffRevisionSources(before, after, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(hunks) != 0 || len(fbdChanges) != 0 {
		t.Fatalf("object không phải POU không có mã nguồn để diff: %+v %+v", hunks, fbdChanges)
	}
}

/*
Hai ca dưới đi qua store thật: chúng khoá thứ mà test hàm thuần không chạm được
— rằng đường Compare có nối được diff vào phản hồi, và rằng một lỗi hạ tầng
KHÔNG được biến thành một lời khẳng định an toàn.
*/

// openDiffService mở store như `openBundleService` nhưng GIỮ LẠI đường dẫn tệp,
// để ca fail-closed làm hỏng đúng một bảng qua kết nối thứ hai.
func openDiffService(t *testing.T) (*ProjectService, string) {
	t.Helper()
	fixedNow := time.Date(2026, 8, 11, 11, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "programming-diff.sqlite")
	store, err := programmingstore.OpenProgrammingStore(context.Background(), programmingstore.Options{
		Path: path,
		Now:  func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service, err := NewProjectService(store, []byte("cursor-secret-task-prog-206"))
	if err != nil {
		t.Fatal(err)
	}
	service.SetPointCatalogProvider(standardBindingCatalog())
	service.now = func() time.Time { return fixedNow }
	return service, path
}

func dropRuntimeIntentTable(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`DROP TABLE program_runtime_intents`); err != nil {
		t.Fatal(err)
	}
}

func TestRevisionChangesDetailCarriesStHunksWhileCommissionPathStaysCheap(t *testing.T) {
	service, _ := openDiffService(t)
	_, revisionOne, revisionTwo := createBundleRevisionPair(t, service)
	ctx := context.Background()

	plain, err := service.GetRevisionChanges(ctx, revisionOne, revisionTwo)
	if err != nil {
		t.Fatal(err)
	}
	// Đường Commission KHÔNG tính diff: nó chỉ cần impact, và tính LCS trên toàn
	// bộ mã nguồn cho mỗi lệnh là công vô ích trên thiết bị nhúng. Nhưng khoá
	// vẫn phải có mặt — mảng rỗng là một câu trả lời, khoá vắng mặt là một
	// khoảng lặng.
	if plain.StHunks == nil || plain.FbdChanges == nil {
		t.Fatal("khoá stHunks/fbdChanges phải luôn có mặt")
	}
	if len(plain.StHunks) != 0 {
		t.Fatalf("đường Commission không được tính diff: %+v", plain.StHunks)
	}

	detail, err := service.GetRevisionChangesDetail(ctx, revisionOne, revisionTwo, 0)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Truncated || detail.NextCursor != nil {
		t.Fatalf("diff nhỏ không được báo chạm trần: %+v", detail)
	}
	// `impactRef` phải KHÔNG đổi giữa hai đường: nó là dấu niêm phong của thứ
	// người vận hành xác nhận, không phải của thứ họ được xem. Trộn diff vào đó
	// sẽ làm mọi acknowledgement đã cấp thành stale.
	if detail.Impact.ImpactRef != plain.Impact.ImpactRef {
		t.Fatalf("diff không được lọt vào impactRef: %q vs %q",
			detail.Impact.ImpactRef, plain.Impact.ImpactRef)
	}
}

func TestRevisionChangesFailsClosedWhenRuntimeIntentStoreErrors(t *testing.T) {
	service, path := openDiffService(t)
	_, revisionOne, revisionTwo := createBundleRevisionPair(t, service)
	ctx := context.Background()

	healthy, err := service.GetRevisionChanges(ctx, revisionOne, revisionTwo)
	if err != nil {
		t.Fatal(err)
	}
	if healthy.Impact.EnableIntent.Status != "NONE" {
		t.Fatalf("chưa bật Program nào ⇒ NONE, có %q", healthy.Impact.EnableIntent.Status)
	}

	// Làm hỏng ĐÚNG bảng intent qua một kết nối thứ hai: mọi thứ khác vẫn đọc
	// được, nên ca này tách bạch "lỗi đọc intent" khỏi "hỏng toàn store".
	dropRuntimeIntentTable(t, path)

	broken, err := service.GetRevisionChanges(ctx, revisionOne, revisionTwo)
	if err != nil {
		t.Fatal(err)
	}
	if broken.Impact.EnableIntent.Status != "UNAVAILABLE" {
		// Trước bản vá T59-819, lỗi này bị nuốt thành danh sách rỗng ⇒ `NONE`,
		// và Commission đi tiếp mà không hỏi acknowledgement nào — fail-OPEN ở
		// đúng chỗ nguy hiểm nhất: thay chương trình đang chạy trên thiết bị.
		t.Fatalf("store lỗi phải fail-closed: %+v", broken.Impact.EnableIntent)
	}
	if len(broken.Impact.EnableIntent.Items) == 0 {
		t.Fatal("UNAVAILABLE phải kèm lý do đọc được")
	}
	if broken.Impact.ImpactRef == healthy.Impact.ImpactRef {
		t.Fatal("impactRef phải đổi khi impact đổi, nếu không ack cũ vẫn dùng được")
	}
}

func TestRevisionChangesDetailReportsExactStHunkAfterSealingEditedProgram(t *testing.T) {
	service, _ := openDiffService(t)
	projectID, _, revisionTwo := createBundleRevisionPair(t, service)
	ctx := context.Background()
	actor := Actor{ID: testActorID, Role: "admin"}
	programID := "65555555-5555-4555-8555-555555555555"

	// Đúng một dòng đổi trong thân Program. Ca này đi TRỌN đường Save → Seal →
	// Compare nên nó khoá luôn tên khoá payload (`source`/`language`): một lần
	// đổi tên khoá ở draft_v2 sẽ làm diff im lặng trở về rỗng, và "không có
	// thay đổi" là câu nói dối tệ nhất mà màn Compare có thể nói.
	edited, _ := json.Marshal(map[string]any{"op": "upsertProgram", "program": map[string]any{
		"programId": programID, "name": "AHU", "kind": "PROGRAM", "language": "ST",
		"document": "PROGRAM AHU\nVAR_OUTPUT Fan : BOOL; END_VAR\nFan := FALSE;\nEND_PROGRAM\n"}})
	current, err := service.GetProject(ctx, projectID)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := service.SaveDraft(ctx, actor, SaveDraftCommand{ProjectID: projectID, SchemaVersion: "1.0",
		BaseRevisionID: revisionTwo, Operations: []json.RawMessage{edited}, IfMatch: current.ETag,
		IdempotencyKey: "60000000-0000-4000-8000-000000000010", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := service.SealRevision(ctx, actor, SealRevisionCommand{ProjectID: projectID, SchemaVersion: "1.0",
		BaseRevisionID: revisionTwo, Label: "R3", IfMatch: saved.ETag,
		IdempotencyKey: "60000000-0000-4000-8000-000000000011", CorrelationID: testCorrelationID})
	if err != nil {
		t.Fatal(err)
	}

	view, err := service.GetRevisionChangesDetail(ctx, revisionTwo, sealed.Resource["revisionId"].(string), 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.StHunks) != 1 {
		t.Fatalf("một dòng đổi phải ra đúng một hunk, có %d: %+v", len(view.StHunks), view.StHunks)
	}
	hunk := view.StHunks[0]
	if hunk.ObjectID != programID || hunk.ChangeType != "REPLACED" {
		t.Fatalf("hunk=%+v", hunk)
	}
	if hunk.BeforeStartLine != 3 || hunk.AfterStartLine != 3 {
		t.Fatalf("hunk phải neo đúng dòng 3: %+v", hunk)
	}
	if len(hunk.BeforeText) != 1 || hunk.BeforeText[0] != "Fan := TRUE;" ||
		len(hunk.AfterText) != 1 || hunk.AfterText[0] != "Fan := FALSE;" {
		t.Fatalf("nội dung hunk sai: %+v", hunk)
	}
}
