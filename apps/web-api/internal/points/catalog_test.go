package points

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCanonicalConfigIDStable(t *testing.T) {
	limits := Limits{UI: 16, AO: 4, DO: 4, VP: 464}
	for _, id := range []string{"UI-01", "AO-04", "DO-04", "VP464"} {
		if got, ok := CanonicalConfigID(id, limits); !ok || got != id {
			t.Fatalf("CanonicalConfigID(%q) = %q/%v", id, got, ok)
		}
	}
	if _, ok := CanonicalConfigID("ui1", limits); ok {
		t.Fatal("ID không canonical được chấp nhận")
	}
}

func TestValidateTagsRejectsRenameConflict(t *testing.T) {
	errs := ValidateTags([]Entry{
		{PointID: "UI-01", TagPath: "ui[0].tag", Tag: "Room Temp"},
		{PointID: "VP1", TagPath: "items[0].tag", Tag: "room temp"},
	}, nil)
	if len(errs) != 1 || errs[0].Reason != "point_tag_conflict" || errs[0].Conflict.PointID != "UI-01" {
		t.Fatalf("conflict = %+v", errs)
	}
}

func TestNamespaceStorePersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "point_namespace.conf")
	store := NamespaceStore{Path: path, Writer: os.WriteFile}
	want := NamespaceAuthority{Revision: 7, Generations: map[string]uint64{"VP1": 3}}
	if err := store.Write(want); err != nil {
		t.Fatalf("Write: %v", err)
	}
	got, err := store.Read()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if got.Revision != want.Revision || got.Generations["VP1"] != 3 {
		t.Fatalf("authority = %+v", got)
	}
}
