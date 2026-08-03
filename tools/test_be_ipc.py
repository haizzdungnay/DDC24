#!/usr/bin/env python3
"""
BE↔FW-SOM IPC simulation — test toàn bộ contract web_ipc (07 §8) qua core.sock.

Giả lập mkddc-web (BE) nói chuyện với mkddc-core: đủ lệnh write/release cho mọi
loại point, đủ case lỗi (unknown/readonly/bad_value/bad_request/malformed/flood),
multi-client, split-frame; đối chiếu hiệu ứng thật trong kx_io_shm qua shm_dump_io.

Dùng:  python3 tools/test_be_ipc.py [--sock /tmp/mkddc-core.sock] [--logdir logs/be-sim]
Exit:  0 = PASS hết; 1 = có FAIL (xem transcript.log + summary)
Log mặc định: <repo>/logs/be-sim/ (gitignored)
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHM_DUMP = os.environ.get(
    "MKDDC_SHM_DUMP", os.path.join(ROOT, "build/release/cpp/iobus/shm_dump_io")
)

results = []   # (name, ok, detail)
log_f = None


def log(line: str):
    print(line)
    log_f.write(line + "\n")
    log_f.flush()


def shm() -> dict:
    out = subprocess.run([SHM_DUMP, "--json"], capture_output=True, text=True).stdout
    return json.loads(out)


class BeClient:
    """1 connection như BE thật: gửi JSON line, nhận đúng 1 dòng/req."""

    def __init__(self, sock_path: str):
        self.s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.s.connect(sock_path)
        self.s.settimeout(8)
        self.buf = b""

    def send_raw(self, data: bytes):
        log(f">> {data.decode(errors='replace').rstrip()}")
        self.s.sendall(data)

    def recv_line(self) -> dict:
        while b"\n" not in self.buf:
            chunk = self.s.recv(4096)
            if not chunk:
                raise ConnectionError("server closed")
            self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        log(f"<< {line.decode()}")
        return json.loads(line)

    def cmd(self, **kw) -> dict:
        self.send_raw((json.dumps(kw) + "\n").encode())
        return self.recv_line()

    def close(self):
        self.s.close()


def check(name: str, cond: bool, detail: str = ""):
    results.append((name, cond, detail))
    log(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))


def wait_shm(predicate, timeout_s=4.0):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        d = shm()
        if predicate(d):
            return d
        time.sleep(0.05)
    return shm()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sock", default="/tmp/mkddc-core.sock")
    ap.add_argument("--logdir", default=os.path.join(ROOT, "logs", "be-sim"))
    args = ap.parse_args()

    os.makedirs(args.logdir, exist_ok=True)
    global log_f
    log_f = open(os.path.join(args.logdir, "transcript.log"), "w")
    log(f"=== BE↔FW-SOM IPC simulation @ {time.strftime('%Y-%m-%d %H:%M:%S')} ===")
    log(f"sock={args.sock}")

    c = BeClient(args.sock)
    uid = [100]

    def nid():
        uid[0] += 1
        return uid[0]

    # ---------- NHÓM 1: write DO hợp lệ (đủ 4 kênh) ----------
    log("\n--- N1: write DO1..DO4 = 1 ---")
    for ch in range(1, 5):
        r = c.cmd(id=nid(), op="write", point=f"DO{ch}", value=1, source="manual", user="be-sim")
        check(f"write DO{ch}=1 accepted", r.get("result") == "accepted" and r.get("applied_value") == 1)
    d = wait_shm(lambda d: d["do_cmd"] == [1, 1, 1, 1] and d["do_feedback"] == [1, 1, 1, 1])
    check("shm do_cmd=[1,1,1,1]", d["do_cmd"] == [1, 1, 1, 1], str(d["do_cmd"]))
    check("shm do_feedback=[1,1,1,1] (MCU phản hồi)", d["do_feedback"] == [1, 1, 1, 1], str(d["do_feedback"]))

    # ---------- NHÓM 2: write DO=0 + id echo ----------
    log("\n--- N2: write DO=0, id echo ---")
    r = c.cmd(id=4294967295, op="write", point="DO2", value=0, source="manual", user="be-sim")
    check("id echo uint32-max", r.get("id") == 4294967295, str(r.get("id")))
    check("write DO2=0 accepted", r.get("result") == "accepted")
    d = wait_shm(lambda d: d["do_cmd"][1] == 0 and d["do_feedback"][1] == 0)
    check("shm DO2 về 0", d["do_cmd"][1] == 0 and d["do_feedback"][1] == 0)

    # ---------- NHÓM 3: write AO hợp lệ ----------
    log("\n--- N3: write AO1..AO4 (eng V, mode 0-10V) ---")
    vals = [2.5, 7.25, 10.0, 0.0]
    for ch, v in zip(range(1, 5), vals):
        r = c.cmd(id=nid(), op="write", point=f"AO{ch}", value=v, source="manual", user="be-sim")
        check(f"write AO{ch}={v} accepted", r.get("result") == "accepted" and abs(r.get("applied_value", -1) - v) < 1e-6)
    d = wait_shm(lambda d: all(abs(a - b) < 1e-4 for a, b in zip(d["ao_setpoint"], vals)))
    check("shm ao_setpoint khớp", all(abs(a - b) < 1e-4 for a, b in zip(d["ao_setpoint"], vals)), str(d["ao_setpoint"]))

    # giá trị âm / quá dải: contract Rev A nhận eng value, iobus clamp khi convert raw
    r = c.cmd(id=nid(), op="write", point="AO1", value=-3.0, source="manual", user="be-sim")
    check("write AO1=-3.0 (accepted — clamp ở tầng convert raw)", r.get("result") == "accepted")
    r = c.cmd(id=nid(), op="write", point="AO1", value=2.5, source="manual", user="be-sim")
    check("write AO1 trả về 2.5", r.get("result") == "accepted")

    # ---------- NHÓM 4: virtual points AV/BV/MSV (biên dải) ----------
    log("\n--- N4: AV/BV/MSV write + release giữ value ---")
    for point, v in [("AV1", 42.5), ("AV32", -17.25), ("BV1", 1), ("BV16", 0), ("MSV1", 3), ("MSV8", 5)]:
        r = c.cmd(id=nid(), op="write", point=point, value=v, source="manual", user="be-sim")
        check(f"write {point}={v} accepted", r.get("result") == "accepted" and abs(r.get("applied_value") - v) < 1e-6)
    r = c.cmd(id=nid(), op="release", point="AV1", source="manual", user="be-sim")
    check("release AV1 accepted + applied_value=42.5 (giữ value)",
          r.get("result") == "accepted" and abs(r.get("applied_value", -1) - 42.5) < 1e-6, str(r))

    # ---------- NHÓM 5: release DO/AO → rơi về default mức 6 ----------
    log("\n--- N5: release DO/AO ---")
    for ch in (1, 3, 4):
        r = c.cmd(id=nid(), op="release", point=f"DO{ch}", source="manual", user="be-sim")
        check(f"release DO{ch} accepted", r.get("result") == "accepted")
    r = c.cmd(id=nid(), op="release", point="AO2", source="manual", user="be-sim")
    check("release AO2 accepted", r.get("result") == "accepted")
    # còn AO1/3/4 + 0 DO manual: T7 chưa kích (manual AO còn active)
    d = wait_shm(lambda d: d["do_cmd"] == [0, 0, 0, 0])
    check("shm DO release → default open [0,0,0,0]", d["do_cmd"] == [0, 0, 0, 0], str(d["do_cmd"]))

    # ---------- NHÓM 6: case lỗi — unknown/readonly/bad_value/bad_request ----------
    log("\n--- N6: error cases ---")
    for point in ("DO5", "AO9", "AV33", "BV17", "MSV9", "XX1", "DO", "do1", "DO0"):
        r = c.cmd(id=nid(), op="write", point=point, value=1, source="manual", user="be-sim")
        check(f"unknown_point {point}", r.get("result") == "rejected" and r.get("error") == "unknown_point", str(r))
    for point in ("AI1", "BI3", "DI2"):
        r = c.cmd(id=nid(), op="write", point=point, value=1, source="manual", user="be-sim")
        check(f"readonly_point {point}", r.get("result") == "rejected" and r.get("error") == "readonly_point", str(r))
    r = c.cmd(id=nid(), op="write", point="DO1", source="manual", user="be-sim")
    check("bad_value (write thiếu value)", r.get("error") == "bad_value", str(r))
    r = c.cmd(id=nid(), op="write", point="DO1", value=1, source="bacnet", user="be-sim")
    check("bad_request (source=bacnet — Rev A chỉ manual)", r.get("error") == "bad_request", str(r))
    r = c.cmd(id=nid(), op="write", point="DO1", value=1, source="schedule", user="be-sim")
    check("bad_request (source=schedule)", r.get("error") == "bad_request", str(r))
    r = c.cmd(id=nid(), op="delete", point="DO1", value=1, source="manual", user="be-sim")
    check("bad_request (op=delete)", r.get("error") == "bad_request", str(r))
    r = c.cmd(id=nid(), point="DO1", value=1, source="manual", user="be-sim")
    check("bad_request (thiếu op)", r.get("error") == "bad_request", str(r))
    r = c.cmd(id=nid(), op="write", value=1, source="manual", user="be-sim")
    check("bad_request (thiếu point)", r.get("error") == "bad_request", str(r))
    r = c.cmd(id=nid(), op="write", point="DO1", value=1, user="be-sim")
    check("bad_request (thiếu source)", r.get("error") == "bad_request", str(r))

    # malformed JSON / thiếu id
    c.send_raw(b'{{{khong json\n')
    r = c.recv_line()
    check("malformed JSON → rejected bad_request", r.get("result") == "rejected", str(r))
    c.send_raw(b'{"op":"write","point":"DO1","value":1,"source":"manual","user":"x"}\n')
    r = c.recv_line()
    check("thiếu id → rejected (id=0 echo)", r.get("result") == "rejected" and r.get("id") == 0, str(r))

    # ---------- NHÓM 7: framing — 2 lệnh 1 packet, 1 lệnh xé 3 packet ----------
    log("\n--- N7: framing ---")
    a, b = nid(), nid()
    c.send_raw((json.dumps({"id": a, "op": "write", "point": "AV2", "value": 1, "source": "manual", "user": "x"}) + "\n" +
                json.dumps({"id": b, "op": "write", "point": "AV3", "value": 2, "source": "manual", "user": "x"}) + "\n").encode())
    r1, r2 = c.recv_line(), c.recv_line()
    check("2 lệnh trong 1 packet → 2 response đúng thứ tự",
          r1.get("id") == a and r2.get("id") == b, f"{r1.get('id')},{r2.get('id')}")
    split_id = nid()
    full = json.dumps({"id": split_id, "op": "write", "point": "AV4", "value": 9, "source": "manual", "user": "x"}) + "\n"
    for i in range(0, len(full), 7):    # xé 7 byte/lần
        c.s.sendall(full[i:i + 7].encode())
        time.sleep(0.02)
    log(f">> (xé {len(full)} byte thành {len(full)//7+1} packet)")
    r = c.recv_line()
    check("lệnh xé nhỏ nhiều packet vẫn parse đúng", r.get("id") == split_id and r.get("result") == "accepted", str(r))

    # ---------- NHÓM 8: multi-client đồng thời ----------
    log("\n--- N8: 2 client đồng thời ---")
    c2 = BeClient(args.sock)
    ra = c.cmd(id=nid(), op="write", point="AV5", value=11, source="manual", user="client1")
    rb = c2.cmd(id=nid(), op="write", point="AV6", value=22, source="manual", user="client2")
    check("client1 + client2 đều accepted, response về đúng connection",
          ra.get("result") == "accepted" and rb.get("result") == "accepted")
    c2.close()

    # ---------- NHÓM 9: flood >64 lệnh/scan → busy ----------
    log("\n--- N9: flood 80 lệnh 1 phát (queue cap 64/scan) ---")
    base = nid()
    uid[0] += 100
    blob = "".join(json.dumps({"id": base + i, "op": "write", "point": "AV7", "value": i,
                               "source": "manual", "user": "flood"}) + "\n" for i in range(80))
    c.send_raw(b"(80 lenh AV7...)\n" if False else blob.encode())
    accepted = busy = 0
    for _ in range(80):
        r = c.recv_line()
        if r.get("result") == "accepted":
            accepted += 1
        elif r.get("error") == "busy":
            busy += 1
    check("flood: 64 accepted + 16 busy", accepted == 64 and busy == 16, f"accepted={accepted} busy={busy}")

    # ---------- NHÓM 10: client biến mất giữa chừng không giết core ----------
    log("\n--- N10: client đóng đột ngột ---")
    c3 = BeClient(args.sock)
    c3.s.sendall(b'{"id":1,"op":"write","point":"DO1","va')   # nửa lệnh rồi đóng
    c3.s.close()
    log(">> (client3 gửi nửa lệnh rồi đóng socket)")
    time.sleep(1.2)
    r = c.cmd(id=nid(), op="write", point="AV8", value=1, source="manual", user="be-sim")
    check("core sống sau khi client chết giữa lệnh", r.get("result") == "accepted")

    # ---------- NHÓM 11: latency contract ≤2 scan ----------
    log("\n--- N11: latency response ---")
    t0 = time.monotonic()
    c.cmd(id=nid(), op="write", point="AV9", value=1, source="manual", user="be-sim")
    dt = time.monotonic() - t0
    check(f"response trong ≤2 chu kỳ scan (đo {dt*1000:.0f}ms)", dt <= 2.5, f"{dt:.2f}s")

    # ---------- NHÓM 12: shm sạch sau test outputs ----------
    log("\n--- N12: dọn outputs về release ---")
    for ch in range(1, 5):
        c.cmd(id=nid(), op="release", point=f"AO{ch}", source="manual", user="be-sim")
        c.cmd(id=nid(), op="release", point=f"DO{ch}", source="manual", user="be-sim")
    d = wait_shm(lambda d: d["do_cmd"] == [0, 0, 0, 0])
    check("outputs về default sau release toàn bộ", d["do_cmd"] == [0, 0, 0, 0])

    c.close()

    # ---------- tổng kết ----------
    n_pass = sum(1 for _, ok, _ in results if ok)
    n_fail = len(results) - n_pass
    log(f"\n=== KẾT QUẢ: {n_pass}/{len(results)} PASS, {n_fail} FAIL ===")
    if n_fail:
        for name, ok, detail in results:
            if not ok:
                log(f"  FAIL: {name} {detail}")
    summary = os.path.join(args.logdir, "summary.txt")
    with open(summary, "w") as f:
        f.write(f"{n_pass}/{len(results)} PASS\n")
        for name, ok, detail in results:
            f.write(f"{'PASS' if ok else 'FAIL'}\t{name}\t{detail}\n")
    log(f"log: {args.logdir}/transcript.log · {summary}")
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
