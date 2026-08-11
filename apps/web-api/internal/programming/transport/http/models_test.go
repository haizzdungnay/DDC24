package programminghttp

import (
	"reflect"
	"testing"

	"mkddc-web/internal/programming/domain"
)

func TestValidateImpactAcknowledgements(t *testing.T) {
	none := ImpactGroup{Status: ImpactNone}
	present := func(item string) ImpactGroup { return ImpactGroup{Status: ImpactPresent, Items: []string{item}} }
	base := Impact{
		ImpactRef:            "impact-v1",
		Retain:               none,
		ActiveOverrides:      none,
		Cutover:              none,
		OutputMappingChanges: none,
	}

	tests := []struct {
		name    string
		impact  Impact
		request CommissionRequest
		code    domain.ErrorCode
	}{
		{name: "không có impact thì mảng rỗng hợp lệ", impact: base, request: CommissionRequest{ImpactRef: "impact-v1"}},
		{name: "đúng tập PRESENT", impact: withGroups(base, present("retain-layout"), present("AO-01")), request: CommissionRequest{ImpactRef: "impact-v1", Acknowledgements: []ImpactKey{ImpactRetain, ImpactActiveOverrides}}},
		{name: "thiếu acknowledgement", impact: withGroups(base, present("retain-layout"), none), request: CommissionRequest{ImpactRef: "impact-v1"}, code: domain.ErrAckMissing},
		{name: "thừa acknowledgement", impact: base, request: CommissionRequest{ImpactRef: "impact-v1", Acknowledgements: []ImpactKey{ImpactRetain}}, code: domain.ErrAckUnexpected},
		{name: "acknowledgement trùng", impact: withGroups(base, present("x"), none), request: CommissionRequest{ImpactRef: "impact-v1", Acknowledgements: []ImpactKey{ImpactRetain, ImpactRetain}}, code: domain.ErrAckUnexpected},
		{name: "impact unavailable", impact: withGroups(base, ImpactGroup{Status: ImpactUnavailable, Reason: "core offline"}, none), request: CommissionRequest{ImpactRef: "impact-v1"}, code: domain.ErrImpactUnavailable},
		{name: "status thiếu fail closed", impact: withGroups(base, ImpactGroup{}, none), request: CommissionRequest{ImpactRef: "impact-v1"}, code: domain.ErrImpactUnavailable},
		{name: "present không có item fail closed", impact: withGroups(base, ImpactGroup{Status: ImpactPresent}, none), request: CommissionRequest{ImpactRef: "impact-v1", Acknowledgements: []ImpactKey{ImpactRetain}}, code: domain.ErrImpactUnavailable},
		{name: "impactRef stale", impact: base, request: CommissionRequest{ImpactRef: "impact-old"}, code: domain.ErrImpactStale},
		{name: "khóa không biết bị chặn", impact: base, request: CommissionRequest{ImpactRef: "impact-v1", Acknowledgements: []ImpactKey{"unknown"}}, code: domain.ErrAckUnexpected},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := ValidateImpactAcknowledgements(test.impact, test.request)
			if test.code == "" {
				if got != nil {
					t.Fatalf("unexpected error: %+v", *got)
				}
				return
			}
			if got == nil || got.Code != test.code {
				t.Fatalf("error = %+v; want code %s", got, test.code)
			}
			if !got.KeepsRunningRevision {
				t.Fatal("validation error must preserve running revision")
			}
		})
	}
}

func TestMissingAcknowledgementsAreSorted(t *testing.T) {
	impact := Impact{
		ImpactRef:            "impact-v1",
		Retain:               ImpactGroup{Status: ImpactPresent, Items: []string{"retain"}},
		ActiveOverrides:      ImpactGroup{Status: ImpactPresent, Items: []string{"override"}},
		Cutover:              ImpactGroup{Status: ImpactNone},
		OutputMappingChanges: ImpactGroup{Status: ImpactNone},
	}
	err := ValidateImpactAcknowledgements(impact, CommissionRequest{ImpactRef: "impact-v1"})
	if err == nil {
		t.Fatal("missing acknowledgements accepted")
	}
	if got, want := err.Args["keys"], []string{"activeOverrides", "retain"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("keys = %#v; want %#v", got, want)
	}
}

func withGroups(base Impact, retain, overrides ImpactGroup) Impact {
	base.Retain = retain
	base.ActiveOverrides = overrides
	return base
}
