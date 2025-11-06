import React, { useEffect, useState } from 'react';
import {
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Stack,
  Box,
  Divider,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Alert,
} from '@mui/material';
import { AreaInfo, Stats, Pixel, Threshold, Probe, Location } from '../utils/types';

interface CommandCenterProps {
  port: SerialPort | null;
  connected: boolean;
  areas: AreaInfo[];
  stats: Stats[];
  pixels: Pixel[];
  thresholds: Threshold[];
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
  serialLog: string;
  onRefreshAreas: () => void;
  onRefreshStats: () => void;
  onRefreshPixels: () => void;
  onRefreshThresholds: () => void;
  onSetOverride: (areaName: string, type: 'MIN' | 'MAX', value: number) => void;
  onSetThreshold: (
    areaName: string,
    measurement: 'CO2' | 'HUM' | 'TEMP' | 'DB',
    pixelNum: number,
    value: number
  ) => void;
  onSetProbe: (probeId: string, areaName: string, location: string) => void;
}

interface ProbeAssignment {
  probeId: string;
  areaName: string;
  location: string;
}

export default function CommandCenter({
  port,
  connected,
  areas,
  stats,
  pixels,
  thresholds,
  probes,
  locations,
  serialLog,
  onRefreshAreas,
  onRefreshStats,
  onRefreshPixels,
  onRefreshThresholds,
  onSetOverride,
  onSetThreshold,
  onSetProbe,
}: CommandCenterProps) {
  const [probeAssignment, setProbeAssignment] = useState<ProbeAssignment>({
    probeId: '',
    areaName: '',
    location: '',
  });

  // Auto-refresh on mount when connected
  useEffect(() => {
    if (connected && port) {
      onRefreshAreas();
      onRefreshStats();
      onRefreshPixels();
      onRefreshThresholds();
    }
  }, [connected, port]);

  const handleRefreshAll = async () => {
    if (!port || !connected) return;
    onRefreshAreas();
    onRefreshStats();
    onRefreshPixels();
    onRefreshThresholds();
  };

  const handleOverrideChange = (stat: Stats, type: 'MIN' | 'MAX', value: number) => {
    onSetOverride(stat.areaName, type, value);
  };

  const handleThresholdChange = (threshold: Threshold, pixelIndex: number, value: number) => {
    onSetThreshold(threshold.areaName, threshold.measurement, pixelIndex + 1, value);
  };

  const handleSetProbe = () => {
    if (!probeAssignment.probeId || !probeAssignment.areaName || !probeAssignment.location) return;
    onSetProbe(probeAssignment.probeId, probeAssignment.areaName, probeAssignment.location);
    setProbeAssignment({ probeId: '', areaName: '', location: '' });
  };

  if (!connected) {
    return (
      <Paper sx={{ p: 2 }} variant="outlined">
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Command Center
        </Typography>
        <Alert severity="info">Connect to serial port to use Command Center</Alert>
      </Paper>
    );
  }

  // Get unique area names from locations
  const areaNames = Array.from(new Set(Object.values(locations).map((l) => l.area)));

  // Get location names for a given area
  const getLocationsForArea = (areaName: string) => {
    return Object.values(locations)
      .filter((l) => l.area === areaName)
      .map((l) => l.name);
  };

  return (
    <Paper sx={{ p: 2 }} variant="outlined">
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="subtitle1">Command Center</Typography>
        <Button variant="contained" onClick={handleRefreshAll}>
          Refresh All
        </Button>
      </Stack>

      <Stack spacing={3}>
        {/* Areas Display */}
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">Areas</Typography>
            <Button size="small" variant="outlined" onClick={onRefreshAreas}>
              Refresh
            </Button>
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Area Name</TableCell>
                  <TableCell>Location Name</TableCell>
                  <TableCell>Probe ID</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {areas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} align="center">
                      No area data
                    </TableCell>
                  </TableRow>
                ) : (
                  areas.map((area, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{area.areaName}</TableCell>
                      <TableCell>{area.locationName}</TableCell>
                      <TableCell>{area.probeId}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        <Divider />

        {/* Stats Display and Edit */}
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">Stats</Typography>
            <Button size="small" variant="outlined" onClick={onRefreshStats}>
              Refresh
            </Button>
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Area</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Min</TableCell>
                  <TableCell>Max</TableCell>
                  <TableCell>Override Min</TableCell>
                  <TableCell>Override Max</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stats.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      No stats
                    </TableCell>
                  </TableRow>
                ) : (
                  stats.map((stat, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{stat.areaName}</TableCell>
                      <TableCell>{stat.location}</TableCell>
                      <TableCell>{stat.min}</TableCell>
                      <TableCell>{stat.max}</TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          type="number"
                          value={stat.overrideMin ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseFloat(e.target.value);
                            if (val !== null && !isNaN(val)) {
                              handleOverrideChange(stat, 'MIN', val);
                            }
                          }}
                          placeholder="Not set"
                          sx={{ width: 100 }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          type="number"
                          value={stat.overrideMax ?? ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? null : parseFloat(e.target.value);
                            if (val !== null && !isNaN(val)) {
                              handleOverrideChange(stat, 'MAX', val);
                            }
                          }}
                          placeholder="Not set"
                          sx={{ width: 100 }}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        <Divider />

        {/* Pixels Display and Edit */}
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">Pixels</Typography>
            <Button size="small" variant="outlined" onClick={onRefreshPixels}>
              Refresh
            </Button>
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Area</TableCell>
                  <TableCell>Measurement</TableCell>
                  <TableCell>Pixel Value (0-6)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pixels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} align="center">
                      No pixels data
                    </TableCell>
                  </TableRow>
                ) : (
                  pixels.map((pixel, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{pixel.areaName}</TableCell>
                      <TableCell>{pixel.measurement}</TableCell>
                      <TableCell>{pixel.pixel}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        <Divider />

        {/* Thresholds Display and Edit */}
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">Thresholds</Typography>
            <Button size="small" variant="outlined" onClick={onRefreshThresholds}>
              Refresh
            </Button>
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Area</TableCell>
                  <TableCell>Measurement</TableCell>
                  <TableCell>P1</TableCell>
                  <TableCell>P2</TableCell>
                  <TableCell>P3</TableCell>
                  <TableCell>P4</TableCell>
                  <TableCell>P5</TableCell>
                  <TableCell>P6</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {thresholds.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      No thresholds data
                    </TableCell>
                  </TableRow>
                ) : (
                  thresholds.map((threshold, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{threshold.areaName}</TableCell>
                      <TableCell>{threshold.measurement}</TableCell>
                      {threshold.values.map((value, pixelIdx) => (
                        <TableCell key={pixelIdx}>
                          <TextField
                            size="small"
                            type="number"
                            value={value}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              if (!isNaN(val) && val >= -1 && val <= 100) {
                                handleThresholdChange(threshold, pixelIdx, val);
                              }
                            }}
                            slotProps={{ htmlInput: { min: -1, max: 100 } }}
                            sx={{ width: 80 }}
                            placeholder="-1"
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        <Divider />

        {/* Probe Assignment */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Assign Probe
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Probe ID</InputLabel>
              <Select
                value={probeAssignment.probeId}
                onChange={(e) => setProbeAssignment({ ...probeAssignment, probeId: e.target.value })}
                label="Probe ID"
              >
                {Object.keys(probes).map((id) => (
                  <MenuItem key={id} value={id}>
                    {id}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Area</InputLabel>
              <Select
                value={probeAssignment.areaName}
                onChange={(e) => {
                  setProbeAssignment({ ...probeAssignment, areaName: e.target.value, location: '' });
                }}
                label="Area"
              >
                {areaNames.map((area) => (
                  <MenuItem key={area} value={area}>
                    {area}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Location</InputLabel>
              <Select
                value={probeAssignment.location}
                onChange={(e) => setProbeAssignment({ ...probeAssignment, location: e.target.value })}
                label="Location"
                disabled={!probeAssignment.areaName}
              >
                {probeAssignment.areaName &&
                  getLocationsForArea(probeAssignment.areaName).map((loc) => (
                    <MenuItem key={loc} value={loc}>
                      {loc}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              onClick={handleSetProbe}
              disabled={!probeAssignment.probeId || !probeAssignment.areaName || !probeAssignment.location}
            >
              Set Probe
            </Button>
          </Stack>
        </Box>

        <Divider />

        {/* Serial Log */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Serial Log
          </Typography>
          <Paper
            variant="outlined"
            sx={{
              p: 1,
              bgcolor: 'background.default',
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.875rem', fontFamily: 'monospace' }}>
              {serialLog || 'No data yet...'}
            </pre>
          </Paper>
        </Box>
      </Stack>
    </Paper>
  );
}
