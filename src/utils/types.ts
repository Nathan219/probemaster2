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
