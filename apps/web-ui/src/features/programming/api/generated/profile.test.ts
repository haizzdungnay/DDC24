import { describe, expect, it } from "vitest";

// Đọc contract bằng import JSON (`resolveJsonModule`) chứ KHÔNG dùng `node:fs`:
// tsconfig của FE chỉ khai lib DOM và repo cố ý không cài `@types/node`, nên
// import Node API làm `tsc --noEmit` trong `npm run build` đỏ dù vitest vẫn chạy.
import contract from "../../../../../../../contracts/programming/product_profile_v2.json";

import {
  PROGRAMMING_ALLOWED_PERIOD_MS,
  PROGRAMMING_CAPACITY,
  PROGRAMMING_LANGUAGES,
  PROGRAMMING_POINT_KINDS,
  PROGRAMMING_PROFILE_CODE,
  PROGRAMMING_PROFILE_ID,
  PROGRAMMING_PROFILE_MAJOR,
  PROGRAMMING_PROFILE_MINOR,
  PROGRAMMING_PROFILE_SHA256,
  PROGRAMMING_RESOURCES,
  PROGRAMMING_REVIEW_GATED_FEATURES,
  PROGRAMMING_SCHEDULER,
  PROGRAMMING_TARGET_ABI,
  PROGRAMMING_TYPES,
} from "./profile";

describe("Product profile v2 sinh tự động", () => {
  it("khớp đúng contract machine-readable, kể cả hash nội dung", () => {
    expect(PROGRAMMING_PROFILE_ID).toBe(contract.profileId);
    expect(PROGRAMMING_PROFILE_CODE).toBe(contract.profileCode);
    expect(PROGRAMMING_TARGET_ABI).toBe(contract.targetAbi);
    expect(PROGRAMMING_PROFILE_MAJOR).toBe(contract.version.major);
    expect(PROGRAMMING_PROFILE_MINOR).toBe(contract.version.minor);
    // Bằng nhau CHÍNH XÁC giữa hằng sinh và SHA-256 nội dung contract được ép ở
    // `scripts/generate_programming_profile.py --check` (gate `layout`) và ở
    // `TestProfileGeneratedMatchesContract` phía Go. Ở đây chỉ khoá dạng giá trị
    // để một chuỗi rác không lọt qua mà không cần kéo Node crypto vào bundle FE.
    expect(PROGRAMMING_PROFILE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("khóa capacity sản phẩm 32 Program / 16 Enabled", () => {
    // Con số này là quyết định Product (DDD-SW-PROG-UNIFIED-001 §0). Nếu ai đó
    // hạ về capacity một Program như As-Built cũ, test đỏ chứ không im lặng.
    expect(PROGRAMMING_CAPACITY.maxProgramsTotal).toBe(32);
    expect(PROGRAMMING_CAPACITY.maxProgramsEnabled).toBe(16);
    expect(PROGRAMMING_CAPACITY.maxUserPou).toBe(256);
    expect(PROGRAMMING_CAPACITY.maxFunctionBlockInstances).toBe(1024);
    expect(PROGRAMMING_CAPACITY.maxSignals).toBe(512);
    expect(PROGRAMMING_CAPACITY.maxBindings).toBe(512);
    expect(PROGRAMMING_CAPACITY).toEqual(contract.capacity);
  });

  it("giữ trần một-Program tách khỏi trần package", () => {
    expect(PROGRAMMING_RESOURCES).toEqual(contract.resources);
    expect(PROGRAMMING_RESOURCES.maxBindings).toBeLessThanOrEqual(
      PROGRAMMING_CAPACITY.maxBindings,
    );
    expect(PROGRAMMING_RESOURCES.maxWritableSlots).toBeLessThanOrEqual(
      PROGRAMMING_RESOURCES.maxSlots,
    );
  });

  it("scheduler khai đúng số lớp chu kỳ và budget", () => {
    const { allowedPeriodMs, ...scalars } = contract.scheduler;
    expect(PROGRAMMING_SCHEDULER).toEqual(scalars);
    expect(PROGRAMMING_ALLOWED_PERIOD_MS).toEqual(allowedPeriodMs);
    expect(PROGRAMMING_SCHEDULER.maxTasks).toBe(PROGRAMMING_ALLOWED_PERIOD_MS.length);
    expect(PROGRAMMING_SCHEDULER.maxProgramsTotal).toBe(PROGRAMMING_CAPACITY.maxProgramsTotal);
  });

  it("giữ nguyên thứ tự canonical của type, language và Point kind", () => {
    expect(PROGRAMMING_LANGUAGES).toEqual(contract.languages);
    expect(PROGRAMMING_POINT_KINDS).toEqual(contract.pointKinds);
    expect(PROGRAMMING_TYPES.map((item) => item.name)).toEqual(
      contract.types.map((item: { name: string }) => item.name),
    );
    expect(PROGRAMMING_TYPES.map((item) => item.wireCode)).toEqual(
      contract.types.map((item: { wireCode: number }) => item.wireCode),
    );
  });

  it("PID đã được phê duyệt Controls/Safety bằng token của contract (#802)", () => {
    // FE chỉ HIỂN THỊ trạng thái này. Không có checkbox nào ở UI được coi là
    // phê duyệt — token suy ra từ contract profile và chỉ generator dựng được.
    expect(PROGRAMMING_REVIEW_GATED_FEATURES.map((item) => item.featureId)).toEqual(
      contract.reviewGatedFeatures.map((item) => item.featureId),
    );
    for (const [index, item] of PROGRAMMING_REVIEW_GATED_FEATURES.entries()) {
      expect(item.approved).toBe(contract.reviewGatedFeatures[index].approvalToken !== null);
      expect(item.approved).toBe(item.approvalToken.length > 0);
      expect(item.approvalToken).toBe(contract.reviewGatedFeatures[index].approvalToken ?? "");
    }
    const pid = PROGRAMMING_REVIEW_GATED_FEATURES.find((item) => item.featureId === "PID");
    expect(pid, "PID phải nằm trong bảng review-gate").toBeDefined();
    expect(pid?.approved, "PID đã ký token EV-PROG-PID-APPROVAL-20260928").toBe(true);
    const contractPid = contract.reviewGatedFeatures.find(
      (item: { featureId: string }) => item.featureId === "PID",
    );
    expect(contractPid?.approvalEvidenceRef).toBe("EV-PROG-PID-APPROVAL-20260928");
  });
});
