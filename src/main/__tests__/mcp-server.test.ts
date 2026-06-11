import { describe, it, expect } from 'vitest';
import { matchMcpRoute, matchNotifyHookRoute } from '../mcp-server.js';

describe('matchMcpRoute', () => {
  it('matches the project-scoped route', () => {
    expect(matchMcpRoute('/mcp/proj-1')).toEqual({
      projectId: 'proj-1',
      sessionId: undefined
    });
  });

  it('matches the session-scoped route', () => {
    expect(matchMcpRoute('/mcp/proj-1/sess-A')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A'
    });
  });

  it('ignores query strings when matching', () => {
    expect(matchMcpRoute('/mcp/proj-1/sess-A?foo=bar')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A'
    });
  });

  it('url-decodes captured segments', () => {
    expect(matchMcpRoute('/mcp/proj%2F1/sess%20A')).toEqual({
      projectId: 'proj/1',
      sessionId: 'sess A'
    });
  });

  it('rejects extra path segments', () => {
    expect(matchMcpRoute('/mcp/proj-1/sess-A/extra')).toBeNull();
  });

  it('rejects a bare /mcp with no project', () => {
    expect(matchMcpRoute('/mcp')).toBeNull();
    expect(matchMcpRoute('/mcp/')).toBeNull();
  });

  it('rejects unrelated paths and undefined input', () => {
    expect(matchMcpRoute('/health')).toBeNull();
    expect(matchMcpRoute(undefined)).toBeNull();
  });
});

describe('matchNotifyHookRoute', () => {
  it('matches the blocked action', () => {
    expect(matchNotifyHookRoute('/hook/notify/proj-1/sess-A/blocked')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A',
      action: 'blocked'
    });
  });

  it('matches the unblocked action', () => {
    expect(matchNotifyHookRoute('/hook/notify/proj-1/sess-A/unblocked')).toEqual({
      projectId: 'proj-1',
      sessionId: 'sess-A',
      action: 'unblocked'
    });
  });

  it('url-decodes captured ids and ignores query strings', () => {
    expect(matchNotifyHookRoute('/hook/notify/proj%2F1/sess%20A/blocked?x=1')).toEqual({
      projectId: 'proj/1',
      sessionId: 'sess A',
      action: 'blocked'
    });
  });

  it('rejects unknown actions and malformed paths', () => {
    expect(matchNotifyHookRoute('/hook/notify/proj-1/sess-A/paused')).toBeNull();
    expect(matchNotifyHookRoute('/hook/notify/proj-1/sess-A')).toBeNull();
    expect(matchNotifyHookRoute('/hook/notify/proj-1/sess-A/blocked/extra')).toBeNull();
    expect(matchNotifyHookRoute('/hook/stop/proj-1/sess-A')).toBeNull();
    expect(matchNotifyHookRoute(undefined)).toBeNull();
  });
});
