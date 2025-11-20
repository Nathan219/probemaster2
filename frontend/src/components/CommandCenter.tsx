import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Grid,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Stack,
  Alert,
  CircularProgress,
  Container,
  Chip,
  useTheme,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ThresholdInfo, StatInfo } from '../utils/commandParsing';
import SerialLog from './SerialLog';
import { ProbesPanel, UnassignProbesPanel } from './Lists';
import { Probe, Location, AreaName } from '../utils/types';
import { formatLastFetched } from '../App';
import { getAuthHeaders } from '../utils/auth';

export type AreaData = {
  area: string;
  locations: Map<string, string>; // location -> probeId
  thresholds: Map<string, ThresholdInfo>; // metric -> threshold info
  stats: Map<string, StatInfo>; // metric -> stat info
};

// Map firmware metric names to display names
function normalizeMetricName(metric: string): string {
  const upper = metric.toUpperCase();
  if (upper === 'TEMP') return 'Temp';
  if (upper === 'HUM') return 'Hum';
  if (upper === 'DB') return 'Sound';
  return metric; // CO2 stays as CO2
}

interface CommandCenterProps {
  port: SerialPort | null;
  baud: number;
  connected: boolean;
  serialLog: string;
  onCommandResponseRef: React.MutableRefObject<((line: string) => void) | null>;
  onCommandLogRef: React.MutableRefObject<((line: string) => void) | null>;
  areas: Map<string, AreaData>;
  setAreas: React.Dispatch<React.SetStateAction<Map<string, AreaData>>>;
  sendCommand: (cmd: string) => Promise<void>;
  onGetStats?: (area?: string) => Promise<void>;
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
  setProbes: React.Dispatch<React.SetStateAction<Record<string, Probe>>>;
  setLocations: React.Dispatch<React.SetStateAction<Record<string, Location>>>;
  areasList: Set<string>;
  getAreasTimestamp: number | null;
  areasLastFetched: number | null;
  thresholdsLastFetched: Map<string, number>;
  statsLastFetched: Map<string, number>;
  clearSerialLog: () => void;
  onProbeAssignmentRef: React.MutableRefObject<((probeId: string, area: string, location: string) => void) | null>;
  probeRefreshInterval: number;
  setProbeRefreshInterval: React.Dispatch<React.SetStateAction<number>>;
  pollingFrequency: number;
  setPollingFrequency: React.Dispatch<React.SetStateAction<number>>;
  passwordUnlocked?: boolean;
}

export default function CommandCenter({
  port,
  baud,
  connected,
  serialLog,
  onCommandResponseRef,
  onCommandLogRef,
  areas,
  setAreas,
  sendCommand,
  onGetStats,
  probes,
  locations,
  setProbes,
  setLocations,
  areasList,
  getAreasTimestamp,
  areasLastFetched,
  thresholdsLastFetched,
  statsLastFetched,
  clearSerialLog,
  onProbeAssignmentRef,
  probeRefreshInterval,
  setProbeRefreshInterval,
  pollingFrequency,
  setPollingFrequency,
  passwordUnlocked,
}: CommandCenterProps) {
  const [commandInput, setCommandInput] = useState('');
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());

  // Calculate loading state: loading if timestamp exists and we have less than 7 areas
  const isLoadingAreas = getAreasTimestamp !== null && areas.size < 7;

  const onLine = useCallback(async (line: string) => {
    if (!line) return;
    setCommandLog((prev) => [...prev, `[RX] ${line}`].slice(-1000));
    // State updates are handled in App.tsx, we just log here
  }, []);

  const onCommandLog = useCallback((line: string) => {
    setCommandLog((prev) => [...prev, line].slice(-1000));
  }, []);

  // Register callback to receive command responses from App.tsx
  useEffect(() => {
    onCommandResponseRef.current = onLine;
    return () => {
      onCommandResponseRef.current = null;
    };
  }, [onCommandResponseRef, onLine]);

  // Register callback to receive command log entries from App.tsx
  useEffect(() => {
    onCommandLogRef.current = onCommandLog;
    return () => {
      onCommandLogRef.current = null;
    };
  }, [onCommandLogRef, onCommandLog]);

  async function handleSendCommand() {
    if (!commandInput.trim()) return;
    setCommandLog((prev) => [...prev, `[TX] ${commandInput}`]);
    await sendCommand(commandInput);
    setCommandInput('');
  }

  async function handleGetThresholds(area: string) {
    try {
      const response = await fetch(`/api/thresholds/${encodeURIComponent(area)}`, {
        method: 'GET',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Failed to fetch thresholds:', response.status, response.statusText);
        return;
      }

      const data = await response.json();
      const thresholds = data.thresholds || [];

      // Directly update the areas state with threshold data
      setAreas((prev) => {
        const next = new Map(prev);
        const areaName = area.toUpperCase();
        const existingArea = next.get(areaName);
        
        const newThresholds = existingArea ? new Map(existingArea.thresholds) : new Map();
        const newLocations = existingArea ? new Map(existingArea.locations) : new Map();
        const newStats = existingArea ? new Map(existingArea.stats) : new Map();

        // Process each threshold
        for (const threshold of thresholds) {
          // Ensure we have values array
          if (!threshold.values || !Array.isArray(threshold.values)) {
            console.warn('Invalid threshold values:', threshold);
            continue;
          }
          
          // Normalize metric name (co2 -> CO2, temp -> Temp, hum -> Hum, db -> Sound)
          const metricLower = threshold.metric.toLowerCase();
          const normalizedMetric =
            metricLower === 'temp' ? 'Temp' :
            metricLower === 'hum' ? 'Hum' :
            metricLower === 'db' ? 'Sound' :
            metricLower === 'co2' ? 'CO2' :
            threshold.metric;
          
          // Ensure we have 6 numeric values
          const values = threshold.values
            .slice(0, 6)
            .map((v: any) => {
              if (typeof v === 'number' && Number.isFinite(v)) {
                return v;
              }
              const parsed = parseFloat(String(v));
              return Number.isFinite(parsed) ? parsed : -1;
            });
          while (values.length < 6) {
            values.push(-1);
          }
          
          // Create threshold info
          const thresholdInfo: ThresholdInfo = {
            area: areaName,
            metric: normalizedMetric,
            values: values,
          };
          
          newThresholds.set(normalizedMetric, thresholdInfo);
          
          // Also trigger the callback to update timestamps
          const thresholdLine = `THRESHOLD ${areaName} ${normalizedMetric} ${values
            .map((v: number) => (v < 0 ? '-1' : v.toFixed(1)))
            .join(' ')}`;
          onCommandResponseRef.current?.(thresholdLine);
        }

        if (!existingArea) {
          next.set(areaName, {
            area: areaName,
            locations: newLocations,
            thresholds: newThresholds,
            stats: newStats,
          });
        } else {
          next.set(areaName, {
            ...existingArea,
            thresholds: newThresholds,
          });
        }

        return next;
      });
    } catch (error) {
      console.error('Error fetching thresholds:', error);
    }
  }

  async function handleGetAllThresholds() {
    // Predefined areas
    const areas = ['FLOOR11', 'FLOOR12', 'FLOOR15', 'FLOOR16', 'FLOOR17', 'POOL', 'TEAROOM'];

    for (const area of areas) {
      try {
        await handleGetThresholds(area);
      } catch (error) {
        console.error(`Error fetching thresholds for ${area}:`, error);
      }
    }

    setCommandLog((prev) => [...prev, `[API] Fetched thresholds for all areas`]);
  }

  async function handleSetThreshold(area: string, metric: string, values: number[]) {
    if (connected && sendCommand) {
      // Use serial command when connected
      const valuesStr = values.map((v) => (v < 0 ? '-1' : v.toString())).join(',');
      await sendCommand(`SET THRESHOLD ${area} ${metric} ${valuesStr}`);
    } else {
      // Use API when not connected
      try {
        // First, get existing thresholds for the area
        const response = await fetch(`/api/thresholds/${encodeURIComponent(area)}`, {
          method: 'GET',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
        });

        let existingThresholds: Array<{ metric: string; values: number[] }> = [];
        if (response.ok) {
          const data = await response.json();
          existingThresholds = data.thresholds || [];
        }

        // Update or add the threshold for this metric
        // Convert display metric name to backend format (CO2 -> co2, Temp -> temp, Hum -> hum, Sound -> db)
        let metricBackend = metric.toLowerCase();
        if (metricBackend === 'sound') {
          metricBackend = 'db';
        }
        const existingIndex = existingThresholds.findIndex((t) => t.metric.toLowerCase() === metricBackend);
        const updatedThreshold = { metric: metricBackend, values };

        if (existingIndex >= 0) {
          existingThresholds[existingIndex] = updatedThreshold;
        } else {
          existingThresholds.push(updatedThreshold);
        }

        // Save all thresholds
        const saveResponse = await fetch(`/api/thresholds/${encodeURIComponent(area)}`, {
          method: 'POST',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ thresholds: existingThresholds }),
        });

        if (saveResponse.ok) {
          // Get thresholds from the response
          const saveData = await saveResponse.json();
          const thresholds = saveData.thresholds || [];
          
          if (thresholds.length > 0) {
            // Process each threshold as if it came from serial to update UI
            for (const threshold of thresholds) {
              const displayMetric = normalizeMetricName(threshold.metric);
              const thresholdLine = `THRESHOLD ${area} ${displayMetric} ${threshold.values.join(' ')}`;
              onCommandResponseRef.current?.(thresholdLine);
            }
          } else {
            // Fallback: just process the one we set
            const thresholdLine = `THRESHOLD ${area} ${metric} ${values.join(' ')}`;
            onCommandResponseRef.current?.(thresholdLine);
          }
        } else {
          console.error('Failed to save threshold:', saveResponse.status, saveResponse.statusText);
        }
      } catch (error) {
        console.error('Error saving threshold:', error);
      }
    }
  }

  async function handleSetProbeRefreshInterval() {
    try {
      const response = await fetch('/api/probeconfig', {
        method: 'PUT',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh: probeRefreshInterval }),
      });
      if (response.ok) {
        const data = await response.json();
        setProbeRefreshInterval(data.refresh);
      } else {
        console.error('Failed to update probe refresh interval');
      }
    } catch (error) {
      console.error('Error updating probe refresh interval:', error);
    }
  }

  const metrics = ['CO2', 'Temp', 'Hum', 'Sound'];

  return (
    <Container maxWidth="xl" sx={{ py: 2 }}>
      {passwordUnlocked && (
        <Box
          sx={{
            position: 'fixed',
            top: 32,
            right: 32,
            width: 150,
            height: 150,
            transform: 'rotate(6deg)',
            background: '#fff6a8',
            color: '#333',
            px: 3,
            py: 2,
            boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
            borderRadius: 1,
            border: '1px solid rgba(0,0,0,0.15)',
            zIndex: 1200,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            fontFamily: '"Comic Sans MS", "Comic Sans", cursive',
            '&:before': {
              content: '""',
              position: 'absolute',
              top: -10,
              left: '50%',
              width: 60,
              height: 16,
              background: 'rgba(255,255,255,0.75)',
              border: '1px solid rgba(0,0,0,0.1)',
              transform: 'translateX(-50%) rotate(-12deg)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            },
          }}
        >
          <Typography
            variant="h7"
            sx={{
              fontFamily: '"Comic Sans MS", "Comic Sans", cursive',
              fontWeight: 700,
              mb: 0.5,
              textAlign: 'center',
              mt: -1,
            }}
          >
            Password:
          </Typography>
          <Typography
            variant="h5"
            sx={{
              fontFamily: '"Comic Sans MS", "Comic Sans", cursive',
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            sasquatch
          </Typography>
        </Box>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" size="small" onClick={handleGetAllThresholds}>
          Fetch All Thresholds
        </Button>
      </Box>
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Stack spacing={2}>
            <UnassignProbesPanel
              probes={probes}
              locations={locations}
              setProbes={setProbes}
              sendCommand={sendCommand}
              connected={connected}
              setCommandCenterAreas={setAreas}
            />
            <ProbesPanel
              probes={probes}
              locations={locations}
              setProbes={setProbes}
              setLocations={setLocations}
              areas={areasList}
              sendCommand={sendCommand}
              connected={connected}
              onProbeAssignmentRef={onProbeAssignmentRef}
              setCommandCenterAreas={setAreas}
            />
            <Paper sx={{ p: 2 }} variant="outlined">
              <Typography variant="h6" sx={{ mb: 2 }}>
                N.E.R.V.E.S Center
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label="Command"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') handleSendCommand();
                  }}
                  fullWidth
                  size="small"
                />
                <Button variant="contained" onClick={handleSendCommand} fullWidth>
                  Send Command
                </Button>
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Quick Actions
                  </Typography>
                  <Stack spacing={1}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={async () => {
                        if (connected && sendCommand) {
                          await sendCommand('GET STATS');
                        } else if (onGetStats) {
                          await onGetStats();
                        }
                      }}
                      fullWidth
                    >
                      GET STATS
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={async () => {
                        await handleGetAllThresholds();
                      }}
                      fullWidth
                    >
                      GET ALL THRESHOLDS
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      color="warning"
                      onClick={async () => {
                        try {
                          const response = await fetch('/api/clear', {
                            method: 'POST',
                            headers: {
                              ...getAuthHeaders(),
                              'Content-Type': 'application/json',
                            },
                          });
                          if (response.ok) {
                            const data = await response.json();
                            console.log('Backend data cleared:', data);
                            // Optionally show a success message or update UI
                            setCommandLog((prev) => [...prev, `[API] Backend data cleared`]);
                          } else {
                            console.error('Failed to clear backend data:', response.status, response.statusText);
                            setCommandLog((prev) => [...prev, `[API] Failed to clear: ${response.statusText}`]);
                          }
                        } catch (error) {
                          console.error('Error clearing backend data:', error);
                          setCommandLog((prev) => [...prev, `[API] Error: ${error}`]);
                        }
                      }}
                      fullWidth
                    >
                      Clear Backend Data
                    </Button>
                  </Stack>
                </Box>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Probe Refresh Interval
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <FormControl size="small" sx={{ flexGrow: 1 }}>
                      <InputLabel>Frequency</InputLabel>
                      <Select
                        value={probeRefreshInterval}
                        label="Frequency"
                        onChange={(e) => {
                          const value = e.target.value as number;
                          setProbeRefreshInterval(value);
                        }}
                      >
                        <MenuItem value={5}>5 seconds</MenuItem>
                        <MenuItem value={10}>10 seconds</MenuItem>
                        <MenuItem value={20}>20 seconds</MenuItem>
                        <MenuItem value={30}>30 seconds</MenuItem>
                        <MenuItem value={60}>1 minute</MenuItem>
                        <MenuItem value={300}>5 minutes</MenuItem>
                      </Select>
                    </FormControl>
                    <Button
                      variant="contained"
                      onClick={handleSetProbeRefreshInterval}
                      size="small"
                    >
                      Set
                    </Button>
                  </Stack>
                </Box>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Polling Frequency
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                    How often to poll the backend for new messages
                  </Typography>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Frequency</InputLabel>
                    <Select
                      value={pollingFrequency}
                      label="Frequency"
                      onChange={(e) => {
                        const value = e.target.value as number;
                        setPollingFrequency(value);
                      }}
                    >
                      <MenuItem value={1}>1 second</MenuItem>
                      <MenuItem value={2}>2 seconds</MenuItem>
                      <MenuItem value={5}>5 seconds</MenuItem>
                      <MenuItem value={10}>10 seconds</MenuItem>
                      <MenuItem value={30}>30 seconds</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              </Stack>
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Command Log
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1,
                    maxHeight: 400,
                    overflow: 'auto',
                    bgcolor: 'background.default',
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                  }}
                >
                  {commandLog.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      No commands yet...
                    </Typography>
                  ) : (
                    commandLog.map((line, idx) => (
                      <Box key={idx} sx={{ mb: 0.5 }}>
                        {line}
                      </Box>
                    ))
                  )}
                </Paper>
              </Box>
            </Paper>
          </Stack>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2 }} variant="outlined">
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                Areas Configuration
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Last fetched: {formatLastFetched(areasLastFetched)}
              </Typography>
            </Box>
            {isLoadingAreas && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={20} />
                  <Box>
                    <Typography variant="body2">Loading areas... ({areas.size}/7)</Typography>
                    {getAreasTimestamp && (
                      <Typography variant="caption" color="text.secondary">
                        Request sent at {new Date(getAreasTimestamp).toLocaleTimeString()}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </Alert>
            )}
            <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {Object.values(AreaName)
                .sort((a, b) => a.localeCompare(b))
                .map((areaName) => {
                  // Areas are now stored with normalized names, so direct lookup should work
                  const areaData = areas.get(areaName);
                  const hasData = !!areaData;
                  const hasLocations = (areaData?.locations?.size ?? 0) > 0;
                  return (
                    <Chip
                      key={areaName}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <span>{areaName}</span>
                          {hasLocations && (
                            <Box
                              component="span"
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                bgcolor: 'success.main',
                                display: 'inline-block',
                              }}
                            />
                          )}
                        </Box>
                      }
                      onClick={() => {
                        if (hasData) {
                          // Expand the accordion
                          setExpandedAreas((prev) => {
                            const next = new Set(prev);
                            next.add(areaName);
                            return next;
                          });
                          // Scroll to the area
                          setTimeout(() => {
                            const element = document.getElementById(`area-${areaName}`);
                            if (element) {
                              element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                          }, 100);
                        }
                      }}
                      variant={hasLocations ? 'filled' : 'outlined'}
                      color={hasLocations ? 'primary' : 'default'}
                      sx={{
                        cursor: hasData ? 'pointer' : 'default',
                        opacity: hasData ? 1 : 0.5,
                      }}
                      disabled={!hasData}
                    />
                  );
                })}
            </Box>
            {areas.size === 0 && !isLoadingAreas && (
              <Alert severity="info">No areas discovered yet. Send GET AREAS to discover areas.</Alert>
            )}
            {Array.from(areas.values()).map((areaData) => (
              <Accordion
                key={areaData.area}
                id={`area-${areaData.area}`}
                expanded={expandedAreas.has(areaData.area)}
                onChange={(_, isExpanded) => {
                  setExpandedAreas((prev) => {
                    const next = new Set(prev);
                    if (isExpanded) {
                      next.add(areaData.area);
                    } else {
                      next.delete(areaData.area);
                    }
                    return next;
                  });
                }}
                sx={{ mb: 1 }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      width: '100%',
                      mr: 2,
                    }}
                  >
                    <Typography variant="subtitle1">
                      {areaData.area} ({areaData.locations.size} location{areaData.locations.size !== 1 ? 's' : ''})
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {(() => {
                        // Find the most recent stat timestamp for this area
                        const metrics = ['CO2', 'Temp', 'Hum', 'Sound'];
                        let mostRecentStat: number | null = null;
                        for (const metric of metrics) {
                          const key = `${areaData.area}-${metric}`;
                          const timestamp = statsLastFetched.get(key);
                          if (timestamp && (!mostRecentStat || timestamp > mostRecentStat)) {
                            mostRecentStat = timestamp;
                          }
                        }
                        return (
                          <Typography variant="caption" color="text.secondary">
                            Last Fetched: {formatLastFetched(mostRecentStat)}
                          </Typography>
                        );
                      })()}
                      <Box
                        component="span"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (connected && sendCommand) {
                            await sendCommand(`GET STATS ${areaData.area}`);
                          } else if (onGetStats) {
                            await onGetStats(areaData.area);
                          }
                        }}
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: 'auto',
                          px: 1.5,
                          py: 0.5,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          fontSize: '0.875rem',
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        Get Stats
                      </Box>
                    </Box>
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={3}>
                    <Box>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Locations & Probes
                      </Typography>
                      {areaData.locations.size === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No Probes Assigned
                        </Typography>
                      ) : (
                        Array.from(areaData.locations.entries()).map(([location, probeId]) => (
                          <Typography key={location} variant="body2" sx={{ mb: 0.5 }}>
                            {location} → Probe {probeId}
                          </Typography>
                        ))
                      )}
                    </Box>

                    {metrics.map((metric) => {
                      const threshold = areaData.thresholds.get(metric);
                      const stat = areaData.stats.get(metric);
                      return (
                        <Box key={metric}>
                          <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            {metric}
                          </Typography>
                          <Grid container spacing={2}>
                            <Grid item xs={12} md={6}>
                              <Paper variant="outlined" sx={{ p: 2 }}>
                                <Box
                                  sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}
                                >
                                  <Typography variant="caption" color="text.secondary">
                                    Thresholds
                                  </Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    {(() => {
                                      const key = `${areaData.area}-${metric}`;
                                      const timestamp = thresholdsLastFetched.get(key);
                                      return (
                                        <Typography variant="caption" color="text.secondary">
                                          Last Fetched: {formatLastFetched(timestamp || null)}
                                        </Typography>
                                      );
                                    })()}
                                    <Button
                                      variant="outlined"
                                      size="small"
                                      onClick={async () => {
                                        if (connected && sendCommand) {
                                          await sendCommand(`GET THRESHOLDS ${areaData.area} ${metric}`);
                                        } else {
                                          await handleGetThresholds(areaData.area);
                                        }
                                      }}
                                      sx={{ minWidth: 'auto', px: 1, py: 0.5 }}
                                    >
                                      Fetch
                                    </Button>
                                  </Box>
                                </Box>
                                <ThresholdForm
                                  area={areaData.area}
                                  metric={metric}
                                  initialValues={threshold?.values}
                                  hasThreshold={!!threshold}
                                  onSave={(values) => handleSetThreshold(areaData.area, metric, values)}
                                  disabled={false}
                                  stat={stat}
                                />
                              </Paper>
                            </Grid>
                            <Grid item xs={12} md={6}>
                              <Paper variant="outlined" sx={{ p: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="caption" color="text.secondary">
                                    Statistics
                                  </Typography>
                                  {(() => {
                                    const key = `${areaData.area}-${metric}`;
                                    const timestamp = statsLastFetched.get(key);
                                    return timestamp ? (
                                      <Typography variant="caption" color="text.secondary">
                                        Last Fetched: {formatLastFetched(timestamp)}
                                      </Typography>
                                    ) : null;
                                  })()}
                                </Box>
                                {stat ? (
                                  <StatDisplay stat={stat} />
                                ) : (
                                  <Typography variant="body2" color="text.secondary">
                                    Not loaded. Click "Get Stats" above to load stats.
                                  </Typography>
                                )}
                              </Paper>
                            </Grid>
                          </Grid>
                        </Box>
                      );
                    })}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ))}
          </Paper>
        </Grid>
      </Grid>

      <SerialLog log={serialLog} maxHeight={300} onClear={clearSerialLog} />
    </Container>
  );
}

function ThresholdForm({
  area,
  metric,
  initialValues,
  hasThreshold,
  onSave,
  disabled,
  stat,
}: {
  area: string;
  metric: string;
  initialValues: number[] | undefined;
  hasThreshold: boolean;
  onSave: (values: number[]) => void;
  disabled: boolean;
  stat?: StatInfo;
}) {
  // Convert number[] to (number | null)[]
  // -1 from protocol is a valid value, not unset
  // Only null represents unset (when threshold data doesn't exist)
  const convertToNullable = (vals: number[] | undefined): (number | null)[] => {
    if (!vals) {
      return [null, null, null, null, null, null];
    }
    return vals.map((v) => v); // Keep all values as-is, including -1
  };

  // Convert (number | null)[] back to number[] where null becomes -1 for protocol
  // The protocol uses -1 to represent unset values
  const convertFromNullable = (vals: (number | null)[]): number[] => {
    return vals.map((v) => (v === null ? -1 : v));
  };

  const [values, setValues] = useState<(number | null)[]>(convertToNullable(initialValues));
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    // Only update from initialValues if there are no unsaved changes
    // This prevents overwriting user's in-progress edits when new data arrives
    if (!hasChanges) {
      setValues(convertToNullable(initialValues));
    }
  }, [initialValues, hasChanges]);

  const handleChange = (idx: number, val: string) => {
    let newValue: number | null;
    if (val === '' || val === '-') {
      newValue = null; // Unset
    } else {
      const num = parseFloat(val);
      if (isNaN(num)) return;
      newValue = num; // Can be any number including -1
    }
    const newValues = [...values];
    newValues[idx] = newValue;
    setValues(newValues);
    setHasChanges(JSON.stringify(newValues) !== JSON.stringify(convertToNullable(initialValues)));
  };

  const handleSave = () => {
    // Check if any values are null (unset)
    if (values.some((v) => v === null)) {
      // Don't send command if any values are null
      return;
    }
    // Convert back to number[] for the protocol (all values are set, no nulls)
    onSave(values.map((v) => v!)); // Non-null assertion is safe here due to check above
    setHasChanges(false);
  };

  const handleDiscard = () => {
    // Reset values back to initial values
    setValues(convertToNullable(initialValues));
    setHasChanges(false);
  };

  // Get current value from stats (use max as the current measured value)
  const getCurrentValue = (): number | null => {
    if (!stat) return null;
    // Use max as the current measured value, or min if max is -1
    if (stat.max !== -1) return stat.max;
    if (stat.min !== -1) return stat.min;
    return null;
  };

  const currentValue = getCurrentValue();
  const theme = useTheme();
  const initialValuesNullable = convertToNullable(initialValues);

  return (
    <Stack spacing={1}>
      <Grid container spacing={1}>
        {values.map((val, idx) => {
          const isUnset = val === null;
          const displayValue = isUnset && currentValue !== null ? currentValue : val === null ? '' : val;
          const isEdited = val !== initialValuesNullable[idx];
          const isDark = theme.palette.mode === 'dark';
          const borderColor = isEdited ? (isDark ? '#ffd54f' : '#ffc107') : undefined;

          return (
            <Grid item xs={4} key={idx}>
              <TextField
                label={`T${idx + 1}`}
                type="number"
                value={displayValue}
                onChange={(e) => handleChange(idx, e.target.value)}
                disabled={disabled}
                size="small"
                fullWidth
                placeholder={currentValue !== null ? currentValue.toString() : 'Unset'}
                sx={{
                  '& .MuiInputBase-input': {
                    color: isUnset && currentValue !== null ? 'text.secondary' : 'text.primary',
                    fontStyle: isUnset && currentValue !== null ? 'italic' : 'normal',
                  },
                  ...(isEdited && {
                    '& .MuiOutlinedInput-root': {
                      '& fieldset': {
                        borderColor: borderColor,
                        borderWidth: 2,
                      },
                      '&:hover fieldset': {
                        borderColor: borderColor,
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: borderColor,
                      },
                    },
                  }),
                }}
                helperText={isUnset && currentValue !== null ? 'Current value' : undefined}
              />
            </Grid>
          );
        })}
      </Grid>
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          size="small"
          onClick={handleDiscard}
          disabled={!hasChanges || disabled}
          sx={{ flex: 1 }}
        >
          Discard
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={handleSave}
          disabled={!hasChanges || disabled || values.some((v) => v === null)}
          sx={{ flex: 1 }}
        >
          Save Thresholds
        </Button>
      </Stack>
    </Stack>
  );
}

function StatDisplay({ stat }: { stat: StatInfo }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">
        <strong>Min:</strong> {stat.min === -1 ? 'N/A' : stat.min.toFixed(1)}
      </Typography>
      <Typography variant="body2">
        <strong>Max:</strong> {stat.max === -1 ? 'N/A' : stat.max.toFixed(1)}
      </Typography>
      <Typography variant="body2">
        <strong>Min Override:</strong> {stat.min_o === -1 ? 'N/A' : stat.min_o.toFixed(1)}
      </Typography>
      <Typography variant="body2">
        <strong>Max Override:</strong> {stat.max_o === -1 ? 'N/A' : stat.max_o.toFixed(1)}
      </Typography>
    </Stack>
  );
}
