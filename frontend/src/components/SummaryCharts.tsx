import React, { useMemo } from 'react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Grid from '@mui/material/Grid';
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

// Match pixel visualization colors per area
const AREA_COLORS: Record<string, string> = {
  FLOOR17: '#4169E1', // royal blue
  FLOOR16: '#4CAF50', // green
  FLOOR15: '#FFEB3B', // yellow
  FLOOR12: '#03A9F4', // sky blue
  FLOOR11: '#9C27B0', // purple
  TEAROOM: '#C0CA33', // teahouse
  POOL: '#B39DDB', // lavender
};

function paletteForArea(area: string) {
  const key = area.toUpperCase();
  if (AREA_COLORS[key]) {
    return AREA_COLORS[key];
  }
  // Fallback palette for unexpected areas
  const fallbackColors = Object.values(AREA_COLORS);
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % fallbackColors.length;
  return fallbackColors[idx];
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
  bucketInterval,
  gridLayout = false,
}: {
  samples: Sample[];
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
  activeAreas: Set<string>;
  metricVisibility: { CO2: boolean; Temp: boolean; Hum: boolean; Sound: boolean };
  aggType: 'avg' | 'min' | 'max';
  showBand: boolean;
  bucketInterval: number;
  gridLayout?: boolean;
}) {
  const areaSamples = useMemo(() => {
    const map: Record<string, Sample[]> = {};
    for (const sample of samples) {
      // Normalize probe ID to match the format used in probes
      const normalizedProbeId = normalizeProbeId(sample.probeId);
      const probe = probes[normalizedProbeId] || probes[sample.probeId];
      if (!probe) {
        // Probe not found, assign to Unassigned
        const area = 'Unassigned';
        if (activeAreas.has('All') || activeAreas.has(area)) {
          (map[area] ||= []).push(sample);
        }
        continue;
      }
      const location = probe.locationId ? locations[probe.locationId] : null;
      const area = location?.area || 'Unassigned';
      if (!(activeAreas.has('All') || activeAreas.has(area))) continue;
      (map[area] ||= []).push(sample);
    }
    return map;
  }, [samples, probes, locations, activeAreas]);

  const metrics = Object.entries(metricInfo).filter(([metricKey]) => (metricVisibility as any)[metricKey]);

  function aggregate(area: string, key: keyof Sample): AggRow[] {
    const rows = areaSamples[area] || [];
    const buckets: Record<number, number[]> = {};
    for (const sample of rows) {
      const timestamp = Math.floor(sample.ts / bucketInterval) * bucketInterval;
      (buckets[timestamp] ||= []).push((sample as any)[key] ?? NaN);
    }
    const out: AggRow[] = [];
    for (const timestamp of Object.keys(buckets)
      .map(Number)
      .sort((timeA, timeB) => timeA - timeB)) {
      const values = buckets[timestamp].filter((value) => Number.isFinite(value));
      if (!values.length) continue;
      const min = Math.min(...values),
        max = Math.max(...values),
        avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      out.push({ time: timestamp, min, avg, max });
    }
    return out;
  }

  const areas = Object.keys(areaSamples);
  const aggregateAreaBodies = (area: string): { time: number; value: number }[] => {
    const rows = areaSamples[area] || [];
    const buckets: Record<number, { sum: number; count: number }> = {};

    for (const sample of rows) {
      const timestamp = Math.floor(sample.ts / bucketInterval) * bucketInterval;
      const values = ['co2', 'temp', 'hum', 'sound']
        .map((key) => (sample as any)[key])
        .filter((val) => Number.isFinite(val));
      if (!values.length) {
        continue;
      }
      const total = values.reduce((sum, val) => sum + val, 0);
      const locationsInArea = Object.values(locations).filter((loc) => loc.area === area).length || 1;

      if (!buckets[timestamp]) {
        buckets[timestamp] = { sum: 0, count: 0 };
      }

      buckets[timestamp].sum += total / locationsInArea;
      buckets[timestamp].count += 1;
    }

    const out: { time: number; value: number }[] = [];
    for (const timestamp of Object.keys(buckets)
      .map(Number)
      .sort((a, b) => a - b)) {
      const entry = buckets[timestamp];
      if (entry.count === 0) continue;
      out.push({ time: timestamp, value: entry.sum / entry.count });
    }
    return out;
  };

  if (gridLayout) {
    if (areas.length === 0) {
      return (
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }} variant="outlined">
            <Typography>No area data available.</Typography>
          </Paper>
        </Grid>
      );
    }

    return (
      <>
        {areas.map((area) => {
          const color = paletteForArea(area);
          const data = aggregateAreaBodies(area);
          return (
            <Grid item xs={12} md={4} key={area}>
              <Paper sx={{ p: 2 }} variant="outlined">
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {area} Bodies
                </Typography>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={['auto', 'auto']}
                      tick={false}
                      axisLine={false}
                      label={{ value: 'Time', position: 'insideBottom', offset: -5, fill: '#ffffff', fontWeight: 700 }}
                    />
                    <YAxis
                      tick={false}
                      axisLine={false}
                      label={{ value: 'Bodies', angle: -90, position: 'insideLeft', fill: '#ffffff', fontWeight: 700 }}
                    />
                    <Tooltip
                      formatter={(value: number) => value.toFixed(1)}
                      labelFormatter={(timestamp) =>
                        new Date(+timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      }
                    />
                    <Line dataKey="value" type="monotone" stroke={color} strokeWidth={5} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>
          );
        })}
      </>
    );
  }

  const chartContent = metrics.map(([metricKey, metric]) => (
    <Paper key={metricKey} sx={{ p: 2 }} variant="outlined">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {metric.label} (Summary)
      </Typography>
      <ResponsiveContainer width="100%" height={320}>
        {(() => {
          const series = areas.map((area) => {
            const color = paletteForArea(area);
            const data = aggregate(area, metricInfo[metricKey as keyof typeof metricInfo].key as keyof Sample);
            return { area, color, data };
          });

          const dataMap = new Map<number, any>();
          for (const { area, data } of series) {
            for (const row of data) {
              const entry = dataMap.get(row.time) || { time: row.time };
              entry[`${area}-value`] = row[aggType];
              if (showBand) {
                entry[`${area}-min`] = row.min;
                entry[`${area}-range`] = row.max - row.min;
              }
              dataMap.set(row.time, entry);
            }
          }

          const chartData = Array.from(dataMap.values()).sort((a, b) => (a.time as number) - (b.time as number));

          return (
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
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
            labelFormatter={(timestamp) => new Date(+timestamp).toLocaleTimeString()}
            formatter={(value: number) => value.toFixed(1)}
          />
          <Legend />
          {series.map(({ area, color }) => {
            return (
              <React.Fragment key={area}>
                {showBand && (
                  <>
                    <Area
                      name={`${area} (min)`}
                      dataKey={`${area}-min`}
                      type="monotone"
                      stroke="none"
                      fill={color}
                      fillOpacity={0.1}
                      dot={false}
                      isAnimationActive={false}
                      activeDot={false}
                      stackId={`${area}-band`}
                    />
                    <Area
                      name={`${area} (range)`}
                      dataKey={`${area}-range`}
                      type="monotone"
                      stroke="none"
                      fill={color}
                      fillOpacity={0.1}
                      dot={false}
                      isAnimationActive={false}
                      activeDot={false}
                      stackId={`${area}-band`}
                    />
                  </>
                )}
                <Line
                  name={`${area} (${aggType})`}
                  dataKey={`${area}-value`}
                  type="monotone"
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </React.Fragment>
            );
          })}
            </ComposedChart>
          );
        })()}
      </ResponsiveContainer>
    </Paper>
  ));

  return <Stack spacing={2}>{chartContent}</Stack>;
}
