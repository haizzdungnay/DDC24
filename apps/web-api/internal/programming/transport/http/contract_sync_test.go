package programminghttp

import (
	"bufio"
	"os"
	"path/filepath"
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
