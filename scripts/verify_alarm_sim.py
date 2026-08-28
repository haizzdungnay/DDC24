#!/usr/bin/env python3
"""Kiểm hành vi `mkddc-alarm-sim` — `T57-2.13`/`T57-3.13`, `ADR-048`.

VÌ SAO KIỂM Ở MỨC BINARY CHỨ KHÔNG PHẢI UNIT TEST

Giá trị của engine này nằm ở chỗ nó là **đúng cái binary** mà backend gọi. Một
unit test gọi thẳng `AlarmRuntime` sẽ bỏ lọt đúng lớp lỗi đáng sợ nhất: hợp đồng
stdin/stdout lệch khỏi thứ Go gửi và đọc — và khi đó mô phỏng chết ngoài hiện
trường trong khi mọi test đều xanh.

Mỗi trường hợp dưới đây khoá một ngữ nghĩa mà nếu bộ mô phỏng nói khác
controller thì người dùng sẽ đặt sai ngưỡng an toàn.
"""
import argparse
import json
import subprocess
import sys


def run(binary, payload):
    proc = subprocess.run([binary, "--stdin-json"], input=json.dumps(payload),
                          capture_output=True, text=True)
    if proc.returncode != 0:
        return proc.returncode, None, proc.stderr
    return 0, json.loads(proc.stdout), proc.stderr


def setting(**overrides):
    base = {
        "id": "ALM-001", "label": "Nhiệt độ gió hồi", "enabled": True, "alarmType": 1,
        "sources": [{"kind": "UI", "channel": 1, "pointId": "UI-01"}],
        "priority": "high", "clearMode": "auto", "delayS": 0, "publishBacnet": False,
        "params": {"hh": 90, "h": 70, "l": 5, "ll": 0, "hysteresis": 2,
                   "severityRules": [{"severity": "critical", "op": ">=", "value": 78}]},
    }
    params = overrides.pop("params", None)
    base.update(overrides)
    if params:
        base["params"].update(params)
    return base


def samples(values, step_s=60, start_min=0):
    out = []
    for i, value in enumerate(values):
        total = start_min * 60 + i * step_s
        out.append({"t": "2026-08-19T%02d:%02d:%02dZ" % (10 + total // 3600, (total // 60) % 60, total % 60),
                    "value": value})
    return out


def check(name, condition, detail=""):
    if condition:
        print("  ok   %s" % name)
        return True
    print("  FAIL %s %s" % (name, detail))
    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    args = parser.parse_args()
    ok = True

    # 1. Vượt ngưỡng H rồi trở lại — đúng một lần lên, một lần xuống.
    code, events, err = run(args.binary, {"setting": setting(), "samples": samples([20, 75, 75, 20])})
    ok &= check("chạy được", code == 0, err)
    kinds = [e["event"] for e in (events or [])]
    ok &= check("một lần raised + một lần cleared", kinds == ["raised", "cleared"], str(kinds))
    if events:
        ok &= check("nói rõ ngưỡng nào bị vượt", "H = 70" in events[0]["reason"], events[0]["reason"])

    # 2. Vùng trễ (hysteresis) — 69 vẫn nằm trong vùng giữ, KHÔNG được clear.
    #    Đây chính là lý do hysteresis tồn tại: một giá trị dao động quanh ngưỡng
    #    không được sinh ra một tràng cảnh báo.
    code, events, err = run(args.binary, {"setting": setting(), "samples": samples([20, 75, 69, 75, 20])})
    kinds = [e["event"] for e in (events or [])]
    ok &= check("hysteresis giữ cảnh báo ở 69 (H=70, hys=2)", kinds == ["raised", "cleared"], str(kinds))

    # 3. Trễ kích hoạt — vượt ngưỡng 60 s với delayS=120 thì KHÔNG được báo.
    code, events, err = run(args.binary, {"setting": setting(delayS=120), "samples": samples([20, 75, 20, 20])})
    ok &= check("trễ kích hoạt chưa đủ thì không báo", events == [], str(events))

    code, events, err = run(args.binary, {"setting": setting(delayS=120),
                                          "samples": samples([20, 75, 75, 75, 20])})
    kinds = [e["event"] for e in (events or [])]
    ok &= check("trễ kích hoạt đủ thì báo", kinds[:1] == ["raised"], str(kinds))

    # 4. severityRules chỉ áp dụng khi priority = flexible — đúng ngữ nghĩa Core.
    code, events, err = run(args.binary, {"setting": setting(priority="flexible"),
                                          "samples": samples([20, 80, 20])})
    ok &= check("priority flexible lấy mức theo severityRules",
                bool(events) and events[0]["severity"] == "critical", str(events))
    code, events, err = run(args.binary, {"setting": setting(priority="high"),
                                          "samples": samples([20, 80, 20])})
    ok &= check("priority cố định KHÔNG bị severityRules ghi đè",
                bool(events) and events[0]["severity"] == "high", str(events))

    # 5. Ngưỡng thấp.
    code, events, err = run(args.binary, {"setting": setting(), "samples": samples([20, 2, 20])})
    ok &= check("xuống dưới L thì báo", bool(events) and "L = 5" in events[0]["reason"], str(events))

    # 6. Luật đang tắt vẫn mô phỏng được — người dùng thử ngưỡng TRƯỚC khi bật.
    code, events, err = run(args.binary, {"setting": setting(enabled=False), "samples": samples([20, 75, 20])})
    ok &= check("luật đang tắt vẫn thử được", bool(events), str(events))

    # 7. Luật sai phải bị TỪ CHỐI, không được im lặng trả rỗng: mô phỏng phải từ
    #    chối đúng những cấu hình mà thiết bị sẽ từ chối.
    code, events, err = run(args.binary, {"setting": setting(sources=[{"kind": "UI", "channel": 99, "pointId": "UI-99"}]),
                                          "samples": samples([20, 75])})
    ok &= check("kênh ngoài dải bị từ chối", code == 3, "code=%s" % code)

    code, events, err = run(args.binary, {"setting": setting(), "samples": [{"t": "hôm qua", "value": 1}]})
    ok &= check("mốc thời gian hỏng bị từ chối, không đoán bừa", code == 2, "code=%s" % code)

    # 8. Khoảng cách mẫu là DỮ LIỆU: cùng chuỗi giá trị, bước 1 s thì trễ 120 s
    #    không thể đạt.
    code, events, err = run(args.binary, {"setting": setting(delayS=120),
                                          "samples": samples([20, 75, 75, 75, 20], step_s=1)})
    ok &= check("bước lấy mẫu ngắn thì trễ kích hoạt không đạt", events == [], str(events))

    print("KẾT QUẢ: %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
