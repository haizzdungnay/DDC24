package app

import (
	"context"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func (a *App) handleSimulationWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: wsOriginPatterns(a.cfg.CORSOrigin, a.cfg.CORSAllowLoopback),
		Subprotocols:   []string{wsSubprotocol},
	})
	if err != nil {
		if a.logger != nil {
			a.logger.Printf("WARN ws_sim_accept err=%v remote=%s", err, r.RemoteAddr)
		}
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	if a.programmingSimulation == nil {
		_ = wsjson.Write(r.Context(), conn, map[string]any{
			"op":    "error",
			"error": "simulation service not configured",
		})
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	requestedSessionID := r.URL.Query().Get("sessionId")
	if requestedSessionID == "" {
		requestedSessionID = "active"
	}

	go func() {
		for {
			var msg map[string]any
			err := wsjson.Read(ctx, conn, &msg)
			if err != nil {
				cancel()
				return
			}
			if op, _ := msg["op"].(string); op == "subscribe" {
				if sid, ok := msg["sessionId"].(string); ok && sid != "" {
					requestedSessionID = sid
				}
			}
		}
	}()

	var lastSeq int64 = -1
	var lastTime int64 = -1
	tickCount := 0

	ticker := time.NewTicker(40 * time.Millisecond) // 25 FPS
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tickCount++
			sessID := requestedSessionID

			frame, pErr := a.programmingSimulation.Observations(ctx, sessID)
			if pErr != nil || len(frame.Observations) == 0 {
				if tickCount%25 == 0 {
					if sess, sErr := a.programmingSimulation.GetSession(ctx, sessID); sErr == nil {
						_ = wsjson.Write(ctx, conn, map[string]any{
							"op":      "session",
							"session": sess,
						})
					}
				}
				continue
			}

			if frame.SnapshotSequence != lastSeq || frame.VirtualTimeMS != lastTime {
				lastSeq = frame.SnapshotSequence
				lastTime = frame.VirtualTimeMS

				payload := map[string]any{
					"op":               "frame",
					"sessionId":        sessID,
					"virtualTimeMs":    frame.VirtualTimeMS,
					"snapshotSequence": frame.SnapshotSequence,
					"resetEpoch":       frame.ResetEpoch,
					"observations":     frame.Observations,
				}

				if tickCount%25 == 0 {
					if sess, sErr := a.programmingSimulation.GetSession(ctx, sessID); sErr == nil {
						payload["session"] = sess
					}
				}

				writeCtx, writeCancel := context.WithTimeout(ctx, 2*time.Second)
				err := wsjson.Write(writeCtx, conn, payload)
				writeCancel()
				if err != nil {
					return
				}
			}
		}
	}
}
