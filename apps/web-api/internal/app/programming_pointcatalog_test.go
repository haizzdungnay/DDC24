package app

import "testing"

func TestPointCatalogCategoryFromRealProducerKind(t *testing.T) {
	cases := []struct {
		kind             string
		wantCategory     string
		wantDeviceIDNote string
	}{
		{"UI", "LOCAL", ""},
		{"AO", "LOCAL", ""},
		{"DO", "LOCAL", ""},
		{"virtual", "VP", ""},
		{"modbus_rtu", "MB_RTU", "bus-2-slave-5"},
	}
	for _, testCase := range cases {
		point := PointDTO{Kind: testCase.kind, BusID: 2, SlaveAddr: 5}
		category, deviceID := pointCatalogCategory(point)
		if category != testCase.wantCategory {
			t.Fatalf("kind=%q category=%q, want %q", testCase.kind, category, testCase.wantCategory)
		}
		if testCase.wantDeviceIDNote != "" && deviceID != testCase.wantDeviceIDNote {
			t.Fatalf("kind=%q deviceId=%q, want %q", testCase.kind, deviceID, testCase.wantDeviceIDNote)
		}
	}
}

func TestPointCatalogQualityNeverFabricatesGood(t *testing.T) {
	cases := map[string]string{
		"GOOD": "GOOD", "UNCERTAIN": "UNCERTAIN", "BAD": "BAD", "STALE": "STALE",
		"OFFLINE": "OFFLINE", "UNKNOWN": "UNKNOWN", "CONFIG_ERROR": "BAD",
		"":            "UNKNOWN",
		"garbled_xyz": "UNKNOWN",
	}
	for input, want := range cases {
		if got := pointCatalogQuality(PointDTO{Quality: input}); got != want {
			t.Fatalf("quality(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestPointCatalogDirectionOutputsAreReadWrite(t *testing.T) {
	if direction, writable := pointCatalogDirection(PointDTO{Kind: "AO"}); direction != "READ_WRITE" || !writable {
		t.Fatalf("AO direction=%q writable=%v", direction, writable)
	}
	if direction, writable := pointCatalogDirection(PointDTO{Kind: "DO"}); direction != "READ_WRITE" || !writable {
		t.Fatalf("DO direction=%q writable=%v", direction, writable)
	}
	if direction, writable := pointCatalogDirection(PointDTO{Kind: "UI"}); direction != "READ" || writable {
		t.Fatalf("UI direction=%q writable=%v", direction, writable)
	}
}

func TestPointCatalogDataTypeDigitalVsAnalog(t *testing.T) {
	if got := pointCatalogDataType(PointDTO{Kind: "DO"}); got != "BOOL" {
		t.Fatalf("DO dataType=%q, want BOOL", got)
	}
	if got := pointCatalogDataType(PointDTO{Kind: "AO"}); got != "REAL" {
		t.Fatalf("AO dataType=%q, want REAL", got)
	}
	if got := pointCatalogDataType(PointDTO{Kind: "virtual", Value: true}); got != "BOOL" {
		t.Fatalf("virtual bool dataType=%q, want BOOL", got)
	}
	if got := pointCatalogDataType(PointDTO{Kind: "virtual", Value: 12.5}); got != "REAL" {
		t.Fatalf("virtual numeric dataType=%q, want REAL", got)
	}
}
