import {
  stationsOnRoute,
  type RouteNode,
  type RouteSimInput,
  type Station,
  type TrainConsist,
} from '../domain/types';
import {
  CARS_PER_LOCOMOTIVE,
  carCapacityItems,
  platformBeltCeiling,
  type BeltMk,
} from './belts';

export interface StationPlatforms {
  /**
   * Platforms to build here: full dock, or more if belts need a longer station.
   */
  platforms: number;
  /** Freight-car dock length from route consist sizing. */
  dockPlatforms: number;
  /** Platforms this stop uses (exclusive full cars + any shared partials). */
  loadingPlatforms: number;
  /** Whole cars reserved only for this station. */
  exclusiveCars: number;
  /** 1-based inclusive exclusive car range, if any. */
  exclusiveRange: { from: number; to: number } | null;
  /** 1-based car indices shared (partial fill) with other stations. */
  sharedCars: number[];
  /** This station's fill fraction of each shared car (0–1). */
  partialFraction: number;
  /** Peer station names sharing those partial cars. */
  sharedWith: string[];
  /** Dual-port belt capacity needed for this station's items/min. */
  beltPlatforms: number;
  /** True when belts need more platforms than the train dock. */
  beltBound: boolean;
  /** Short human summary of the car split. */
  breakdown: string;
}

export interface ConsistSizing {
  freightCars: number;
  locomotives: number;
  /** Freight platforms needed at each cargo station (= cars). */
  platforms: number;
  fillFraction: number;
  itemsPerTrip: number;
  carCapacity: number;
  /** Governing station throughput used (items/min). */
  targetItemsPerMin: number;
  /** True when target exceeds dual-belt ceiling × cars for station belt mk. */
  warnings: string[];
}

/** Throughput target from stations linked on this route (falls back to all). */
export function resolveTargetItemsPerMin(input: RouteSimInput): number {
  const linked = stationsOnRoute(input.stations, input.route);
  const pool = linked.length > 0 ? linked : input.stations;
  let max = 0;
  for (const s of pool) {
    if (s.role === 'passthrough') continue;
    if (s.itemsPerMin != null && s.itemsPerMin > max) max = s.itemsPerMin;
  }
  return max;
}

/**
 * Wiki: n_cars = ceil(T_desired × t_round_trip / V_cargo)
 * with T in items/s → itemsPerMin/60.
 * Fill % = needed / (cars × capacity) after rounding cars up.
 * Engines = ceil(cars / 3) (1:3 ratio).
 */
export function sizeConsistFromThroughput(
  input: RouteSimInput,
  roundTripSeconds: number,
): ConsistSizing | null {
  const targetItemsPerMin = resolveTargetItemsPerMin(input);
  if (targetItemsPerMin <= 0 || !(roundTripSeconds > 0)) return null;

  const stackSize = input.cargo?.stackSize ?? 100;
  const carCapacity = carCapacityItems(stackSize);
  const itemsPerTrip = (targetItemsPerMin * roundTripSeconds) / 60;

  const freightCars = Math.max(1, Math.ceil(itemsPerTrip / carCapacity));
  const locomotives = Math.max(1, Math.ceil(freightCars / CARS_PER_LOCOMOTIVE));
  const platforms = freightCars;
  const fillFraction = Math.min(1, itemsPerTrip / (freightCars * carCapacity));

  const linked = stationsOnRoute(input.stations, input.route);
  const pool = linked.length > 0 ? linked : input.stations;
  const mk = (input.cargo.beltMk ?? 5) as BeltMk;
  const warnings: string[] = [];
  for (const s of pool) {
    if (s.role === 'passthrough') continue;
    if (s.itemsPerMin == null || s.itemsPerMin <= 0) continue;
    const ceiling = platformBeltCeiling(mk) * freightCars;
    if (s.itemsPerMin > ceiling + 1e-6) {
      warnings.push(
        `${s.name}: ${s.itemsPerMin}/min exceeds ~${Math.round(ceiling)}/min with ${freightCars}× dual Mk.${mk} platform ports.`,
      );
    }
  }

  return {
    freightCars,
    locomotives,
    platforms,
    fillFraction,
    itemsPerTrip,
    carCapacity,
    targetItemsPerMin,
    warnings,
  };
}

export function applySizingToConsist(sizing: ConsistSizing): TrainConsist {
  return {
    locomotives: sizing.locomotives,
    freightCars: sizing.freightCars,
    fillFraction: sizing.fillFraction,
  };
}

export function consistChanged(a: TrainConsist, b: TrainConsist): boolean {
  return (
    a.locomotives !== b.locomotives ||
    a.freightCars !== b.freightCars ||
    Math.abs(a.fillFraction - b.fillFraction) > 0.001
  );
}

const EPS = 1e-9;

function formatCarList(cars1Based: number[]): string {
  if (cars1Based.length === 0) return '';
  const sorted = [...cars1Based].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  const flush = () => {
    parts.push(start === prev ? `car ${start}` : `cars ${start}–${prev}`);
  };
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    flush();
    start = sorted[i];
    prev = sorted[i];
  }
  flush();
  return parts.join(', ');
}

function isLoadPeer(s: Station): boolean {
  return (
    s.vehicleType !== 'drone' &&
    (s.role === 'pickup' || s.role === 'both') &&
    s.itemsPerMin != null &&
    s.itemsPerMin > 0
  );
}

function isUnloadPeer(s: Station): boolean {
  return (
    s.vehicleType !== 'drone' &&
    (s.role === 'dropoff' || s.role === 'both') &&
    s.itemsPerMin != null &&
    s.itemsPerMin > 0
  );
}

/**
 * Same-flow peers in route order, starting just after the first opposite-role
 * stop (after drop for pickups, after pickup for dropoffs), wrapping the list.
 * Shared partial cars may still combine across this order in allocateStationCars.
 */
export function peersForFlow(
  station: Station,
  stations: Station[],
  route: RouteNode[],
): Station[] {
  const loading = station.role !== 'dropoff';
  const isPeer = loading ? isLoadPeer : isUnloadPeer;
  const isPivot = loading
    ? (s: Station) => s.role === 'dropoff' || s.role === 'both'
    : (s: Station) => s.role === 'pickup' || s.role === 'both';

  const byId = new Map(stations.map((s) => [s.id, s]));
  const seq: Station[] = [];
  for (const node of route) {
    if (node.kind !== 'station') continue;
    const s = byId.get(node.stationId);
    if (s) seq.push(s);
  }
  if (seq.length === 0) return [];

  let pivotIdx = -1;
  for (let i = 0; i < seq.length; i++) {
    if (isPivot(seq[i])) {
      pivotIdx = i;
      break;
    }
  }

  const ordered: Station[] = [];
  const seen = new Set<string>();
  const start = pivotIdx >= 0 ? pivotIdx + 1 : 0;
  for (let k = 0; k < seq.length; k++) {
    const s = seq[(start + k) % seq.length];
    if (!isPeer(s) || seen.has(s.id)) continue;
    ordered.push(s);
    seen.add(s.id);
  }
  return ordered;
}

/**
 * Split dock cars across same-flow peers (pickups or dropoffs).
 * Each station gets floor(share) exclusive cars first; fractional remainders
 * are bin-packed into shared cars so partials can share a container.
 */
export function allocateStationCars(
  peers: Station[],
  dockPlatforms: number,
): Map<string, {
  exclusiveCars: number;
  exclusiveRange: { from: number; to: number } | null;
  sharedCars: number[];
  partialFraction: number;
  sharedWith: string[];
  loadingPlatforms: number;
  breakdown: string;
}> {
  const out = new Map();
  const dock = Math.max(1, Math.ceil(dockPlatforms));
  const active = peers.filter(
    (s) => s.itemsPerMin != null && s.itemsPerMin > 0,
  );
  if (active.length === 0) return out;

  const sum = active.reduce((a, s) => a + (s.itemsPerMin ?? 0), 0);
  if (!(sum > 0)) return out;

  type Row = {
    station: Station;
    exact: number;
    full: number;
    frac: number;
    exclusiveStart: number;
    exclusiveCars: number;
    sharedCars: number[];
  };

  const rows: Row[] = active.map((station) => {
    const exact = ((station.itemsPerMin ?? 0) / sum) * dock;
    let full = Math.floor(exact + EPS);
    let frac = exact - full;
    if (frac < EPS) frac = 0;
    if (frac > 1 - EPS) {
      full += 1;
      frac = 0;
    }
    return {
      station,
      exact,
      full,
      frac,
      exclusiveStart: 0,
      exclusiveCars: full,
      sharedCars: [],
    };
  });

  let next = 0;
  for (const row of rows) {
    row.exclusiveStart = next;
    next += row.exclusiveCars;
  }

  // First-fit pack partials into shared cars (capacity 1.0 each).
  type Bin = { remaining: number; members: number[] };
  const bins: Bin[] = [];
  for (let i = 0; i < rows.length; i++) {
    const frac = rows[i].frac;
    if (frac <= 0) continue;
    let placed = false;
    for (const bin of bins) {
      if (bin.remaining + EPS >= frac) {
        bin.remaining -= frac;
        bin.members.push(i);
        placed = true;
        break;
      }
    }
    if (!placed) bins.push({ remaining: 1 - frac, members: [i] });
  }

  for (const bin of bins) {
    const car = Math.min(next, dock - 1);
    next += 1;
    for (const i of bin.members) rows[i].sharedCars.push(car);
  }

  for (const row of rows) {
    const from = row.exclusiveCars > 0 ? row.exclusiveStart + 1 : null;
    const to =
      row.exclusiveCars > 0
        ? row.exclusiveStart + row.exclusiveCars
        : null;
    const exclusiveRange =
      from != null && to != null ? { from, to } : null;
    const shared1 = row.sharedCars.map((c) => c + 1);
    const sharedWith = [
      ...new Set(
        rows
          .filter(
            (other) =>
              other.station.id !== row.station.id &&
              other.sharedCars.some((c) => row.sharedCars.includes(c)),
          )
          .map((other) => other.station.name),
      ),
    ];
    const loadingPlatforms = row.exclusiveCars + row.sharedCars.length;
    const parts: string[] = [];
    if (exclusiveRange) {
      parts.push(
        exclusiveRange.from === exclusiveRange.to
          ? `car ${exclusiveRange.from} exclusive`
          : `cars ${exclusiveRange.from}–${exclusiveRange.to} exclusive`,
      );
    }
    if (shared1.length > 0) {
      const pct = Math.round(row.frac * 100);
      const who =
        sharedWith.length > 0 ? ` with ${sharedWith.join(', ')}` : '';
      parts.push(
        `${pct}% of ${formatCarList(shared1)} (partial)${who}`,
      );
    }
    out.set(row.station.id, {
      exclusiveCars: row.exclusiveCars,
      exclusiveRange,
      sharedCars: shared1,
      partialFraction: row.frac,
      sharedWith,
      loadingPlatforms,
      breakdown: parts.length > 0 ? parts.join('; ') : 'no car share',
    });
  }

  return out;
}

/**
 * Platforms + car split for a train cargo stop.
 * Peers (same load/unload flow, after-drop / after-pickup route order) share
 * the dock: whole cars first, then packed partials so leftovers can be co-used.
 */
export function platformsForStation(
  station: Station,
  routePlatforms: number | null | undefined,
  beltMk: BeltMk = 5,
  stations: Station[] = [],
  route: RouteNode[] = [],
): StationPlatforms | null {
  if (station.vehicleType === 'drone' || station.role === 'passthrough') {
    return null;
  }
  if (routePlatforms == null || !(routePlatforms > 0)) return null;

  const dockPlatforms = Math.max(1, Math.ceil(routePlatforms));
  const ceiling = platformBeltCeiling(beltMk);
  const rate = station.itemsPerMin;
  const beltPlatforms =
    rate != null && rate > 0 && ceiling > 0
      ? Math.max(1, Math.ceil(rate / ceiling))
      : 0;

  const peers =
    route.length > 0
      ? peersForFlow(station, stations, route)
      : stations.filter((s) =>
          station.role === 'dropoff' ? isUnloadPeer(s) : isLoadPeer(s),
        );
  const allocMap = allocateStationCars(peers, dockPlatforms);
  const alloc = allocMap.get(station.id);

  const emptyAlloc = {
    exclusiveCars: 0,
    exclusiveRange: null as { from: number; to: number } | null,
    sharedCars: [] as number[],
    partialFraction: 0,
    sharedWith: [] as string[],
    loadingPlatforms: 0,
    breakdown:
      rate == null || rate <= 0
        ? 'Set items/min to allocate cars'
        : 'No peers to split with',
  };
  const split = alloc ?? emptyAlloc;

  const platforms = Math.max(dockPlatforms, beltPlatforms);
  return {
    platforms,
    dockPlatforms,
    loadingPlatforms: split.loadingPlatforms,
    exclusiveCars: split.exclusiveCars,
    exclusiveRange: split.exclusiveRange,
    sharedCars: split.sharedCars,
    partialFraction: split.partialFraction,
    sharedWith: split.sharedWith,
    beltPlatforms,
    beltBound: beltPlatforms > dockPlatforms,
    breakdown: split.breakdown,
  };
}
