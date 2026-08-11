import { describe, expect, it } from "vitest";

import {
  PROGRAMMING_ERROR_CATALOG,
  PROGRAMMING_ERROR_CATALOG_SHA256,
  isRetryable,
  mapComponentError,
  messageKeyFor,
  sanitizeProgrammingErrorArgs,
} from "./errors";

describe("Programming error catalog sinh tự động", () => {
  it("khóa đủ 19 mã và hash", () => {
    expect(Object.keys(PROGRAMMING_ERROR_CATALOG)).toHaveLength(19);
    expect(PROGRAMMING_ERROR_CATALOG_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ánh xạ detail thống nhất và detail lạ fail-safe", () => {
    expect(mapComponentError("artifact-loader", "IR-E-001")).toBe("PRG-ERR-ARTIFACT-001");
    expect(mapComponentError("artifact-loader", "IR-E-004")).toBe("PRG-ERR-TARGET-001");
    expect(mapComponentError("compiler", "ST-IOMAP-003")).toBe("PRG-ERR-MAP-004");
    expect(mapComponentError("core-ipc", "UNKNOWN-DETAIL")).toBe("PRG-ERR-UNAVAILABLE-001");
  });

  it("không dùng text tự do để quyết định retry hoặc copy", () => {
    expect(isRetryable("PRG-ERR-UNAVAILABLE-001")).toBe(true);
    expect(PROGRAMMING_ERROR_CATALOG["PRG-ERR-UNAVAILABLE-001"].keepsRunningRevision).toBe(false);
    expect(isRetryable("PRG-ERR-COM-001")).toBe(false);
    expect(messageKeyFor("PRG-ERR-IMPACT-STALE-001")).toBe("programming.error.impactStale");
  });

  it("loại public arg ngoài allowlist hoặc có cấu trúc nhạy cảm", () => {
    expect(sanitizeProgrammingErrorArgs("PRG-ERR-REQ-001", {
      actual: "2.0",
      secret: "token-value",
      path: "/etc/shadow",
      maxBytes: Number.POSITIVE_INFINITY,
      supportedMajor: ["1.0", "bad\nvalue"],
    })).toEqual({ actual: "2.0" });
  });
});
