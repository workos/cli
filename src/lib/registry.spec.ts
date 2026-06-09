import { describe, it, expect, beforeEach } from 'vitest';
import { buildRegistry, getRegistry, resetRegistry } from './registry.js';
import { integrationLoaders } from '../integrations/_manifest.js';

const EXPECTED_COUNT = Object.keys(integrationLoaders).length;

describe('buildRegistry', () => {
  beforeEach(() => resetRegistry());

  it('registers every integration in the manifest', async () => {
    const registry = await buildRegistry();
    expect(registry.all()).toHaveLength(EXPECTED_COUNT);
  });

  it('exposes choices as {name, value} pairs for every integration', async () => {
    const registry = await buildRegistry();
    const choices = registry.choices();
    expect(choices).toHaveLength(EXPECTED_COUNT);
    for (const choice of choices) {
      expect(choice.name).toBeTruthy();
      expect(choice.value).toBeTruthy();
    }
  });

  it('get() round-trips a registered integration by name', async () => {
    const registry = await buildRegistry();
    const first = registry.choices()[0]!;
    const mod = registry.get(first.value);
    expect(mod).toBeDefined();
    expect(typeof mod!.run).toBe('function');
    expect(mod!.config.metadata.integration).toBe(first.value);
  });

  it('orders integrations by priority descending', async () => {
    const registry = await buildRegistry();
    const priorities = registry.detectionOrder().map((c) => c.metadata.priority);
    const sorted = [...priorities].sort((a, b) => b - a);
    expect(priorities).toEqual(sorted);
  });

  it('getRegistry() caches a single instance', async () => {
    const a = await getRegistry();
    const b = await getRegistry();
    expect(a).toBe(b);
  });
});
