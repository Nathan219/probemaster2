import React from 'react';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import { Probe, Location, Sample } from '../utils/types';
import { AreaData } from './CommandCenter';

export function UnassignProbesPanel({
  probes,
  locations,
  setProbes,
  sendCommand,
  connected,
  setCommandCenterAreas,
}: {
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
  setProbes: React.Dispatch<React.SetStateAction<Record<string, Probe>>>;
  sendCommand: (cmd: string) => Promise<void>;
  connected: boolean;
  setCommandCenterAreas: React.Dispatch<React.SetStateAction<Map<string, AreaData>>>;
}) {
  const handleUnassign = async (probeId: string) => {
    const confirmed = window.confirm(`Are you sure you want to unassign probe ${probeId}?`);
    if (!confirmed) return;

    if (connected) {
      await sendCommand(`REMOVE PROBE ${probeId}`);
    }

    // Remove probe from all areas in commandCenterAreas
    setCommandCenterAreas((prev) => {
      const next = new Map(prev);
      for (const [areaName, areaData] of next.entries()) {
        const locations = new Map(areaData.locations);
        let found = false;
        for (const [locName, locProbeId] of locations.entries()) {
          if (locProbeId === probeId) {
            locations.delete(locName);
            found = true;
            break;
          }
        }
        if (found) {
          next.set(areaName, {
            ...areaData,
            locations,
          });
        }
      }
      return next;
    });

    // Update probe to remove assignment
    setProbes((prev: any) => {
      const updatedProbes = { ...prev, [probeId]: { ...prev[probeId], locationId: null } };
      return updatedProbes;
    });
  };

  const assignedProbes = Object.values(probes).filter(
    (probe: any) => probe.locationId !== null && probe.locationId !== undefined
  );

  if (assignedProbes.length === 0) {
    return null;
  }

  return (
    <Paper sx={{ p: 2 }} variant="outlined">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Assigned Probes
      </Typography>
      <Stack spacing={1} maxHeight={200} sx={{ overflow: 'auto', pt: 0.5 }}>
        {assignedProbes.map((probe: any) => {
          const location = probe.locationId ? locations[probe.locationId] : null;
          const label = location ? `${location.area} / ${location.name}` : 'Unknown';
          return (
            <Stack key={probe.id} direction="row" spacing={1} alignItems="center">
              <Typography sx={{ fontFamily: 'monospace', flex: 1 }}>{probe.id}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                {label}
              </Typography>
              <Button
                variant="outlined"
                color="error"
                size="small"
                onClick={() => handleUnassign(probe.id)}
                disabled={!connected}
                sx={{ minWidth: 90 }}
              >
                Unassign
              </Button>
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}

export function ProbesPanel({
  probes,
  locations,
  setProbes,
  setLocations,
  areas,
  sendCommand,
  connected,
  onProbeAssignmentRef,
  setCommandCenterAreas,
}: {
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
  setProbes: React.Dispatch<React.SetStateAction<Record<string, Probe>>>;
  setLocations: React.Dispatch<React.SetStateAction<Record<string, Location>>>;
  areas: Set<string>;
  sendCommand: (cmd: string) => Promise<void>;
  connected: boolean;
  onProbeAssignmentRef: React.MutableRefObject<((probeId: string, area: string, location: string) => void) | null>;
  setCommandCenterAreas: React.Dispatch<React.SetStateAction<Map<string, AreaData>>>;
}) {
  // Local state to track area and location per probe
  const [probeAssignments, setProbeAssignments] = React.useState<Record<string, { area: string; location: string }>>(
    {}
  );
  // Track loading state for each probe assignment
  const [loadingProbes, setLoadingProbes] = React.useState<Set<string>>(new Set());
  // Track pending assignments to avoid stale closures
  const pendingAssignmentsRef = React.useRef<Map<string, { area: string; location: string }>>(new Map());

  // Initialize from existing locations
  React.useEffect(() => {
    const assignments: Record<string, { area: string; location: string }> = {};
    Object.values(probes).forEach((probe: any) => {
      if (probe.locationId && locations[probe.locationId]) {
        const location = locations[probe.locationId];
        assignments[probe.id] = { area: location.area, location: location.name };
      }
    });
    setProbeAssignments(assignments);
  }, [probes, locations]);

  const handleAreaChange = (probeId: string, area: string) => {
    setProbeAssignments((prev) => ({
      ...prev,
      [probeId]: { ...prev[probeId], area, location: prev[probeId]?.location || '' },
    }));
  };

  const handleLocationChange = (probeId: string, location: string) => {
    setProbeAssignments((prev) => ({
      ...prev,
      [probeId]: { ...prev[probeId], area: prev[probeId]?.area || '', location },
    }));
  };

  // Set up callback to handle probe assignment success
  React.useEffect(() => {
    const handleProbeAssignment = (probeId: string, area: string, location: string) => {
      // Only process if this probe is in pending assignments
      if (!pendingAssignmentsRef.current.has(probeId)) return;

      // Remove probe from all old areas in commandCenterAreas
      setCommandCenterAreas((prev) => {
        const next = new Map(prev);
        for (const [areaName, areaData] of next.entries()) {
          const locations = new Map(areaData.locations);
          let found = false;
          for (const [locName, locProbeId] of locations.entries()) {
            if (locProbeId === probeId) {
              locations.delete(locName);
              found = true;
              break;
            }
          }
          if (found) {
            next.set(areaName, {
              ...areaData,
              locations,
            });
          }
        }
        return next;
      });

      // Find or create location
      let locationId: string | null = null;
      const existingLocation = Object.values(locations).find((loc: any) => loc.name === location && loc.area === area);
      if (existingLocation) {
        locationId = existingLocation.id;
      } else {
        // Create new location
        const newId = Math.random().toString(36).slice(2, 10);
        const newLocation: Location = { id: newId, name: location, area: area };
        setLocations((prev: any) => ({ ...prev, [newId]: newLocation }));
        locationId = newId;
      }

      // Update probe
      setProbes((prev: any) => {
        const updatedProbes = { ...prev, [probeId]: { ...prev[probeId], locationId } };
        return updatedProbes;
      });

      // Add probe to new area in commandCenterAreas
      const areaName = area.toUpperCase();
      setCommandCenterAreas((prev) => {
        const next = new Map(prev);
        const existingArea = next.get(areaName);
        const newLocations = existingArea ? new Map(existingArea.locations) : new Map<string, string>();
        newLocations.set(location, probeId);
        next.set(areaName, {
          area: areaName,
          locations: newLocations,
          thresholds: existingArea?.thresholds || new Map(),
          stats: existingArea?.stats || new Map(),
        });
        return next;
      });

      // Update probeAssignments to reflect the new assignment
      setProbeAssignments((prev) => ({
        ...prev,
        [probeId]: { area, location },
      }));

      // Remove from pending and loading state
      pendingAssignmentsRef.current.delete(probeId);
      setLoadingProbes((prev) => {
        const next = new Set(prev);
        next.delete(probeId);
        return next;
      });
    };

    onProbeAssignmentRef.current = handleProbeAssignment;
    return () => {
      onProbeAssignmentRef.current = null;
    };
  }, [locations, setProbes, setLocations, setCommandCenterAreas, onProbeAssignmentRef]);

  const handleAssign = async (probeId: string) => {
    const assignment = probeAssignments[probeId];
    if (!assignment || !assignment.area || !assignment.location) return;

    // Set loading state and track pending assignment
    setLoadingProbes((prev) => new Set(prev).add(probeId));
    pendingAssignmentsRef.current.set(probeId, { area: assignment.area, location: assignment.location });

    if (connected) {
      // Based on SensorHandler.cpp, sensor UART expects: probeId: SET PROBE area location
      // The device routes SET PROBE commands to sensor UART (UART2), so we need to format it
      // as if it came from a probe: probeId: SET PROBE area location
      await sendCommand(`SET PROBES ${probeId} ${assignment.area} ${assignment.location}`);
    } else {
      // If not connected, remove from loading state immediately
      pendingAssignmentsRef.current.delete(probeId);
      setLoadingProbes((prev) => {
        const next = new Set(prev);
        next.delete(probeId);
        return next;
      });
    }
  };

  const areaList = Array.from(areas).sort();

  return (
    <Paper sx={{ p: 2 }} variant="outlined">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Probes
      </Typography>
      <Stack spacing={1} maxHeight={350} sx={{ overflow: 'auto', pt: 0.5 }}>
        {Object.values(probes).map((probe: any) => {
          const assignment = probeAssignments[probe.id] || { area: '', location: '' };
          const canAssign = assignment.area && assignment.location;
          return (
            <Stack key={probe.id} direction="row" spacing={1} alignItems="flex-start">
              <Typography sx={{ fontFamily: 'monospace', pt: 1.5 }}>{probe.id}</Typography>
              <TextField
                select
                size="small"
                label="Area"
                value={assignment.area}
                onChange={(e) => handleAreaChange(probe.id, e.target.value)}
                disabled={!connected}
                sx={{ minWidth: 120 }}
              >
                {areaList.map((areaName) => (
                  <MenuItem key={areaName} value={areaName}>
                    {areaName}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Location"
                value={assignment.location}
                onChange={(e) => handleLocationChange(probe.id, e.target.value)}
                disabled={!connected}
                sx={{ minWidth: 120 }}
              />
              <Button
                variant="contained"
                size="small"
                onClick={() => handleAssign(probe.id)}
                disabled={!canAssign || !connected || loadingProbes.has(probe.id)}
                sx={{ minWidth: 80 }}
                startIcon={loadingProbes.has(probe.id) ? <CircularProgress size={16} /> : null}
              >
                Assign
              </Button>
            </Stack>
          );
        })}
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
        <b>Latest Readings</b>
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
              <Typography variant="body2" color="text.secondary">
                Location: {label}
              </Typography>

              {latestReading && (
                <Typography variant="body2" color="text.secondary">
                  Latest reading: {new Date(latestReading.ts).toLocaleTimeString()}
                </Typography>
              )}
              {latestReading ? (
                <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                  <Typography variant="body2">
                    CO₂: <b>{latestReading.co2}</b>
                  </Typography>
                  <Typography variant="body2">
                    <b>Temp:</b> {latestReading.temp.toFixed(2)}°C
                  </Typography>
                  <Typography variant="body2">
                    <b>Hum: </b>
                    {latestReading.hum.toFixed(2)}%
                  </Typography>
                  <Typography variant="body2">
                    <b>Sound:</b> {latestReading.sound}dB
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
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
