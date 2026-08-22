import { describe, expect, it, vi } from "vitest";

import {
  PROGRAMMING_ENDPOINTS,
  PROGRAMMING_SCHEMA_VERSION,
  ProgrammingApiClient,
  ProgrammingApiError,
  type ProgrammingCommissionRequest,
} from "./client";
import impactGolden from "../../../../../../../contracts/openapi/testdata/programming-impact.json";

describe("Programming API client sinh từ OpenAPI", () => {
  it("khóa đủ 31 operation và contract Commission/Runtime Signal", () => {
    // 25 operation Rev A + 3 operation Control Library (T59-202)
    // + 2 operation intent Enable/Disable (T59-405) + 1 Published Signal
    // runtime read-only (T59-504).
    expect(Object.keys(PROGRAMMING_ENDPOINTS)).toHaveLength(31);
    expect(PROGRAMMING_ENDPOINTS.getProgrammingRuntimeSignals).toEqual({
      method: "GET",
      path: "/api/v1/programming/runtime/signals",
      roles: ["viewer", "operator", "admin"],
    });
    // Intent Enable/Disable: đọc cho viewer, đặt intent admin-only — RBAC nằm ở
    // CHÍNH contract sinh ra, không chỉ ở BE.
    expect(PROGRAMMING_ENDPOINTS.listProgrammingProgramIntents).toEqual({
      method: "GET",
      path: "/api/v1/programming/projects/{projectId}/programs",
      roles: ["viewer", "operator", "admin"],
    });
    expect(PROGRAMMING_ENDPOINTS.setProgrammingProgramIntent).toEqual({
      method: "PUT",
      path: "/api/v1/programming/projects/{projectId}/programs/{programId}/runtime-intent",
      roles: ["admin"],
    });
    expect(PROGRAMMING_ENDPOINTS.searchProgrammingLibraries).toEqual({
      method: "GET",
      path: "/api/v1/programming/libraries",
      roles: ["viewer", "operator", "admin"],
    });
    // Mutation library là admin-only ở CHÍNH contract sinh ra, không chỉ ở BE.
    expect(PROGRAMMING_ENDPOINTS.upsertProgrammingLibraryEntry.roles).toEqual(["admin"]);
    expect(PROGRAMMING_ENDPOINTS.deleteProgrammingLibraryEntry).toEqual({
      method: "DELETE",
      path: "/api/v1/programming/projects/{projectId}/library/entries/{entryId}",
      roles: ["admin"],
    });
    expect(PROGRAMMING_ENDPOINTS.commissionProgrammingRevision).toEqual({
      method: "POST",
      path: "/api/v1/programming/operations/commission",
      roles: ["admin"],
    });
    const request: ProgrammingCommissionRequest = {
      schemaVersion: PROGRAMMING_SCHEMA_VERSION,
      revisionId: "revision-id",
      expectedActiveRevisionId: null,
      checkId: "check-id",
      impactRef: "impact-ref",
      acknowledgements: [],
      cutover: { requested: "PROGRAM_ONLY" },
    };
    expect(request.acknowledgements).toEqual([]);
  });

  it("đọc cùng golden impact payload với Go", () => {
    expect(impactGolden.impactRef).toBe("impact-ref-0001");
    const acknowledgements = Object.entries(impactGolden)
      .filter(([, value]) => typeof value === "object" && "status" in value && value.status === "PRESENT")
      .map(([key]) => key)
      .sort();
    expect(acknowledgements).toEqual([
      "activeOverrides",
      "controlLibrary",
      "cutover",
      "enableIntent",
      "outputMappingChanges",
      "programSet",
      "publishedSignals",
      "retain",
    ]);
  });

  it("resolve path, query và header concurrency đúng contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ projectId: "project-id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new ProgrammingApiClient("https://controller.test", fetchImpl);
    await client.request("getProgrammingProject", {
      path: { projectId: "project id" },
      query: { limit: 10 },
      correlationId: "correlation-id-001",
      ifMatch: '"etag-1"',
    });
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://controller.test/api/v1/programming/projects/project%20id?limit=10");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("X-Correlation-ID")).toBe("correlation-id-001");
    expect(new Headers(init.headers).get("If-Match")).toBe('"etag-1"');
  });

  it("ném ProgrammingApiError theo error envelope ổn định", async () => {
    const envelope = {
      error: {
        code: "PRG-ERR-UNAVAILABLE-001",
        messageKey: "programming.error.unavailable",
        retryable: true,
        keepsRunningRevision: true,
        correlationId: "correlation-id-001",
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(envelope), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new ProgrammingApiClient("https://controller.test", fetchImpl);
    await expect(client.request("getProgrammingCapabilities")).rejects.toEqual(
      expect.objectContaining<Partial<ProgrammingApiError>>({
        status: 503,
        message: "programming.error.unavailable",
      }),
    );
  });

  it("fail-safe khi HTTP/code lệch và loại metadata nhạy cảm", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: "PRG-ERR-REQ-001",
          messageKey: "attacker.message",
          args: { actual: "2.0", secret: "token", path: "/etc/shadow" },
          field: "/etc/shadow",
          retryable: false,
          keepsRunningRevision: true,
          correlationId: "bad id",
        },
      }), { status: 500, headers: { "Content-Type": "application/json" } }),
    );
    const client = new ProgrammingApiClient("https://controller.test", fetchImpl);
    try {
      await client.request("getProgrammingCapabilities");
      throw new Error("request phải thất bại");
    } catch (error) {
      expect(error).toBeInstanceOf(ProgrammingApiError);
      const apiError = error as ProgrammingApiError;
      expect(apiError.envelope.error).toEqual({
        code: "PRG-ERR-UNAVAILABLE-001",
        messageKey: "programming.error.unavailable",
        retryable: true,
        keepsRunningRevision: false,
        correlationId: "invalid-correlation-id",
      });
    }
  });

  it("mã public lạ không được báo optimistic keeps-running", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: "PRG-ERR-UNKNOWN-999",
          keepsRunningRevision: true,
          correlationId: "correlation-id-001",
        },
      }), { status: 503, headers: { "Content-Type": "application/json" } }),
    );
    const client = new ProgrammingApiClient("https://controller.test", fetchImpl);
    try {
      await client.request("getProgrammingCapabilities");
      throw new Error("request phải thất bại");
    } catch (error) {
      const apiError = error as ProgrammingApiError;
      expect(apiError.envelope.error.code).toBe("PRG-ERR-UNAVAILABLE-001");
      expect(apiError.envelope.error.keepsRunningRevision).toBe(false);
    }
  });
});
