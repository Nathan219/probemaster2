import { Sample, Location } from './utils/types';
function uid(p = 'id') {
  return p + '_' + Math.random().toString(36).slice(2, 10);
}
export function createSimSetup() {
  const a = ['10th Floor', 'Tea Room', 'Pool'],
    n = ['Rotunda', 'Hallway', 'Corner 1', 'Corner 2', 'Line'];
  const locations: Record<string, Location> = {},
    probes: Record<string, { id: string; locationId: string }> = {};
  let i = 0;
  for (const A of a) {
    for (let k = 0; k < 2; k++) {
      const l: Location = { id: uid('loc'), name: n[(i + k) % n.length], area: A };
      locations[l.id] = l;
      const pid = (A.startsWith('10') ? 'A' : A.startsWith('Tea') ? 'T' : 'P') + (k + 1);
      probes[pid] = { id: pid, locationId: l.id };
    }
    i++;
  }
  return { locations, probes };
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
export function makeSimTickers(ids: string[]) {
  const st: Record<string, { co2: number; temp: number; hum: number; sound: number }> = {};
  for (const id of ids)
    st[id] = {
      co2: 500 + Math.random() * 100,
      temp: 25 + Math.random() * 3,
      hum: 40 + Math.random() * 10,
      sound: 30 + Math.random() * 8,
    };
  return () => {
    const out: Sample[] = [];
    const now = Date.now();
    for (const id of ids) {
      const s = st[id];
      s.co2 = clamp(s.co2 + (Math.random() - 0.5) * 10, 350, 2000);
      s.temp = clamp(s.temp + (Math.random() - 0.5) * 0.15, 10, 40);
      s.hum = clamp(s.hum + (Math.random() - 0.5) * 0.6, 5, 95);
      s.sound = clamp(s.sound + (Math.random() - 0.5) * 2, 20, 80);
      out.push({
        ts: now,
        probeId: id,
        co2: Math.round(s.co2),
        temp: +s.temp.toFixed(2),
        hum: +s.hum.toFixed(2),
        sound: Math.round(s.sound),
      });
    }
    return out;
  };
}
