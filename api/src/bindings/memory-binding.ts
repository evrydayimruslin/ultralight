// RPC Memory Binding for Dynamic Workers
// Wraps user memory (Memory.md) read/write behind a WorkerEntrypoint.

import { WorkerEntrypoint } from "cloudflare:workers";
import type { BillingConfig } from "../../services/billing-config.ts";
import {
  type CloudOperationMeteringContext,
  debitCloudOperation,
} from "../../services/cloud-usage.ts";

// ============================================
// TYPES
// ============================================

interface MemoryBindingProps {
  userId: string;
  operationMetering?: CloudOperationMeteringContext | null;
  operationBillingConfig?:
    | Pick<
      BillingConfig,
      | "version"
      | "cloudUnitLightPer1k"
      | "r2OpsPerCloudUnit"
      | "kvOpsPerCloudUnit"
    >
    | null;
}

// ============================================
// RPC BINDING
// ============================================

export class MemoryBinding
  extends WorkerEntrypoint<unknown, MemoryBindingProps> {
  private getR2Bucket(): R2Bucket {
    return globalThis.__env.R2_BUCKET;
  }

  private async meter(operation: string, units = 1): Promise<void> {
    const metering = this.ctx.props.operationMetering;
    if (!metering) {
      return;
    }

    await debitCloudOperation({
      ...metering,
      resource: "r2_operation",
      operation,
      units,
      billingConfig: this.ctx.props.operationBillingConfig ?? undefined,
      metadata: {
        ...(metering.metadata ?? {}),
        key: this.memoryKey(),
        binding: "MemoryBinding",
      },
    });
  }

  private memoryKey(): string {
    return `users/${this.ctx.props.userId}/memory.md`;
  }

  async remember(key: string, value: unknown): Promise<void> {
    await this.meter("memory.remember", 2);
    const bucket = this.getR2Bucket();
    const memKey = this.memoryKey();

    // Load existing memory
    let memory = "";
    try {
      const obj = await bucket.get(memKey);
      if (obj) memory = await obj.text();
    } catch { /* No existing memory */ }

    // Append or update the key
    const valueStr = typeof value === "string" ? value : JSON.stringify(value);
    const keyPattern = new RegExp(`^## ${key}$[\\s\\S]*?(?=^## |\\Z)`, "gm");

    if (keyPattern.test(memory)) {
      // Update existing section
      memory = memory.replace(keyPattern, `## ${key}\n${valueStr}\n\n`);
    } else {
      // Append new section
      memory += `\n## ${key}\n${valueStr}\n\n`;
    }

    await bucket.put(memKey, memory.trim() + "\n", {
      httpMetadata: { contentType: "text/markdown" },
    });
  }

  async recall(key: string): Promise<unknown> {
    await this.meter("memory.recall");
    const bucket = this.getR2Bucket();
    const memKey = this.memoryKey();

    try {
      const obj = await bucket.get(memKey);
      if (!obj) return null;
      const memory = await obj.text();

      // Find section by key
      const keyPattern = new RegExp(`^## ${key}$([\\s\\S]*?)(?=^## |$)`, "m");
      const match = memory.match(keyPattern);
      if (!match) return null;

      const value = match[1].trim();
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch {
      return null;
    }
  }
}
