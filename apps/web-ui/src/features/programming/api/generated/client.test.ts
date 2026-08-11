import { describe, expect, it, vi } from "vitest";

import {
  PROGRAMMING_ENDPOINTS,
  PROGRAMMING_SCHEMA_VERSION,
  ProgrammingApiClient,
  ProgrammingApiError,
  type ProgrammingCommissionRequest,
} from "./client";

describe("Programming API client sinh từ OpenAPI", () => {
  it("khóa đủ 25 operation và contract Commission", () => {
    expect(Object.keys(PROGRAMMING_ENDPOINTS)).toHaveLength(25);
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
        messageKey: "programming.unavailable.contractOnly",
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
        message: "programming.unavailable.contractOnly",
      }),
    );
  });
});
