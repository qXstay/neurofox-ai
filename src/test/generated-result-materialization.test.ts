import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ||= "development";
process.env.DATABASE_URL ||= "postgresql://qa:qa@127.0.0.1:5432/generated_result_materialization_test";
process.env.SESSION_SECRET ||= "generated-result-materialization-test-local-only";
process.env.UPLOAD_PROVIDER ||= "local_fs";
process.env.UPLOAD_FALLBACK_PROVIDER ||= "local_fs_copy";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pM7nY4AAAAASUVORK5CYII=",
  "base64",
);
const MB = 1024 * 1024;
const DEFAULT_GENERATED_RESULT_MAX_BYTES = 30 * MB;
const SUNO_GENERATED_RESULT_MAX_BYTES = 80 * MB;
const SUNO_GENERATED_RESULT_TIMEOUT_MS = 60_000;
const SUNO_GENERATED_RESULT_MAX_ATTEMPTS = 4;
const LARGE_VIDEO_GENERATED_RESULT_MAX_BYTES = 200 * MB;
const RESULT_LARGER_THAN_DEFAULT_BYTES = DEFAULT_GENERATED_RESULT_MAX_BYTES + 1024;
const PROVIDER_RESULT_URL = sourceUrl("/generated/result.bin");

type StorageModule = typeof import("../../backend/assets/storage.mjs");

let storage: StorageModule;

function sourceUrl(pathname: string) {
  return new URL(pathname, "https://provider.example.invalid").toString();
}

function fetchFailure(code = "ECONNRESET") {
  const cause = Object.assign(new Error(`${code} masked network failure`), { code });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

function pngResponse() {
  return new Response(ONE_BY_ONE_PNG, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(ONE_BY_ONE_PNG.length),
    },
  });
}

beforeAll(async () => {
  storage = await import("../../backend/assets/storage.mjs");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("../../backend/assets/repository.mjs");
  vi.doUnmock("../../backend/assets/storage.mjs");
  vi.doUnmock("../../backend/generations/kie-adapter.mjs");
  vi.doUnmock("../../backend/generations/repository.mjs");
});

function generatedResultTooLargeError(byteSize: number, maxBytes: number) {
  return Object.assign(new Error("Generated provider result content length is too large"), {
    outcome: "generated_output_unavailable",
    materializationReason: "remote_content_length_exceeded",
    materializationDiagnostics: {
      internalMaterializationReason: "remote_content_length_exceeded",
      contentLength: byteSize,
      byteSize,
      maxBytes,
    },
  });
}

function assertGeneratedResultWithinLimit(buffer: Buffer, maxBytes?: number) {
  const effectiveMaxBytes = maxBytes || DEFAULT_GENERATED_RESULT_MAX_BYTES;
  if (!buffer.length || buffer.length > effectiveMaxBytes) {
    throw generatedResultTooLargeError(buffer.length, effectiveMaxBytes);
  }
}

function baseGenerationJob(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-05-08T00:00:00.000Z");
  return {
    id: "generation-1",
    userId: "user-1",
    flowCode: "photo_gpt_image_15_text_to_image",
    prompt: "test prompt",
    sourceAssetId: null,
    requestedImageSize: "16:9",
    requestedOutputFormat: "png",
    tokenCost: 7,
    generationState: "dispatched",
    billingState: "reserved",
    providerTaskId: "provider-task-1",
    providerModel: "gpt-image/1.5-text-to-image",
    providerNormalizedState: "pending",
    resultPayload: null,
    failureCode: null,
    failureMessage: null,
    createdAt: now,
    updatedAt: now,
    reservedAt: now,
    dispatchedAt: now,
    pendingAt: null,
    generatingAt: null,
    succeededAt: null,
    failedAt: null,
    refundedAt: null,
    finalizedAt: null,
    ...overrides,
  };
}

async function importGenerationServiceWithMaterializationMocks({
  flowCode,
  providerModel,
  requestedOutputFormat,
  resultContentType,
  providerReader = "kie",
  sourceBuffer,
}: {
  flowCode: string;
  providerModel: string;
  requestedOutputFormat: string;
  resultContentType: string;
  providerReader?: "kie" | "suno" | "veo";
  sourceBuffer: Buffer;
}) {
  vi.resetModules();

  const generationJob = baseGenerationJob({
    flowCode,
    providerModel,
    requestedOutputFormat,
  });
  const providerRecord = {
    ok: true,
    providerNormalizedState: "succeeded",
    providerResponsePayload: {
      status: "succeeded",
    },
    resultPayload: {
      resultUrls: [PROVIDER_RESULT_URL],
      tracks:
        providerReader === "suno"
          ? [
              {
                audioUrl: PROVIDER_RESULT_URL,
                title: "Generated track",
              },
            ]
          : [],
    },
  };

  const storageMocks = {
    createGeneratedResultMaterializationError: vi.fn((reason: string, message: string, diagnostics = {}) =>
      Object.assign(new Error(message), {
        outcome: "generated_output_unavailable",
        materializationReason: reason,
        materializationDiagnostics: diagnostics,
      }),
    ),
    deleteManagedReferences: vi.fn(async () => undefined),
    describeGeneratedResultUrl: vi.fn(() => ({
      urlHost: "provider.example.invalid",
      urlPathHash: "masked-path-hash",
    })),
    materializationDiagnosticsFromError: vi.fn(
      (error: { materializationDiagnostics?: Record<string, unknown> } | null | undefined) =>
        error?.materializationDiagnostics || {},
    ),
    prepareProviderReference: vi.fn(
      async ({
        assetId,
        buffer,
        originalFilename,
        maxBytes,
      }: {
        assetId: string;
        buffer: Buffer;
        originalFilename: string;
        maxBytes?: number;
      }) => {
        assertGeneratedResultWithinLimit(buffer, maxBytes);
        return {
          providerConsumableReference: `local_fs://provider-ready/${assetId}/${originalFilename}`,
          providerStorageReference: `local_fs://provider-ready/${assetId}/${originalFilename}`,
          providerReferenceMode: "local_fs_reference",
        };
      },
    ),
    readGeneratedResultSource: vi.fn(async (_sourceUrl: string, options: { maxBytes?: number } = {}) => {
      assertGeneratedResultWithinLimit(sourceBuffer, options.maxBytes);
      return {
        buffer: sourceBuffer,
        contentType: resultContentType,
        sourceKind: "remote_url",
        diagnostics: {
          byteSize: sourceBuffer.length,
        },
      };
    }),
    resolveTransportRoute: vi.fn(() => "local_fs"),
    stageManagedAsset: vi.fn(
      async ({
        assetId,
        buffer,
        originalFilename,
        maxBytes,
      }: {
        assetId: string;
        buffer: Buffer;
        originalFilename: string;
        maxBytes?: number;
      }) => {
        assertGeneratedResultWithinLimit(buffer, maxBytes);
        return {
          storageReference: `local_fs://source/${assetId}/${originalFilename}`,
          originalFilename,
          byteSize: buffer.length,
          checksumSha256: "test-checksum",
        };
      },
    ),
  };

  const assetRepositoryMocks = {
    findMaterializedResultAssetByGeneration: vi.fn(async () => null),
    getAssetByIdForUserForUpdate: vi.fn(),
    insertMaterializedResultAsset: vi.fn(async (_client: unknown, input: Record<string, unknown>) => ({
      ...input,
      assetOrigin: "generated_result",
      assetState: "used",
    })),
    linkAssetToGenerationJob: vi.fn(),
    listSourceAssetsByGenerationJob: vi.fn(async () => []),
    markGeneratedResultAssetsExpiredForGenerationIfSafe: vi.fn(async () => []),
    markLinkedAssetUsed: vi.fn(),
    restoreLinkedAssetToProviderReady: vi.fn(),
  };

  const generationRepositoryMocks = {
    acquireGenerationDuplicateLock: vi.fn(),
    finalizeGenerationTokens: vi.fn(async () => undefined),
    findActiveDuplicateGenerationJob: vi.fn(),
    getGenerationJobByIdForUpdate: vi.fn(async () => generationJob),
    getGenerationJobByIdForUser: vi.fn(async () => generationJob),
    insertReservedGenerationJob: vi.fn(),
    listUnresolvedGenerationJobsForReconciliation: vi.fn(async () => []),
    listGenerationHistoryForUser: vi.fn(async () => []),
    markGenerationHistoryDeletedForUser: vi.fn(),
    markGenerationJobDispatched: vi.fn(),
    markGenerationJobFailedAfterDispatch: vi.fn(
      async (
        _client: unknown,
        _generationId: string,
        patch: { resultPayload?: unknown; failureCode?: string; failureMessage?: string },
        now: Date,
      ) => ({
        ...generationJob,
        generationState: "failed",
        billingState: "refunded",
        providerNormalizedState: "succeeded",
        resultPayload: patch.resultPayload,
        failureCode: patch.failureCode,
        failureMessage: patch.failureMessage,
        failedAt: now,
        refundedAt: now,
        updatedAt: now,
      }),
    ),
    markGenerationJobFailedAndRefunded: vi.fn(),
    markGenerationJobGenerating: vi.fn(),
    markGenerationJobPending: vi.fn(),
    markGenerationJobSucceededAndFinalized: vi.fn(
      async (_client: unknown, _generationId: string, patch: { resultPayload?: unknown }, now: Date) => ({
        ...generationJob,
        generationState: "success",
        billingState: "finalized",
        providerNormalizedState: "succeeded",
        resultPayload: patch.resultPayload,
        succeededAt: now,
        finalizedAt: now,
        updatedAt: now,
      }),
    ),
    refundGenerationTokens: vi.fn(async () => undefined),
    reserveGenerationTokens: vi.fn(),
    upsertGenerationHistoryProjection: vi.fn(async () => undefined),
    withTransaction: vi.fn(async (callback: (client: unknown) => unknown) => callback({})),
  };

  const dispatchTask = vi.fn(async () => ({ ok: true }));
  const kieAdapterMocks = {
    dispatchGptImage2ImageToImageTask: dispatchTask,
    dispatchGptImage2TextToImageTask: dispatchTask,
    dispatchKlingAvatarTask: dispatchTask,
    dispatchGrokImagineImageToVideoTask: dispatchTask,
    dispatchGrokImagineTextToVideoTask: dispatchTask,
    dispatchGptImageImageToImageTask: dispatchTask,
    dispatchGptImageTextToImageTask: dispatchTask,
    dispatchNanoBanana2Task: dispatchTask,
    dispatchNanoBananaEditTask: dispatchTask,
    dispatchNanoBananaProTask: dispatchTask,
    dispatchNanoBananaTextToImageTask: dispatchTask,
    dispatchSeedance20Task: dispatchTask,
    dispatchKlingMotionControlTask: dispatchTask,
    dispatchSunoAddInstrumentalTask: dispatchTask,
    dispatchSunoAddVocalsTask: dispatchTask,
    dispatchSunoBaseGenerateTask: dispatchTask,
    dispatchSunoUploadCoverTask: dispatchTask,
    dispatchSunoUploadExtendTask: dispatchTask,
    dispatchVeo31ImageToVideoTask: dispatchTask,
    normalizeNanoBananaProAspectRatio: vi.fn((value: unknown) => value),
    readKieTaskRecord: vi.fn(async () => providerRecord),
    readSunoTaskRecord: vi.fn(async () => providerRecord),
    readVeoTaskRecord: vi.fn(async () => providerRecord),
  };

  vi.doMock("../../backend/assets/repository.mjs", () => assetRepositoryMocks);
  vi.doMock("../../backend/assets/storage.mjs", () => storageMocks);
  vi.doMock("../../backend/generations/kie-adapter.mjs", () => kieAdapterMocks);
  vi.doMock("../../backend/generations/repository.mjs", () => generationRepositoryMocks);

  const service = await import("../../backend/generations/service.mjs");
  return {
    assetRepositoryMocks,
    generationRepositoryMocks,
    kieAdapterMocks,
    service,
    storageMocks,
  };
}

describe("generated result materialization remote fetch", () => {
  it("materializes a local HTTP provider-like result into bytes", async () => {
    const fetchStub = vi.fn().mockResolvedValue(pngResponse());
    vi.stubGlobal("fetch", fetchStub);

    const source = await storage.readGeneratedResultSource(sourceUrl("/png"), {
      timeoutMs: 1_000,
      retryDelayMs: 5,
      maxBytes: 1024,
    });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(source.contentType).toBe("image/png");
    expect(Buffer.compare(source.buffer, ONE_BY_ONE_PNG)).toBe(0);
    expect(source.diagnostics).toMatchObject({
      attemptCount: 1,
      maxAttempts: 3,
      responseReceived: true,
      httpStatus: 200,
    });
  });

  it("retries a transient remote fetch failure and succeeds without exposing the raw URL", async () => {
    const fetchStub = vi.fn().mockRejectedValueOnce(fetchFailure("ECONNRESET")).mockResolvedValueOnce(pngResponse());
    vi.stubGlobal("fetch", fetchStub);

    const source = await storage.readGeneratedResultSource(sourceUrl("/fetch-error-then-success?token=secret"), {
      timeoutMs: 1_000,
      retryDelayMs: 5,
      maxBytes: 1024,
    });

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(source.contentType).toBe("image/png");
    expect(source.diagnostics.attemptCount).toBe(2);
    expect(source.diagnostics.maxAttempts).toBe(3);
    expect(source.diagnostics.urlHost).toBe("provider.example.invalid");
    expect(JSON.stringify(source.diagnostics)).not.toContain("token=secret");
    expect(JSON.stringify(source.diagnostics)).not.toContain("/fetch-error-then-success");
  });

  it("terminal fetch failure stays masked and returns no generated source", async () => {
    const fetchStub = vi.fn().mockRejectedValue(fetchFailure("ENOTFOUND"));
    vi.stubGlobal("fetch", fetchStub);
    const rawProviderUrl = sourceUrl("/private/result.png?signature=secret");

    await expect(
      storage.readGeneratedResultSource(rawProviderUrl, {
        timeoutMs: 1_000,
        retryDelayMs: 5,
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({
      outcome: "generated_output_unavailable",
      materializationReason: "remote_fetch_error",
    });
    expect(fetchStub).toHaveBeenCalledTimes(3);

    try {
      await storage.readGeneratedResultSource(rawProviderUrl, {
        timeoutMs: 1_000,
        retryDelayMs: 5,
        maxBytes: 1024,
      });
    } catch (error) {
      const diagnostics = storage.materializationDiagnosticsFromError(error);
      expect(diagnostics).toMatchObject({
        internalMaterializationReason: "remote_fetch_error",
        attemptCount: 3,
        maxAttempts: 3,
        responseReceived: false,
        errorName: "TypeError",
      });
      expect(diagnostics.errorMessageClass).toBeTruthy();
      expect(diagnostics.causeName).toBeTruthy();
      expect(diagnostics.causeMessageClass).toBeTruthy();
      expect(JSON.stringify(diagnostics)).not.toContain(rawProviderUrl);
      expect(JSON.stringify(diagnostics)).not.toContain("signature=secret");
      expect(JSON.stringify(diagnostics)).not.toContain("/private/result.png");
      return;
    }

    throw new Error("Expected terminal materialization failure");
  });
});

describe("generated result materialization flow-aware limits", () => {
  it("materializes a Kling Motion video result larger than the default image cap", async () => {
    const sourceBuffer = Buffer.alloc(RESULT_LARGER_THAN_DEFAULT_BYTES, 7);
    const { assetRepositoryMocks, service, storageMocks } =
      await importGenerationServiceWithMaterializationMocks({
        flowCode: "video_kling_motion_control",
        providerModel: "kling-2.6/motion-control",
        requestedOutputFormat: "mp4",
        resultContentType: "video/mp4",
        sourceBuffer,
      });

    const response = await service.readGenerationStatus({ userId: "user-1" }, "generation-1");

    expect(response.body.outcome).toBe("generation_succeeded");
    expect(storageMocks.readGeneratedResultSource).toHaveBeenCalledWith(PROVIDER_RESULT_URL, {
      maxBytes: LARGE_VIDEO_GENERATED_RESULT_MAX_BYTES,
    });
    expect(storageMocks.stageManagedAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "video/mp4",
        maxBytes: LARGE_VIDEO_GENERATED_RESULT_MAX_BYTES,
      }),
    );
    expect(storageMocks.prepareProviderReference).toHaveBeenCalledWith(
      expect.objectContaining({
        maxBytes: LARGE_VIDEO_GENERATED_RESULT_MAX_BYTES,
      }),
    );
    expect(assetRepositoryMocks.insertMaterializedResultAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assetType: "video",
        byteSize: RESULT_LARGER_THAN_DEFAULT_BYTES,
      }),
    );
  });

  it("preserves the default 30 MB generated image result cap", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sourceBuffer = Buffer.alloc(RESULT_LARGER_THAN_DEFAULT_BYTES, 7);
    const { assetRepositoryMocks, generationRepositoryMocks, service, storageMocks } =
      await importGenerationServiceWithMaterializationMocks({
        flowCode: "photo_gpt_image_15_text_to_image",
        providerModel: "gpt-image/1.5-text-to-image",
        requestedOutputFormat: "png",
        resultContentType: "image/png",
        sourceBuffer,
      });

    const response = await service.readGenerationStatus({ userId: "user-1" }, "generation-1");

    expect(response.body.outcome).toBe("generation_failed");
    expect(storageMocks.readGeneratedResultSource).toHaveBeenCalledWith(PROVIDER_RESULT_URL, {
      maxBytes: DEFAULT_GENERATED_RESULT_MAX_BYTES,
    });
    expect(storageMocks.stageManagedAsset).not.toHaveBeenCalled();
    expect(assetRepositoryMocks.insertMaterializedResultAsset).not.toHaveBeenCalled();
    expect(generationRepositoryMocks.markGenerationJobFailedAfterDispatch).toHaveBeenCalledWith(
      expect.anything(),
      "generation-1",
      expect.objectContaining({
        failureCode: "generated_output_unavailable",
      }),
      expect.any(Date),
    );
    expect(generationRepositoryMocks.refundGenerationTokens).toHaveBeenCalled();
  });

  it("materializes a Suno audio result larger than the default image cap", async () => {
    const sourceBuffer = Buffer.alloc(RESULT_LARGER_THAN_DEFAULT_BYTES, 7);
    const { assetRepositoryMocks, kieAdapterMocks, service, storageMocks } =
      await importGenerationServiceWithMaterializationMocks({
        flowCode: "music_suno_base_instrumental_prompt",
        providerModel: "suno/base-generate",
        providerReader: "suno",
        requestedOutputFormat: "mp3",
        resultContentType: "audio/mpeg",
        sourceBuffer,
      });

    const response = await service.readGenerationStatus({ userId: "user-1" }, "generation-1");

    expect(response.body.outcome).toBe("generation_succeeded");
    expect(kieAdapterMocks.readSunoTaskRecord).toHaveBeenCalled();
    expect(storageMocks.readGeneratedResultSource).toHaveBeenCalledWith(PROVIDER_RESULT_URL, {
      maxBytes: SUNO_GENERATED_RESULT_MAX_BYTES,
      timeoutMs: SUNO_GENERATED_RESULT_TIMEOUT_MS,
      maxAttempts: SUNO_GENERATED_RESULT_MAX_ATTEMPTS,
    });
    expect(storageMocks.stageManagedAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "audio/mpeg",
        maxBytes: SUNO_GENERATED_RESULT_MAX_BYTES,
      }),
    );
    expect(assetRepositoryMocks.insertMaterializedResultAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assetType: "audio",
        byteSize: RESULT_LARGER_THAN_DEFAULT_BYTES,
      }),
    );
  });
});
