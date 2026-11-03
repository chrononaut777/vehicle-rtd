import LZString from 'lz-string';
import { normalizeProject, type Project } from '../domain/types';

const PREFIX = '#rtd=';
/** Soft limit — browsers vary; warn above this. */
export const SHARE_URL_SOFT_LIMIT = 12_000;

export function encodeShareHash(project: Project): string {
  const json = JSON.stringify(project);
  const compressed = LZString.compressToEncodedURIComponent(json);
  return `${PREFIX}${compressed}`;
}

export function decodeShareHash(hash: string): Project | null {
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!raw.startsWith('rtd=')) return null;
    const payload = raw.slice(4);
    const json = LZString.decompressFromEncodedURIComponent(payload);
    if (!json) return null;
    const data = JSON.parse(json) as { version?: number };
    if (data.version !== 1 && data.version !== 2) return null;
    return normalizeProject(data);
  } catch {
    return null;
  }
}

export function applyShareToLocation(project: Project): { ok: boolean; length: number } {
  const hash = encodeShareHash(project);
  if (hash.length > SHARE_URL_SOFT_LIMIT) {
    return { ok: false, length: hash.length };
  }
  history.replaceState(null, '', hash);
  return { ok: true, length: hash.length };
}

export function readShareFromLocation(): Project | null {
  return decodeShareHash(window.location.hash);
}
