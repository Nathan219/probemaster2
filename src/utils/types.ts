export enum LocationName {
  FLOOR_11 = 'Floor 11',
  FLOOR_12 = 'Floor 12',
  FLOOR_15 = 'Floor 15',
  FLOOR_16 = 'Floor 16',
  FLOOR_17 = 'Floor 17',
  POOL = 'Pool',
  TEA_ROOM = 'Tea Room',
}

export type Sample = { ts: number; probeId: string; co2: number; temp: number; hum: number; sound: number };
export type Probe = { id: string; locationId: string | null };
export type Location = { id: string; name: string; area: string };

export type AreaInfo = { areaName: string; locationName: LocationName; probeId: string };
export type Stats = {
  areaName: string;
  location: string;
  min: number;
  max: number;
  overrideMin: number | null;
  overrideMax: number | null;
};

export enum Measurement {
  CO2 = 'CO2',
  HUM = 'HUM',
  TEMP = 'TEMP',
  DB = 'DB',
}
export type Pixel = { areaName: string; measurement: Measurement; pixel: number };
export type Threshold = { areaName: string; measurement: Measurement; values: number[] };
