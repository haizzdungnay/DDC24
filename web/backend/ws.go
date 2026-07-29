package main

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
)

type monitorPointReader interface {
	ReadPoints(context.Context) ([]PointDTO, error)
}

type monitorPointForcer interface {
	ForcePoint(context.Context, string, any, bool) (PointDTO, error)
}

func (a *App) requireWSAuth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			token = bearerToken(r)
		}
		principal, err := a.auth.Validate(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalContextKey, principal)))
	})
}

func (a *App) handleMonitorWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: wsOriginPatterns(a.cfg.CORSOrigin)})
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
	expirations := map[string]time.Time{}

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
			resetFingerprint, err := a.handleMonitorWSMessage(ctx, conn, raw, canForce, forcer, &subscription, &subscribed, expirations)
			if err != nil {
				cancel()
				return
			}
			if resetFingerprint {
				lastFingerprint = ""
				lastReadErr = ""
			}
		case now := <-ticker.C:
			if err := a.flushExpiredForces(ctx, conn, forcer, canForce, expirations, now); err != nil {
				cancel()
				return
			}
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

func wsOriginPatterns(allowedOrigin string) []string {
	patterns := []string{"localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*", "[::1]", "[::1]:*"}
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

func (a *App) handleMonitorWSMessage(ctx context.Context, conn *websocket.Conn, raw json.RawMessage, canForce bool, forcer monitorPointForcer, subscription *SubscribePoints, subscribed *bool, expirations map[string]time.Time) (bool, error) {
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
		return a.handleMonitorForce(ctx, conn, raw, forcer, canForce, expirations)
	default:
		return false, writeWSError(ctx, conn, http.StatusBadRequest, "unknown op")
	}
}

func (a *App) handleMonitorForce(ctx context.Context, conn *websocket.Conn, raw json.RawMessage, forcer monitorPointForcer, canForce bool, expirations map[string]time.Time) (bool, error) {
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
	if req.ExpireS != nil && *req.ExpireS < 0 {
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
		delete(expirations, item.ID)
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
	point, err := forcer.ForcePoint(ctx, req.ID, value, false)
	if err != nil {
		return false, writeWSError(ctx, conn, http.StatusBadGateway, err.Error())
	}
	if point.Fault && strings.Contains(point.Source, "core_unavailable") {
		return false, writeWSError(ctx, conn, http.StatusServiceUnavailable, "core unavailable")
	}
	if req.ExpireS != nil && *req.ExpireS > 0 {
		expirations[req.ID] = time.Now().Add(time.Duration(*req.ExpireS) * time.Second)
	} else {
		delete(expirations, req.ID)
	}
	return true, writeWSJSON(ctx, conn, WSUpdateMessage{
		Op:     WSOpUpdate,
		TS:     time.Now().Format(time.RFC3339Nano),
		Points: []PointDTO{point},
	})
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

func (a *App) flushExpiredForces(ctx context.Context, conn *websocket.Conn, forcer monitorPointForcer, canForce bool, expirations map[string]time.Time, now time.Time) error {
	if len(expirations) == 0 {
		return nil
	}
	for id, expiresAt := range expirations {
		if now.Before(expiresAt) {
			continue
		}
		delete(expirations, id)
		if !canForce {
			return writeWSError(ctx, conn, http.StatusServiceUnavailable, "core force unavailable")
		}
		if _, err := forcer.ForcePoint(ctx, id, nil, true); err != nil {
			return writeWSError(ctx, conn, http.StatusBadGateway, err.Error())
		}
		if err := writeWSJSON(ctx, conn, WSForceExpiredMessage{Op: WSOpForceExpired, ID: id}); err != nil {
			return err
		}
	}
	return nil
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
