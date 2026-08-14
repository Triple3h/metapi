import { describe, expect, it } from 'vitest';

import { buildUpstreamUrl } from './upstreamRequest.js';

describe('buildUpstreamUrl', () => {
  it('joins plain bases with versioned request paths', () => {
    expect(buildUpstreamUrl('https://api.openai.com', '/v1/chat/completions'))
      .toBe('https://api.openai.com/v1/chat/completions');
    expect(buildUpstreamUrl('https://api.openai.com/', '/v1/responses'))
      .toBe('https://api.openai.com/v1/responses');
  });

  it('keeps the version segment for v1-suffixed bases', () => {
    expect(buildUpstreamUrl('https://api.deepseek.com/v1', '/v1/chat/completions'))
      .toBe('https://api.deepseek.com/v1/chat/completions');
    expect(buildUpstreamUrl('https://api.deepseek.com/v1', '/v1'))
      .toBe('https://api.deepseek.com/v1');
    expect(buildUpstreamUrl('https://api.deepseek.com/v1', '/models'))
      .toBe('https://api.deepseek.com/v1/models');
  });

  it('joins v1 request paths onto newer versioned bases without duplicating versions', () => {
    expect(buildUpstreamUrl('https://ark.cn-beijing.volces.com/api/plan/v3', '/v1/responses'))
      .toBe('https://ark.cn-beijing.volces.com/api/plan/v3/responses');
    expect(buildUpstreamUrl('https://ark.cn-beijing.volces.com/api/coding/v3', '/v1/chat/completions'))
      .toBe('https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions');
    expect(buildUpstreamUrl('https://open.bigmodel.cn/api/coding/paas/v4', '/v1/chat/completions'))
      .toBe('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions');
    expect(buildUpstreamUrl('https://open.bigmodel.cn/api/coding/paas/v4', '/v1'))
      .toBe('https://open.bigmodel.cn/api/coding/paas/v4');
  });

  it('supports beta-suffixed bases and paths', () => {
    expect(buildUpstreamUrl('https://generativelanguage.googleapis.com/v1beta', '/v1beta/openai/responses'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/responses');
    expect(buildUpstreamUrl('https://generativelanguage.googleapis.com', '/v1beta/openai/chat/completions'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  });

  it('strips version-looking request path prefixes against versioned bases', () => {
    expect(buildUpstreamUrl('https://api.example.com/v1', '/v10/chat/completions'))
      .toBe('https://api.example.com/v1/chat/completions');
    expect(buildUpstreamUrl('https://api.example.com/vision', '/v1/chat/completions'))
      .toBe('https://api.example.com/vision/v1/chat/completions');
  });

  it('falls back to raw concatenation for unparsable bases', () => {
    expect(buildUpstreamUrl('not a url://weird/v1', '/v1/models'))
      .toBe('not a url://weird/v1/models');
    expect(buildUpstreamUrl('https://example.com/base', '/responses'))
      .toBe('https://example.com/base/responses');
  });
});
