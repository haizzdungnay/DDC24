package app

import (
	"context"
	"net"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

// Kiểm kết nối sau khi apply cấu hình mạng — `T57-3.18` (§6.15-P2).
//
// BỐI CẢNH QUYẾT ĐỊNH THIẾT KẾ
//
// Người vận hành vừa bấm Apply, đồng hồ rollback 120 giây đang chạy, và trang họ
// đang mở vẫn đi qua địa chỉ CŨ. Câu hỏi duy nhất lúc đó là "cấu hình mới có
// thật sự thông không?" — và trước đây không có cách nào trả lời ngoài việc mở
// một tab khác rồi đoán.
//
// BA TÌNH TRẠNG, KHÔNG PHẢI HAI
//
// Đây là chỗ dễ sai nhất của tính năng này. `unknown` (không kiểm được: thiếu
// công cụ `ping`, thiếu quyền, hết giờ) **không được gộp** vào `unreachable`.
// Gộp hai thứ đó lại sẽ khiến người dùng rollback một cấu hình hoàn toàn đúng
// chỉ vì thiết bị thiếu một binary chẩn đoán — và họ mất luôn cửa sổ 120 giây.

type NetworkCheckTarget struct {
	Kind string `json:"kind"`
	Host string `json:"host"`
	// State: `ok` | `unreachable` | `unknown`.
	State string `json:"state"`
	// Detail nói vì sao, nhất là với `unknown`.
	Detail string `json:"detail,omitempty"`
	RTTMs  *int   `json:"rttMs,omitempty"`
}

type NetworkCheckResponse struct {
	SchemaVersion int                  `json:"schemaVersion"`
	CheckedAt     string               `json:"checkedAt"`
	Targets       []NetworkCheckTarget `json:"targets"`
	// Summary: `ok` khi mọi đích kiểm được đều thông; `degraded` khi có đích
	// không thông; `unknown` khi KHÔNG kiểm được đích nào.
	Summary string `json:"summary"`
}

const networkCheckTimeout = 3 * time.Second

func (a *App) handleNetworkConnectivityCheck(w http.ResponseWriter, r *http.Request) {
	status, err := a.netcfg.Request(r.Context(), requestID(), "status", "", nil)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "không đọc được trạng thái mạng: "+err.Error())
		return
	}

	targets := []NetworkCheckTarget{}
	active := status.Active
	if active != nil && strings.TrimSpace(active.Gateway) != "" {
		targets = append(targets, pingTarget(r.Context(), "gateway", active.Gateway))
	}
	if active != nil {
		for _, server := range active.DNSServers {
			if strings.TrimSpace(server) == "" {
				continue
			}
			targets = append(targets, pingTarget(r.Context(), "dns", server))
			break // một máy chủ DNS là đủ để trả lời câu hỏi "DNS có tới được không"
		}
	}
	// Phân giải tên: khác với ping DNS server — nó kiểm CẢ đường đi lẫn dịch vụ.
	targets = append(targets, resolveTarget(r.Context()))

	writeJSON(w, http.StatusOK, NetworkCheckResponse{
		SchemaVersion: 1,
		CheckedAt:     time.Now().UTC().Format(time.RFC3339),
		Targets:       targets,
		Summary:       summarizeNetworkCheck(targets),
	})
}

// summarizeNetworkCheck gộp kết quả, giữ nguyên sự phân biệt ba trạng thái.
func summarizeNetworkCheck(targets []NetworkCheckTarget) string {
	known := 0
	failed := 0
	for _, target := range targets {
		switch target.State {
		case "ok":
			known++
		case "unreachable":
			known++
			failed++
		}
	}
	if known == 0 {
		// Không kiểm được gì thì nói là KHÔNG BIẾT. Trả `degraded` ở đây là đẩy
		// người dùng tới một quyết định rollback không có cơ sở.
		return "unknown"
	}
	if failed > 0 {
		return "degraded"
	}
	return "ok"
}

func pingTarget(ctx context.Context, kind, host string) NetworkCheckTarget {
	target := NetworkCheckTarget{Kind: kind, Host: host}

	binary, err := exec.LookPath("ping")
	if err != nil {
		target.State = "unknown"
		target.Detail = "thiết bị không có công cụ ping; chưa kiểm được"
		return target
	}

	runCtx, cancel := context.WithTimeout(ctx, networkCheckTimeout)
	defer cancel()
	started := time.Now()
	// `-c 1 -W 2`: một gói, chờ tối đa 2 giây. Cú pháp này đúng với cả iputils
	// lẫn busybox ping của Buildroot trên bo.
	if err := exec.CommandContext(runCtx, binary, "-c", "1", "-W", "2", host).Run(); err != nil {
		if runCtx.Err() != nil {
			target.State = "unknown"
			target.Detail = "hết giờ chờ khi kiểm; chưa kết luận được"
			return target
		}
		target.State = "unreachable"
		target.Detail = "không nhận được trả lời"
		return target
	}
	rtt := int(time.Since(started).Milliseconds())
	target.State = "ok"
	target.RTTMs = &rtt
	return target
}

// resolveTarget kiểm phân giải tên — thứ mà ping tới IP của máy chủ DNS không
// trả lời được: đường có thể thông trong khi dịch vụ DNS đã chết.
func resolveTarget(ctx context.Context) NetworkCheckTarget {
	target := NetworkCheckTarget{Kind: "dns_resolve", Host: "pool.ntp.org"}
	runCtx, cancel := context.WithTimeout(ctx, networkCheckTimeout)
	defer cancel()

	resolver := &net.Resolver{}
	addresses, err := resolver.LookupHost(runCtx, target.Host)
	if err != nil {
		if runCtx.Err() != nil {
			target.State = "unknown"
			target.Detail = "hết giờ chờ khi phân giải tên"
			return target
		}
		target.State = "unreachable"
		target.Detail = "không phân giải được tên miền"
		return target
	}
	if len(addresses) == 0 {
		target.State = "unreachable"
		target.Detail = "phân giải trả về rỗng"
		return target
	}
	target.State = "ok"
	return target
}
