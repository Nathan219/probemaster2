import React, { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Grid from '@mui/material/Grid';
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
  gridLayout?: boolean;
}

export default function IndividualCharts({ samples, probes, locations, activeProbes, metricVisibility, gridLayout = false }: Props) {
  // --- Group samples by probe ---
  const seriesByProbe = useMemo(() => {
    const groups: Record<string, Sample[]> = {};
    for (const sample of samples) {
      if (!activeProbes.has(sample.probeId)) continue;
      (groups[sample.probeId] ||= []).push(sample);
    }
    return groups;
  }, [samples, activeProbes]);

  // --- Create labels for legend ---
  const probeLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const probeId of Object.keys(seriesByProbe)) {
      const probe = probes[probeId];
      const location = probe?.locationId ? locations[probe.locationId] : null;
      if (location) {
        // Show area name prominently: [Area] ProbeId (Location)
        labels[probeId] = `${location.area} ${location.name} (Probe ${probeId})`;
      } else {
        labels[probeId] = `Unassigned Probe ${probeId}`;
      }
    }
    return labels;
  }, [seriesByProbe, probes, locations]);

  // --- Which metrics to show ---
  const metrics = Object.entries(metricInfo).filter(
    ([metricKey]) => metricVisibility[metricKey as keyof typeof metricInfo]
  );

  // --- Render ---
  const chartContent = metrics.map(([metricKey, metric]) => (
    <Paper key={metricKey} sx={{ p: 2 }} variant="outlined">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {metric.label} (Individual)
      </Typography>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            type="number"
            domain={['auto', 'auto']}
            tickFormatter={(timestamp) =>
              new Date(timestamp as number).toLocaleTimeString([], {
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
              const tooltipLines = payload.map((payloadItem) => ({
                name: payloadItem.name,
                value: payloadItem.value,
                color: payloadItem.stroke,
              }));
              return (
                <div style={{ background: '#222', color: '#fff', padding: 8, borderRadius: 4 }}>
                  <div>
                    <strong>{new Date(label).toLocaleTimeString()}</strong>
                  </div>
                  {tooltipLines.map((line, index) => (
                    <div key={index} style={{ color: line.color }}>
                      {line.name}: {line.value}
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <Legend />

          {Object.entries(seriesByProbe).map(([probeId, rows], index) => (
            <Line
              key={probeId}
              name={probeLabels[probeId]}
              type="monotone"
              data={rows.map((row) => ({
                time: row.ts,
                value: (row as any)[metric.key],
              }))}
              dataKey="value"
              stroke={metric.color}
              strokeOpacity={0.9 - (index % 4) * 0.15}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Paper>
  ));

  if (gridLayout) {
    return (
      <>
        {chartContent.map((chart, index) => (
          <Grid item xs={12} md={4} key={index}>
            {chart}
          </Grid>
        ))}
      </>
    );
  }

  return <Stack spacing={2}>{chartContent}</Stack>;
}
