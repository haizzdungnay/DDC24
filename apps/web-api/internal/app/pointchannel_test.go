package app

import "testing"

func TestGlobalPointChannelMapping(t *testing.T) {
	tests := []struct {
		id      string
		channel int
	}{
		{"UI-01", 1}, {"UI-16", 16},
		{"AO-01", 17}, {"AO-04", 20},
		{"DO-01", 21}, {"DO-04", 24},
		{"VP1", 25}, {"VP464", 488},
	}
	seen := map[int]string{}
	for _, tt := range tests {
		channel, ok := globalPointChannel(tt.id)
		if !ok || channel != tt.channel {
			t.Fatalf("globalPointChannel(%q) = %d, %v; want %d, true", tt.id, channel, ok, tt.channel)
		}
		if previous := seen[channel]; previous != "" {
			t.Fatalf("channel %d shared by %s and %s", channel, previous, tt.id)
		}
		seen[channel] = tt.id
	}
}

func TestPointIDFromGlobalChannel(t *testing.T) {
	for channel, want := range map[int]string{1: "UI-01", 16: "UI-16", 17: "AO-01", 20: "AO-04", 21: "DO-01", 24: "DO-04", 25: "VP1", 488: "VP464"} {
		if got, ok := pointIDFromGlobalChannel(channel); !ok || got != want {
			t.Fatalf("pointIDFromGlobalChannel(%d) = %q, %v; want %q, true", channel, got, ok, want)
		}
	}
}

func TestValidatePhysicalPointTagsAreFixed(t *testing.T) {
	cfg := ConfigIO{
		UI: []map[string]any{{"ch": 1, "tag": "Changed", "name": "Input"}},
		AO: []map[string]any{{"ch": 1, "tag": "AO-01", "name": "Output"}},
		DO: []map[string]any{{"ch": 1, "tag": "DO-01", "name": "Relay"}},
	}
	errs := validateFixedPhysicalPointTags(cfg)
	if !hasConfigErrorPath(errs, "ui[0].tag") {
		t.Fatalf("validateFixedPhysicalPointTags() errors = %+v; want ui[0].tag", errs)
	}
}

func TestNextVirtualPointIDReusesDeletedGlobalChannel(t *testing.T) {
	items := []VirtualPoint{{ID: "VP2"}}
	if got := nextVirtualPointID(items); got != "VP1" {
		t.Fatalf("nextVirtualPointID() = %q; want VP1 (global channel 25)", got)
	}
}

func TestVirtualPointTagRejectsLegacyIDAlias(t *testing.T) {
	errs := validatePointTagEntries([]pointNamespaceEntry{{PointID: "VP1", TagPath: "items[0].tag", Tag: "AV1"}})
	if !hasValidationReason(errs, "point_tag_reserved") {
		t.Fatalf("validatePointTagEntries() errors = %+v; want point_tag_reserved", errs)
	}
}

func TestVirtualPointDTOUsesTagAsDisplayName(t *testing.T) {
	point := virtualPointDTO(VirtualPoint{ID: "VP1", Tag: "doraemon", Label: "legacy label", SignalType: "float", Enabled: true})
	if point.ID != "VP1" || point.Tag != "doraemon" || point.Name != "doraemon" || point.Channel != 25 {
		t.Fatalf("virtualPointDTO() = %+v; want internal VP1 with doraemon display and channel 25", point)
	}
}

func TestNormalizeVirtualPointDropsLegacyLabel(t *testing.T) {
	point := normalizeVirtualPoint(VirtualPoint{ID: "VP1", Tag: "doraemon", Label: "legacy label", SignalType: "float"})
	if point.Label != "" {
		t.Fatalf("normalizeVirtualPoint() label = %q; want empty", point.Label)
	}
}
