// Tệp sinh tự động bởi scripts/generate_programming_profile.py. Không sửa bằng tay.
export const PROGRAMMING_PROFILE_ID = "revA-1t-1-5-30" as const;
export const PROGRAMMING_PROFILE_CODE = 1 as const;
export const PROGRAMMING_TARGET_ABI = 3841 as const;
export const PROGRAMMING_PROFILE_MAJOR = 2 as const;
export const PROGRAMMING_PROFILE_MINOR = 2 as const;
export const PROGRAMMING_PROFILE_SHA256 = "25bc2a00ad3c541d796457a3554b802971e8320cdbb0f6ddc614c83fe9226ec2" as const;
export const PROGRAMMING_LIBRARY_VERSION = "rev-a.6" as const;

/** Trần cấp package/Revision. */
export const PROGRAMMING_CAPACITY = {
  maxObjects: 1312,
  maxProgramsTotal: 32,
  maxProgramsEnabled: 16,
  maxUserPou: 256,
  maxFunctionBlockInstances: 1024,
  maxSignals: 512,
  maxBindings: 512,
} as const;

/** Trần cấp một Program/artifact. */
export const PROGRAMMING_RESOURCES = {
  maxSourceBytes: 65536,
  maxVariables: 512,
  maxStatements: 4096,
  maxFbdBlocks: 256,
  maxFbdConnections: 512,
  maxArtifactBytes: 1048576,
  maxInstructions: 4096,
  maxSlots: 1024,
  maxWritableSlots: 512,
  maxConstants: 512,
  maxFunctionBlocks: 64,
  maxBindings: 256,
  maxRetainVariables: 128,
  maxRetainBytes: 4096,
  maxSections: 16,
} as const;

export const PROGRAMMING_SCHEDULER = {
  maxTasks: 8,
  maxProgramsPerTask: 32,
  maxProgramsTotal: 32,
  maxTaskBudgetPercent: 20,
} as const;

export const PROGRAMMING_ALLOWED_PERIOD_MS = [10, 50, 100, 500, 1000, 5000, 10000, 50000] as const;
export const PROGRAMMING_LANGUAGES = ["ST", "FBD"] as const;
export const PROGRAMMING_POINT_KINDS = ["LOCAL", "VP", "MB_RTU"] as const;

export const PROGRAMMING_TYPES = [
  { name: "BOOL", widthBits: 1, wireCode: 1 },
  { name: "INT", widthBits: 16, wireCode: 5 },
  { name: "DINT", widthBits: 32, wireCode: 2 },
  { name: "UINT", widthBits: 16, wireCode: 6 },
  { name: "REAL", widthBits: 32, wireCode: 3 },
  { name: "TIME", widthBits: 64, wireCode: 4 },
] as const;

// Feature giữ nhãn REVIEW_REQUIRED trong registry POU/Control Library.
// `approved: false` nghĩa là Check chặn; FE chỉ HIỂN THỊ trạng thái này và
// không được coi một checkbox nào là phê duyệt.
export const PROGRAMMING_REVIEW_GATED_FEATURES = [
  { featureId: "PID", approved: false, approvalToken: "" },
] as const;
