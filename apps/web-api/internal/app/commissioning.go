package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

/* ISS-PIO-26 — lệnh test commissioning phải có TTL và tự nhả.
 *
 * TRIỆU CHỨNG: `POST /commissioning/points/{id}/test` ghi thẳng ra AO/DO nhưng
 * thân yêu cầu chỉ nhận đúng `value`. Không có thời hạn, nên mỗi lần chạy thử
 * để lại một output BỊ ÉP VĨNH VIỄN cho tới khi có người nhớ bấm "Trả về tự
 * động". Chính trang Chạy thử đã phải dựng một điều kiện tiên quyết tên là
 * "Không còn điểm kẹt ép tay từ phiên trước" — tức là hệ thống đang cảnh báo về
 * hậu quả của chính nó.
 *
 * NGUYÊN NHÂN GỐC: đường ép tay thường (`PUT /points/{id}`) đã có `ttlS` và
 * Core `scan_loop` tự `release_ao/do` khi hết hạn (`web_ipc.cpp:715` nhận
 * `ttlS` 1..86400 cho op `write` nguồn `manual`). Đường test đi qua
 * `CommissionTest` → `ForcePoint` → `ForcePointTTL(..., ttlS = 0, ...)`, và
 * `ttlS = 0` với Core nghĩa là "không tự nhả". Cơ chế TTL đã có sẵn dưới Core;
 * chỗ duy nhất đánh rơi nó là hai tầng bọc ở web-api.
 *
 * CÁCH SỬA: đường test dùng chung `ForcePointTTL` với TTL bắt buộc lớn hơn 0,
 * mặc định `defaultCommissionTestTTLS` khi client không gửi, và ghi vết audit
 * ngang bằng đường ép tay (`commissioning_test` + `point_override`) cùng việc
 * đăng ký vào `OverrideRegistry` để đồng hồ đếm ngược hiện ở mọi màn hình.
 */

// defaultCommissionTestTTLS là thời hạn áp dụng khi client KHÔNG gửi `ttlS`.
//
// Không chọn 0 (giữ vô hạn) làm mặc định: một buổi commissioning điển hình thử
// từng output vài chục giây rồi chuyển sang điểm kế tiếp, nên "quên nhả" là
// trạng thái mặc định của con người chứ không phải ngoại lệ. 5 phút đủ dài để
// quan sát cơ cấu chấp hành phản hồi, và đủ ngắn để một buổi chạy thử bị bỏ dở
// không để lại van mở qua đêm.
const defaultCommissionTestTTLS = 300

type commissionTestBody struct {
	value any
	ttlS  uint32
}

// commissionTesterTTL là đường test có thời hạn do Core cưỡng chế. Tách khỏi
// `commissionTester` theo đúng mẫu `pointTTLForcer`/`pointForcer`: một core
// client không cưỡng chế được TTL thì phải TỪ CHỐI lệnh, không được lặng lẽ
// rơi về đường ghi vô hạn — đó chính là lỗi đang sửa.
type commissionTesterTTL interface {
	CommissionTestTTL(ctx context.Context, id string, value any, ttlS uint32, user string) (CommissioningTestResult, error)
}

// handleCommissionTest handles POST /api/v1/commissioning/points/{id}/test (RBAC operator+).
// Sends a commissioning test command to core via CommissionTestTTL and returns CommissioningTestResult.
func (a *App) handleCommissionTest(w http.ResponseWriter, r *http.Request) {
	principal := principalFromContext(r.Context())
	if principal == nil || !RoleAllows(principal.Role, RoleOperator) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing point id")
		return
	}
	body, err := decodeCommissionTestBody(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tester, ok := a.core.(commissionTesterTTL)
	if !ok {
		// Fail closed: thà không chạy thử được còn hơn ép một cơ cấu chấp hành
		// bằng lệnh không ai nhả.
		a.audit.CommissioningTest(principal, id, "unsupported", body.ttlS, 0, r.RemoteAddr)
		writeError(w, http.StatusConflict, "commissioning test unsupported")
		return
	}
	res, err := tester.CommissionTestTTL(r.Context(), id, body.value, body.ttlS, principalUsername(principal))
	if err != nil {
		a.audit.CommissioningTest(principal, id, "rejected", body.ttlS, 0, r.RemoteAddr)
		a.audit.PointOverride(principal, id, body.ttlS, 0, "rejected", "commission_test_rejected", "", r.RemoteAddr)
		writeError(w, http.StatusConflict, fmt.Sprintf("commission test error: %v", err))
		return
	}
	remaining := uint32(0)
	if res.ExpiresInS != nil {
		remaining = *res.ExpiresInS
	}
	a.audit.CommissioningTest(principal, id, res.Result, body.ttlS, remaining, r.RemoteAddr)
	if res.Result != "failed" {
		/* Ngang bằng đường ép tay: cùng ghi `point_override` và cùng đăng ký
		 * vào `OverrideRegistry`. Thiếu bước đăng ký thì một lệnh test ép
		 * output xong mà trang Giám sát/Tổng quan KHÔNG thấy điểm nào bị ép —
		 * đúng lớp lỗi PA3-F05, chỉ khác đường vào. */
		reason := "commission_test_ttl"
		if remaining == 0 {
			// Core nhận lệnh nhưng không báo thời hạn còn lại. Nói ra trong
			// audit thay vì để giao diện đếm ngược một con số không ai cưỡng chế.
			reason = "commission_test_ttl_not_reported"
		}
		a.overrides.Note(id, principalUsername(principal), body.ttlS, remaining, "manual")
		a.audit.PointOverride(principal, id, body.ttlS, remaining, res.Result, reason, "", r.RemoteAddr)
	}
	writeJSON(w, http.StatusOK, res)
}

func decodeCommissionTestBody(w http.ResponseWriter, r *http.Request) (commissionTestBody, error) {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.UseNumber()
	var raw map[string]json.RawMessage
	if err := dec.Decode(&raw); err != nil {
		return commissionTestBody{}, fmt.Errorf("invalid json")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return commissionTestBody{}, fmt.Errorf("invalid json")
	}
	for key := range raw {
		if key != "value" && key != "ttlS" {
			return commissionTestBody{}, fmt.Errorf("unknown field %q", key)
		}
	}
	valueRaw, ok := raw["value"]
	if !ok {
		return commissionTestBody{}, fmt.Errorf("missing value")
	}
	var value any
	vdec := json.NewDecoder(bytes.NewReader(valueRaw))
	vdec.UseNumber()
	if err := vdec.Decode(&value); err != nil {
		return commissionTestBody{}, fmt.Errorf("invalid value")
	}
	switch value.(type) {
	case bool, json.Number:
	default:
		return commissionTestBody{}, fmt.Errorf("value must be number or bool")
	}
	body := commissionTestBody{value: value, ttlS: defaultCommissionTestTTLS}
	if ttlRaw, ok := raw["ttlS"]; ok {
		var ttl int64
		if err := json.Unmarshal(ttlRaw, &ttl); err != nil {
			return commissionTestBody{}, fmt.Errorf("invalid ttlS")
		}
		/* `ttlS: 0` bị từ chối chứ KHÔNG rơi về mặc định. Với Core, 0 nghĩa là
		 * "giữ vô hạn"; nhận nó ở đây rồi âm thầm đổi thành 300 sẽ trả lời một
		 * câu khác hẳn câu người gọi hỏi. Nói thẳng rằng endpoint này không có
		 * lựa chọn vô hạn. */
		if ttl < 1 || ttl > maxOverrideTTLS {
			return commissionTestBody{}, fmt.Errorf("ttlS must be between 1 and %d seconds (lệnh test luôn phải tự nhả)", maxOverrideTTLS)
		}
		body.ttlS = uint32(ttl)
	}
	return body, nil
}
