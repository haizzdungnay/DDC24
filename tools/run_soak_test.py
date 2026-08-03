#!/usr/bin/env python3
import os
import sys
import time
import socket
import json
import subprocess
import argparse
import signal
import multiprocessing

# Global process handles for cleanup
processes = {}

def cleanup():
    print("\n[cleanup] Terminating all test processes...")
    for name, proc in list(processes.items()):
        if proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
    # Clean files
    for f in ["/tmp/mkddc-soak-a", "/tmp/mkddc-soak-b", "/tmp/mkddc-soak-core.sock", "/tmp/mkddc-soak-safe.conf", "/tmp/mkddc-soak-iobus.conf"]:
        if os.path.exists(f):
            try:
                os.unlink(f)
            except Exception:
                pass

def signal_handler(sig, frame):
    cleanup()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def get_process_metrics(pid):
    """Returns VSZ (kB), RSS (kB), and process ticks from /proc"""
    try:
        vsz = 0
        rss = 0
        if os.path.exists(f"/proc/{pid}/status"):
            with open(f"/proc/{pid}/status", "r") as f:
                for line in f:
                    if line.startswith("VmSize:"):
                        vsz = int(line.split()[1])
                    elif line.startswith("VmRSS:"):
                        rss = int(line.split()[1])
        utime = 0
        stime = 0
        if os.path.exists(f"/proc/{pid}/stat"):
            with open(f"/proc/{pid}/stat", "r") as f:
                parts = f.read().split()
                if len(parts) > 14:
                    utime = int(parts[13])
                    stime = int(parts[14])
        return vsz, rss, utime + stime
    except Exception:
        return 0, 0, 0

def get_system_ticks():
    """Returns total system CPU ticks from /proc/stat"""
    try:
        with open("/proc/stat", "r") as f:
            line = f.readline()
            parts = line.split()[1:]
            return sum(int(x) for x in parts)
    except Exception:
        return 0

def send_socket_cmd(sock_path, cmd_json):
    """Sends JSON command to mkddc-core UNIX socket and returns response"""
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(2.0)
        s.connect(sock_path)
        s.sendall((json.dumps(cmd_json) + "\n").encode())
        resp = s.recv(1024).decode().strip()
        s.close()
        return json.loads(resp)
    except Exception as e:
        return {"error": str(e)}

def dump_shm(dump_bin):
    """Runs shm_dump_io and returns parsed JSON"""
    try:
        res = subprocess.run([dump_bin, "--json"], capture_output=True, text=True, timeout=2.0)
        if res.returncode in (0, 1):
            return json.loads(res.stdout)
        else:
            return {"error": f"Exit code {res.returncode}"}
    except Exception as e:
        return {"error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="MK-DDC-24 SOM Soak Test Runner")
    parser.add_argument("--duration", type=int, default=60, help="Test duration in seconds (default: 60)")
    parser.add_argument("--pwrite", type=int, default=5, help="DO/AO write period in seconds (default: 5)")
    parser.add_argument("--pfault", type=int, default=30, help="MCU fault injection period in seconds (default: 30)")
    parser.add_argument("--pmetrics", type=int, default=10, help="Metrics sampling period in seconds (default: 10)")
    parser.add_argument("--log-dir", type=str, default="logs/soak-test", help="Log directory")
    args = parser.parse_args()

    # Paths
    build_dir = os.environ.get("MKDDC_CPP_BUILD_ROOT", "build/release/cpp")
    socat_bin = "socat"
    fake_mcu_bin = os.path.join(build_dir, "iobus/fake_mcu")
    iobus_bin = os.path.join(build_dir, "iobus/mkddc-iobus")
    core_bin = os.path.join(build_dir, "core/mkddc-core")
    dump_bin = os.path.join(build_dir, "iobus/shm_dump_io")

    # Validate binaries
    for b in [fake_mcu_bin, iobus_bin, core_bin, dump_bin]:
        if not os.path.exists(b):
            print(f"Error: binary {b} not found. Run compile first.")
            sys.exit(1)

    os.makedirs(args.log_dir, exist_ok=True)
    csv_path = os.path.join(args.log_dir, "soak_metrics.csv")
    report_path = os.path.join(args.log_dir, "soak_report.md")

    # Config files
    safe_conf = "/tmp/mkddc-soak-safe.conf"
    iobus_conf = "/tmp/mkddc-soak-iobus.conf"
    sock_path = "/tmp/mkddc-soak-core.sock"
    pty_a = "/tmp/mkddc-soak-a"
    pty_b = "/tmp/mkddc-soak-b"

    # Clean old PTYs/SHM
    cleanup()
    time.sleep(0.5)

    with open(safe_conf, "w") as f:
        f.write('{"do":[]}')
    with open(iobus_conf, "w") as f:
        f.write(json.dumps({
            "iop": {
                "uart_device": pty_a,
                "poll_period_ms": 10,
                "reconnect_interval_ms": 1000
            },
            "log_level": "info"
        }))

    print(f"[setup] Starting services. Logs will be written to {args.log_dir}/")
    
    # 1. socat
    processes["socat"] = subprocess.Popen(
        [socat_bin, "PTY,raw,echo=0,link=" + pty_a, "PTY,raw,echo=0,link=" + pty_b],
        stdout=open(os.path.join(args.log_dir, "socat.log"), "w"),
        stderr=subprocess.STDOUT
    )
    # wait for links
    for _ in range(20):
        if os.path.exists(pty_a) and os.path.exists(pty_b):
            break
        time.sleep(0.1)
    else:
        print("Error: socat failed to create PTY links")
        cleanup()
        sys.exit(1)

    # 2. fake_mcu
    processes["fake_mcu"] = subprocess.Popen(
        [fake_mcu_bin, "--uart", pty_b],
        stdout=open(os.path.join(args.log_dir, "fake_mcu.log"), "w"),
        stderr=subprocess.STDOUT
    )
    time.sleep(0.2)

    # 3. mkddc-iobus
    processes["iobus"] = subprocess.Popen(
        [iobus_bin, "--config", iobus_conf],
        stdout=open(os.path.join(args.log_dir, "iobus.log"), "w"),
        stderr=subprocess.STDOUT
    )
    time.sleep(0.5)

    # 4. mkddc-core
    processes["core"] = subprocess.Popen(
        [core_bin, "--sock", sock_path, "--safe-state-conf", safe_conf, "--scan-ms", "200"],
        stdout=open(os.path.join(args.log_dir, "core.log"), "w"),
        stderr=subprocess.STDOUT
    )
    time.sleep(1.0)

    # Verify all running
    for name, proc in processes.items():
        if proc.poll() is not None:
            print(f"Error: {name} failed to start (exit code {proc.returncode})")
            cleanup()
            sys.exit(1)

    print("[soak] All processes running. Commencing soak test...")

    # Write CSV header
    with open(csv_path, "w") as f:
        f.write("timestamp,elapsed,cpu_socat,rss_socat,cpu_mcu,rss_mcu,cpu_iobus,rss_iobus,cpu_core,rss_core,shm_seq,shm_iop_status,shm_scan_count,shm_overruns\n")

    # Tracking metrics
    prev_ticks = {name: 0 for name in processes}
    prev_sys_ticks = get_system_ticks()
    num_cpus = multiprocessing.cpu_count()

    start_time = time.monotonic()
    last_write = 0
    last_fault = 0
    last_metrics = 0
    mcu_state = "alive"
    revive_time = 0
    do_value = 0

    metrics_records = []
    fault_inject_count = 0
    reconnect_success_count = 0
    command_send_count = 0
    command_ok_count = 0

    while time.monotonic() - start_time < args.duration:
        now = time.monotonic()
        elapsed = now - start_time

        # Check if processes crashed
        for name, proc in list(processes.items()):
            if name == "fake_mcu" and mcu_state == "dead":
                continue # expected to be dead
            if proc.poll() is not None:
                print(f"CRITICAL: Process {name} crashed with code {proc.returncode}!")
                cleanup()
                sys.exit(1)

        # 1. DO/AO Write Command
        if now - last_write >= args.pwrite:
            last_write = now
            do_value = 1 - do_value
            cmd = {"id": int(now), "op": "write", "point": "DO1", "value": do_value, "source": "manual", "user": "soak"}
            print(f"[soak] [{elapsed:.1f}s] Sending command DO1={do_value}...")
            if mcu_state == "alive":
                command_send_count += 1
            res = send_socket_cmd(sock_path, cmd)
            if "result" in res and res["result"] == "accepted":
                if mcu_state == "alive":
                    command_ok_count += 1
                print("       Accepted.")
            else:
                print(f"       Rejected/Error: {res}")

        # 2. MCU Fault Injection (Kill/Revive)
        if now - last_fault >= args.pfault:
            last_fault = now
            if mcu_state == "alive":
                print(f"[soak] [{elapsed:.1f}s] FAULT INJECTION: Killing fake_mcu...")
                fault_inject_count += 1
                processes["fake_mcu"].terminate()
                processes["fake_mcu"].wait()
                mcu_state = "dead"
                revive_time = now + (args.pfault / 2.0)
            elif mcu_state == "dead":
                # Wait for scheduler to trigger revive
                pass

        if mcu_state == "dead" and now >= revive_time:
            print(f"[soak] [{elapsed:.1f}s] FAULT RECOVERY: Reviving fake_mcu...")
            processes["fake_mcu"] = subprocess.Popen(
                [fake_mcu_bin, "--uart", pty_b],
                stdout=open(os.path.join(args.log_dir, "fake_mcu.log"), "a"),
                stderr=subprocess.STDOUT
            )
            mcu_state = "alive"
            # We'll check reconnect in metrics collection

        # 3. Collect Metrics
        if now - last_metrics >= args.pmetrics:
            last_metrics = now
            sys_ticks = get_system_ticks()
            delta_sys = sys_ticks - prev_sys_ticks
            prev_sys_ticks = sys_ticks

            cpu_pct = {}
            rss_val = {}
            for name, proc in processes.items():
                if name == "fake_mcu" and mcu_state == "dead":
                    cpu_pct[name] = 0.0
                    rss_val[name] = 0
                    continue
                vsz, rss, ticks = get_process_metrics(proc.pid)
                delta_proc = ticks - prev_ticks[name]
                prev_ticks[name] = ticks
                if delta_sys > 0:
                    cpu_pct[name] = (delta_proc / delta_sys) * 100.0 * num_cpus
                else:
                    cpu_pct[name] = 0.0
                rss_val[name] = rss

            # SHM state
            shm_data = dump_shm(dump_bin)
            if "error" in shm_data or shm_data is None:
                shm_seq = 0
                shm_status = "ERROR_READ"
                scan_count = 0
            else:
                shm_seq = shm_data.get("seq", 0)
                shm_status = shm_data.get("iop_status", "UNKNOWN")
                scan_count = shm_data.get("metrics", {}).get("rx", 0)
            
            # Check if recovered
            if mcu_state == "alive" and shm_status == "NORMAL" and last_fault > 0:
                # If we injected fault recently and now recovered
                if elapsed - (last_fault % args.pfault) < args.pfault / 2.0:
                    # just recovered
                    reconnect_success_count += 1

            # Core stats from logs
            overruns = 0
            core_log_path = os.path.join(args.log_dir, "core.log")
            if os.path.exists(core_log_path):
                try:
                    with open(core_log_path, "r") as fl:
                        for line in fl:
                            if "scan.overrun" in line:
                                overruns += 1
                except Exception:
                    pass

            # Log to console
            print(f"[metrics] [{elapsed:.1f}s] Status: {shm_status} | iobus CPU: {cpu_pct['iobus']:.1f}% RSS: {rss_val['iobus']}KB | core CPU: {cpu_pct['core']:.1f}% RSS: {rss_val['core']}KB")

            # Write to CSV
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
            with open(csv_path, "a") as f:
                f.write(f"{timestamp},{elapsed:.1f},{cpu_pct['socat']:.2f},{rss_val['socat']},{cpu_pct['fake_mcu']:.2f},{rss_val['fake_mcu']},{cpu_pct['iobus']:.2f},{rss_val['iobus']},{cpu_pct['core']:.2f},{rss_val['core']},{shm_seq},{shm_status},{scan_count},{overruns}\n")

            metrics_records.append({
                "elapsed": elapsed,
                "cpu_iobus": cpu_pct['iobus'],
                "rss_iobus": rss_val['iobus'],
                "cpu_core": cpu_pct['core'],
                "rss_core": rss_val['core'],
                "overruns": overruns,
                "iop_status": shm_status
            })

        time.sleep(0.5)

    cleanup()
    print("[soak] Soak test finished. Generating report...")

    # Report calculation
    if metrics_records:
        avg_cpu_iobus = sum(r["cpu_iobus"] for r in metrics_records) / len(metrics_records)
        max_cpu_iobus = max(r["cpu_iobus"] for r in metrics_records)
        avg_rss_iobus = sum(r["rss_iobus"] for r in metrics_records) / len(metrics_records)
        max_rss_iobus = max(r["rss_iobus"] for r in metrics_records)

        avg_cpu_core = sum(r["cpu_core"] for r in metrics_records) / len(metrics_records)
        max_cpu_core = max(r["cpu_core"] for r in metrics_records)
        avg_rss_core = sum(r["rss_core"] for r in metrics_records) / len(metrics_records)
        max_rss_core = max(r["rss_core"] for r in metrics_records)

        final_overruns = metrics_records[-1]["overruns"]
        
        # Check leaks: diff between last 20% and first 20% RSS
        n = len(metrics_records)
        if n >= 5:
            first_rss = sum(r["rss_iobus"] for r in metrics_records[:n//5]) / (n//5)
            last_rss = sum(r["rss_iobus"] for r in metrics_records[-(n//5):]) / (n//5)
            iobus_leak = last_rss - first_rss
            
            first_rss_core = sum(r["rss_core"] for r in metrics_records[:n//5]) / (n//5)
            last_rss_core = sum(r["rss_core"] for r in metrics_records[-(n//5):]) / (n//5)
            core_leak = last_rss_core - first_rss_core
        else:
            iobus_leak = 0
            core_leak = 0
    else:
        avg_cpu_iobus = max_cpu_iobus = avg_rss_iobus = max_rss_iobus = 0
        avg_cpu_core = max_cpu_core = avg_rss_core = max_rss_core = 0
        final_overruns = 0
        iobus_leak = core_leak = 0

    # Write markdown report
    with open(report_path, "w") as f:
        f.write(f"""# Soak Test Report - SOM No-MCU Simulation Stack
Date: {time.strftime("%Y-%m-%d %H:%M:%S")}
Duration: {args.duration}s
Command Write Period: {args.pwrite}s
Fault Injection Period: {args.pfault}s
Metrics Sample Period: {args.pmetrics}s

## Summary Statistics

| Metric | `mkddc-iobus` | `mkddc-core` |
| --- | --- | --- |
| Average CPU Usage | {avg_cpu_iobus:.2f}% | {avg_cpu_core:.2f}% |
| Max CPU Usage | {max_cpu_iobus:.2f}% | {max_cpu_core:.2f}% |
| Average RSS Memory | {avg_rss_iobus:.1f} KB | {avg_rss_core:.1f} KB |
| Max RSS Memory | {max_rss_iobus:.1f} KB | {max_rss_core:.1f} KB |
| Memory Growth (Leak metric) | {iobus_leak:.1f} KB | {core_leak:.1f} KB |

## Robustness & Fault Tolerance

- **Command Send Success Rate**: {command_ok_count}/{command_send_count} ({100.0 * command_ok_count / max(1, command_send_count):.1f}%)
- **Fault Injections (MCU Kill)**: {fault_inject_count} times
- **Fault Recoveries (MCU Revive & Connect)**: {reconnect_success_count} times
- **Total Core Scan Overruns**: {final_overruns}

## Final Verdict
""")
        # Verdict logic
        passed = True
        reasons = []
        if iobus_leak > 500: # growth > 500KB in short run
            passed = False
            reasons.append("iobus memory growth indicates potential leak")
        if core_leak > 500:
            passed = False
            reasons.append("core memory growth indicates potential leak")
        if command_ok_count < command_send_count * 0.8 and command_send_count > 0:
            passed = False
            reasons.append("command success rate is below 80%")
        if fault_inject_count > 0 and reconnect_success_count < fault_inject_count - 1:
            passed = False
            reasons.append("fake MCU did not successfully reconnect after fault")

        if passed:
            f.write("> [!TIP]\n> **PASSED** - All processes remained stable, memory growth was within limits, and fault recovery succeeded reliably.\n")
        else:
            f.write(f"> [!CAUTION]\n> **FAILED** - Issues detected:\n" + "\n".join(f"> - {r}" for r in reasons) + "\n")

    print(f"[soak] Soak test report generated: {report_path}")
    print(f"[soak] Soak test metrics CSV generated: {csv_path}")

if __name__ == "__main__":
    main()
