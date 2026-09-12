package programminghttp

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
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

// `ISS-PIO-38` (#492) — RestoreRequest phải MANG được acknowledgements qua decoder
// strict. Đây là chỗ đường thoát lệch slot Modbus dễ thành trang trí nhất: nếu
// trường bị rớt khỏi struct hay đổi tag, `DisallowUnknownFields` sẽ TỪ CHỐI đúng
// request mang xác nhận, và RESTORE khi lệch slot thành hard-block không có
// đường phục hồi — đúng thứ phương án 3 của issue tồn tại để tránh.
func TestRestoreRequestCarriesModbusSlotOverrideAcknowledgement(t *testing.T) {
	body := `{"schemaVersion":"1.0","revisionId":"11111111-1111-4111-8111-111111111111",` +
		`"expectedActiveRevisionId":null,"reason":"khôi phục LKG",` +
		`"acknowledgements":["modbus-slot-mismatch-override"]}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/programming/operations/restore",
		strings.NewReader(body))
	var decoded RestoreRequest
	if err := decodeStrictRequest(request, &decoded); err != nil {
		t.Fatalf("decoder strict từ chối acknowledgements của RESTORE — đường thoát #492 không gọi được: %v", err)
	}
	if len(decoded.Acknowledgements) != 1 || decoded.Acknowledgements[0] != "modbus-slot-mismatch-override" {
		t.Fatalf("acknowledgements không tới được service: %+v", decoded.Acknowledgements)
	}
}

// Không có acknowledgements vẫn phải decode được: RESTORE không lệch slot thì
// không cần xác nhận, và trường là optional.
func TestRestoreRequestWithoutAcknowledgementsStillDecodes(t *testing.T) {
	body := `{"schemaVersion":"1.0","revisionId":"11111111-1111-4111-8111-111111111111",` +
		`"expectedActiveRevisionId":null,"reason":"khôi phục LKG"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/programming/operations/restore",
		strings.NewReader(body))
	var decoded RestoreRequest
	if err := decodeStrictRequest(request, &decoded); err != nil {
		t.Fatalf("RESTORE không kèm xác nhận phải decode được: %v", err)
	}
	if len(decoded.Acknowledgements) != 0 {
		t.Fatalf("không gửi acknowledgements mà lại có: %+v", decoded.Acknowledgements)
	}
}
