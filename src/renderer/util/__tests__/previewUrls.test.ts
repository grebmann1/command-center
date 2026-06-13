import { describe, it, expect } from 'vitest';
import {
  groupDetectedUrls,
  primaryPreviewUrl,
  type DetectedUrl
} from '../previewUrls.js';

function d(url: string, fromTabTitle = 'tab'): DetectedUrl {
  return { url, fromTabTitle };
}

describe('groupDetectedUrls', () => {
  it('collapses many paths on one host into a single origin group', () => {
    const grouped = groupDetectedUrls([
      d('http://localhost:3000/dashboard'),
      d('http://localhost:3000/api/health'),
      d('http://localhost:3000/'),
      d('http://localhost:3000/assets/app.js')
    ]);
    expect(grouped.local).toHaveLength(1);
    expect(grouped.local[0].origin).toBe('http://localhost:3000');
    expect(grouped.local[0].display).toBe('localhost:3000');
    expect(grouped.local[0].paths.map((p) => p.label)).toEqual([
      '/dashboard',
      '/api/health',
      '/',
      '/assets/app.js'
    ]);
  });

  it('preserves freshest-first ordering of paths', () => {
    const grouped = groupDetectedUrls([
      d('http://localhost:3000/newest'),
      d('http://localhost:3000/older')
    ]);
    expect(grouped.local[0].paths[0].url).toBe('http://localhost:3000/newest');
  });

  it('dedupes identical full URLs but keeps distinct paths', () => {
    const grouped = groupDetectedUrls([
      d('http://localhost:3000/a'),
      d('http://localhost:3000/a'),
      d('http://localhost:3000/b')
    ]);
    expect(grouped.local[0].paths).toHaveLength(2);
  });

  it('separates local from remote origins', () => {
    const grouped = groupDetectedUrls([
      d('http://localhost:5173/'),
      d('https://github.com/foo/bar'),
      d('https://docs.example.com/guide')
    ]);
    expect(grouped.local.map((g) => g.display)).toEqual(['localhost:5173']);
    expect(grouped.remote.map((g) => g.display).sort()).toEqual([
      'docs.example.com',
      'github.com'
    ]);
  });

  it('treats LAN IPs as local', () => {
    const grouped = groupDetectedUrls([
      d('http://192.168.1.20:8080/'),
      d('http://10.0.0.5:3000/'),
      d('http://172.16.5.5:3000/'),
      d('http://8.8.8.8/')
    ]);
    expect(grouped.local).toHaveLength(3);
    expect(grouped.remote.map((g) => g.display)).toEqual(['8.8.8.8']);
  });

  it('ranks true localhost dev port above LAN and non-dev ports', () => {
    const grouped = groupDetectedUrls([
      d('http://192.168.1.20:9999/'),
      d('http://localhost:3000/')
    ]);
    expect(grouped.local[0].display).toBe('localhost:3000');
  });

  it('ignores unparseable and non-http URLs', () => {
    const grouped = groupDetectedUrls([
      d('not a url'),
      d('ftp://localhost/x'),
      d('http://localhost:3000/')
    ]);
    expect(grouped.local).toHaveLength(1);
    expect(grouped.remote).toHaveLength(0);
  });

  it('keeps query strings as part of the path label', () => {
    const grouped = groupDetectedUrls([d('http://localhost:3000/search?q=hi')]);
    expect(grouped.local[0].paths[0].label).toBe('/search?q=hi');
  });
});

describe('primaryPreviewUrl', () => {
  it('returns the freshest path of the top-ranked local origin', () => {
    const grouped = groupDetectedUrls([
      d('https://github.com/x'),
      d('http://localhost:5173/dashboard'),
      d('http://localhost:5173/api')
    ]);
    expect(primaryPreviewUrl(grouped)).toBe('http://localhost:5173/dashboard');
  });

  it('returns null when no local origin exists', () => {
    const grouped = groupDetectedUrls([d('https://github.com/x')]);
    expect(primaryPreviewUrl(grouped)).toBeNull();
  });
});
