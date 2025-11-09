import React, { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Sample, Location, Probe } from '../utils/types';

// Helper function to normalize probe ID (strip prefixes like [UART2])
function normalizeProbeId(probeId: string): string {
  // Remove prefixes like [UART2], [UART1], etc.
  const match = probeId.match(/\[.*?\]\s*(.+)$/);
  return match ? match[1].trim() : probeId.trim();
}

const metricInfo = {
  CO2: { key: 'co2', label: 'CO₂ (ppm)' },
  Temp: { key: 'temp', label: 'Temperature (°C)' },
  Hum: { key: 'hum', label: 'Humidity (%)' },
  Sound: { key: 'sound', label: 'Sound' },
} as const;

function paletteForArea(area: string) {
  // Use a color palette that works for any area name
  const colors = [
    '#7E57C2',
    '#26A69A',
    '#FFB74D',
    '#42A5F5',
    '#EF5350',
    '#66BB6A',
    '#FFA726',
    '#AB47BC',
    '#26C6DA',
    '#FFCA28',
  ];

  // Generate a consistent color index based on area name hash
  let hash = 0;
  for (let i = 0; i < area.length; i++) {
    hash = area.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % colors.length;
  return colors[idx];
}

type AggRow = { time: number; min: number; avg: number; max: number };

export default function SummaryCharts({
  samples,
  probes,
  locations,
  activeAreas,
  metricVisibility,
  aggType,
  showBand,
}: {
  samples: Sample[];
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
  activeAreas: Set<string>;
  metricVisibility: { CO2: boolean; Temp: boolean; Hum: boolean; Sound: boolean };
  aggType: 'avg' | 'min' | 'max';
  showBand: boolean;
}) {
  const areaSamples = useMemo(() => {
    const map: Record<string, Sample[]> = {};
    for (const s of samples) {
      // Normalize probe ID to match the format used in probes
      const normalizedProbeId = normalizeProbeId(s.probeId);
      const probe = probes[normalizedProbeId] || probes[s.probeId];
      if (!probe) {
        // Probe not found, assign to Unassigned
        const area = 'Unassigned';
        if (activeAreas.has('All') || activeAreas.has(area)) {
          (map[area] ||= []).push(s);
        }
        continue;
      }
      const loc = probe.locationId ? locations[probe.locationId] : null;
      const area = loc?.area || 'Unassigned';
      if (!(activeAreas.has('All') || activeAreas.has(area))) continue;
      (map[area] ||= []).push(s);
    }
    return map;
  }, [samples, probes, locations, activeAreas]);

  const metrics = Object.entries(metricInfo).filter(([k]) => (metricVisibility as any)[k]);

  function aggregate(area: string, key: keyof Sample): AggRow[] {
    const rows = areaSamples[area] || [];
    const buckets: Record<number, number[]> = {};
    for (const r of rows) {
      const t = Math.floor(r.ts / 60000) * 60000;
      (buckets[t] ||= []).push((r as any)[key] ?? NaN);
    }
    const out: AggRow[] = [];
    for (const t of Object.keys(buckets)
      .map(Number)
      .sort((a, b) => a - b)) {
      const vals = buckets[t].filter((v) => Number.isFinite(v));
      if (!vals.length) continue;
      const min = Math.min(...vals),
        max = Math.max(...vals),
        avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      out.push({ time: t, min, avg, max });
    }
    return out;
  }

  const areas = Object.keys(areaSamples);
  return (
    <Stack spacing={2}>
      {metrics.map(([mKey, m]) => (
        <Paper key={mKey} sx={{ p: 2 }} variant="outlined">
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {m.label}
          </Typography>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="time"
                type="number"
                domain={['auto', 'auto']}
                tickFormatter={(v) =>
                  new Date(v as number).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                }
              />
              <YAxis />
              <Tooltip labelFormatter={(v) => new Date(+v).toLocaleTimeString()} />
              <Legend />
              {areas.map((area) => {
                const color = paletteForArea(area);
                const data = aggregate(area, metricInfo[mKey as keyof typeof metricInfo].key as keyof Sample);
                return (
                  <g key={area}>
                    {showBand && (
                      <Area
                        name={`${area} (min–max)`}
                        data={data.map((d) => ({ time: d.time, bandMin: d.min, bandMax: d.max }))}
                        dataKey="bandMax"
                        type="monotone"
                        stroke="none"
                        fill={color}
                        fillOpacity={0.15}
                        dot={false}
                        isAnimationActive={false}
                        activeDot={false}
                      />
                    )}
                  </g>
                );
              })}
              {areas.map((area) => {
                const color = paletteForArea(area);
                const data = aggregate(area, metricInfo[mKey as keyof typeof metricInfo].key as keyof Sample);
                return (
                  <Line
                    key={area}
                    name={`${area} (${aggType})`}
                    data={data.map((d) => ({ time: d.time, value: d[aggType] }))}
                    dataKey="value"
                    type="monotone"
                    stroke={color}
                    dot={false}
                    isAnimationActive={false}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        </Paper>
      ))}
    </Stack>
  );
}
