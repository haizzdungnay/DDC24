#!/usr/bin/env python3
"""Deterministic checks for the MK-DDC-24 hardware-doc closure register."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HW = ROOT / "docs/04_design/hardware"
HW_RECORDS = ROOT / "docs/07_records/reviews/hardware"

REQUIRED = [
    HW_RECORDS / "hw_design_review/HW_DOC_REVIEW_CLOSURE_PLAN.md",
    HW / "02_carrier_board/GROUNDING_SCHEME.md",
    HW / "03_io_subsystem/IO_RS485_CIRCUIT.md",
    HW / "04_power_supply/PWR_DESIGN.md",
    HW / "05_mcu_io/IOP_PROTOCOL.md",
    HW / "05_mcu_io/FW-ADC-SAMPLING.md",
    ROOT / "docs/03_architecture/SYSTEM.md",
    ROOT / "docs/02_design/firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md",
]

METADATA_DOCS = [
    HW / "01_som/SOM_SPEC_RADXA_CM3.md",
    HW / "02_carrier_board/CB_BLOCK_DIAGRAM.md",
    HW / "02_carrier_board/CB_SCHEMATIC_NOTES.md",
    HW / "03_io_subsystem/IO_AO_CIRCUIT.md",
    HW / "03_io_subsystem/IO_DO_RELAY.md",
    HW / "03_io_subsystem/IO_UI_CIRCUIT.md",
    HW / "04_power_supply/PWR_DESIGN.md",
    HW / "05_mcu_io/MCU_STM32G0_SPEC.md",
    HW / "05_mcu_io/FW-ADC-SAMPLING.md",
    HW / "06_bom/BOM_MK-DDC-24_v1.md",
    HW / "06_bom/BOM-UI-16CH.md",
    HW / "07_emc_thermal/EMC_THERMAL_NOTES.md",
    HW / "09_hw_bringup/HW-TEST-UI-16CH.md",
    HW / "10_manufacturing/MFG_DATA_PACKAGE.md",
    HW_RECORDS / "hw_design_review/SCHEMATIC_REVIEW_CHECKLIST.md",
]

BASELINE_DOCS = [
    ROOT / "docs/00_governance/DECISIONS.md",
    ROOT / "docs/01_product/PRODUCT.md",
    ROOT / "docs/02_requirements/REQUIREMENTS.md",
    ROOT / "docs/03_architecture/SYSTEM.md",
    ROOT / "docs/04_design/HARDWARE.md",
    ROOT / "docs/04_design/FIRMWARE.md",
    ROOT / "docs/04_design/SOFTWARE.md",
    ROOT / "docs/03_implementation/01_SYSTEM_IMPLEMENTATION_OVERVIEW.md",
    ROOT / "docs/02_design/software/SW_HMI_DESIGN_MK-DDC-24_VI.md",
    ROOT / "docs/04_uiux/KX-DDC24-UC-HMI-001_VI.md",
]

BASE_SKU_DOCS = [
    ROOT / "docs/01_product/PRODUCT.md",
    ROOT / "docs/02_requirements/REQUIREMENTS.md",
    ROOT / "docs/04_design/HARDWARE.md",
    ROOT / "docs/04_design/FIRMWARE.md",
]


class Checks:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def check(self, condition: bool, label: str, detail: str = "") -> None:
        if condition:
            self.passed += 1
            print(f"PASS  {label}")
        else:
            self.failed += 1
            suffix = f": {detail}" if detail else ""
            print(f"FAIL  {label}{suffix}")


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def issue_rows(register: str) -> dict[str, str]:
    rows: dict[str, str] = {}
    for line in register.splitlines():
        if not line.startswith("| HW-DOC-"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 5:
            continue
        rows[cells[0]] = cells[3].strip("`")
    return rows


def local_links(path: Path) -> list[tuple[str, Path]]:
    broken: list[tuple[str, Path]] = []
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text(path)):
        target = target.strip().strip("<>")
        if not target or target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        local = target.split("#", 1)[0]
        if not local:
            continue
        resolved = (path.parent / local).resolve()
        if not resolved.exists():
            broken.append((target, resolved))
    return broken


def main() -> int:
    checks = Checks()

    missing = [str(path.relative_to(ROOT)) for path in REQUIRED if not path.is_file()]
    checks.check(not missing, "required controlled documents exist", ", ".join(missing))
    if missing:
        return 1

    register_path = REQUIRED[0]
    register = text(register_path)
    rows = issue_rows(register)
    expected_ids = {f"HW-DOC-{n:03d}" for n in range(1, 40)} | {
        "HW-DOC-045",
        "HW-DOC-047",
        "HW-DOC-048",
        "HW-DOC-049",
        "HW-DOC-050",
    }
    checks.check(set(rows) == expected_ids, "canonical register has exactly 44 unique IDs")
    checks.check(
        all(status in {"BLOCKED_HW", "BLOCKED_FW", "CLOSED_DOC", "CLOSED_EVIDENCE", "REJECTED"} for status in rows.values()),
        "register has no OPEN/IN_PROGRESS issue row",
    )
    counts = {status: list(rows.values()).count(status) for status in sorted(set(rows.values()))}
    checks.check(
        counts == {"BLOCKED_FW": 1, "BLOCKED_HW": 13, "CLOSED_DOC": 28, "REJECTED": 2},
        "status counts are 13 HW-blocked / 1 FW-blocked / 28 doc-closed / 2 rejected",
        str(counts),
    )

    protocol_header = text(ROOT / "contracts/iop/iop_protocol.h")
    match = re.search(r"#define\s+IOP_GET_IO_PERIOD_MS\s+(\d+)u", protocol_header)
    checks.check(match is not None and match.group(1) == "2", "contract IOP authority defines 2ms GET_IO period")

    timing_paths = [
        HW / "05_mcu_io/IOP_PROTOCOL.md",
        HW / "05_mcu_io/FW-ADC-SAMPLING.md",
        HW / "05_mcu_io/MCU_STM32G0_SPEC.md",
        HW / "03_io_subsystem/IO_UI_CIRCUIT.md",
        HW_RECORDS / "hw_design_review/HW-RISK-UI-16CH.md",
        ROOT / "docs/03_architecture/SYSTEM.md",
        ROOT / "docs/01_specs/SRS_MK-DDC-24_VI.md",
        ROOT / "docs/03_implementation/01_SYSTEM_IMPLEMENTATION_OVERVIEW.md",
        ROOT / "docs/03_implementation/04_FW_MCU_IMPLEMENTATION_GUIDE.md",
        ROOT / "docs/03_implementation/05_IOP_UART_IMPLEMENTATION_GUIDE.md",
        ROOT / "docs/03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md",
    ]
    timing_text = "\n".join(text(path) for path in timing_paths)
    legacy_timing = re.findall(
        r"(?:CM3|SOM)?\s*publish(?:\s+period|\s+rate)?[^\n]*10\s*ms|"
        r"GET_IO[^\n]*10\s*ms|10\s*ms[^\n]*(?:GET_IO|publish|cadence)|mỗi 10ms[^\n]*hỏi",
        timing_text,
        flags=re.IGNORECASE,
    )
    checks.check(not legacy_timing, "active review-scope docs contain no legacy 10ms GET_IO/publish claim", str(legacy_timing))

    baseline_text = "\n".join(text(path) for path in BASELINE_DOCS)
    stale_baseline = re.findall(
        r"8\s*(?:x|×)?\s*UI\s*\+\s*8\s*(?:x|×)?\s*DI|"
        r"8\s*(?:x|×)?\s*DI\s*\+\s*8\s*(?:x|×)?\s*UI",
        baseline_text,
        flags=re.IGNORECASE,
    )
    checks.check(not stale_baseline, "active product/spec docs contain no 8 UI + 8 DI baseline", str(stale_baseline))
    checks.check(
        all("16 UI" in text(path) for path in BASE_SKU_DOCS),
        "active baseline docs state the 16 UI base-SKU architecture",
    )

    sys_arch = text(ROOT / "docs/03_architecture/SYSTEM.md")
    checks.check("16 UI + 4 AO + 4 DO" in sys_arch, "SYS-ARCH states Rev A 16 UI + 4 AO + 4 DO")
    checks.check("8× UI, 8× DI" not in sys_arch, "SYS-ARCH has no active 8 UI + 8 DI diagram")

    schematic_notes = text(HW / "02_carrier_board/CB_SCHEMATIC_NOTES.md")
    checks.check("06_DI_INPUT" not in schematic_notes, "active schematic notes contain no obsolete 06_DI_INPUT sheet")
    checks.check("10_DI_ISOLATED_OPTION" in schematic_notes, "optional isolated DI is explicitly separated")

    metadata_errors: list[str] = []
    for path in METADATA_DOCS:
        doc = text(path)
        head = "\n".join(doc.splitlines()[:10])
        tail = "\n".join(doc.splitlines()[-35:])
        head_match = re.search(r"\bRev\s+([0-9.]+)", head)
        tail_matches = re.findall(r"(?:Document ID[^\n]*|_Document ID[^\n]*)\bRev\s+([0-9.]+)", tail)
        if not head_match or not tail_matches or head_match.group(1) != tail_matches[-1]:
            metadata_errors.append(str(path.relative_to(ROOT)))
    checks.check(not metadata_errors, "document header/footer revisions agree", ", ".join(metadata_errors))

    power = text(HW / "04_power_supply/PWR_DESIGN.md")
    checks.check("**Status:** **BLOCKED" in power, "power design remains explicitly blocked")
    checks.check("4.513A" in power and "19.2–40.7V" in power, "power doc records corrected load and rectified-input calculations")
    checks.check(
        all(token in power for token in ("rejected for Rev A release", "rejected for production release")),
        "legacy 3A/LDO/boost solutions are not presented as released",
    )

    mfg_path = HW / "10_manufacturing/MFG_DATA_PACKAGE.md"
    mfg = text(mfg_path)
    kicad_sources = list((HW / "kicad").glob("*.kicad_sch")) + list((HW / "kicad").glob("*.kicad_pcb"))
    checks.check(bool(kicad_sources) or "**Status:** BLOCKED" in mfg, "manufacturing cannot appear released without KiCad sources")

    link_docs = REQUIRED + METADATA_DOCS + BASELINE_DOCS + [
        HW / "README.md",
        HW_RECORDS / "root/PROGRESS.md",
        HW_RECORDS / "README.md",
    ]
    broken_links: list[str] = []
    for path in dict.fromkeys(link_docs):
        for target, resolved in local_links(path):
            broken_links.append(f"{path.relative_to(ROOT)} -> {target} ({resolved})")
    checks.check(not broken_links, "local Markdown links resolve", "; ".join(broken_links))

    print(f"\nSUMMARY: {checks.passed} pass, {checks.failed} fail")
    return 1 if checks.failed else 0


if __name__ == "__main__":
    sys.exit(main())
