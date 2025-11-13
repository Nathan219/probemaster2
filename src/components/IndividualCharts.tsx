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

// --- Area color palette ---
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

interface Props {
  samples: Sample[];
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
  activeProbes: Set<string>;
  metricVisibility: { CO2: boolean; Temp: boolean; Hum: boolean; Sound: boolean };
  bucketInterval: number;
  gridLayout?: boolean;
}

export default function IndividualCharts({ samples, probes, locations, activeProbes, metricVisibility, bucketInterval, gridLayout = false }: Props) {
  // --- Group samples by probe ---
  const seriesByProbe = useMemo(() => {
    const groups: Record<string, Sample[]> = {};
    for (const sample of samples) {
      if (!activeProbes.has(sample.probeId)) continue;
      (groups[sample.probeId] ||= []).push(sample);
    }
    return groups;
  }, [samples, activeProbes]);

  // --- Create labels and area info for legend ---
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

  // --- Get area for each probe and group probes by area ---
  const { probeAreas, probesByArea } = useMemo(() => {
    const areas: Record<string, string> = {};
    const groups: Record<string, string[]> = {};
    for (const probeId of Object.keys(seriesByProbe)) {
      const probe = probes[probeId];
      const location = probe?.locationId ? locations[probe.locationId] : null;
      const area = location?.area || 'Unassigned';
      areas[probeId] = area;
      (groups[area] ||= []).push(probeId);
    }
    return { probeAreas: areas, probesByArea: groups };
  }, [seriesByProbe, probes, locations]);

  // --- Which metrics to show ---
  const metrics = Object.entries(metricInfo).filter(
    ([metricKey]) => metricVisibility[metricKey as keyof typeof metricInfo]
  );

  // --- Aggregate samples by bucket interval for each probe ---
  const aggregatedDataByProbe = useMemo(() => {
    const result: Record<string, Record<string, { time: number; value: number }[]>> = {};
    const activeMetrics = Object.entries(metricInfo).filter(
      ([metricKey]) => metricVisibility[metricKey as keyof typeof metricInfo]
    );
    
    for (const [probeId, probeSamples] of Object.entries(seriesByProbe)) {
      result[probeId] = {};
      
      for (const [metricKey, metric] of activeMetrics) {
        const buckets: Record<number, number[]> = {};
        
        for (const sample of probeSamples) {
          const timestamp = Math.floor(sample.ts / bucketInterval) * bucketInterval;
          const value = (sample as any)[metric.key];
          if (value != null && Number.isFinite(value)) {
            (buckets[timestamp] ||= []).push(value);
          }
        }
        
        const aggregated: { time: number; value: number }[] = [];
        for (const timestamp of Object.keys(buckets)
          .map(Number)
          .sort((timeA, timeB) => timeA - timeB)) {
          const values = buckets[timestamp];
          if (values.length > 0) {
            const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
            aggregated.push({ time: timestamp, value: avg });
          }
        }
        
        result[probeId][metricKey] = aggregated;
      }
    }
    
    return result;
  }, [seriesByProbe, metricVisibility, bucketInterval]);

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

          {Object.entries(seriesByProbe).map(([probeId]) => {
            const area = probeAreas[probeId];
            const areaColor = paletteForArea(area);
            // Get index of this probe within its area for opacity variation
            const areaProbes = probesByArea[area] || [];
            const probeIndexInArea = areaProbes.indexOf(probeId);
            // Vary opacity slightly for probes in the same area (0.7 to 1.0)
            const opacity = 0.7 + (probeIndexInArea % 4) * 0.1;
            const aggregatedData = aggregatedDataByProbe[probeId]?.[metricKey] || [];
            
            return (
              <Line
                key={probeId}
                name={probeLabels[probeId]}
                type="monotone"
                data={aggregatedData}
                dataKey="value"
                stroke={areaColor}
                strokeOpacity={opacity}
                dot={false}
              />
            );
          })}
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
