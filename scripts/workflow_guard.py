#!/usr/bin/env python3
"""Cổng quy trình clean-code — thi hành WF-CLEAN-001 trên mỗi pull request.

Authority: docs/00_governance/CLEAN_CODE_WORKFLOW.md

Script kiểm ba nhóm ràng buộc mà con người rất dễ bỏ qua khi review nhanh:

1.  **Truy xuất (N3)** — PR phải liên kết đúng một Issue bằng `Closes #N`, phải
    khai `Implementer-Run`, và phải có bảng Verification với số đo thật.
2.  **Tách vai (N1/N2)** — `Implementer-Run` của PR phải KHÁC `Manager-Run` của
    Issue, và `Reviewer-Run` trong verdict phải khác cả hai. Đây là cơ chế thay
    thế cho cổng "Require approvals" của GitHub: cả ba vai agent hiện chạy dưới
    cùng một tài khoản nên GitHub không phân biệt được chúng (xem §5.1 và §9
    của WF-CLEAN-001).
3.  **Cổng merge (N2)** — job chỉ xanh khi Issue đúng trạng thái, nhãn
    `review:pass` đã được gắn và tồn tại comment `[REVIEW-VERDICT: PASS]`.

Ba chế độ chạy:

* không tham số — trong GitHub Actions, tự đọc `GITHUB_EVENT_PATH` và gọi API.
* `--input <file.json>` — **chế độ offline**, dùng khi Actions không cấp runner.
  Vai Reviewer/Implementer lấy dữ liệu bằng GitHub MCP, ghi ra JSON rồi chạy
  guard trên đó. Cùng một hàm `check()`, cùng một phán quyết; chỉ khác nguồn dữ
  liệu. Không cần token, không cần mạng.
* `--selftest` — bộ kiểm nội bộ của các hàm parse, chạy offline.

Hình dạng JSON của `--input`:

    {
      "pr":       {"number": 1, "body": "...", "labels": [{"name": "review:pass"}]},
      "issue":    {"number": 10, "body": "...", "labels": [{"name": "state:in-review"}]},
      "comments": [{"body": "[REVIEW-VERDICT: PASS]...", "user": {"login": "x"}}]
    }

`issue` được phép là `null` (PR chưa liên kết Issue) — guard sẽ báo đúng mã lỗi
`N3-LINK` thay vì hỏng. `labels` nhận cả `[{"name": "x"}]` lẫn `["x"]`.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"

STATE_LABELS = {
    "state:triage",
    "state:ready",
    "state:in-progress",
    "state:in-review",
    "state:changes-requested",
    "state:blocked",
    "state:done",
}

# Trạng thái Issue hợp lệ khi đã có PR mở. `state:ready` bị loại có chủ ý:
# Implementer phải chuyển sang `in-progress` khi nhận việc, nếu không thì hai
# Implementer chạy song song sẽ cùng nhận một Issue mà không ai thấy.
STATES_ALLOWED_WITH_PR = {
    "state:in-progress",
    "state:in-review",
    "state:changes-requested",
}

PLACEHOLDER = re.compile(
    r"^\s*(<[^>]*>|_?no response_?|n/?a|tbd|\.\.\.|)\s*$", re.IGNORECASE
)


def is_placeholder(value: str) -> bool:
    """Giá trị bỏ trống hoặc còn nguyên chỗ điền mẫu thì không tính là đã khai."""
    return bool(PLACEHOLDER.match(value or ""))


def extract_field(body: str, name: str) -> str | None:
    """Đọc một trường khai báo từ body Issue/PR.

    Chấp nhận cả ba dạng cùng tồn tại trong repo này:

    * `Manager-Run: value`            — người viết tay
    * `- **Implementer-Run:** value`  — template PR có markdown bold
    * `### Manager-Run\\n\\nvalue`     — GitHub Issue Form render heading + giá trị

    Trả `None` khi không tìm thấy hoặc giá trị vẫn là chỗ điền mẫu.
    """
    if not body:
        return None

    inline = re.search(
        r"^[ \t>*\-]*(?:\*\*)?%s(?:\*\*)?[ \t]*:[ \t]*(?:\*\*)?(.+?)(?:\*\*)?[ \t]*$"
        % re.escape(name),
        body,
        re.IGNORECASE | re.MULTILINE,
    )
    if inline:
        value = inline.group(1).strip().strip("`")
        if not is_placeholder(value):
            return value

    heading = re.search(
        r"^#{1,6}[ \t]*%s[ \t]*$\n+(.+?)$" % re.escape(name),
        body,
        re.IGNORECASE | re.MULTILINE,
    )
    if heading:
        value = heading.group(1).strip().strip("`")
        if not is_placeholder(value):
            return value

    return None


def linked_issues(body: str) -> list[int]:
    """Số hiệu Issue mà PR tuyên bố đóng.

    Chỉ nhận từ khoá đóng của GitHub. `Refs #N` cố ý KHÔNG tính: nó không đóng
    Issue nên không tạo được mắt xích Merge → Close của N3.
    """
    if not body:
        return []
    found = re.findall(
        r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[ \t:]*#(\d+)",
        body,
        re.IGNORECASE,
    )
    return sorted({int(n) for n in found})


def verification_rows(body: str) -> list[tuple[str, str]]:
    """Các dòng bảng Verification đã điền kết quả.

    Trả về [(tên cổng, kết quả)]. Dòng header, dòng phân cách và dòng để trống
    bị loại — một bảng chép nguyên từ template mà chưa điền sẽ ra danh sách rỗng.
    """
    if not body:
        return []
    section = re.search(
        r"^#{1,6}[ \t]*Verification[ \t]*$\n(.*?)(?=^#{1,6}[ \t]|\Z)",
        body,
        re.IGNORECASE | re.MULTILINE | re.DOTALL,
    )
    if not section:
        return []

    rows: list[tuple[str, str]] = []
    for line in section.group(1).splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 3:
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        if cells[0].lower() in {"cổng", "cong", "gate"}:
            continue
        if not cells[-1] or is_placeholder(cells[-1]):
            continue
        rows.append((cells[0], cells[-1]))
    return rows


def review_verdicts(comments: list[dict]) -> list[tuple[str, str | None, str]]:
    """Verdict do Reviewer post, theo thứ tự thời gian.

    Trả [(PASS|FAIL, Reviewer-Run, tác giả comment)].
    """
    out: list[tuple[str, str | None, str]] = []
    for comment in comments:
        body = comment.get("body") or ""
        marker = re.search(
            r"\[\s*REVIEW-VERDICT\s*:\s*(PASS|FAIL)\s*\]", body, re.IGNORECASE
        )
        if not marker:
            continue
        author = ((comment.get("user") or {}).get("login")) or "?"
        out.append((marker.group(1).upper(), extract_field(body, "Reviewer-Run"), author))
    return out


def same_run(a: str | None, b: str | None) -> bool:
    """Hai định danh phiên có trỏ về cùng một lượt chạy hay không."""
    if a is None or b is None:
        return False
    return a.strip().lower().rstrip("/") == b.strip().lower().rstrip("/")


# --------------------------------------------------------------------------
# Lớp gọi GitHub API
# --------------------------------------------------------------------------


def api_get(path: str, token: str) -> object:
    request = urllib.request.Request(
        f"{API}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "mkddc-workflow-guard",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def api_get_all(path: str, token: str) -> list[dict]:
    items: list[dict] = []
    page = 1
    while page <= 10:
        joiner = "&" if "?" in path else "?"
        chunk = api_get(f"{path}{joiner}per_page=100&page={page}", token)
        if not isinstance(chunk, list) or not chunk:
            break
        items.extend(chunk)
        if len(chunk) < 100:
            break
        page += 1
    return items


# --------------------------------------------------------------------------
# Kiểm tra
# --------------------------------------------------------------------------


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.notes: list[str] = []

    def fail(self, code: str, message: str) -> None:
        self.errors.append(f"{code} — {message}")

    def note(self, message: str) -> None:
        self.notes.append(message)


def check(pr: dict, issue: dict | None, comments: list[dict], labels: set[str]) -> Report:
    report = Report()
    body = pr.get("body") or ""

    # --- Nhóm 1: truy xuất ------------------------------------------------
    issues = linked_issues(body)
    if len(issues) != 1:
        report.fail(
            "N3-LINK",
            "PR phải liên kết ĐÚNG MỘT Issue bằng `Closes #N`; tìm thấy "
            f"{len(issues)} ({issues or 'không có'}). `Refs #N` không tính vì "
            "nó không đóng Issue.",
        )

    implementer_run = extract_field(body, "Implementer-Run")
    if implementer_run is None:
        report.fail(
            "N3-IMPL",
            "PR thiếu trường `Implementer-Run`. Điền định danh phiên đã "
            "implement (URL phiên agent hoặc implementer-YYYYMMDDThhmmZ).",
        )

    rows = verification_rows(body)
    if not rows:
        report.fail(
            "N3-EVID",
            "Mục `## Verification` không có dòng nào điền kết quả. Bảng chép "
            "nguyên từ template không phải bằng chứng. Cổng chưa chạy thì ghi "
            "NOT_RUN kèm lý do, không bỏ trống.",
        )
    else:
        report.note(f"Verification: {len(rows)} cổng đã ghi kết quả.")

    # --- Nhóm 2: tách vai -------------------------------------------------
    manager_run = None
    if issue is not None:
        manager_run = extract_field(issue.get("body") or "", "Manager-Run")
        if manager_run is None:
            report.fail(
                "N1-MGR",
                f"Issue #{issue['number']} thiếu trường `Manager-Run`. Không có "
                "nó thì không chứng minh được người tạo Issue khác người "
                "implement. Manager phải bổ sung vào body Issue.",
            )
        elif same_run(manager_run, implementer_run):
            report.fail(
                "N1-SELF",
                f"`Manager-Run` của Issue #{issue['number']} trùng "
                f"`Implementer-Run` của PR (`{manager_run}`). Người tạo Issue "
                "không được tự implement (WF-CLEAN-001 §1 N1).",
            )

        issue_states = {lbl for lbl in issue_labels(issue) if lbl in STATE_LABELS}
        if len(issue_states) != 1:
            report.fail(
                "WF-STATE",
                f"Issue #{issue['number']} phải mang ĐÚNG MỘT nhãn `state:*`; "
                f"đang có {sorted(issue_states) or 'không có'}.",
            )
        elif not (issue_states & STATES_ALLOWED_WITH_PR):
            report.fail(
                "WF-STATE",
                f"Issue #{issue['number']} đang ở {sorted(issue_states)[0]}. Khi "
                "PR đã mở, trạng thái hợp lệ là "
                f"{sorted(STATES_ALLOWED_WITH_PR)}.",
            )

    # --- Nhóm 3: cổng merge ----------------------------------------------
    verdicts = review_verdicts(comments)
    passes = [v for v in verdicts if v[0] == "PASS"]

    if "review:changes-requested" in labels:
        report.fail(
            "N2-GATE",
            "PR đang mang nhãn `review:changes-requested`. Sửa theo verdict "
            "FAIL rồi báo Reviewer đổi nhãn, không tự gỡ.",
        )

    if "review:pass" not in labels:
        report.fail(
            "N2-GATE",
            "Chưa có nhãn `review:pass`. Cổng merge do vai Reviewer mở; "
            "Implementer không được tự gắn nhãn này. Job đỏ ở đây là trạng "
            "thái BÌNH THƯỜNG của PR đang chờ review.",
        )
    elif not passes:
        report.fail(
            "N2-VERDICT",
            "Có nhãn `review:pass` nhưng không tìm thấy comment "
            "`[REVIEW-VERDICT: PASS]`. Nhãn không thay được verdict có nội dung.",
        )
    else:
        reviewer_run = passes[-1][1]
        if reviewer_run is None:
            report.fail(
                "N2-VERDICT",
                "Comment verdict PASS thiếu trường `Reviewer-Run`.",
            )
        else:
            if same_run(reviewer_run, implementer_run):
                report.fail(
                    "N2-SELF",
                    f"`Reviewer-Run` trùng `Implementer-Run` (`{reviewer_run}`). "
                    "Người implement không được tự merge (WF-CLEAN-001 §1 N2).",
                )
            if same_run(reviewer_run, manager_run):
                report.fail(
                    "N2-SELF",
                    f"`Reviewer-Run` trùng `Manager-Run` (`{reviewer_run}`). Ba "
                    "vai phải là ba lượt chạy khác nhau.",
                )
            report.note(f"Verdict PASS bởi `{reviewer_run}`.")

    return report


def issue_labels(issue: dict) -> set[str]:
    out = set()
    for label in issue.get("labels") or []:
        out.add(label["name"] if isinstance(label, dict) else str(label))
    return out


def apply_waiver(report: Report, labels: set[str], comments: list[dict]) -> Report:
    """`gate:waived` chỉ miễn cổng review, không miễn ràng buộc truy xuất/tách vai."""
    if "gate:waived" not in labels:
        return report
    reason = next(
        (
            c
            for c in comments
            if re.search(r"GATE-WAIVED\s*:", c.get("body") or "", re.IGNORECASE)
        ),
        None,
    )
    if reason is None:
        report.fail(
            "WAIVE",
            "Nhãn `gate:waived` bắt buộc kèm comment `GATE-WAIVED: <lý do>`.",
        )
        return report

    waivable = ("N2-GATE", "N2-VERDICT")
    kept = [e for e in report.errors if not e.startswith(waivable)]
    waived = [e for e in report.errors if e.startswith(waivable)]
    report.errors = kept
    for entry in waived:
        report.note(f"MIỄN bởi `gate:waived`: {entry}")
    return report


def normalize_labels(raw: object) -> set[str]:
    """Nhận nhãn ở cả hai dạng: [{"name": "x"}] của API và ["x"] viết tay."""
    out: set[str] = set()
    if not isinstance(raw, list):
        return out
    for item in raw:
        if isinstance(item, dict) and "name" in item:
            out.add(str(item["name"]))
        elif isinstance(item, str):
            out.add(item)
    return out


def run_offline(path: str) -> int:
    """Chạy guard trên một ảnh chụp JSON thay vì gọi GitHub API.

    Đây KHÔNG phải chế độ nới lỏng: nó gọi đúng `check()` và `apply_waiver()` mà
    job CI gọi, nên phán quyết giống hệt. Khác biệt duy nhất là ai đi lấy dữ
    liệu — ở đây là vai Reviewer/Implementer qua GitHub MCP.
    """
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        print(f"LỖI: không đọc được `{path}`: {error}")
        return 2

    if not isinstance(data, dict) or not isinstance(data.get("pr"), dict):
        print("LỖI: JSON phải là object có khoá `pr` là object.")
        return 2

    pr = data["pr"]
    issue = data.get("issue") if isinstance(data.get("issue"), dict) else None
    comments = data.get("comments") if isinstance(data.get("comments"), list) else []
    labels = normalize_labels(pr.get("labels"))

    report = apply_waiver(check(pr, issue, comments, labels), labels, comments)

    number = pr.get("number", "?")
    issues = linked_issues(pr.get("body") or "")
    print(f"# Cổng quy trình clean-code (offline) — PR #{number}")
    print(f"Nguồn dữ liệu: {path} · Issue liên kết: {issues or 'không có'}\n")
    if report.notes:
        print("## Ghi nhận")
        for note in report.notes:
            print(f"- {note}")
        print()
    if report.errors:
        print(f"## CHẶN MERGE — {len(report.errors)} vi phạm")
        for error_line in report.errors:
            print(f"- {error_line}")
        return 1
    print("## PASS — đủ điều kiện merge")
    return 0


def main() -> int:
    if "--selftest" in sys.argv:
        return selftest()

    if "--input" in sys.argv:
        index = sys.argv.index("--input")
        if index + 1 >= len(sys.argv):
            print("LỖI: `--input` cần đường dẫn file JSON.")
            return 2
        return run_offline(sys.argv[index + 1])

    token = os.environ.get("GITHUB_TOKEN") or ""
    repo = os.environ.get("GITHUB_REPOSITORY") or ""
    event_path = os.environ.get("GITHUB_EVENT_PATH") or ""
    if not (token and repo and event_path and os.path.exists(event_path)):
        print("LỖI: thiếu GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_EVENT_PATH.")
        print("Không ở trong GitHub Actions. Dùng `--input <file.json>` để chạy")
        print("offline (vai Reviewer/Implementer lấy dữ liệu bằng GitHub MCP),")
        print("hoặc `--selftest` để kiểm logic guard.")
        return 2

    with open(event_path, encoding="utf-8") as handle:
        event = json.load(handle)

    pr = event.get("pull_request")
    if not pr:
        print("Không phải sự kiện pull_request — bỏ qua.")
        return 0

    number = pr["number"]
    labels = {label["name"] for label in pr.get("labels") or []}
    comments = api_get_all(f"/repos/{repo}/issues/{number}/comments", token)

    issue = None
    issues = linked_issues(pr.get("body") or "")
    if len(issues) == 1:
        try:
            fetched = api_get(f"/repos/{repo}/issues/{issues[0]}", token)
            if isinstance(fetched, dict) and "pull_request" not in fetched:
                issue = fetched
            else:
                print(f"CẢNH BÁO: #{issues[0]} là pull request, không phải Issue.")
        except urllib.error.HTTPError as error:
            print(f"CẢNH BÁO: không đọc được Issue #{issues[0]}: {error}")

    report = apply_waiver(check(pr, issue, comments, labels), labels, comments)

    lines = [f"# Cổng quy trình clean-code — PR #{number}", ""]
    lines.append(f"Authority: `WF-CLEAN-001` · Issue liên kết: {issues or 'không có'}")
    lines.append("")
    if report.notes:
        lines.append("## Ghi nhận")
        lines += [f"- {n}" for n in report.notes] + [""]
    if report.errors:
        lines.append(f"## CHẶN MERGE — {len(report.errors)} vi phạm")
        lines += [f"- **{e}**" for e in report.errors]
    else:
        lines.append("## PASS — đủ điều kiện merge")

    summary = "\n".join(lines)
    print(summary)
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as handle:
            handle.write(summary + "\n")

    return 1 if report.errors else 0


# --------------------------------------------------------------------------
# Self-test — chạy được offline, không cần token
# --------------------------------------------------------------------------


def selftest() -> int:
    cases: list[tuple[str, bool]] = []

    def expect(name: str, condition: bool) -> None:
        cases.append((name, bool(condition)))

    expect("field inline", extract_field("Manager-Run: mgr-1", "Manager-Run") == "mgr-1")
    expect(
        "field bold list",
        extract_field("- **Implementer-Run:** impl-1", "Implementer-Run") == "impl-1",
    )
    expect(
        "field issue-form heading",
        extract_field("### Manager-Run\n\nmgr-2\n", "Manager-Run") == "mgr-2",
    )
    expect(
        "field placeholder bị loại",
        extract_field("Implementer-Run: <URL phiên>", "Implementer-Run") is None,
    )
    expect(
        "field _No response_ bị loại",
        extract_field("### Manager-Run\n\n_No response_\n", "Manager-Run") is None,
    )

    expect("closes", linked_issues("Closes #12") == [12])
    expect("fixes hoa thường", linked_issues("FIXES #7\nresolved #7") == [7])
    expect("refs không tính", linked_issues("Refs #9") == [])
    expect("nhiều issue", linked_issues("Closes #1\nCloses #2") == [1, 2])

    table = (
        "## Verification\n\n"
        "| Cổng | Lệnh | Kết quả |\n|---|---|---|\n"
        "| Go | `go test` | 42/42 PASS |\n"
        "| FE | `vitest` |  |\n\n"
        "## Checklist\n| x | y | z |\n"
    )
    rows = verification_rows(table)
    expect("verification chỉ lấy dòng đã điền", rows == [("Go", "42/42 PASS")])
    expect(
        "verification bỏ qua bảng ngoài mục",
        all(r[0] != "x" for r in verification_rows(table)),
    )
    expect(
        "verification template rỗng",
        verification_rows("## Verification\n\n| Cổng | Lệnh | Kết quả |\n|---|---|---|\n| Go | `x` | |\n")
        == [],
    )

    verdicts = review_verdicts(
        [
            {"body": "không liên quan", "user": {"login": "a"}},
            {"body": "[REVIEW-VERDICT: FAIL]\nReviewer-Run: rev-1", "user": {"login": "b"}},
            {"body": "[REVIEW-VERDICT: PASS]\nReviewer-Run: rev-2", "user": {"login": "b"}},
        ]
    )
    expect("verdict parse", verdicts == [("FAIL", "rev-1", "b"), ("PASS", "rev-2", "b")])

    expect("same_run bỏ hoa thường", same_run("Impl-1", "impl-1"))
    expect("same_run bỏ dấu / cuối", same_run("https://x/s1/", "https://x/s1"))
    expect("same_run None", not same_run(None, "impl-1"))

    good_pr = {
        "number": 1,
        "body": (
            "Closes #10\n- **Implementer-Run:** impl-1\n\n"
            "## Verification\n\n| Cổng | Lệnh | Kết quả |\n|---|---|---|\n"
            "| Go | `go test` | 42/42 PASS |\n"
        ),
    }
    good_issue = {
        "number": 10,
        "body": "### Manager-Run\n\nmgr-1\n",
        "labels": [{"name": "state:in-review"}],
    }
    passing = check(
        good_pr,
        good_issue,
        [{"body": "[REVIEW-VERDICT: PASS]\nReviewer-Run: rev-1", "user": {"login": "r"}}],
        {"review:pass"},
    )
    expect("PR hợp lệ không có vi phạm", passing.errors == [])

    self_impl = check(
        good_pr,
        {**good_issue, "body": "Manager-Run: impl-1"},
        [{"body": "[REVIEW-VERDICT: PASS]\nReviewer-Run: rev-1", "user": {"login": "r"}}],
        {"review:pass"},
    )
    expect("N1 bắt tự implement", any(e.startswith("N1-SELF") for e in self_impl.errors))

    self_merge = check(
        good_pr,
        good_issue,
        [{"body": "[REVIEW-VERDICT: PASS]\nReviewer-Run: impl-1", "user": {"login": "r"}}],
        {"review:pass"},
    )
    expect("N2 bắt tự merge", any(e.startswith("N2-SELF") for e in self_merge.errors))

    no_label = check(good_pr, good_issue, [], set())
    expect("thiếu review:pass thì chặn", any(e.startswith("N2-GATE") for e in no_label.errors))

    waived = apply_waiver(
        check(good_pr, good_issue, [{"body": "GATE-WAIVED: CTO duyệt", "user": {"login": "c"}}], {"gate:waived"}),
        {"gate:waived"},
        [{"body": "GATE-WAIVED: CTO duyệt", "user": {"login": "c"}}],
    )
    expect("gate:waived miễn cổng review", waived.errors == [])

    waived_no_reason = apply_waiver(
        check(good_pr, good_issue, [], {"gate:waived"}), {"gate:waived"}, []
    )
    expect(
        "gate:waived thiếu lý do vẫn chặn",
        any(e.startswith("WAIVE") for e in waived_no_reason.errors),
    )

    waived_keeps_n1 = apply_waiver(
        check(
            good_pr,
            {**good_issue, "body": "Manager-Run: impl-1"},
            [{"body": "GATE-WAIVED: CTO duyệt", "user": {"login": "c"}}],
            {"gate:waived"},
        ),
        {"gate:waived"},
        [{"body": "GATE-WAIVED: CTO duyệt", "user": {"login": "c"}}],
    )
    expect(
        "gate:waived KHÔNG miễn N1",
        any(e.startswith("N1-SELF") for e in waived_keeps_n1.errors),
    )

    bad_state = check(good_pr, {**good_issue, "labels": [{"name": "state:ready"}]}, [], {"review:pass"})
    expect("state:ready khi đã có PR thì chặn", any(e.startswith("WF-STATE") for e in bad_state.errors))

    two_states = check(
        good_pr,
        {**good_issue, "labels": [{"name": "state:ready"}, {"name": "state:in-review"}]},
        [],
        {"review:pass"},
    )
    expect("hai nhãn state thì chặn", any(e.startswith("WF-STATE") for e in two_states.errors))

    # --- chế độ offline: nguồn dữ liệu khác, phán quyết phải giống hệt -----
    expect("nhãn dạng API", normalize_labels([{"name": "review:pass"}]) == {"review:pass"})
    expect("nhãn dạng chuỗi", normalize_labels(["review:pass"]) == {"review:pass"})
    expect("nhãn sai kiểu ra rỗng", normalize_labels("review:pass") == set())

    import tempfile

    def offline(payload: object) -> int:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as handle:
            json.dump(payload, handle)
            path = handle.name
        try:
            import contextlib
            import io

            with contextlib.redirect_stdout(io.StringIO()):
                return run_offline(path)
        finally:
            os.unlink(path)

    expect(
        "offline PASS trên PR hợp lệ",
        offline(
            {
                "pr": {**good_pr, "labels": [{"name": "review:pass"}]},
                "issue": good_issue,
                "comments": [
                    {"body": "[REVIEW-VERDICT: PASS]\nReviewer-Run: rev-1", "user": {"login": "r"}}
                ],
            }
        )
        == 0,
    )
    expect(
        "offline CHẶN khi Reviewer-Run trùng Implementer-Run",
        offline(
            {
                "pr": {**good_pr, "labels": [{"name": "review:pass"}]},
                "issue": good_issue,
                "comments": [
                    {"body": "[REVIEW-VERDICT: PASS]\nReviewer-Run: impl-1", "user": {"login": "r"}}
                ],
            }
        )
        == 1,
    )
    expect(
        "offline CHẶN khi thiếu review:pass",
        offline({"pr": {**good_pr, "labels": []}, "issue": good_issue, "comments": []}) == 1,
    )
    expect(
        "offline chịu được issue null",
        offline({"pr": {**good_pr, "labels": []}, "issue": None, "comments": []}) == 1,
    )
    expect("offline JSON sai hình dạng trả 2", offline({"khong_co_pr": 1}) == 2)
    expect("offline file không tồn tại trả 2", run_offline("/nonexistent/guard-input.json") == 2)

    failed = [name for name, ok in cases if not ok]
    for name, ok in cases:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(f"\n{len(cases) - len(failed)}/{len(cases)} PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
