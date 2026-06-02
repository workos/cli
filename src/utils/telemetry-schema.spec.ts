import { describe, it, expect } from 'vitest';
import { z } from 'zod';

/**
 * Mirror of the API's Zod discriminated union schema.
 * These tests validate that the schema shape preserves top-level fields
 * (not stripped by safeParse) and accepts all 7 event types.
 * This ensures CLI and API stay in sync.
 */

const attributesSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional();

const baseFields = {
  sessionId: z.string(),
  timestamp: z.string(),
  attributes: attributesSchema,
};

const SessionStartSchema = z.object({ type: z.literal('session.start'), ...baseFields }).passthrough();

const SessionEndSchema = z.object({ type: z.literal('session.end'), ...baseFields }).passthrough();

const StepSchema = z
  .object({
    type: z.literal('step'),
    ...baseFields,
    name: z.string(),
    startTimestamp: z.string().optional(),
    durationMs: z.number(),
    success: z.boolean(),
    error: z.object({ type: z.string(), message: z.string() }).optional(),
  })
  .passthrough();

const AgentToolSchema = z
  .object({
    type: z.literal('agent.tool'),
    ...baseFields,
    toolName: z.string(),
    startTimestamp: z.string().optional(),
    durationMs: z.number(),
    success: z.boolean(),
  })
  .passthrough();

const AgentLlmSchema = z
  .object({
    type: z.literal('agent.llm'),
    ...baseFields,
    model: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
  })
  .passthrough();

const CommandSchema = z.object({ type: z.literal('command'), ...baseFields }).passthrough();

const CrashSchema = z.object({ type: z.literal('crash'), ...baseFields }).passthrough();

const TelemetryEventSchema = z.discriminatedUnion('type', [
  SessionStartSchema,
  SessionEndSchema,
  StepSchema,
  AgentToolSchema,
  AgentLlmSchema,
  CommandSchema,
  CrashSchema,
]);

describe('TelemetryEventSchema (discriminated union)', () => {
  const base = { sessionId: 'sess-1', timestamp: '2024-01-01T00:00:00Z' };

  describe('accepts all 7 event types', () => {
    it('accepts session.start', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'session.start',
        ...base,
        attributes: { 'installer.version': '1.0.0' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts session.end', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'session.end',
        ...base,
        attributes: { 'installer.outcome': 'success' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts step', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'step',
        ...base,
        name: 'detect',
        startTimestamp: '2024-01-01T00:00:00Z',
        durationMs: 100,
        success: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts agent.tool', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'agent.tool',
        ...base,
        toolName: 'Write',
        startTimestamp: '2024-01-01T00:00:00Z',
        durationMs: 50,
        success: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts agent.llm', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'agent.llm',
        ...base,
        model: 'claude',
        inputTokens: 100,
        outputTokens: 50,
      });
      expect(result.success).toBe(true);
    });

    it('accepts command', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'command',
        ...base,
        attributes: { 'command.name': 'org.list' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts crash', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'crash',
        ...base,
        attributes: { 'crash.error_type': 'Error' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('preserves top-level fields via .passthrough()', () => {
    it('preserves name and durationMs on step events', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'step',
        ...base,
        name: 'detect',
        durationMs: 100,
        success: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('name', 'detect');
        expect(result.data).toHaveProperty('durationMs', 100);
      }
    });

    it('preserves toolName on agent.tool events', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'agent.tool',
        ...base,
        toolName: 'Write',
        durationMs: 50,
        success: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('toolName', 'Write');
      }
    });

    it('preserves model, inputTokens, outputTokens on agent.llm events', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'agent.llm',
        ...base,
        model: 'claude',
        inputTokens: 100,
        outputTokens: 50,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('model', 'claude');
        expect(result.data).toHaveProperty('inputTokens', 100);
        expect(result.data).toHaveProperty('outputTokens', 50);
      }
    });

    it('preserves startTimestamp on step events', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'step',
        ...base,
        name: 'detect',
        startTimestamp: '2024-01-01T00:00:00Z',
        durationMs: 100,
        success: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty('startTimestamp', '2024-01-01T00:00:00Z');
      }
    });
  });

  describe('backward compatibility', () => {
    it('accepts step event without startTimestamp', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'step',
        ...base,
        name: 'detect',
        durationMs: 100,
        success: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts agent.tool event without startTimestamp', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'agent.tool',
        ...base,
        toolName: 'Write',
        durationMs: 50,
        success: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('rejects invalid events', () => {
    it('rejects events with unknown type', () => {
      const result = TelemetryEventSchema.safeParse({
        type: 'unknown',
        ...base,
      });
      expect(result.success).toBe(false);
    });

    it('rejects events without type', () => {
      const result = TelemetryEventSchema.safeParse({
        ...base,
      });
      expect(result.success).toBe(false);
    });
  });
});
