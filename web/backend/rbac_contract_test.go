package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestOpenAPIRBACOperationsExactlyMatchRouter(t *testing.T) {
	version, operations := readOpenAPIRBACOperations(t)
	if version != "1.11.0" {
		t.Fatalf("OpenAPI version = %q; want 1.11.0", version)
	}
	if len(operations) != 62 {
		t.Fatalf("OpenAPI operation count = %d; want 62", len(operations))
	}
	loginRoles, ok := operations["POST /auth/login"]
	if !ok || loginRoles != nil {
		t.Fatalf("login operation roles = %v, present=%v; want public", loginRoles, ok)
	}
	delete(operations, "POST /auth/login")

	app, _ := newTestAppWithAdmin(t)
	routes := app.protectedRoutes()
	if len(routes) != len(operations) {
		t.Fatalf("protected router/OpenAPI counts = %d/%d", len(routes), len(operations))
	}
	for _, route := range routes {
		method, fullPath, ok := strings.Cut(route.pattern, " ")
		if !ok || !strings.HasPrefix(fullPath, "/api/v1") {
			t.Fatalf("invalid backend route pattern %q", route.pattern)
		}
		key := method + " " + strings.TrimPrefix(fullPath, "/api/v1")
		contractRoles, exists := operations[key]
		if !exists {
			t.Errorf("backend route missing from OpenAPI: %s", key)
			continue
		}
		wantRoles := rolesForPermission(route.permission)
		if !reflect.DeepEqual(contractRoles, wantRoles) {
			t.Errorf("%s roles = %v; permission %q maps to %v", key, sortedRoles(contractRoles), route.permission, sortedRoles(wantRoles))
		}
		delete(operations, key)
	}
	if len(operations) != 0 {
		keys := make([]string, 0, len(operations))
		for key := range operations {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		t.Fatalf("OpenAPI operations missing from backend router: %v", keys)
	}
}

func TestOpenAPIRuntimeAvailabilityMarkers(t *testing.T) {
	path := filepath.Join("..", "..", "docs", "02_design", "interfaces", "openapi.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	document := string(data)
	if !strings.Contains(document, "status: backend-mapped") {
		t.Fatal("OpenAPI RBAC contract is not marked backend-mapped")
	}
	for _, path := range []string{
		"/bacnet/objects", "/logs/download", "/ota/status", "/graph/deploy",
		"/graph/validate", "/ota/apply", "/ota/upload",
	} {
		block := openAPIPathBlock(t, document, path)
		if !strings.Contains(block, "x-runtime-status: authority-pending") || !strings.Contains(block, `"501":`) {
			t.Errorf("%s must declare authority-pending and response 501", path)
		}
	}
	ws := openAPIPathBlock(t, document, "/ws/monitor")
	for _, marker := range []string{"x-websocket: { runtimeStatus: implemented }", "- wsToken: []", `"101":`} {
		if !strings.Contains(ws, marker) {
			t.Errorf("/ws/monitor missing %q", marker)
		}
	}
	if strings.Contains(openAPIPathBlock(t, document, "/system/config"), "\n    put:") {
		t.Fatal("unsupported aggregate PUT /system/config remains in OpenAPI")
	}
}

func openAPIPathBlock(t *testing.T, document, path string) string {
	t.Helper()
	startMarker := "\n  " + path + ":\n"
	start := strings.Index(document, startMarker)
	if start < 0 {
		t.Fatalf("OpenAPI path %s not found", path)
	}
	start += 1
	rest := document[start+len(startMarker)-1:]
	end := strings.Index(rest, "\n  /")
	if end < 0 {
		end = strings.Index(rest, "\ncomponents:")
	}
	if end < 0 {
		return document[start:]
	}
	return document[start : start+len(startMarker)-1+end]
}

// This parser intentionally covers the constrained paths/method/x-rbac shape
// used by the canonical OpenAPI file without adding a runtime YAML dependency.
func readOpenAPIRBACOperations(t *testing.T) (string, map[string]map[Role]bool) {
	t.Helper()
	path := filepath.Join("..", "..", "docs", "02_design", "interfaces", "openapi.yaml")
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	operations := make(map[string]map[Role]bool)
	version := ""
	inPaths := false
	currentPath, currentOperation := "", ""
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if !inPaths && strings.HasPrefix(line, "  version:") && version == "" {
			version = strings.Trim(strings.TrimSpace(strings.TrimPrefix(trimmed, "version:")), `"`)
			continue
		}
		if line == "paths:" {
			inPaths = true
			continue
		}
		if !inPaths {
			continue
		}
		if line != "" && line[0] != ' ' {
			break
		}
		if strings.HasPrefix(line, "  /") && strings.HasSuffix(trimmed, ":") {
			currentPath = strings.TrimSuffix(trimmed, ":")
			currentOperation = ""
			continue
		}
		if strings.HasPrefix(line, "    ") && !strings.HasPrefix(line, "      ") && strings.HasSuffix(trimmed, ":") {
			method := strings.TrimSuffix(trimmed, ":")
			switch method {
			case "get", "post", "put", "delete", "patch":
				currentOperation = strings.ToUpper(method) + " " + currentPath
				if _, duplicate := operations[currentOperation]; duplicate {
					t.Fatalf("duplicate OpenAPI operation %s", currentOperation)
				}
				operations[currentOperation] = nil
			default:
				currentOperation = ""
			}
			continue
		}
		if currentOperation != "" && strings.HasPrefix(trimmed, "x-rbac:") {
			roles, err := parseInlineRBACRoles(strings.TrimSpace(strings.TrimPrefix(trimmed, "x-rbac:")))
			if err != nil {
				t.Fatalf("%s: %v", currentOperation, err)
			}
			operations[currentOperation] = roles
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	for operation, roles := range operations {
		if operation != "POST /auth/login" && len(roles) == 0 {
			t.Fatalf("protected OpenAPI operation %s has no x-rbac roles", operation)
		}
	}
	return version, operations
}

func parseInlineRBACRoles(value string) (map[Role]bool, error) {
	if !strings.HasPrefix(value, "[") || !strings.HasSuffix(value, "]") {
		return nil, fmt.Errorf("x-rbac must be an inline role list")
	}
	roles := make(map[Role]bool)
	for _, item := range strings.Split(strings.Trim(value, "[]"), ",") {
		role := Role(strings.TrimSpace(item))
		if !validRole(role) {
			return nil, fmt.Errorf("invalid role %q", role)
		}
		roles[role] = true
	}
	return roles, nil
}

func rolesForPermission(permission Permission) map[Role]bool {
	roles := make(map[Role]bool)
	for _, role := range []Role{RoleViewer, RoleOperator, RoleEngineer, RoleAdmin} {
		if RoleHasPermission(role, permission) {
			roles[role] = true
		}
	}
	return roles
}

func sortedRoles(roles map[Role]bool) []Role {
	result := make([]Role, 0, len(roles))
	for role := range roles {
		result = append(result, role)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}
