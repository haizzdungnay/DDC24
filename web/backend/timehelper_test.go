package main

import (
	"testing"
	"time"
)

func TestManualTimeCommandUsesConfiguredCivilTimezone(t *testing.T) {
	instant, err := time.Parse(time.RFC3339, "2026-07-20T02:34:00Z")
	if err != nil {
		t.Fatal(err)
	}
	got, err := manualTimeCommandValue(instant, "Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	if got != "2026-07-20 10:34:00" {
		t.Fatalf("got=%q", got)
	}
}
