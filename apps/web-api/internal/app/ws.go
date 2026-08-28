package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

const (
	monitorUpdateInterval = 200 * time.Millisecond
	monitorReadLimit      = 1 << 20
	monitorWriteTimeout   = 5 * time.Second

	// F-10: token đi qua Sec-WebSocket-Protocol thay vì query string.
	// Server chỉ offer wsSubprotocol nên response echo lại đúng phần tử đó —
	// token KHÔNG bao giờ xuất hiện trong header trả về.
	wsSubprotocol            = "mkddc.v1"
	wsTokenSubprotocolPrefix = "mkddc.token."
)

// wsTokenFromSubprotocols lấy JWT do client gửi kèm trong Sec-WebSocket-Protocol.
// Trả "" nếu client không gửi (client cũ, hoặc dùng Authorization header).
func wsTokenFromSubprotocols(r *http.Request) string {
	for _, header := range r.Header.Values("Sec-WebSocket-Protocol") {
		for _, item := range strings.Split(header, ",") {
			item = strings.TrimSpace(item)
			if rest, ok := strings.CutPrefix(item, wsTokenSubprotocolPrefix); ok && rest != "" {
				return rest
			}
		}
	}
	return ""
}

type monitorPointReader interface {
	ReadPoints(context.Context) ([]PointDTO, error)
}

type monitorPointForcer interface {
	ForcePoint(context.Context, string, any, bool) (PointDTO, error)
}

// monitorPointTTLForcer là đường ghi có TTL do Core cưỡng chế. Nếu core client
// không hiện thực nó, WS từ chối lệnh có `expire_s` thay vì tự dựng hẹn giờ —
// xem chú thích của `handleMonitorForce`.
type monitorPointTTLForcer interface {
	ForcePointTTL(ctx context.Context, id string, value any, release bool, ttlS uint32, user string) (PointDTO, error)
}

func (a *App) requireWSAuth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// F-10: thứ tự ưu tiên — subprotocol (không bao giờ vào URL), rồi
		// Authorization header, rồi query string.
		//
		// Query string được giữ làm đường LỖI THỜI để một SPA còn nằm trong cache
		// browser sau khi nâng cấp thiết bị không bị mất kết nối; nó sinh log WARN
		// để lộ ra client nào còn dùng. Bản thân việc FE ngừng dùng nó đã đóng
		// phần lộ thông tin của finding (lịch sử browser + access log của proxy).
		token := wsTokenFromSubprotocols(r)
		if token == "" {
			token = bearerToken(r)
		}
		if token == "" {
			if fromQuery := r.URL.Query().Get("token"); fromQuery != "" {
				token = fromQuery
				if a.logger != nil {
					a.logger.Printf("WARN ws_token_in_query remote=%s — đường lỗi thời, client nên gửi qua Sec-WebSocket-Protocol", r.RemoteAddr)
				}
			}
		}
		principal, err := a.auth.Validate(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r.WithContext(contextWithPrincipal(r.Context(), principal)))
	})
}

func (a *App) handleMonitorWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: wsOriginPatterns(a.cfg.CORSOrigin, a.cfg.CORSAllowLoopback),
		// Chỉ offer đúng subprotocol cố định: client gửi
		// ["mkddc.v1", "mkddc.token.<jwt>"] và server chọn "mkddc.v1", nên phần tử
		// mang token không bị echo lại vào response header (F-10).
		Subprotocols: []string{wsSubprotocol},
	})
	if err != nil {
		if a.logger != nil {
			a.logger.Printf("WARN ws_accept err=%v remote=%s", err, r.RemoteAddr)
		}
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	conn.SetReadLimit(monitorReadLimit)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	rawMessages := make(chan json.RawMessage, 8)
	readErrs := make(chan error, 1)
	go readMonitorWS(ctx, conn, rawMessages, readErrs)

	forcer, canForce := a.core.(monitorPointForcer)
	ticker := time.NewTicker(monitorUpdateInterval)
	defer ticker.Stop()

	var subscription SubscribePoints
	subscribed := false
	lastFingerprint := ""
	lastReadErr := ""

	for {
		select {
		case <-ctx.Done():
			return
		case err := <-readErrs:
			if err != nil && a.logger != nil && !isNormalWSClose(err) {
				a.logger.Printf("WARN ws_read err=%v remote=%s", err, r.RemoteAddr)
			}
			cancel()
			return
		case raw := <-rawMessages:
			if len(raw) == 0 {
				continue
			}
			if !a.wsSessionStillValid(ctx, conn, r) {
				cancel()
				return
			}
			resetFingerprint, err := a.handleMonitorWSMessage(ctx, conn, raw, canForce, forcer, &subscription, &subscribed)
			if err != nil {
				cancel()
				return
			}
			if resetFingerprint {
				lastFingerprint = ""
				lastReadErr = ""
			}
		case <-ticker.C:
			// Kiểm lại phiên mỗi nhịp, không chỉ lúc có lệnh: một socket đang
			// mở im lặng vẫn phải rụng khi người dùng logout hoặc token hết hạn.
			if !a.wsSessionStillValid(ctx, conn, r) {
				cancel()
				return
			}
			// Không còn `flushExpiredForces` ở đây: TTL do Core sở hữu
			// (PA3-107). Vòng lặp này chỉ đọc và phát trạng thái.
			if !subscribed {
				continue
			}
			changed, fingerprint, err := sendMonitorSnapshot(ctx, conn, a, subscription, lastFingerprint)
			if err != nil {
				errMsg := err.Error()
				if errMsg != lastReadErr {
					if writeErr := writeWSError(ctx, conn, http.StatusServiceUnavailable, errMsg); writeErr != nil {
						cancel()
						return
					}
					lastReadErr = errMsg
				}
				continue
			}
			lastReadErr = ""
			if changed {
				lastFingerprint = fingerprint
			}
		}
	}
}

// wsSessionStillValid kiểm lại phiên của socket đang mở.
//
// `requireWSAuth` chỉ xác thực ĐÚNG MỘT LẦN lúc bắt tay rồi nhét principal vào
// context; socket sau đó sống bao lâu tuỳ ý. Hệ quả: operator bấm Logout thì
// `AuthService.Revoke` xoá phiên và mọi request REST bị chặn, nhưng socket đang
// mở không hề bị đóng — nó vẫn giữ quyền `op:"force"` để ghi xuống AO/DO/VP.
// Cơ chế thu hồi phiên bị vô hiệu đúng trên kênh DUY NHẤT thật sự ghi xuống
// thiết bị, và cùng lỗ hổng đó cho phép giữ socket sống quá hạn TTL (REV-BE-02).
//
// Trả `false` nghĩa là phiên đã hết hiệu lực: caller phải đóng socket, không
// được chỉ bỏ qua một lệnh.
func (a *App) wsSessionStillValid(ctx context.Context, conn *websocket.Conn, r *http.Request) bool {
	principal := principalFromContext(ctx)
	if principal == nil {
		return false
	}
	if _, err := a.auth.Validate(principal.Token); err != nil {
		if a.logger != nil {
			a.logger.Printf("INFO ws_session_revoked user=%s remote=%s — đóng socket",
				sanitizeAudit(principal.Username, 64), r.RemoteAddr)
		}
		_ = writeWSError(ctx, conn, http.StatusUnauthorized, "phiên đã hết hiệu lực")
		conn.Close(websocket.StatusPolicyViolation, "session revoked")
		return false
	}
	return true
}

// wsOriginPatterns dựng danh sách Origin cho phép của WebSocket.
//
// F-11: trước đây hàm này LUÔN nối 6 pattern localhost, kể cả khi CORS_ORIGIN đã
// được cấu hình tường minh cho triển khai production. Một trang tại
// http://localhost:<bất kỳ port> trong browser của người vận hành vẫn qua được
// check Origin của WS — phá vỡ đúng ý định "chỉ cho phép origin đã khai báo" mà
// isAllowedOrigin (http.go) đang thực thi cho đường HTTP.
//
// REV-PLT-01: nhánh loopback nay phải BẬT TƯỜNG MINH bằng `CORS_ALLOW_LOOPBACK`.
// `CORS_ORIGIN` rỗng từng nghĩa là "chế độ dev, cho phép mọi cổng loopback", mà
// không chỗ nào trong `mkddc-web-pi.service` hay `/etc/mkddc-web.env` đặt biến
// đó — nên nhánh allowlist đóng là mã chết trên bo, còn bo production thì chạy
// bằng đúng allowlist của chế độ dev. Giá trị rỗng nay = chỉ same-origin (N5).
func wsOriginPatterns(allowedOrigin string, allowLoopback bool) []string {
	patterns := make([]string, 0, 6)
	for _, item := range strings.Split(allowedOrigin, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		parsed, err := url.Parse(item)
		if err != nil || parsed.Host == "" {
			patterns = append(patterns, item)
			continue
		}
		patterns = append(patterns, parsed.Host)
	}
	if len(patterns) == 0 && allowLoopback {
		return []string{"localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*", "[::1]", "[::1]:*"}
	}
	// Danh sách rỗng KHÔNG mở cửa: `websocket.Accept` vẫn luôn nhận kết nối
	// same-origin (Origin.Host == r.Host), tức giao diện do chính mkddc-web phục
	// vụ chạy bình thường, còn mọi origin khác bị từ chối.
	return patterns
}

func readMonitorWS(ctx context.Context, conn *websocket.Conn, rawMessages chan<- json.RawMessage, readErrs chan<- error) {
	for {
		var raw json.RawMessage
		if err := wsjson.Read(ctx, conn, &raw); err != nil {
			select {
			case readErrs <- err:
			case <-ctx.Done():
			}
			return
		}
		select {
		case rawMessages <- raw:
		case <-ctx.Done():
			return
		}
	}
}

func (a *App) handleMonitorWSMessage(ctx context.Context, conn *websocket.Conn, raw json.RawMessage, canForce bool, forcer monitorPointForcer, subscription *SubscribePoints, subscribed *bool) (bool, error) {
	var base struct {
		Op WSOp `json:"op"`
	}
	if err := json.Unmarshal(raw, &base); err != nil {
		return false, writeWSError(ctx, conn, http.StatusBadRequest, "invalid json")
	}
	switch base.Op {
	case WSOpSubscribe:
		var req WSSubscribeRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			return false, writeWSError(ctx, conn, http.StatusBadRequest, "invalid subscribe")
		}
		points, err := normalizeSubscribePoints(req.Points)
		if err != nil {
			return false, writeWSError(ctx, conn, http.StatusBadRequest, err.Error())
		}
		*subscription = points
		*subscribed = true
		return true, nil
	case WSOpForce:
		return a.handleMonitorForce(ctx, conn, raw, forcer, canForce)
	default:
		return false, writeWSError(ctx, conn, http.StatusBadRequest, "unknown op")
	}
}

// handleMonitorForce chuyển lệnh ép tay qua WebSocket xuống Core.
//
// # PA3-107 — VÌ SAO KHÔNG CÒN HẸN GIỜ Ở ĐÂY
//
// Bản trước giữ `expirations map[string]time.Time` gắn với MỘT kết nối
// WebSocket rồi tự gửi lệnh release khi tới hạn. Nghĩa là thời hạn an toàn của
// một output vật lý phụ thuộc vào việc cái socket đó còn sống: rớt Wi-Fi, đóng
// laptop, hay chỉ cần `mkddc-web` restart là hẹn giờ biến mất và output ở lại
// trạng thái ép tay không có gì nhả.
//
// Nay `expire_s` được chuyển nguyên vẹn thành `ttlS` xuống Core; `scan_loop`
// giữ `manual_ao_expiry_ns_`/`manual_do_expiry_ns_` và tự `release_*` khi hết
// hạn, kể cả khi không còn client nào kết nối.
func (a *App) handleMonitorForce(ctx context.Context, conn *websocket.Conn, raw json.RawMessage, forcer monitorPointForcer, canForce bool) (bool, error) {
	principal := principalFromContext(ctx)
	if principal == nil {
		return false, writeWSError(ctx, conn, http.StatusUnauthorized, "unauthorized")
	}
	if !RoleAllows(principal.Role, RoleOperator) {
		return false, writeWSError(ctx, conn, http.StatusForbidden, "forbidden")
	}
	var req WSForceRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return false, writeWSError(ctx, conn, http.StatusBadRequest, "invalid force")
	}
	req.ID = strings.TrimSpace(req.ID)
	if req.ID == "" {
		return false, writeWSError(ctx, conn, http.StatusBadRequest, "missing point id")
	}
	if len(req.Value) == 0 || string(req.Value) == "null" {
		return false, writeWSError(ctx, conn, http.StatusBadRequest, "missing force value")
	}
	if req.ExpireS != nil && (*req.ExpireS < 0 || *req.ExpireS > maxOverrideTTLS) {
		return false, writeWSError(ctx, conn, http.StatusBadRequest, "invalid expire_s")
	}

	var value any
	if err := json.Unmarshal(req.Value, &value); err != nil {
		return false, writeWSError(ctx, conn, http.StatusBadRequest, "invalid force value")
	}
	if item, ok := a.findVirtualPoint(req.ID); ok {
		if req.ExpireS != nil && *req.ExpireS > 0 {
			return false, writeWSError(ctx, conn, http.StatusBadRequest, "virtual point force expiry unsupported")
		}
		httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPut, "/ws/v1/events", nil)
		httpReq.RemoteAddr = "websocket"
		point, err := a.writeVirtualPointValue(httpReq, item.ID, value, false)
		if err != nil {
			return false, writeWSError(ctx, conn, http.StatusConflict, err.Error())
		}
		a.audit.PointForce(principal, item.ID, false, "accepted", "websocket")
		return true, writeWSJSON(ctx, conn, WSUpdateMessage{
			Op:     WSOpUpdate,
			TS:     time.Now().Format(time.RFC3339Nano),
			Points: []PointDTO{point},
		})
	}
	if prefix, _, ok := parsePointID(req.ID); ok && (virtualPointIDPrefix(prefix) || prefix == "BV" || prefix == "MSV") {
		return false, writeWSError(ctx, conn, http.StatusNotFound, "point not found")
	}
	if !canForce {
		return false, writeWSError(ctx, conn, http.StatusServiceUnavailable, "core force unavailable")
	}
	ttlS := uint32(0)
	if req.ExpireS != nil && *req.ExpireS > 0 {
		ttlS = uint32(*req.ExpireS)
	}
	point, err := a.forceViaWS(ctx, forcer, req.ID, value, ttlS, principal)
	if err != nil {
		if errors.Is(err, errPointTTLUnsupported) {
			return false, writeWSError(ctx, conn, http.StatusBadRequest, "core không cưỡng chế được expire_s; bỏ trống để ép không thời hạn")
		}
		return false, writeWSError(ctx, conn, http.StatusBadGateway, err.Error())
	}
	if point.Fault && strings.Contains(point.Source, "core_unavailable") {
		return false, writeWSError(ctx, conn, http.StatusServiceUnavailable, "core unavailable")
	}
	remaining := uint32(0)
	if point.OverrideExpiresInS != nil {
		remaining = *point.OverrideExpiresInS
	}
	a.audit.PointForce(principal, req.ID, false, "accepted", "websocket")
	if ttlS > 0 {
		reason := "core_ttl"
		if remaining == 0 {
			reason = "core_ttl_not_reported"
		}
		a.overrides.Note(req.ID, principal.Username, ttlS, remaining, point.Priority)
		a.audit.PointOverride(principal, req.ID, ttlS, remaining, "accepted", reason, "", "websocket")
	}
	return true, writeWSJSON(ctx, conn, WSUpdateMessage{
		Op:     WSOpUpdate,
		TS:     time.Now().Format(time.RFC3339Nano),
		Points: []PointDTO{point},
	})
}

var errPointTTLUnsupported = errors.New("core does not enforce override ttl")

func (a *App) forceViaWS(ctx context.Context, forcer monitorPointForcer, id string, value any, ttlS uint32, principal *Principal) (PointDTO, error) {
	if ttlForcer, ok := forcer.(monitorPointTTLForcer); ok {
		return ttlForcer.ForcePointTTL(ctx, id, value, false, ttlS, principalUsername(principal))
	}
	if ttlS > 0 {
		return PointDTO{}, errPointTTLUnsupported
	}
	return forcer.ForcePoint(ctx, id, value, false)
}

func normalizeSubscribePoints(points SubscribePoints) (SubscribePoints, error) {
	if points.All {
		return SubscribePoints{All: true}, nil
	}
	seen := map[string]struct{}{}
	ids := make([]string, 0, len(points.IDs))
	for _, id := range points.IDs {
		id = strings.TrimSpace(id)
		if id == "" {
			return SubscribePoints{}, errors.New("invalid point id")
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return SubscribePoints{}, errors.New("missing subscription points")
	}
	return SubscribePoints{IDs: ids}, nil
}

func sendMonitorSnapshot(ctx context.Context, conn *websocket.Conn, reader monitorPointReader, subscription SubscribePoints, lastFingerprint string) (bool, string, error) {
	points, err := reader.ReadPoints(ctx)
	if err != nil {
		return false, lastFingerprint, err
	}
	points = filterSubscribedPoints(points, subscription)
	fingerprint, err := fingerprintPoints(points)
	if err != nil {
		return false, lastFingerprint, err
	}
	if fingerprint == lastFingerprint {
		return false, lastFingerprint, nil
	}
	return true, fingerprint, writeWSJSON(ctx, conn, WSUpdateMessage{
		Op:     WSOpUpdate,
		TS:     time.Now().Format(time.RFC3339Nano),
		Points: points,
	})
}

func filterSubscribedPoints(points []PointDTO, subscription SubscribePoints) []PointDTO {
	if subscription.All {
		return points
	}
	wanted := make(map[string]struct{}, len(subscription.IDs))
	for _, id := range subscription.IDs {
		wanted[id] = struct{}{}
		if canonical := canonicalPointID(id); canonical != id {
			wanted[canonical] = struct{}{}
		}
	}
	filtered := make([]PointDTO, 0, len(subscription.IDs))
	for _, point := range points {
		if _, ok := wanted[point.ID]; ok {
			filtered = append(filtered, point)
			continue
		}
		if _, ok := wanted[canonicalPointID(point.ID)]; ok {
			filtered = append(filtered, point)
		}
	}
	return filtered
}

func fingerprintPoints(points []PointDTO) (string, error) {
	data, err := json.Marshal(points)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func writeWSError(ctx context.Context, conn *websocket.Conn, code int, msg string) error {
	return writeWSJSON(ctx, conn, WSErrorMessage{Op: WSOpError, Code: code, Msg: msg})
}

func writeWSJSON(ctx context.Context, conn *websocket.Conn, value any) error {
	writeCtx, cancel := context.WithTimeout(ctx, monitorWriteTimeout)
	defer cancel()
	return wsjson.Write(writeCtx, conn, value)
}

func isNormalWSClose(err error) bool {
	status := websocket.CloseStatus(err)
	return status == websocket.StatusNormalClosure || status == websocket.StatusGoingAway
}
