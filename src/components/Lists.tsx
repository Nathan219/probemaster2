import React from 'react';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import { Probe, Location, Sample } from '../utils/types';
import { idbPut } from '../db/idb';

export function LocationsPanel({
  locations,
  setLocations,
}: {
  locations: Record<string, Location>;
  setLocations: React.Dispatch<React.SetStateAction<Record<string, Location>>>;
}) {
  const [name, setName] = React.useState('');
  const [area, setArea] = React.useState('');

  const add = async () => {
    if (!name || !area) return;
    const id = Math.random().toString(36).slice(2, 10);
    const location: Location = { id, name, area };
    setLocations((prev: any) => ({ ...prev, [location.id]: location }));
    await idbPut('locations', location);
    setName('');
    setArea('');
  };

  return (
    <Paper sx={{ p: 2 }} variant="outlined">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Locations
      </Typography>
      <Stack direction="row" spacing={1}>
        <TextField size="small" label="Location" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField size="small" label="Area" value={area} onChange={(e) => setArea(e.target.value)} />
        <Button variant="contained" onClick={add}>
          Add
        </Button>
      </Stack>
      <Divider sx={{ my: 1 }} />
      <Stack spacing={1} maxHeight={280} sx={{ overflow: 'auto' }}>
        {Object.values(locations).map((location: any) => (
          <Paper key={location.id} variant="outlined" sx={{ p: 1 }}>
            <Typography fontWeight={600}>{location.name}</Typography>
            <Typography variant="caption">Area: {location.area}</Typography>
          </Paper>
        ))}
      </Stack>
    </Paper>
  );
}

export function ProbesPanel({
  probes,
  locations,
  setProbes,
}: {
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
  setProbes: React.Dispatch<React.SetStateAction<Record<string, Probe>>>;
}) {
  const assign = async (id: string, locationId: string | null) => {
    setProbes((prev: any) => {
      const updatedProbes = { ...prev, [id]: { ...prev[id], locationId } };
      idbPut('probes', updatedProbes[id]);
      return updatedProbes;
    });
  };

  return (
    <Paper sx={{ p: 2 }} variant="outlined">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Probes
      </Typography>
      <Stack spacing={1} maxHeight={350} sx={{ overflow: 'auto' }}>
        {Object.values(probes).map((probe: any) => (
          <Stack key={probe.id} direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontFamily: 'monospace' }}>{probe.id}</Typography>
            <TextField
              select
              size="small"
              label="Location"
              value={probe.locationId || ''}
              onChange={(e) => assign(probe.id, (e.target as any).value || null)}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="">Unassigned</MenuItem>
              {Object.values(locations).map((location: any) => (
                <MenuItem key={location.id} value={location.id}>
                  {location.name} ({location.area})
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

export function LatestReadings({
  samples,
  probes,
  locations,
}: {
  samples: Sample[];
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
}) {
  const latest: Record<string, Sample> = {};
  for (const sample of samples) latest[sample.probeId] = sample;

  return (
    <Paper sx={{ p: 2 }} variant="outlined">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Latest Readings
      </Typography>
      <Stack spacing={1} maxHeight={350} sx={{ overflow: 'auto' }}>
        {Object.keys(probes).length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No probes yet.
          </Typography>
        )}
        {Object.values(probes).map((probe: any) => {
          const location = probe.locationId ? locations[probe.locationId] : null;
          const label = location ? `${location.area} / ${location.name}` : 'Unassigned';
          const latestReading = latest[probe.id];
          return (
            <Paper key={probe.id} variant="outlined" sx={{ p: 1.5 }}>
              <Typography sx={{ fontFamily: 'monospace' }}>{probe.id}</Typography>
              <Typography variant="caption" color="text.secondary">
                Location: {label}
              </Typography>
              {latestReading ? (
                <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                  <Typography variant="body2">
                    CO₂: <b>{latestReading.co2}</b>
                  </Typography>
                  <Typography variant="body2">
                    Temp: <b>{latestReading.temp.toFixed(2)}</b>°C
                  </Typography>
                  <Typography variant="body2">
                    Hum: <b>{latestReading.hum.toFixed(2)}</b>%
                  </Typography>
                  <Typography variant="body2">
                    Sound: <b>{latestReading.sound}</b>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(latestReading.ts).toLocaleTimeString()}
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  No data yet
                </Typography>
              )}
            </Paper>
          );
        })}
      </Stack>
    </Paper>
  );
}
