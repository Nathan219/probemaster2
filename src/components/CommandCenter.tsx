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
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ThresholdInfo, StatInfo } from '../utils/commandParsing';
import SerialLog from './SerialLog';
import { ProbesPanel, UnassignProbesPanel } from './Lists';
import { Probe, Location, AreaName } from '../utils/types';

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
  probes: Record<string, Probe>;
  locations: Record<string, Location>;
  setProbes: React.Dispatch<React.SetStateAction<Record<string, Probe>>>;
  setLocations: React.Dispatch<React.SetStateAction<Record<string, Location>>>;
  areasList: Set<string>;
  getAreasTimestamp: number | null;
  clearSerialLog: () => void;
  onProbeAssignmentRef: React.MutableRefObject<((probeId: string, area: string, location: string) => void) | null>;
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
  probes,
  locations,
  setProbes,
  setLocations,
  areasList,
  getAreasTimestamp,
  clearSerialLog,
  onProbeAssignmentRef,
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

  async function handleSetThreshold(area: string, metric: string, values: number[]) {
    const valuesStr = values.map((v) => (v < 0 ? '-1' : v.toString())).join(',');
    await sendCommand(`SET THRESHOLD ${area} ${metric} ${valuesStr}`);
  }

  const metrics = ['CO2', 'Temp', 'Hum', 'Sound'];

  return (
    <Container maxWidth="xl" sx={{ py: 2 }}>
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
                Command Interface
              </Typography>
              {!connected && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Not connected. Connect serial port to use commands.
                </Alert>
              )}
              <Stack spacing={2}>
                <TextField
                  label="Command"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') handleSendCommand();
                  }}
                  disabled={!connected}
                  fullWidth
                  size="small"
                />
                <Button variant="contained" onClick={handleSendCommand} disabled={!connected} fullWidth>
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
                      onClick={() => sendCommand('GET STATS')}
                      disabled={!connected}
                      fullWidth
                    >
                      GET STATS
                    </Button>
                  </Stack>
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
            <Typography variant="h6" sx={{ mb: 2 }}>
              Areas Configuration
            </Typography>
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
                    <Box
                      component="span"
                      onClick={(e) => {
                        e.stopPropagation();
                        sendCommand(`GET STATS ${areaData.area}`);
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
                        cursor: connected ? 'pointer' : 'not-allowed',
                        opacity: connected ? 1 : 0.5,
                        '&:hover': connected ? { bgcolor: 'action.hover' } : {},
                      }}
                    >
                      Get Stats
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
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={() => sendCommand(`GET THRESHOLDS ${areaData.area} ${metric}`)}
                                    disabled={!connected}
                                    sx={{ minWidth: 'auto', px: 1, py: 0.5 }}
                                  >
                                    Fetch
                                  </Button>
                                </Box>
                                <ThresholdForm
                                  area={areaData.area}
                                  metric={metric}
                                  initialValues={threshold?.values ?? Array(6).fill(-1)}
                                  onSave={(values) => handleSetThreshold(areaData.area, metric, values)}
                                  disabled={!connected}
                                />
                              </Paper>
                            </Grid>
                            <Grid item xs={12} md={6}>
                              <Paper variant="outlined" sx={{ p: 2 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                  Statistics
                                </Typography>
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
  onSave,
  disabled,
}: {
  area: string;
  metric: string;
  initialValues: number[];
  onSave: (values: number[]) => void;
  disabled: boolean;
}) {
  const [values, setValues] = useState<number[]>(initialValues);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setValues(initialValues);
    setHasChanges(false);
  }, [initialValues]);

  const handleChange = (idx: number, val: string) => {
    const num = val === '' || val === '-' ? -1 : parseFloat(val);
    if (isNaN(num) && val !== '' && val !== '-') return;
    const newValues = [...values];
    newValues[idx] = num < 0 ? -1 : num;
    setValues(newValues);
    setHasChanges(JSON.stringify(newValues) !== JSON.stringify(initialValues));
  };

  const handleSave = () => {
    onSave(values);
    setHasChanges(false);
  };

  return (
    <Stack spacing={1}>
      <Grid container spacing={1}>
        {values.map((val, idx) => (
          <Grid item xs={4} key={idx}>
            <TextField
              label={`T${idx + 1}`}
              type="number"
              value={val < 0 ? '' : val}
              onChange={(e) => handleChange(idx, e.target.value)}
              disabled={disabled}
              size="small"
              fullWidth
              placeholder="-1"
            />
          </Grid>
        ))}
      </Grid>
      <Button variant="contained" size="small" onClick={handleSave} disabled={!hasChanges || disabled} fullWidth>
        Save Thresholds
      </Button>
    </Stack>
  );
}

function StatDisplay({ stat }: { stat: StatInfo }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">
        <strong>Min:</strong> {stat.min === -1 ? 'N/A' : stat.min.toFixed(2)}
      </Typography>
      <Typography variant="body2">
        <strong>Max:</strong> {stat.max === -1 ? 'N/A' : stat.max.toFixed(2)}
      </Typography>
      <Typography variant="body2">
        <strong>Min Override:</strong> {stat.min_o === -1 ? 'N/A' : stat.min_o.toFixed(2)}
      </Typography>
      <Typography variant="body2">
        <strong>Max Override:</strong> {stat.max_o === -1 ? 'N/A' : stat.max_o.toFixed(2)}
      </Typography>
    </Stack>
  );
}
