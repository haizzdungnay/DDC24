import { describe, expect, it, vi } from "vitest";

import {
  PROGRAMMING_ENDPOINTS,
  PROGRAMMING_OPENAPI_VERSION,
  PROGRAMMING_SCHEMA_VERSION,
  ProgrammingApiClient,
  ProgrammingApiError,
  ProgrammingNoResponseError,
  type ProgrammingCommissionRequest,
  type ProgrammingProgramHealth,
  type ProgrammingProgramListItem,
  type ProgrammingProgramRuntimeState,
  type ProgrammingProgramRuntimeStateSource,
  type ProgrammingProgramsPage,
} from "./client";
import impactGolden from "../../../../../../../contracts/openapi/testdata/programming-impact.json";
import { roleCan, USER_ROLES } from "../../../../shared/auth/capabilities";

/*
 * `WEB-RBAC-001` — `x-rbac` của Programming được suy từ `x-permission`.
 *
 * Vai này tồn tại đúng để làm việc Programming: sửa Draft (`program.edit`) và
 * đưa chương trình vào vận hành (`program.activate`). Simulation tách riêng
 * bằng `simulation.run` admin-only. Trước lát này giao diện chỉ cho `admin`
 * làm được, nên không thể giao việc lập trình cho một kỹ sư mà không đồng thời
 * trao cho họ quyền tạo tài khoản.
 */
describe("Programming API client sinh từ OpenAPI", () => {
  it("khớp vai của cả 45 operation với capability FE", () => {
    for (const [operationId, endpoint] of Object.entries(PROGRAMMING_ENDPOINTS)) {
      for (const role of USER_ROLES) {
        expect(
          (endpoint.roles as readonly string[]).includes(role),
          `${operationId}: ${role} phải khớp ${endpoint.permission}`,
        ).toBe(roleCan(role, endpoint.permission));
      }
    }
  });

  it("khóa đủ 45 operation và contract Commission/Runtime Signal/Simulation", () => {
    // 25 operation Rev A + 4 operation Control Library (T59-202/T59-203)
    // + 2 operation intent Enable/Disable (T59-405) + 1 Published Signal
    // runtime read-only (T59-504) + 1 recovery-reset (T59-702)
    // + 7 operation Simulation R3 (T59-814) + 1 Used-In (T61-105)
    // + 1 Check entry PROJECT Library (T61-401)
    // + 1 đọc mã nguồn entry theo revision (T61-404)
    // + 1 preview binding server-authoritative (ISS-PGM03-01).
    expect(Object.keys(PROGRAMMING_ENDPOINTS)).toHaveLength(45);
    expect(PROGRAMMING_ENDPOINTS.previewProgrammingBinding).toEqual({
      method: "POST",
      path: "/api/v1/programming/projects/{projectId}/draft/bindings/preview",
      roles: ["engineer", "admin"],
      permission: "program.edit",
    });
    /* `T59-814`/`ADR-053` — RBAC của Simulation nằm ở CHÍNH contract sinh ra:
       mọi mutation dùng `simulation.run` admin-only, mọi đường đọc mở cho viewer/operator. Nếu ai
       đó nới quyền ở OpenAPI thì test này đỏ trước khi FE kịp hiện thêm nút.

       `T59-816` sửa một chỗ chính bộ test này đã mâu thuẫn với chính nó: chú
       thích viết "mọi mutation admin-only" trong khi khẳng định lại chờ
       `["engineer","admin"]`. Bản khẳng định sai, không phải chú thích —
       `simulation.run` là quyền riêng của admin vì một phiên mô phỏng sinh ra
       tiến trình worker có hạn ngạch RAM/CPU trên chính tủ điều khiển. */
    expect(PROGRAMMING_ENDPOINTS.createProgrammingSimulationSession).toEqual({
      method: "POST",
      path: "/api/v1/programming/simulation/sessions",
      roles: ["admin"],
      permission: "simulation.run",
    });
    expect(PROGRAMMING_ENDPOINTS.actProgrammingSimulationSession.roles).toEqual(["admin"]);
    expect(PROGRAMMING_ENDPOINTS.setProgrammingSimulationInput.roles).toEqual(["admin"]);
    expect(PROGRAMMING_ENDPOINTS.stopProgrammingSimulationSession.roles).toEqual(["admin"]);
    expect(PROGRAMMING_ENDPOINTS.getProgrammingSimulationSession.roles).toEqual([
      "viewer",
      "operator",
      "engineer",
      "admin",
    ]);
    expect(PROGRAMMING_ENDPOINTS.listProgrammingSimulationObservations.roles).toEqual([
      "viewer",
      "operator",
      "engineer",
      "admin",
    ]);
    expect(PROGRAMMING_ENDPOINTS.listProgrammingSimulationTrace.roles).toEqual([
      "viewer",
      "operator",
      "engineer",
      "admin",
    ]);
    // T59-702 — lối ra tường minh khỏi RECOVERY_REQUIRED, dùng program.activate: đây là
    // lệnh gỡ khoá vận hành, đưa Core về IDLE KHÔNG có Active và bắt buộc
    // Commission lại; không gói nào tự sống lại.
    expect(PROGRAMMING_ENDPOINTS.resetProgrammingRecovery).toEqual({
      method: "POST",
      path: "/api/v1/programming/runtime/recovery-reset",
      roles: ["engineer", "admin"],
      permission: "program.activate",
    });
    expect(PROGRAMMING_ENDPOINTS.getProgrammingRuntimeSignals).toEqual({
      method: "GET",
      path: "/api/v1/programming/runtime/signals",
      roles: ["viewer", "operator", "engineer", "admin"],
      permission: "read",
    });
    // Intent Enable/Disable: đọc cho viewer, đặt intent dùng program.activate — RBAC nằm ở
    // CHÍNH contract sinh ra, không chỉ ở BE.
    expect(PROGRAMMING_ENDPOINTS.listProgrammingProgramIntents).toEqual({
      method: "GET",
      path: "/api/v1/programming/projects/{projectId}/programs",
      roles: ["viewer", "operator", "engineer", "admin"],
      permission: "read",
    });
    expect(PROGRAMMING_ENDPOINTS.setProgrammingProgramIntent).toEqual({
      method: "PUT",
      path: "/api/v1/programming/projects/{projectId}/programs/{programId}/runtime-intent",
      roles: ["engineer", "admin"],
      permission: "program.activate",
    });
    expect(PROGRAMMING_ENDPOINTS.searchProgrammingLibraries).toEqual({
      method: "GET",
      path: "/api/v1/programming/libraries",
      roles: ["viewer", "operator", "engineer", "admin"],
      permission: "read",
    });
    // Mutation library dùng program.edit ở CHÍNH contract sinh ra, không chỉ ở BE.
    expect(PROGRAMMING_ENDPOINTS.upsertProgrammingLibraryEntry.roles).toEqual(["engineer", "admin"]);
    expect(PROGRAMMING_ENDPOINTS.deleteProgrammingLibraryEntry).toEqual({
      method: "DELETE",
      path: "/api/v1/programming/projects/{projectId}/library/entries/{entryId}",
      roles: ["engineer", "admin"],
      permission: "program.edit",
    });
    expect(PROGRAMMING_ENDPOINTS.deprecateProgrammingLibraryRevision).toEqual({
      method: "POST",
      path: "/api/v1/programming/projects/{projectId}/library/revisions/{libraryRevisionId}/deprecate",
      roles: ["engineer", "admin"],
      permission: "program.edit",
    });
    expect(PROGRAMMING_ENDPOINTS.commissionProgrammingRevision).toEqual({
      method: "POST",
      path: "/api/v1/programming/operations/commission",
      roles: ["engineer", "admin"],
      permission: "program.activate",
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

  it("khoá hợp đồng bảng Programs sinh từ OpenAPI (T60-013/T60-014)", () => {
    // Bump contract đi kèm thay đổi hình dạng phản hồi; khoá số ở đây để một
    // lần sinh lại quên chạy không lặng lẽ giữ type cũ.
    //
    // `1.41.0` — `becd76b` nâng `contracts/openapi/openapi.yaml` khi đưa
    // acknowledgements của RESTORE vào hợp đồng, và `0de274e` sinh lại client
    // theo đúng số đó. Ghim này thì không được cập nhật cùng, nên `main` đỏ với
    // `expected '1.41.0' to be '1.40.0'`: phép kiểm đã làm đúng việc của nó —
    // báo rằng hai số đã rời nhau — chỉ là lần này bên trôi là chính cái ghim,
    // không phải client. Cập nhật ghim theo contract, KHÔNG hạ client về số cũ.
    expect(PROGRAMMING_OPENAPI_VERSION).toBe("1.41.0");

    // D-07 — ĐÚNG năm trạng thái. `STARTING`/`STOPPING` không bao giờ xuất hiện:
    // `start()`/`stop()`/`disable()` của Core đổi trạng thái đồng bộ tức thì,
    // không có pha trung gian nào để hiển thị. Hai `@ts-expect-error` dưới đây
    // là phần khoá thật — chúng HỎNG BUILD ngay khi ai đó thêm lại hai giá trị
    // đó vào enum, thứ mà một phép đếm phần tử mảng không bắt được.
    const runtimeStates: ProgrammingProgramRuntimeState[] = [
      "RUNNING",
      "WAITING",
      "DISABLED",
      "FAULTED",
      "UNKNOWN",
    ];
    expect(runtimeStates).toHaveLength(5);
    // @ts-expect-error STARTING bị loại khỏi hợp đồng D-07, không được quay lại
    const starting: ProgrammingProgramRuntimeState = "STARTING";
    // @ts-expect-error STOPPING bị loại khỏi hợp đồng D-07, không được quay lại
    const stopping: ProgrammingProgramRuntimeState = "STOPPING";
    expect([starting, stopping]).toEqual(["STARTING", "STOPPING"]);

    const sources: ProgrammingProgramRuntimeStateSource[] = ["CORE_LIVE", "LAST_KNOWN", "UNAVAILABLE"];
    expect(sources).toHaveLength(3);
    const healthValues: ProgrammingProgramHealth[] = ["HEALTHY", "DEGRADED", "FAULT", "UNKNOWN"];
    expect(healthValues).toHaveLength(4);

    // Core im: mọi số đo phải là `null` HỢP LỆ theo type. Nếu một trường nào bị
    // khai thành non-nullable thì đối tượng này không biên dịch được — đúng chỗ
    // ta muốn hỏng, vì `0`/`false` ở cột Cycle hay Health là số bịa.
    const offline: ProgrammingProgramsPage = {
      schemaVersion: PROGRAMMING_SCHEMA_VERSION,
      projectId: "11111111-1111-4111-8111-111111111111",
      runtimeStateSource: "UNAVAILABLE",
      observedAt: null,
      programsTruncated: null,
      items: [
        {
          programId: "ahu-1",
          desiredEnabled: null,
          generation: null,
          updatedBy: null,
          updatedAtUtcMs: null,
          runtimeState: "UNKNOWN",
          lastFaultCode: null,
          lastFaultLine: null,
          faultCount: null,
          runtimeStateSource: "UNAVAILABLE",
          coreState: null,
          enabled: null,
          observedAt: null,
          periodMs: null,
          lastExecNs: null,
          maxExecNs: null,
          missedReleaseCount: null,
          consecutiveMissedRelease: null,
          lastRunAtUtc: null,
          lastRunAgeMs: null,
          lane: null,
          health: null,
        },
      ],
    };
    // `desiredEnabled = null` KHÁC `false`: Program chạy trong Core mà Project
    // chưa từng ghi intent không phải là Program "đã có người tắt".
    expect(offline.items[0].desiredEnabled).toBeNull();
    expect(offline.items[0].health).toBeNull();

    // Dòng sống: `health` là nhãn do SERVER tính, FE không được tự suy.
    const live: ProgrammingProgramListItem = {
      ...offline.items[0],
      desiredEnabled: true,
      generation: 3,
      updatedBy: "admin",
      updatedAtUtcMs: 1_700_000_000_000,
      runtimeState: "RUNNING",
      runtimeStateSource: "CORE_LIVE",
      coreState: "RUNNING",
      enabled: true,
      observedAt: "2026-08-24T00:00:00Z",
      periodMs: 1000,
      lastExecNs: 120_000,
      maxExecNs: 300_000,
      missedReleaseCount: 0,
      consecutiveMissedRelease: 0,
      lastRunAtUtc: "2026-08-24T00:00:00Z",
      lastRunAgeMs: 12,
      lane: 0,
      health: "HEALTHY",
    };
    expect(live.health).toBe("HEALTHY");
    expect(live.periodMs).toBe(1000);
  });

  it("đọc cùng golden impact payload với Go", () => {
    expect(impactGolden.impactRef).toBe("impact-ref-0001");
    const acknowledgements = Object.entries(impactGolden)
      .filter(([, value]) => typeof value === "object" && "status" in value && value.status === "PRESENT")
      .map(([key]) => key)
      .sort();
    /* `ISS-PIO-29` — kỳ vọng SUY từ chính golden payload, không gõ tay.
     *
     * Danh sách gõ tay ở đây chỉ nói "ai đó quên sửa test" khi tập nhóm impact
     * đổi; nó KHÔNG nói "một nhóm vừa biến mất khỏi payload", là thứ đáng khoá.
     * Điều test này thật sự phải bảo đảm là hai phía đọc CÙNG một tệp: mọi khoá
     * dạng nhóm impact trong golden đều được nhận ra, và không khoá nào bị bỏ
     * sót vì FE chưa biết tên nó. */
    const impactGroupKeys = Object.entries(impactGolden)
      .filter(([, value]) => typeof value === "object" && value !== null && "status" in value)
      .map(([key]) => key)
      .sort();
    expect(acknowledgements).toEqual(impactGroupKeys);
    // Bốn nhóm tách theo nguồn Point phải có mặt — đó là nội dung của ISS-PIO-29.
    for (const key of ["physicalMappingChanges", "virtualPointChanges",
      "modbusMappingChanges", "writableOutputsAffected"]) {
      expect(impactGroupKeys, `golden payload thiếu nhóm ${key}`).toContain(key);
    }
    // Và các nhóm cũ không được biến mất khỏi hợp đồng.
    for (const key of ["retain", "activeOverrides", "cutover", "outputMappingChanges",
      "publishedSignals", "controlLibrary", "programSet", "enableIntent"]) {
      expect(impactGroupKeys, `golden payload mất nhóm cũ ${key}`).toContain(key);
    }
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

  it("HTTP 403 thu hồi đúng capability và không tự phát lại mutation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: "PRG-ERR-FORBIDDEN-001",
          messageKey: "programming.error.forbidden",
          retryable: false,
          keepsRunningRevision: true,
          correlationId: "correlation-id-403",
        },
      }), { status: 403, headers: { "Content-Type": "application/json" } }),
    );
    const onForbidden = vi.fn();
    const client = new ProgrammingApiClient("https://controller.test", fetchImpl, onForbidden);

    await expect(client.request("updateProgrammingDraft", {
      path: { projectId: "project-id" },
      body: {},
    })).rejects.toBeInstanceOf(ProgrammingApiError);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onForbidden).toHaveBeenCalledOnce();
    expect(onForbidden).toHaveBeenCalledWith("program.edit", "updateProgrammingDraft");
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

  /*
  `T61-402` — client PHẢI có trần chờ.

  Trước lát này không có trần nào: một request treo sẽ treo mãi, nên đường ghi
  không bao giờ tới được trạng thái "không rõ kết quả" mà nó phải xử lý — màn
  hình chỉ đứng im ở "đang gửi" và người dùng bấm lại.
  */
  it("hết trần chờ thì ném ProgrammingNoResponseError, không treo vô hạn", async () => {
    // `fetch` tôn trọng signal: nó chỉ reject khi bị abort. Một mock resolve
    // ngay sẽ không đo được gì.
    const fetchImpl = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const client = new ProgrammingApiClient("https://controller.test", fetchImpl as unknown as typeof fetch);
    await expect(client.request("getProgrammingCapabilities", { timeoutMs: 5 }))
      .rejects.toBeInstanceOf(ProgrammingNoResponseError);
  });

  it("huỷ từ caller cũng là KHÔNG BIẾT, và nói đúng nguyên nhân là abort", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const client = new ProgrammingApiClient("https://controller.test", fetchImpl as unknown as typeof fetch);
    const pending = client.request("getProgrammingCapabilities", { signal: controller.signal, timeoutMs: 0 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "ProgrammingNoResponseError", reason: "abort" });
  });

  it("lỗi mạng (fetch reject không do abort) cũng là KHÔNG BIẾT, không phải lỗi lạ", async () => {
    // Máy chủ có thể đã commit rồi mới đứt đường về. Quy nó về "đã hỏng" là mời
    // người dùng bấm lại một thao tác có thể đã chạy.
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = new ProgrammingApiClient("https://controller.test", fetchImpl as unknown as typeof fetch);
    await expect(client.request("getProgrammingCapabilities"))
      .rejects.toMatchObject({ name: "ProgrammingNoResponseError", reason: "network" });
  });
});
