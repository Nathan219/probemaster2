export type Sample = { ts: number; probeId: string; co2: number; temp: number; hum: number; sound: number };
export type Probe = { id: string; locationId: string | null };
export type Location = { id: string; name: string; area: string };

export enum LocationName {
  FLOOR11 = 'Floor 11',
  FLOOR12 = 'Floor 12',
  FLOOR15 = 'Floor 15',
  FLOOR16 = 'Floor 16',
  FLOOR17 = 'Floor 17',
  POOL = 'Pool',
  TEAROOM = 'Tea Room',
}
