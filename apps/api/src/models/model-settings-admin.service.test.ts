import { describe, expect, it } from "vitest";

import {
  shouldPersistModelCapabilities,
  shouldResetModelCapabilitiesForUpdate
} from "./model-settings-admin.service";

describe("ModelSettingsAdminService capability decisions", () => {
  it("persists capabilities only for successful non-transient provider detections", () => {
    expect(
      shouldPersistModelCapabilities("embedding", false, {
        ok: true,
        capabilities_detected: true,
        capabilities: { input_modalities: ["text"] }
      })
    ).toBe(true);

    expect(
      shouldPersistModelCapabilities("embedding", false, {
        ok: false,
        capabilities_detected: true,
        capabilities: { input_modalities: ["text"] }
      })
    ).toBe(false);
    expect(
      shouldPersistModelCapabilities("embedding", false, {
        ok: true,
        capabilities_detected: false,
        capabilities: { input_modalities: ["text"] }
      })
    ).toBe(false);
    expect(
      shouldPersistModelCapabilities("embedding", true, {
        ok: true,
        capabilities_detected: true,
        capabilities: { input_modalities: ["text"] }
      })
    ).toBe(false);
    expect(
      shouldPersistModelCapabilities("language", false, {
        ok: true,
        capabilities_detected: true,
        capabilities: { input_modalities: ["text"] }
      })
    ).toBe(false);
  });

  it("resets embedding capability snapshots when model identity changes", () => {
    const existing = {
      provider: "openai_compatible",
      endpoint: "http://old/v1/embeddings",
      model: "old-model",
      enabled: true,
      embedding_dim: 768
    };

    expect(
      shouldResetModelCapabilitiesForUpdate(
        "embedding",
        existing,
        {
          provider: "openai_compatible",
          endpoint: "http://new/v1/embeddings",
          model: "old-model",
          enabled: true,
          timeout_ms: 30_000,
          embedding_dim: 768,
          embedding_batch_size: 32,
          llm_temperature: null,
          llm_max_output_tokens: null
        },
        false
      )
    ).toBe(true);

    expect(
      shouldResetModelCapabilitiesForUpdate(
        "embedding",
        existing,
        {
          provider: "openai_compatible",
          endpoint: "http://old/v1/embeddings",
          model: "old-model",
          enabled: true,
          timeout_ms: 60_000,
          embedding_dim: 768,
          embedding_batch_size: 64,
          llm_temperature: null,
          llm_max_output_tokens: null
        },
        false
      )
    ).toBe(false);

    expect(
      shouldResetModelCapabilitiesForUpdate(
        "embedding",
        existing,
        {
          provider: "openai_compatible",
          endpoint: "http://old/v1/embeddings",
          model: "old-model",
          enabled: true,
          timeout_ms: 30_000,
          embedding_dim: 768,
          embedding_batch_size: 32,
          llm_temperature: null,
          llm_max_output_tokens: null
        },
        true
      )
    ).toBe(true);
  });
});
