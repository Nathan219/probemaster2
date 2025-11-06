export type Sample = { ts: number; probeId: string; co2: number; temp: number; hum: number; sound: number };
export type Probe = { id: string; locationId: string | null };
export type Location = { id: string; name: string; area: string };

export type AreaInfo = { areaName: string; locationName: string; probeId: string };
export type Stats = {
  areaName: string;
  location: string;
  min: number;
  max: number;
  overrideMin: number | null;
  overrideMax: number | null;
};
export type Pixel = { areaName: string; measurement: 'CO2' | 'HUM' | 'TEMP' | 'DB'; pixel: number };
export type Threshold = { areaName: string; measurement: 'CO2' | 'HUM' | 'TEMP' | 'DB'; values: number[] };
