#!/usr/bin/env python3
"""Core giả cho đo T63-108 trên HOST: chỉ trả lời `alarm_list` (một cảnh báo
đang hoạt động, chưa xác nhận) để overview KHÔNG gắn cờ degraded `alarms` —
giống bo có Core chạy. Mọi op khác trả `rejected`."""
import json, os, socket, sys, threading, itertools

path = sys.argv[1]
try:
    os.unlink(path)
except FileNotFoundError:
    pass
srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
srv.bind(path)
srv.listen(64)
counts = {}
lock = threading.Lock()

ALARM = {"id": "ALM-1", "alarmSettingId": "ALM-1", "time": "2026-09-28T10:00:00Z", "status": "unack",
         "sourcePointId": "UI-01", "value": 31.8, "triggerLevel": "H", "threshold": 30.0, "priority": "high",
         "label": "Nhiệt độ gió cấp cao", "alarmType": 1, "occurrence": 1, "active": True}

# Hàng chốt tay đã xác nhận, hết điều kiện (chờ return) và hàng shelved hết điều kiện:
# hai hàng phân biệt định nghĩa chuông với `total`.
LATCHED = dict(ALARM, id="ALM-2", alarmSettingId="ALM-2", status="acked", active=False, label="Chốt tay đã xác nhận")
SHELVED = dict(ALARM, id="ALM-3", alarmSettingId="ALM-3", status="shelved", active=False, label="Đã gác")

def handle(conn):
    with conn:
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = conn.recv(65536)
            if not chunk:
                return
            buf += chunk
        try:
            req = json.loads(buf)
        except Exception:
            return
        op = req.get("op")
        with lock:
            counts[op] = counts.get(op, 0) + 1
        if op == "alarm_list":
            resp = {"id": req.get("id"), "result": "ok", "alarms": [ALARM, LATCHED, SHELVED]}
        else:
            resp = {"id": req.get("id"), "result": "rejected", "error": "fake core: op not supported"}
        conn.sendall((json.dumps(resp) + "\n").encode())

def report():
    import time
    while True:
        time.sleep(30)
        with lock:
            print(json.dumps(counts), flush=True)

threading.Thread(target=report, daemon=True).start()
while True:
    c, _ = srv.accept()
    threading.Thread(target=handle, args=(c,), daemon=True).start()
