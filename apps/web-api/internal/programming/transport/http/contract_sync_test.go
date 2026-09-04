package programminghttp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"

	programmingapplication "mkddc-web/internal/programming/application"
)

func TestRegisteredRoutesMatchProgrammingOpenAPI(t *testing.T) {
	openAPIPath := filepath.Join("..", "..", "..", "..", "..", "..", "contracts", "openapi", "openapi.yaml")
	file, err := os.Open(openAPIPath)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	methods := map[string]bool{"get": true, "post": true, "put": true, "patch": true, "delete": true}
	inPaths := false
	currentPath := ""
	openAPIContracts := make([]string, 0, len(routeDefinitions))
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "paths:" {
			inPaths = true
			continue
		}
		if inPaths && line == "components:" {
			break
		}
		if !inPaths {
			continue
		}
		if strings.HasPrefix(line, "  /programming/") && strings.HasSuffix(line, ":") {
			currentPath = strings.TrimSuffix(strings.TrimSpace(line), ":")
			continue
		}
		if currentPath == "" || !strings.HasPrefix(line, "    ") || strings.HasPrefix(line, "      ") {
			continue
		}
		method := strings.TrimSuffix(strings.TrimSpace(line), ":")
		if methods[method] {
			openAPIContracts = append(openAPIContracts, strings.ToUpper(method)+" /api/v1"+currentPath)
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}

	registered := RegisteredRouteContracts()
	sort.Strings(openAPIContracts)
	sort.Strings(registered)
	if strings.Join(openAPIContracts, "\n") != strings.Join(registered, "\n") {
		t.Fatalf("OpenAPI và Go routes lệch:\nOpenAPI:\n%s\nGo:\n%s", strings.Join(openAPIContracts, "\n"), strings.Join(registered, "\n"))
	}
}

func TestProgrammingImpactGoldenPayload(t *testing.T) {
	goldenPath := filepath.Join("..", "..", "..", "..", "..", "..", "contracts", "openapi", "testdata", "programming-impact.json")
	raw, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	var impact Impact
	if err := json.Unmarshal(raw, &impact); err != nil {
		t.Fatal(err)
	}
	request := CommissionRequest{
		SchemaVersion:    "1.0",
		ImpactRef:        impact.ImpactRef,
		Acknowledgements: append([]ImpactKey(nil), allImpactKeys...),
	}
	if public := ValidateImpactAcknowledgements(impact, request); public != nil {
		t.Fatalf("golden payload bị từ chối: %+v", public)
	}

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	expectedFields := map[string]bool{"impactRef": true}
	for _, key := range allImpactKeys {
		expectedFields[string(key)] = true
	}
	if got, want := len(fields), len(expectedFields); got != want {
		t.Fatalf("golden có %d field; want %d (impactRef + đúng tám nhóm)", got, want)
	}
	for field := range expectedFields {
		if _, ok := fields[field]; !ok {
			t.Errorf("golden thiếu field %q", field)
		}
	}
}

func TestProgrammingImpactOpenAPIStaysSynchronized(t *testing.T) {
	openAPIPath := filepath.Join("..", "..", "..", "..", "..", "..", "contracts", "openapi", "openapi.yaml")
	raw, err := os.ReadFile(openAPIPath)
	if err != nil {
		t.Fatal(err)
	}
	spec := string(raw)

	impactKeys := make([]string, 0, len(allImpactKeys))
	for _, key := range allImpactKeys {
		impactKeys = append(impactKeys, string(key))
	}
	assertOpenAPIEnum(t, schemaSection(t, spec, "ProgrammingImpactKey"), impactKeys)

	commission := schemaSection(t, spec, "ProgrammingCommissionRequest")
	acknowledgements := fieldSection(t, commission, "acknowledgements", "cutover")
	/* Trần `maxItems` phải đúng BẰNG số nhóm impact, không phải một hằng số gõ
	 * tay: hẹp hơn thì một Revision chạm đủ mọi nhóm sẽ không Commission được,
	 * còn rộng hơn thì nó thôi là một phép kiểm. Suy từ `allImpactKeys` để hai
	 * con số không thể trôi khỏi nhau. */
	wantMaxItems := fmt.Sprintf("maxItems: %d", len(allImpactKeys))
	if !strings.Contains(acknowledgements, wantMaxItems) {
		t.Fatalf("ProgrammingCommissionRequest.acknowledgements phải có %s (bằng số nhóm impact):\n%s",
			wantMaxItems, acknowledgements)
	}

	change := schemaSection(t, spec, "ProgrammingRevisionChange")
	kind := fieldSection(t, change, "kind", "changeType")
	// Danh sách này đối chiếu trực tiếp với store.validObjectKind và CHECK của
	// revision_objects ở migration v11. Contract không được hẹp hơn dữ liệu mà
	// backend có thể trả.
	assertOpenAPIEnum(t, kind, []string{
		"METADATA", "PROGRAM", "FUNCTION", "FUNCTION_BLOCK",
		"VARIABLE", "BINDING", "TASK", "SIGNAL",
	})
	category := fieldSection(t, change, "category", "beforeSha256")
	assertOpenAPIEnum(t, category, []string{
		"SOURCE", "MAPPING", "OUTPUT_MAPPING", "TASK", "LIBRARY", "RETAIN",
		"PUBLISHED_SIGNAL", "PROGRAM_SET",
	})
}

// TestProgramsPageOpenAPIMatchesGoResponse — khoá HÌNH DẠNG phản hồi của
// `GET /projects/{projectId}/programs` (T60-013/T60-014) vào contract.
//
// Phép kiểm này đọc trường JSON THẬT bằng reflect trên chính struct mà handler
// serialize, chứ không đối chiếu với một danh sách chép tay. Lý do: một danh
// sách chép tay chỉ bắt được lỗi khi có người nhớ sửa nó, và đúng lúc quên thì
// nó vẫn xanh. Ràng buộc quan trọng nhất ở đây là `omitempty` ⇔ `required`:
// server cố ý KHÔNG dùng `omitempty` cho các trường nullable, vì `null` tường
// minh nói "đã xét, chưa biết" còn trường VẮNG MẶT lẫn với "server đời cũ chưa
// có trường này". Khai một trường như vậy thành optional trong contract sẽ xoá
// đúng sự phân biệt đó.
func TestProgramsPageOpenAPIMatchesGoResponse(t *testing.T) {
	spec := readProgrammingOpenAPI(t)

	// D-07 (Plan 60 §4.1) — ĐÚNG năm trạng thái. `STARTING`/`STOPPING` bị loại
	// vì `start()`/`stop()`/`disable()` của scheduler đổi trạng thái đồng bộ,
	// tức thì: không có pha trung gian nào để hiển thị, và bày ra một pha không
	// tồn tại sẽ làm UI kẹt vĩnh viễn ở đó.
	runtimeState := schemaSection(t, spec, "ProgrammingProgramRuntimeState")
	assertOpenAPIEnum(t, runtimeState, []string{"RUNNING", "WAITING", "DISABLED", "FAULTED", "UNKNOWN"})
	// Soi ĐÚNG danh sách enum, không soi cả section: phần mô tả cố ý NHẮC TÊN
	// hai giá trị bị loại để người đọc sau biết vì sao chúng vắng mặt, nên một
	// phép `Contains` trên cả section sẽ đỏ vì chính lời giải thích của mình.
	enumValues := strings.Join(schemaEnumValues(t, runtimeState), ",")
	for _, forbidden := range []string{"STARTING", "STOPPING"} {
		if strings.Contains(enumValues, forbidden) {
			t.Fatalf("ProgrammingProgramRuntimeState không được mang %q (D-07): [%s]", forbidden, enumValues)
		}
	}

	// Nguồn số đo lấy thẳng từ hằng của lớp application — không chép chuỗi.
	assertOpenAPIEnum(t, schemaSection(t, spec, "ProgrammingProgramRuntimeStateSource"), []string{
		programmingapplication.ProgramSourceCoreLive,
		programmingapplication.ProgramSourceLastKnown,
		programmingapplication.ProgramSourceUnavailable,
	})

	// D-04 (Plan 60 §4.2) — bốn giá trị khi CÓ nhãn. `null` là câu trả lời hợp
	// lệ và KHÔNG phải một giá trị enum: Program `DISABLED`/`WAITING` không mang
	// nhãn sức khoẻ nào, nên nó nằm ở chỗ dùng (`oneOf` với `null`), không nằm
	// trong enum.
	assertOpenAPIEnum(t, schemaSection(t, spec, "ProgrammingProgramHealth"),
		[]string{"HEALTHY", "DEGRADED", "FAULT", "UNKNOWN"})
	health := fieldSection(t, schemaSection(t, spec, "ProgrammingProgramListItem"), "health", "")
	if !strings.Contains(health, `{ type: "null" }`) {
		t.Fatalf("ProgrammingProgramListItem.health phải nullable (D-04):\n%s", health)
	}

	assertSchemaMatchesGoResponse(t, spec, "ProgrammingProgramsPage",
		programmingapplication.ProgramsPageView{})
	assertSchemaMatchesGoResponse(t, spec, "ProgrammingProgramListItem",
		programmingapplication.ProgramListItemView{})
}

// TestProjectLabelsOpenAPIMatchesGoResponse — khoá `dirty`/`draftSequence`/
// `activeSequence` (`GET /projects`) và `sequence` (`GET /revisions/{id}`) vào
// contract (T60-015 + D-05).
//
// Ba trường đầu là con trỏ KHÔNG `omitempty`, nên chúng phải là `required` và
// nullable: `null` nghĩa là "server đã xét và chưa biết", khác hẳn trường vắng
// mặt. FE render `null` thành `—`, không bao giờ thành `0` hay "sạch" — và
// contract phải nói đúng điều đó thay vì để FE tự đoán.
func TestProjectLabelsOpenAPIMatchesGoResponse(t *testing.T) {
	spec := readProgrammingOpenAPI(t)

	assertSchemaMatchesGoResponse(t, spec, "ProgrammingProject", projectResponse{})
	project := schemaSection(t, spec, "ProgrammingProject")
	for _, field := range []string{"dirty", "draftSequence", "activeSequence"} {
		section := fieldSection(t, project, field, "")
		if !strings.Contains(section, `"null"`) {
			t.Fatalf("ProgrammingProject.%s phải nullable (T60-015):\n%s", field, section)
		}
	}

	// `GET /revisions/{id}` trả map chứ không trả struct, nên lấy khoá THẬT từ
	// chính hàm dựng phản hồi thay vì chép tay danh sách.
	revision := toRevisionResponse(programmingapplication.RevisionView{})
	fields := make([]jsonResponseField, 0, len(revision))
	for name := range revision {
		fields = append(fields, jsonResponseField{name: name, required: true})
	}
	assertSchemaMatchesFields(t, spec, "ProgrammingRevision", fields)
	// `sequence` LUÔN >= 1 nên không nullable: hàng `revisions` không tồn tại
	// thì request đã trả 404 từ trước đó. Nullable ở đây sẽ mời FE hiện `—` cho
	// một giá trị luôn biết được.
	sequence := fieldSection(t, schemaSection(t, spec, "ProgrammingRevision"), "sequence", "contentHash")
	if strings.Contains(sequence, `"null"`) {
		t.Fatalf("ProgrammingRevision.sequence không được nullable:\n%s", sequence)
	}
}

// jsonResponseField là một trường JSON của phản hồi Go. `required` = trường
// LUÔN có mặt trên dây, tức tag KHÔNG mang `omitempty`.
type jsonResponseField struct {
	name     string
	required bool
}

func readProgrammingOpenAPI(t *testing.T) string {
	t.Helper()
	openAPIPath := filepath.Join("..", "..", "..", "..", "..", "..", "contracts", "openapi", "openapi.yaml")
	raw, err := os.ReadFile(openAPIPath)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// goResponseFields đọc hợp đồng JSON của một struct phản hồi bằng reflect.
func goResponseFields(t *testing.T, sample any) []jsonResponseField {
	t.Helper()
	value := reflect.TypeOf(sample)
	if value.Kind() != reflect.Struct {
		t.Fatalf("goResponseFields cần struct, nhận %s", value.Kind())
	}
	fields := make([]jsonResponseField, 0, value.NumField())
	for index := 0; index < value.NumField(); index++ {
		tag := value.Field(index).Tag.Get("json")
		if tag == "" || tag == "-" {
			continue
		}
		parts := strings.Split(tag, ",")
		if parts[0] == "" {
			continue
		}
		omitempty := false
		for _, option := range parts[1:] {
			if option == "omitempty" {
				omitempty = true
			}
		}
		fields = append(fields, jsonResponseField{name: parts[0], required: !omitempty})
	}
	return fields
}

func assertSchemaMatchesGoResponse(t *testing.T, spec, schema string, sample any) {
	t.Helper()
	assertSchemaMatchesFields(t, spec, schema, goResponseFields(t, sample))
}

func assertSchemaMatchesFields(t *testing.T, spec, schema string, fields []jsonResponseField) {
	t.Helper()
	section := schemaSection(t, spec, schema)

	wantProperties := make([]string, 0, len(fields))
	wantRequired := make([]string, 0, len(fields))
	for _, field := range fields {
		wantProperties = append(wantProperties, field.name)
		if field.required {
			wantRequired = append(wantRequired, field.name)
		}
	}
	assertSameSet(t, schema+".properties", schemaPropertyNames(t, section), wantProperties)
	assertSameSet(t, schema+".required", schemaRequiredNames(t, section), wantRequired)
}

// schemaPropertyNames đọc tên các thuộc tính khai trực tiếp dưới `properties:`.
// Chỉ nhận đúng mức thụt 8 khoảng trắng nên khối lồng (`oneOf`, `type:` dạng
// mảng, comment) không bị đếm nhầm thành thuộc tính.
func schemaPropertyNames(t *testing.T, section string) []string {
	t.Helper()
	marker := "\n      properties:\n"
	start := strings.Index(section, marker)
	if start < 0 {
		t.Fatalf("không tìm thấy khối properties trong:\n%s", section)
	}
	body := section[start+len(marker):]
	names := make([]string, 0)
	for _, match := range regexp.MustCompile(`(?m)^        ([A-Za-z][A-Za-z0-9_]*):`).FindAllStringSubmatch(body, -1) {
		names = append(names, match[1])
	}
	return names
}

func schemaRequiredNames(t *testing.T, section string) []string {
	t.Helper()
	match := regexp.MustCompile(`(?s)\n      required:\s*\[([^]]*)\]`).FindStringSubmatch(section)
	if match == nil {
		t.Fatalf("không tìm thấy required inline trong:\n%s", section)
	}
	names := make([]string, 0)
	for _, item := range strings.Split(match[1], ",") {
		item = strings.Trim(strings.TrimSpace(item), `"'`)
		if item != "" {
			names = append(names, item)
		}
	}
	return names
}

func assertSameSet(t *testing.T, label string, actual, expected []string) {
	t.Helper()
	got := append([]string(nil), actual...)
	want := append([]string(nil), expected...)
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("%s lệch với phản hồi Go:\nOpenAPI=%v\nGo=%v", label, got, want)
	}
}

func schemaSection(t *testing.T, spec, schema string) string {
	t.Helper()
	marker := "\n    " + schema + ":"
	start := strings.Index(spec, marker)
	if start < 0 {
		t.Fatalf("không tìm thấy schema %s", schema)
	}
	section := spec[start+1:]
	headerLength := len(marker) - 1
	nextSchema := regexp.MustCompile(`(?m)^    [A-Za-z_][A-Za-z0-9_]*:`)
	if location := nextSchema.FindStringIndex(section[headerLength:]); location != nil {
		section = section[:headerLength+location[0]]
	}
	return section
}

func fieldSection(t *testing.T, schema, field, nextField string) string {
	t.Helper()
	marker := "        " + field + ":"
	start := strings.Index(schema, marker)
	if start < 0 {
		t.Fatalf("không tìm thấy field %s", field)
	}
	section := schema[start:]
	if nextField != "" {
		endMarker := "\n        " + nextField + ":"
		if end := strings.Index(section, endMarker); end >= 0 {
			section = section[:end]
		}
	}
	return section
}

func schemaEnumValues(t *testing.T, section string) []string {
	t.Helper()
	match := regexp.MustCompile(`(?s)enum:\s*\[([^]]*)\]`).FindStringSubmatch(section)
	if match == nil {
		t.Fatalf("không tìm thấy enum inline trong:\n%s", section)
	}
	values := make([]string, 0)
	for _, item := range strings.Split(match[1], ",") {
		item = strings.Trim(strings.TrimSpace(item), `"'`)
		if item != "" {
			values = append(values, item)
		}
	}
	return values
}

func assertOpenAPIEnum(t *testing.T, section string, expected []string) {
	t.Helper()
	actual := schemaEnumValues(t, section)
	want := append([]string(nil), expected...)
	sort.Strings(actual)
	sort.Strings(want)
	if strings.Join(actual, "\n") != strings.Join(want, "\n") {
		t.Fatalf("enum lệch:\nactual=%v\nwant=%v", actual, want)
	}
}

// TestRevisionChangesDiffOpenAPIMatchesGoResponse — khoá typed diff của Compare
// (`T59-819`) vào contract.
//
// Phía TS có generator sinh type thẳng từ OpenAPI, nên một lần sửa schema mà
// quên sinh lại sẽ đỏ ở `client.test.ts`. Phía Go KHÔNG có generator: struct
// được viết tay, và không có phép kiểm nào thì `stHunks` có thể mất `json` tag,
// đổi tên khoá, hay mọc thêm `omitempty` mà mọi test khác vẫn xanh — rồi khay
// So sánh đọc `undefined` và vẽ "máy chủ chưa biết so" cho một máy chủ đã so.
//
// Enum đọc THẲNG từ hằng của lớp application thay vì chép chuỗi: một bản sao
// trong test chỉ chứng minh test khớp chính nó, không chứng minh OpenAPI khớp
// thứ máy chủ thật sự gửi.
func TestRevisionChangesDiffOpenAPIMatchesGoResponse(t *testing.T) {
	spec := readProgrammingOpenAPI(t)

	assertSchemaMatchesGoResponse(t, spec, "ProgrammingRevisionChanges",
		programmingapplication.RevisionChangesView{})
	assertSchemaMatchesGoResponse(t, spec, "ProgrammingStHunk",
		programmingapplication.StHunk{})
	assertSchemaMatchesGoResponse(t, spec, "ProgrammingFbdChange",
		programmingapplication.FbdChange{})

	stHunk := schemaSection(t, spec, "ProgrammingStHunk")
	assertOpenAPIEnum(t, fieldSection(t, stHunk, "changeType", "beforeStartLine"),
		programmingapplication.StHunkChangeTypes)

	fbdChange := schemaSection(t, spec, "ProgrammingFbdChange")
	assertOpenAPIEnum(t, fieldSection(t, fbdChange, "element", "elementId"),
		programmingapplication.FbdElements)
	assertOpenAPIEnum(t, fieldSection(t, fbdChange, "changeType", "detail"),
		programmingapplication.FbdChangeTypes)

	// `truncated` phải là `required` và KHÔNG nullable: "danh sách có bị cắt
	// không" là câu server luôn trả lời được. Để nó vắng mặt hay `null` là mời
	// phía dùng đọc một danh sách bị cắt thành một danh sách đầy đủ.
	changes := schemaSection(t, spec, "ProgrammingRevisionChanges")
	truncated := fieldSection(t, changes, "truncated", "nextCursor")
	if strings.Contains(truncated, `"null"`) {
		t.Fatalf("ProgrammingRevisionChanges.truncated không được nullable:\n%s", truncated)
	}

	// `nextCursor` thì NGƯỢC LẠI phải nullable: `null` là "đã đọc hết", và một
	// chuỗi rỗng dùng thay `null` sẽ được `if (cursor)` ở FE đọc thành hết
	// trang một cách tình cờ chứ không phải theo hợp đồng.
	nextCursor := fieldSection(t, changes, "nextCursor", "")
	if !strings.Contains(nextCursor, `{ type: "null" }`) {
		t.Fatalf("ProgrammingRevisionChanges.nextCursor phải nullable:\n%s", nextCursor)
	}
}

/*
TestLibraryContractOpenAPIMatchesGoResponse — khoá read model Control Library
(`T61-101`) vào contract.

Phía Go KHÔNG có generator: struct phản hồi được viết tay, nên không có phép
kiểm nào thì `tags` có thể mất `json` tag, `compatibility` có thể mọc thêm
`omitempty`, hay một trường mới chỉ tồn tại ở docs mà không ai thấy — cho tới
khi một client tin vào hợp đồng và đọc `undefined`.

Enum `compatibility.state` đọc THẲNG từ hằng của lớp application thay vì chép
chuỗi: một bản sao trong test chỉ chứng minh test khớp chính nó.
*/
func TestLibraryContractOpenAPIMatchesGoResponse(t *testing.T) {
	spec := readProgrammingOpenAPI(t)

	assertSchemaMatchesGoResponse(t, spec, "ProgrammingLibraryEntry", libraryEntryResponse{})
	assertSchemaMatchesGoResponse(t, spec, "ProgrammingLibraryCompatibility",
		libraryCompatibilityResponse{})
	assertSchemaMatchesGoResponse(t, spec, "ProgrammingLibraryUsage",
		programmingapplication.LibraryUsageView{})
	assertSchemaMatchesGoResponse(t, spec, "ProgrammingLibraryUsageScope",
		programmingapplication.LibraryUsageScope{})
	assertSchemaMatchesGoResponse(t, spec, "ProgrammingLibraryUsageItem",
		programmingapplication.LibraryUsageItem{})

	assertOpenAPIEnum(t,
		fieldSection(t, schemaSection(t, spec, "ProgrammingLibraryCompatibility"), "state", "requiredVersion"),
		programmingapplication.LibraryCompatibilityStates)

	/* `compatibility` phải là `required` VÀ không nullable. Cho nó vắng hay
	   `null` là mời client đọc "chưa có thông tin" thành "không sao" — đúng cái
	   kết luận mà `UNKNOWN` sinh ra để chặn. */
	entry := schemaSection(t, spec, "ProgrammingLibraryEntry")
	compatibility := fieldSection(t, entry, "compatibility", "presentationSha256")
	if strings.Contains(compatibility, `"null"`) {
		t.Fatalf("ProgrammingLibraryEntry.compatibility không được nullable:\n%s", compatibility)
	}

	/* Ba trường version/lý do thì NGƯỢC LẠI phải nullable: `null` là "đã xét,
	   chưa đo được", và một trường vắng thì client không phân biệt được với
	   "máy chủ cũ chưa biết trường này". */
	compatibilitySchema := schemaSection(t, spec, "ProgrammingLibraryCompatibility")
	for field, next := range map[string]string{
		"requiredVersion": "availableVersion", "availableVersion": "reason", "reason": "",
	} {
		section := fieldSection(t, compatibilitySchema, field, next)
		if !strings.Contains(section, `"null"`) {
			t.Fatalf("ProgrammingLibraryCompatibility.%s phải nullable:\n%s", field, section)
		}
	}

	/* `nextCursor` của Used-In phải nullable; `truncated` thì không. Hai trường
	   này đi cùng nhau: `truncated` nói CÓ CÒN, `nextCursor` nói ĐỌC TIẾP BẰNG
	   GÌ. Một `truncated: true` không có cursor là ngõ cụt. */
	scope := schemaSection(t, spec, "ProgrammingLibraryUsageScope")
	if strings.Contains(fieldSection(t, scope, "truncated", "items"), `"null"`) {
		t.Fatalf("ProgrammingLibraryUsageScope.truncated không được nullable:\n%s", scope)
	}
	if !strings.Contains(fieldSection(t, scope, "nextCursor", ""), `"null"`) {
		t.Fatalf("ProgrammingLibraryUsageScope.nextCursor phải nullable:\n%s", scope)
	}

	// Trần `tags` là số của hợp đồng §2.1, khoá bằng số tuyệt đối ở cả hai đầu.
	tags := fieldSection(t, entry, "tags", "compatibility")
	for _, want := range []string{"maxItems: 8", "maxLength: 24"} {
		if !strings.Contains(tags, want) {
			t.Fatalf("ProgrammingLibraryEntry.tags thiếu %q:\n%s", want, tags)
		}
	}
	request := schemaSection(t, spec, "ProgrammingLibraryEntryRequest")
	requestTags := fieldSection(t, request, "tags", "stateLayout")
	for _, want := range []string{"maxItems: 8", "maxLength: 24"} {
		if !strings.Contains(requestTags, want) {
			t.Fatalf("ProgrammingLibraryEntryRequest.tags thiếu %q:\n%s", want, requestTags)
		}
	}
}

// Đường ghi phải khớp payload OpenAPI đúng như đường đọc — một trường chỉ có ở
// một phía nghĩa là client gửi được thứ server bỏ qua, hoặc ngược lại.
func TestLibraryEntryRequestOpenAPIMatchesGoRequest(t *testing.T) {
	spec := readProgrammingOpenAPI(t)
	assertSchemaMatchesGoResponse(t, spec, "ProgrammingLibraryEntryRequest",
		upsertLibraryEntryRequest{})
}
