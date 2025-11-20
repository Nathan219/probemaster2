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
import { getAuthHeaders } from '../utils/auth';

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
      <Stack
        spacing={1}
        sx={{
          maxHeight: 200,
          overflowY: 'scroll',
          overflowX: 'hidden',
          pt: 0.5,
          pr: 1,
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#7E57C2',
            borderRadius: '4px',
          },
          scrollbarWidth: 'thin',
          scrollbarColor: '#7E57C2 transparent',
        }}
      >
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
  const [probeAssignments, setProbeAssignments] = React.useState<Record<string, { area: string; location: string }>>({});
  const [dirtyAssignments, setDirtyAssignments] = React.useState<Set<string>>(new Set());
  // Track loading state for each probe assignment
  const [loadingProbes, setLoadingProbes] = React.useState<Set<string>>(new Set());
  // Track pending assignments to avoid stale closures
  const pendingAssignmentsRef = React.useRef<Map<string, { area: string; location: string }>>(new Map());

  // Initialize/refresh assignments from backend locations without wiping in-progress edits
  React.useEffect(() => {
    setProbeAssignments((prev) => {
      const next: Record<string, { area: string; location: string }> = { ...prev };
      const seen = new Set<string>();

      Object.values(probes).forEach((probe: any) => {
        seen.add(probe.id);
        if (probe.locationId && locations[probe.locationId]) {
          const location = locations[probe.locationId];
          if (!dirtyAssignments.has(probe.id)) {
            next[probe.id] = { area: location.area, location: location.name };
          }
        } else if (!next[probe.id]) {
          // Preserve existing manual edits; only initialize if we have no entry yet
          next[probe.id] = { area: '', location: '' };
        }
      });

      // Remove assignments for probes that no longer exist
      Object.keys(next).forEach((probeId) => {
        if (!seen.has(probeId)) {
          delete next[probeId];
        }
      });

      return next;
    });
  }, [probes, locations, dirtyAssignments]);

  const handleAreaChange = (probeId: string, area: string) => {
    setDirtyAssignments((prev) => {
      const next = new Set(prev);
      next.add(probeId);
      return next;
    });
    setProbeAssignments((prev) => ({
      ...prev,
      [probeId]: { ...prev[probeId], area, location: prev[probeId]?.location || '' },
    }));
  };

  const handleLocationChange = (probeId: string, location: string) => {
    setDirtyAssignments((prev) => {
      const next = new Set(prev);
      next.add(probeId);
      return next;
    });
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
      setDirtyAssignments((prev) => {
        const next = new Set(prev);
        next.delete(probeId);
        return next;
      });

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
      // Use API when not connected
      try {
        const response = await fetch(`/api/probes/${encodeURIComponent(probeId)}`, {
          method: 'POST',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            area: assignment.area,
            location: assignment.location,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          // Trigger the assignment callback to update UI
          if (onProbeAssignmentRef.current) {
            onProbeAssignmentRef.current(probeId, data.area, data.location);
          }
        } else {
          console.error('Failed to assign probe:', response.status, response.statusText);
          // Remove from loading state on error
          pendingAssignmentsRef.current.delete(probeId);
          setLoadingProbes((prev) => {
            const next = new Set(prev);
            next.delete(probeId);
            return next;
          });
        }
      } catch (error) {
        console.error('Error assigning probe:', error);
        // Remove from loading state on error
        pendingAssignmentsRef.current.delete(probeId);
        setLoadingProbes((prev) => {
          const next = new Set(prev);
          next.delete(probeId);
          return next;
        });
      }
    }
  };

  // Always include predefined areas, even if not yet discovered
  const predefinedAreas = ['FLOOR11', 'FLOOR12', 'FLOOR15', 'FLOOR16', 'FLOOR17', 'POOL', 'TEAROOM'];
  const areaList = Array.from(new Set([...predefinedAreas, ...Array.from(areas)])).sort();

  return (
    <Paper sx={{ p: 2 }} variant="outlined">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Probes
      </Typography>
      <Stack
        spacing={1}
        sx={{
          maxHeight: 350,
          overflowY: 'scroll',
          overflowX: 'hidden',
          pt: 0.5,
          pr: 1,
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#7E57C2',
            borderRadius: '4px',
          },
          scrollbarWidth: 'thin',
          scrollbarColor: '#7E57C2 transparent',
        }}
      >
        {Object.values(probes).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No probes available. Probes will appear here when they send data.
          </Typography>
        ) : (
          Object.values(probes).map((probe: any) => {
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
                  sx={{ minWidth: 120 }}
                />
                <Button
                  variant="contained"
                  size="small"
                  onClick={() => handleAssign(probe.id)}
                  disabled={!canAssign || loadingProbes.has(probe.id)}
                  sx={{ minWidth: 80 }}
                  startIcon={loadingProbes.has(probe.id) ? <CircularProgress size={16} /> : null}
                >
                  Assign
                </Button>
              </Stack>
            );
          })
        )}
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
      <Stack
        spacing={1}
        sx={{
          maxHeight: 350,
          overflowY: 'auto',
          overflowX: 'hidden',
          pr: 1,
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#9c27b0',
            borderRadius: '4px',
            '&:hover': {
              background: '#7b1fa2',
            },
          },
          scrollbarWidth: 'thin',
          scrollbarColor: '#9c27b0 transparent',
        }}
      >
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
                    <b>Temp:</b> {latestReading.temp.toFixed(1)}°C
                  </Typography>
                  <Typography variant="body2">
                    <b>Hum: </b>
                    {latestReading.hum.toFixed(1)}%
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
