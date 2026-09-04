package programminghttp

import (
	"reflect"
	"testing"

	"mkddc-web/internal/programming/domain"
)

func TestValidateImpactAcknowledgements(t *testing.T) {
	none := ImpactGroup{Status: ImpactNone}
	present := func(item string) ImpactGroup { return ImpactGroup{Status: ImpactPresent, Items: []string{item}} }
	base := impactWithEveryGroup("impact-v1", none)

	tests := []struct {
		name    string
		impact  Impact
		request CommissionRequest
		code    domain.ErrorCode
	}{
		{name: "không có impact thì mảng rỗng hợp lệ", impact: base, request: CommissionRequest{ImpactRef: "impact-v1"}},
		{name: "đúng tập PRESENT", impact: withImpactGroups(base, map[ImpactKey]ImpactGroup{ImpactRetain: present("retain-layout"), ImpactActiveOverrides: present("AO-01")}), request: CommissionRequest{ImpactRef: "impact-v1", Acknowledgements: []ImpactKey{ImpactRetain, ImpactActiveOverrides}}},
		{name: "thiếu acknowledgement", impact: withImpactGroups(base, map[ImpactKey]ImpactGroup{ImpactRetain: present("retain-layout")}), request: CommissionRequest{ImpactRef: "impact-v1"}, code: domain.ErrAckMissing},
		{name: "thừa acknowledgement", impact: base, request: CommissionRequest{ImpactRef: "impact-v1", Acknowledgements: []ImpactKey{ImpactRetain}}, code: domain.ErrAckUnexpected},
		{name: "acknowledgement trùng", impact: withImpactGroups(base, map[ImpactKey]ImpactGroup{ImpactRetain: present("x")}), request: CommissionRequest{ImpactRef: "impact-v1", Acknowledgements: []ImpactKey{ImpactRetain, ImpactRetain}}, code: domain.ErrAckUnexpected},
		{name: "impact unavailable", impact: withImpactGroups(base, map[ImpactKey]ImpactGroup{ImpactRetain: {Status: ImpactUnavailable, Reason: "core offline"}}), request: CommissionRequest{ImpactRef: "impact-v1"}, code: domain.ErrImpactUnavailable},
		{name: "status thiếu fail closed", impact: withImpactGroups(base, map[ImpactKey]ImpactGroup{ImpactRetain: {}}), request: CommissionRequest{ImpactRef: "impact-v1"}, code: domain.ErrImpactUnavailable},
		{name: "present không có item fail closed", impact: withImpactGroups(base, map[ImpactKey]ImpactGroup{ImpactRetain: {Status: ImpactPresent}}), request: CommissionRequest{ImpactRef: "impact-v1", Acknowledgements: []ImpactKey{ImpactRetain}}, code: domain.ErrImpactUnavailable},
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

func TestEveryPresentImpactGroupRequiresAndAcceptsExactAckSet(t *testing.T) {
	impact := impactWithEveryGroup("impact-v1", ImpactGroup{Status: ImpactNone})
	acknowledgements := make([]ImpactKey, 0, len(allImpactKeys))
	for _, key := range allImpactKeys {
		impact = withImpactGroups(impact, map[ImpactKey]ImpactGroup{
			key: {Status: ImpactPresent, Items: []string{"item-" + string(key)}},
		})
		acknowledgements = append(acknowledgements, key)
	}
	/* Số nhóm suy từ `allImpactKeys`, KHÔNG gõ tay.
	 *
	 * `ISS-PIO-29` nâng 8 → 12 và một con số gõ tay ở đây chỉ nói "ai đó quên
	 * sửa test", không nói "một nhóm impact vừa biến mất". Điều đáng khoá là
	 * MỌI nhóm trong danh sách đều đòi và nhận đúng acknowledgement của nó. */
	if got, want := len(acknowledgements), len(allImpactKeys); got != want {
		t.Fatalf("số nhóm impact = %d; want %d", got, want)
	}
	if public := ValidateImpactAcknowledgements(impact, CommissionRequest{
		ImpactRef: impact.ImpactRef, Acknowledgements: acknowledgements,
	}); public != nil {
		t.Fatalf("đủ %d acknowledgement bị từ chối: %+v", len(allImpactKeys), public)
	}

	missingLast := append([]ImpactKey(nil), acknowledgements[:len(acknowledgements)-1]...)
	public := ValidateImpactAcknowledgements(impact, CommissionRequest{
		ImpactRef: impact.ImpactRef, Acknowledgements: missingLast,
	})
	if public == nil || public.Code != domain.ErrAckMissing {
		t.Fatalf("thiếu nhóm thứ tám không bị chặn: %+v", public)
	}
}

func TestEveryMissingImpactGroupFailsClosed(t *testing.T) {
	for _, key := range allImpactKeys {
		t.Run(string(key), func(t *testing.T) {
			impact := impactWithEveryGroup("impact-v1", ImpactGroup{Status: ImpactNone})
			impact = withImpactGroups(impact, map[ImpactKey]ImpactGroup{key: {}})
			public := ValidateImpactAcknowledgements(impact, CommissionRequest{ImpactRef: impact.ImpactRef})
			if public == nil || public.Code != domain.ErrImpactUnavailable {
				t.Fatalf("nhóm thiếu status không fail-closed: %+v", public)
			}
			if got, want := public.Field, "impact."+string(key); got != want {
				t.Fatalf("field = %q; want %q", got, want)
			}
		})
	}
}

func TestMissingAcknowledgementsAreSorted(t *testing.T) {
	impact := impactWithEveryGroup("impact-v1", ImpactGroup{Status: ImpactNone})
	impact = withImpactGroups(impact, map[ImpactKey]ImpactGroup{
		ImpactRetain:          {Status: ImpactPresent, Items: []string{"retain"}},
		ImpactActiveOverrides: {Status: ImpactPresent, Items: []string{"override"}},
	})
	err := ValidateImpactAcknowledgements(impact, CommissionRequest{ImpactRef: "impact-v1"})
	if err == nil {
		t.Fatal("missing acknowledgements accepted")
	}
	if got, want := err.Args["keys"], []string{"activeOverrides", "retain"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("keys = %#v; want %#v", got, want)
	}
}

func impactWithEveryGroup(impactRef string, group ImpactGroup) Impact {
	return Impact{
		ImpactRef:            impactRef,
		Retain:               group,
		ActiveOverrides:      group,
		Cutover:              group,
		OutputMappingChanges: group,
		PublishedSignals:     group,
		ControlLibrary:       group,
		ProgramSet:           group,
		EnableIntent:         group,
		// `ISS-PIO-29` — bốn nhóm tách theo nguồn Point. Thiếu chúng ở đây thì
		// status rỗng ⇒ UNAVAILABLE ⇒ Commission fail-closed, đúng như thiết kế.
		PhysicalMappingChanges:  group,
		VirtualPointChanges:     group,
		ModbusMappingChanges:    group,
		WritableOutputsAffected: group,
	}
}

func withImpactGroups(base Impact, groups map[ImpactKey]ImpactGroup) Impact {
	for key, group := range groups {
		switch key {
		case ImpactRetain:
			base.Retain = group
		case ImpactActiveOverrides:
			base.ActiveOverrides = group
		case ImpactCutover:
			base.Cutover = group
		case ImpactOutputMappingChanges:
			base.OutputMappingChanges = group
		case ImpactPublishedSignals:
			base.PublishedSignals = group
		case ImpactControlLibrary:
			base.ControlLibrary = group
		case ImpactProgramSet:
			base.ProgramSet = group
		case ImpactEnableIntent:
			base.EnableIntent = group
		case ImpactPhysicalMappingChanges:
			base.PhysicalMappingChanges = group
		case ImpactVirtualPointChanges:
			base.VirtualPointChanges = group
		case ImpactModbusMappingChanges:
			base.ModbusMappingChanges = group
		case ImpactWritableOutputsAffected:
			base.WritableOutputsAffected = group
		}
	}
	return base
}
