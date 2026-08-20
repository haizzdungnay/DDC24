import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

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
  PROGRAMMING_SCHEDULER,
  PROGRAMMING_TARGET_ABI,
  PROGRAMMING_TYPES,
} from "./profile";

const CONTRACT_PATH = resolve(
  __dirname,
  "../../../../../../../contracts/programming/product_profile_v2.json",
);

const raw = readFileSync(CONTRACT_PATH);
const contract = JSON.parse(raw.toString("utf8"));

describe("Product profile v2 sinh tự động", () => {
  it("khớp đúng contract machine-readable, kể cả hash nội dung", () => {
    expect(PROGRAMMING_PROFILE_ID).toBe(contract.profileId);
    expect(PROGRAMMING_PROFILE_CODE).toBe(contract.profileCode);
    expect(PROGRAMMING_TARGET_ABI).toBe(contract.targetAbi);
    expect(PROGRAMMING_PROFILE_MAJOR).toBe(contract.version.major);
    expect(PROGRAMMING_PROFILE_MINOR).toBe(contract.version.minor);
    expect(PROGRAMMING_PROFILE_SHA256).toBe(createHash("sha256").update(raw).digest("hex"));
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
});
