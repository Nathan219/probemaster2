export type Sample = { ts: number; probeId: string; co2: number; temp: number; hum: number; sound: number };
export type Probe = { id: string; locationId: string | null };
export type Location = { id: string; name: string; area: string };

export enum AreaName {
  FLOOR11 = 'FLOOR11',
  FLOOR12 = 'FLOOR12',
  FLOOR15 = 'FLOOR15',
  FLOOR16 = 'FLOOR16',
  FLOOR17 = 'FLOOR17',
  POOL = 'POOL',
  TEAROOM = 'TEAROOM',
}

// Serialized AreaData for IndexedDB storage (Maps converted to arrays/objects)
export type SerializedAreaData = {
  area: string;
  locations: Array<[string, string]>; // [location, probeId] pairs
  thresholds: Array<[string, any]>; // [metric, ThresholdInfo] pairs
  stats: Array<[string, any]>; // [metric, StatInfo] pairs
};

// Persisted areas data structure
export type PersistedAreasData = {
  id: string;
  data: SerializedAreaData[];
  lastFetched: number;
};

// Persisted pixel data structure
export type PersistedPixelData = {
  id: string;
  data: Record<string, number>;
  lastFetched: number;
};

// Persisted timestamps for thresholds and stats (key: "area-metric", value: timestamp)
export type PersistedTimestamps = {
  id: string;
  data: Record<string, number>; // area-metric -> timestamp
};
