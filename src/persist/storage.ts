import { get, set } from 'idb-keyval';
import {
  createEmptyProject,
  normalizeProject,
  type Project,
} from '../domain/types';

const KEY = 'map-rtd:project:v1';

function isSupportedVersion(version: unknown): boolean {
  return version === 1 || version === 2;
}

export async function loadProject(): Promise<Project> {
  try {
    const data = await get(KEY);
    if (data && typeof data === 'object' && isSupportedVersion((data as Project).version)) {
      return normalizeProject(data);
    }
  } catch {
    // ignore
  }
  return createEmptyProject();
}

export async function saveProject(project: Project): Promise<void> {
  await set(KEY, project);
}

export function exportProjectJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function importProjectJson(text: string): Project {
  const data = JSON.parse(text) as Record<string, unknown>;
  if (!data || !isSupportedVersion(data.version)) {
    // Also accept unversioned / legacy blobs that look like a project
    if (!Array.isArray(data?.stations)) {
      throw new Error('Unsupported project file');
    }
  }
  if (!Array.isArray(data.stations)) {
    throw new Error('Invalid project structure');
  }
  // v1 has top-level route; v2 has routes[]
  if (!Array.isArray(data.routes) && !Array.isArray(data.route)) {
    throw new Error('Invalid project structure');
  }
  return normalizeProject(data);
}

export function downloadJson(project: Project, filename = 'satisfactory-route.json') {
  const blob = new Blob([exportProjectJson(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
