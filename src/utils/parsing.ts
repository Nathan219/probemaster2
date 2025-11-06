import { Sample } from './types';
export function parseLine(l: string) {
  const m = l.match(/^([^:]+):\s*(.*)$/);
  if (!m) return null;
  const probeId = m[1].trim(),
    rest = m[2].trim();
  let co2 = NaN,
    temp = NaN,
    hum = NaN,
    sound = NaN;
  for (const part of rest.split(/[\s,]+/)) {
    const [k, v] = part.split(/[:=]/);
    if (!k || !v) continue;
    const key = k.toLowerCase();
    const val = parseFloat(v);
    if (Number.isNaN(val)) continue;
    if (key.startsWith('co2')) co2 = val;
    else if (key.startsWith('temp')) temp = val;
    else if (key.startsWith('hum')) hum = val;
    else if (key.startsWith('sound')) sound = val;
  }
  if ([co2, temp, hum, sound].some((v) => Number.isFinite(v)))
    return { ts: Date.now(), probeId, co2, temp, hum, sound } as Sample;
  return null;
}
export function toCSV(rows: Sample[]) {
  const h = ['timestamp', 'isoTime', 'probeId', 'CO2', 'Temp', 'Hum', 'Sound'];
  const out = [h.join(',')];
  for (const r of rows) {
    out.push([r.ts, new Date(r.ts).toISOString(), r.probeId, r.co2, r.temp, r.hum, r.sound].join(','));
  }
  return out.join('\n');
}
