package programminghttp

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
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
	if !strings.Contains(acknowledgements, "maxItems: 8") {
		t.Fatalf("ProgrammingCommissionRequest.acknowledgements phải có maxItems: 8:\n%s", acknowledgements)
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

func assertOpenAPIEnum(t *testing.T, section string, expected []string) {
	t.Helper()
	match := regexp.MustCompile(`(?s)enum:\s*\[([^]]*)\]`).FindStringSubmatch(section)
	if match == nil {
		t.Fatalf("không tìm thấy enum inline trong:\n%s", section)
	}
	actual := make([]string, 0)
	for _, item := range strings.Split(match[1], ",") {
		item = strings.Trim(strings.TrimSpace(item), `"'`)
		if item != "" {
			actual = append(actual, item)
		}
	}
	want := append([]string(nil), expected...)
	sort.Strings(actual)
	sort.Strings(want)
	if strings.Join(actual, "\n") != strings.Join(want, "\n") {
		t.Fatalf("enum lệch:\nactual=%v\nwant=%v", actual, want)
	}
}
