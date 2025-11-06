import React, { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Sample, Location, Probe } from '../utils/types';

// --- Metric display configuration ---
const metricInfo = {
  CO2: { key: 'co2', label: 'CO₂ (ppm)', color: '#64b5f6' },
  Temp: { key: 'temp', label: 'Temperature (°C)', color: '#ef5350' },
  Hum: { key: 'hum', label: 'Humidity (%)', color: '#66bb6a' },
  Sound: { key: 'sound', label: 'Sound (dB)', color: '#ab47bc' },
} as const;

interface Props {
  samples: Sample[];
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
  activeProbes: Set<string>;
  metricVisibility: { CO2: boolean; Temp: boolean; Hum: boolean; Sound: boolean };
}

export default function IndividualCharts({ samples, probes, locations, activeProbes, metricVisibility }: Props) {
  // --- Group samples by probe ---
  const seriesByProbe = useMemo(() => {
    const groups: Record<string, Sample[]> = {};
    for (const s of samples) {
      if (!activeProbes.has(s.probeId)) continue;
      (groups[s.probeId] ||= []).push(s);
    }
    return groups;
  }, [samples, activeProbes]);

  // --- Create labels for legend ---
  const probeLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const id of Object.keys(seriesByProbe)) {
      const probe = probes[id];
      const loc = probe?.locationId ? locations[probe.locationId] : null;
      labels[id] = loc ? `${id} (${loc.area} / ${loc.name})` : id;
    }
    return labels;
  }, [seriesByProbe, probes, locations]);

  // --- Which metrics to show ---
  const metrics = Object.entries(metricInfo).filter(([key]) => metricVisibility[key as keyof typeof metricInfo]);

  // --- Render ---
  return (
    <Stack spacing={2}>
      {metrics.map(([metricKey, metric]) => (
        <Paper key={metricKey} sx={{ p: 2 }} variant="outlined">
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {metric.label}
          </Typography>

          <ResponsiveContainer width="100%" height={320}>
            <LineChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
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
              <Tooltip
                isAnimationActive={false}
                content={({ active, payload, label }) => {
                  if (!active || !payload) return null;
                  const lines = payload.map((p) => ({
                    name: p.name,
                    value: p.value,
                    color: p.stroke,
                  }));
                  return (
                    <div style={{ background: '#222', color: '#fff', padding: 8, borderRadius: 4 }}>
                      <div>
                        <strong>{new Date(label).toLocaleTimeString()}</strong>
                      </div>
                      {lines.map((l, i) => (
                        <div key={i} style={{ color: l.color }}>
                          {l.name}: {l.value}
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Legend />

              {Object.entries(seriesByProbe).map(([probeId, rows], idx) => (
                <Line
                  key={probeId}
                  name={probeLabels[probeId]}
                  type="monotone"
                  data={rows.map((r) => ({
                    time: r.ts,
                    value: (r as any)[metric.key],
                  }))}
                  dataKey="value"
                  stroke={metric.color}
                  strokeOpacity={0.9 - (idx % 4) * 0.15}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      ))}
    </Stack>
  );
}
