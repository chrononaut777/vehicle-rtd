import { describe, expect, it } from 'vitest';
import LZString from 'lz-string';
import {
  createEmptyProject,
  newId,
  type Project,
  type Station,
} from '../domain/types';
import {
  decodeShareHash,
  encodeShareHash,
  packProject,
  unpackProject,
} from './shareUrl';

function sampleProject(): Project {
  const project = createEmptyProject('Test line');
  const a: Station = {
    id: newId('st'),
    name: 'Pickup',
    vehicleType: 'train',
    role: 'pickup',
    x: 100.12,
    y: -200.45,
    z: 50,
    itemsPerMin: 780,
  };
  const b: Station = {
    id: newId('st'),
    name: 'Dropoff',
    vehicleType: 'train',
    role: 'dropoff',
    x: 1500,
    y: 300,
    itemsPerMin: 780,
  };
  const wpId = newId('wp');
  project.stations = [a, b];
  project.routes[0].waypoints = [{ id: wpId, x: 800, y: 50 }];
  project.routes[0].route = [
    { kind: 'station', stationId: a.id },
    { kind: 'waypoint', waypointId: wpId },
    { kind: 'station', stationId: b.id },
  ];
  project.routes[0].flags.cruiseHeight = 400;
  return project;
}

describe('shareUrl compact format', () => {
  it('round-trips pack/unpack', () => {
    const original = sampleProject();
    const again = unpackProject(packProject(original));
    expect(again.name).toBe(original.name);
    expect(again.stations).toHaveLength(2);
    expect(again.stations[0].name).toBe('Pickup');
    expect(again.stations[0].itemsPerMin).toBe(780);
    expect(again.stations[0].x).toBe(100.1);
    expect(again.routes[0].route).toHaveLength(3);
    expect(again.routes[0].waypoints).toHaveLength(1);
    expect(again.routes[0].flags.cruiseHeight).toBe(400);
  });

  it('produces shorter hashes than legacy full-JSON LZ', () => {
    const project = sampleProject();
    const compact = encodeShareHash(project);
    const legacyFull = `#rtd=${LZString.compressToEncodedURIComponent(JSON.stringify(project))}`;

    expect(compact.startsWith('#r2=')).toBe(true);
    expect(compact.length).toBeLessThan(legacyFull.length * 0.75);

    const decoded = decodeShareHash(compact);
    expect(decoded?.stations[0].name).toBe('Pickup');
  });

  it('still decodes legacy #rtd= payloads', () => {
    const project = sampleProject();
    const hash = `#rtd=${LZString.compressToEncodedURIComponent(JSON.stringify(project))}`;
    const decoded = decodeShareHash(hash);
    expect(decoded?.name).toBe('Test line');
    expect(decoded?.stations).toHaveLength(2);
  });
});
