import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildProxyBillingDetails,
  calculateModelUsageBreakdown,
  calculateModelUsageCost,
  fallbackTokenCost,
  type PricingModel,
} from './modelPricingService.js';

const pricingFetchMock = vi.fn();

vi.mock('undici', () => ({
  fetch: (url: string, init?: { headers?: Record<string, string> }) =>
    pricingFetchMock(url, init),
}));

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function notFoundResponse() {
  return {
    ok: false,
    status: 404,
    json: async () => null,
  };
}

describe('modelPricingService', () => {
  beforeEach(() => {
    pricingFetchMock.mockReset();
  });
  it('calculates token-based cost from model ratio and completion ratio', () => {
    const model: PricingModel = {
      modelName: 'gpt-4o',
      quotaType: 0,
      modelRatio: 2,
      completionRatio: 1.5,
      modelPrice: null,
      enableGroups: ['vip'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      },
      { default: 1, vip: 2 },
    );

    expect(cost).toBe(0.014);
  });

  it('falls back to total tokens when split token usage is missing', () => {
    const model: PricingModel = {
      modelName: 'claude-sonnet',
      quotaType: 0,
      modelRatio: 1,
      completionRatio: 2,
      modelPrice: null,
      enableGroups: ['default'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 2000,
      },
      { default: 1 },
    );

    expect(cost).toBe(0.004);
  });

  it('calculates per-call cost when quota type is call-based', () => {
    const model: PricingModel = {
      modelName: 'gpt-image-1',
      quotaType: 1,
      modelRatio: 1,
      completionRatio: 1,
      modelPrice: 0.3,
      enableGroups: ['vip'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      { default: 1, vip: 1.5 },
    );

    expect(cost).toBe(0.45);
  });

  it('calculates times-based per-call cost from input ratio only', () => {
    const model: PricingModel = {
      modelName: 'flux-kontext-pro',
      quotaType: 1,
      modelRatio: 1,
      completionRatio: 1,
      modelPrice: { input: 1, output: 3 },
      enableGroups: ['vip'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      { default: 1, vip: 2 },
    );

    expect(cost).toBe(0.004);
  });

  it('splits cache read and cache creation costs from prompt cost', () => {
    const model: PricingModel = {
      modelName: 'gpt-4o',
      quotaType: 0,
      modelRatio: 2.5,
      completionRatio: 5,
      cacheRatio: 0.1,
      cacheCreationRatio: 1.25,
      modelPrice: null,
      enableGroups: ['default'],
    };

    const detail = calculateModelUsageBreakdown(
      model,
      {
        promptTokens: 146638,
        completionTokens: 172,
        totalTokens: 146810,
        cacheReadTokens: 145692,
        cacheCreationTokens: 945,
        promptTokensIncludeCache: true,
      },
      { default: 1 },
    );

    expect(detail).toMatchObject({
      usage: {
        billablePromptTokens: 1,
        cacheReadTokens: 145692,
        cacheCreationTokens: 945,
      },
      pricing: {
        modelRatio: 2.5,
        completionRatio: 5,
        cacheRatio: 0.1,
        cacheCreationRatio: 1.25,
        groupRatio: 1,
      },
      breakdown: {
        inputPerMillion: 5,
        outputPerMillion: 25,
        cacheReadPerMillion: 0.5,
        cacheCreationPerMillion: 6.25,
        inputCost: 0.000005,
        outputCost: 0.0043,
        cacheReadCost: 0.072846,
        cacheCreationCost: 0.005906,
        totalCost: 0.083057,
      },
    });
  });

  it('keeps prompt tokens intact when upstream reports cache tokens separately', () => {
    const model: PricingModel = {
      modelName: 'claude-sonnet',
      quotaType: 0,
      modelRatio: 3,
      completionRatio: 5,
      cacheRatio: 0.3,
      cacheCreationRatio: 1.25,
      modelPrice: null,
      enableGroups: ['default'],
    };

    const cost = calculateModelUsageCost(
      model,
      {
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        cacheReadTokens: 1000,
        cacheCreationTokens: 40,
        promptTokensIncludeCache: false,
      },
      { default: 1 },
    );

    expect(cost).toBe(0.00372);
  });

  it('uses platform-specific fallback token divisor', () => {
    expect(fallbackTokenCost(1500, 'new-api')).toBe(0.003);
    expect(fallbackTokenCost(1500, 'veloera')).toBe(0.0015);
  });

  it('builds a pricingless billing detail when the upstream has no pricing data', async () => {
    pricingFetchMock.mockImplementation(async () => notFoundResponse());

    const detail = await buildProxyBillingDetails({
      site: { id: 901, url: 'https://ark.example.com/api/plan/v3', platform: 'responses' },
      account: { id: 901, accessToken: 'sk-test' },
      modelName: 'deepseek-v4-flash',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cacheReadTokens: 300,
      cacheCreationTokens: 100,
      promptTokensIncludeCache: true,
    });

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      quotaType: 0,
      usage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cacheReadTokens: 300,
        cacheCreationTokens: 100,
      },
      pricing: {
        modelRatio: 1,
        completionRatio: 1,
        cacheRatio: 1,
        cacheCreationRatio: 1,
        groupRatio: 1,
      },
      breakdown: {
        inputPerMillion: 0,
        outputPerMillion: 0,
        cacheReadPerMillion: 0,
        cacheCreationPerMillion: 0,
        inputCost: 0,
        outputCost: 0,
        cacheReadCost: 0,
        cacheCreationCost: 0,
        totalCost: 0,
      },
    });
  });

  it('builds a pricingless billing detail for per-call (quotaType 1) models', async () => {
    pricingFetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/pricing')) {
        return jsonResponse([
          {
            model_name: 'gpt-image-1',
            quota_type: 1,
            model_price: 0.3,
            enable_groups: ['default'],
          },
        ]);
      }
      return notFoundResponse();
    });

    const detail = await buildProxyBillingDetails({
      site: { id: 902, url: 'https://one.example.com', platform: 'one-hub' },
      account: { id: 902, accessToken: 'sk-test' },
      modelName: 'gpt-image-1',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 40,
      cacheCreationTokens: 0,
      promptTokensIncludeCache: null,
    });

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      quotaType: 0,
      usage: {
        cacheReadTokens: 40,
        cacheCreationTokens: 0,
      },
      breakdown: {
        inputPerMillion: 0,
        outputPerMillion: 0,
        totalCost: 0,
      },
    });
  });
});
