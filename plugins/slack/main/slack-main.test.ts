/**
 * Tests for slack main module — notification formatting and fetch logic.
 */

import { describe, it, expect, vi } from 'vitest';
import type { MainModuleContext, BrokeredFetchResponse } from '@cctc/extension-sdk/main';
import { slackMainModule } from './slack-main.js';
import { DEFAULT_SLACK_CONFIG } from '../shared/types.js';

describe('slack main module', () => {
  it('exports a MainModule with id "slack"', () => {
    expect(slackMainModule.id).toBe('slack');
    expect(typeof slackMainModule.setup).toBe('function');
  });

  it('notify sends via webhook when configured', async () => {
    const mockFetch = vi.fn<
      Parameters<NonNullable<MainModuleContext['fetch']>>,
      Promise<BrokeredFetchResponse>
    >();
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: {},
      body: 'ok'
    });

    const mockStorage = {
      get: vi.fn().mockResolvedValue({
        ...DEFAULT_SLACK_CONFIG,
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL'
      }),
      set: vi.fn()
    };

    const ctx: MainModuleContext = {
      storage: mockStorage,
      log: vi.fn(),
      fetch: mockFetch
    };

    const caps = await slackMainModule.setup(ctx);
    const result = await caps.notify('Test notification');

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('https://hooks.slack.com/services/TEST/WEBHOOK/URL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test notification' })
    });
  });

  it('notify fails gracefully when webhook returns non-200', async () => {
    const mockFetch = vi.fn<
      Parameters<NonNullable<MainModuleContext['fetch']>>,
      Promise<BrokeredFetchResponse>
    >();
    mockFetch.mockResolvedValue({
      status: 500,
      ok: false,
      headers: {},
      body: 'Internal Server Error'
    });

    const mockStorage = {
      get: vi.fn().mockResolvedValue({
        ...DEFAULT_SLACK_CONFIG,
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL'
      }),
      set: vi.fn()
    };

    const ctx: MainModuleContext = {
      storage: mockStorage,
      log: vi.fn(),
      fetch: mockFetch
    };

    const caps = await slackMainModule.setup(ctx);
    const result = await caps.notify('Test notification');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  it('notify rejects empty messages', async () => {
    const ctx: MainModuleContext = {
      storage: { get: vi.fn(), set: vi.fn() },
      log: vi.fn(),
      fetch: vi.fn()
    };

    const caps = await slackMainModule.setup(ctx);
    const result = await caps.notify('');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Empty message');
  });

  it('testConnection sends a ping message', async () => {
    const mockFetch = vi.fn<
      Parameters<NonNullable<MainModuleContext['fetch']>>,
      Promise<BrokeredFetchResponse>
    >();
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: {},
      body: 'ok'
    });

    const mockStorage = {
      get: vi.fn().mockResolvedValue({
        ...DEFAULT_SLACK_CONFIG,
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL'
      }),
      set: vi.fn()
    };

    const ctx: MainModuleContext = {
      storage: mockStorage,
      log: vi.fn(),
      fetch: mockFetch
    };

    const caps = await slackMainModule.setup(ctx);
    const result = await caps.testConnection();

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
      expect.objectContaining({
        method: 'POST'
      })
    );
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1]?.body ?? '{}');
    expect(body.text).toContain('test notification');
  });

  it('throws when ctx.fetch is unavailable', async () => {
    const ctx: MainModuleContext = {
      storage: { get: vi.fn(), set: vi.fn() },
      log: vi.fn()
      // no fetch capability
    };

    await expect(() => slackMainModule.setup(ctx)).toThrow('ctx.fetch capability is unavailable');
  });
});
