import { describe, it, expect } from 'vitest';
import { matchMcpRoute } from '../mcp-server.js';

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
