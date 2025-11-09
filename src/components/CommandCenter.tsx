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
import { parseCommandResponse, AreaInfo, StatInfo, ThresholdInfo } from '../utils/commandParsing';
import SerialLog from './SerialLog';

type AreaData = {
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
}

export default function CommandCenter({ port, baud, connected, serialLog, onCommandResponseRef }: CommandCenterProps) {
  const [commandInput, setCommandInput] = useState('');
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [areas, setAreas] = useState<Map<string, AreaData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const pendingCommandRef = useRef<string | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);

  // Register callback to receive command responses from App.tsx
  useEffect(() => {
    onCommandResponseRef.current = onLine;
    return () => {
      onCommandResponseRef.current = null;
    };
  }, [onCommandResponseRef]);

  // Initialize writer when port changes
  useEffect(() => {
    if (port && port.writable && !writerRef.current) {
      writerRef.current = port.writable.getWriter();
    }
    return () => {
      if (writerRef.current) {
        writerRef.current.releaseLock();
        writerRef.current = null;
      }
    };
  }, [port]);

  async function sendCommand(cmd: string) {
    if (!port || !port.writable) {
      setCommandLog((prev) => [...prev, '[ERROR] Port not writable']);
      return;
    }
    const command = cmd.trim() + '\n';
    setCommandLog((prev) => [...prev, `[TX] ${cmd}`]);
    pendingCommandRef.current = cmd;
    try {
      // Get or reuse writer
      if (!writerRef.current) {
        writerRef.current = port.writable.getWriter();
      }
      const encoder = new TextEncoder();
      await writerRef.current.write(encoder.encode(command));
    } catch (e) {
      console.error('Send command error', e);
      setCommandLog((prev) => [...prev, `[ERROR] Failed to send: ${e}`]);
      // If writer is invalid, clear it so we get a new one next time
      if (writerRef.current) {
        try {
          writerRef.current.releaseLock();
        } catch {}
        writerRef.current = null;
      }
    }
  }

  const onLine = useCallback(
    async (line: string) => {
      if (!line) return;
      setCommandLog((prev) => [...prev, `[RX] ${line}`].slice(-1000));

      const parsed = parseCommandResponse(line);
      if (parsed.type === 'area' && parsed.data) {
        const areaInfo = parsed.data as AreaInfo;
        setAreas((prev) => {
          const next = new Map(prev);
          if (!next.has(areaInfo.area)) {
            next.set(areaInfo.area, {
              area: areaInfo.area,
              locations: new Map(),
              thresholds: new Map(),
              stats: new Map(),
            });
          }
          const areaData = next.get(areaInfo.area)!;
          // If no probe (empty strings), clear locations for this area
          if (!areaInfo.probeId || !areaInfo.probeId.trim() || !areaInfo.location || !areaInfo.location.trim()) {
            areaData.locations.clear();
          } else {
            // Only add location if there's a probe (check for non-empty strings)
            areaData.locations.set(areaInfo.location, areaInfo.probeId);
          }
          return next;
        });
      } else if (parsed.type === 'threshold' && parsed.data) {
        const thresholdInfo = parsed.data as ThresholdInfo;
        // Normalize metric name from firmware format to display format
        const normalizedMetric = normalizeMetricName(thresholdInfo.metric);
        setAreas((prev) => {
          const next = new Map(prev);
          if (!next.has(thresholdInfo.area)) {
            next.set(thresholdInfo.area, {
              area: thresholdInfo.area,
              locations: new Map(),
              thresholds: new Map(),
              stats: new Map(),
            });
          }
          const areaData = next.get(thresholdInfo.area)!;
          // Store with normalized metric name
          areaData.thresholds.set(normalizedMetric, { ...thresholdInfo, metric: normalizedMetric });
          return next;
        });
      } else if (parsed.type === 'stat' && parsed.data) {
        const statInfo = parsed.data as StatInfo;
        // Normalize metric name from firmware format to display format
        const normalizedMetric = normalizeMetricName(statInfo.metric);
        setAreas((prev) => {
          const next = new Map(prev);
          if (!next.has(statInfo.area)) {
            next.set(statInfo.area, {
              area: statInfo.area,
              locations: new Map(),
              thresholds: new Map(),
              stats: new Map(),
            });
          }
          const areaData = next.get(statInfo.area)!;
          // Store with normalized metric name
          areaData.stats.set(normalizedMetric, { ...statInfo, metric: normalizedMetric });
          return next;
        });
      }
    },
    [port]
  );

  // Register callback to receive command responses from App.tsx
  useEffect(() => {
    onCommandResponseRef.current = onLine;
    return () => {
      onCommandResponseRef.current = null;
    };
  }, [onLine, onCommandResponseRef]);

  async function handleSendCommand() {
    if (!commandInput.trim()) return;
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
                    onClick={() => sendCommand('GET AREAS')}
                    disabled={!connected}
                    fullWidth
                  >
                    GET AREAS
                  </Button>
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
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2 }} variant="outlined">
            <Typography variant="h6" sx={{ mb: 2 }}>
              Areas Configuration
            </Typography>
            {areas.size > 0 && (
              <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {Array.from(areas.values())
                  .sort((a, b) => a.area.localeCompare(b.area))
                  .map((areaData) => (
                    <Chip
                      key={areaData.area}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <span>{areaData.area}</span>
                          {areaData.locations.size > 0 && (
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
                        // Expand the accordion
                        setExpandedAreas((prev) => {
                          const next = new Set(prev);
                          next.add(areaData.area);
                          return next;
                        });
                        // Scroll to the area
                        setTimeout(() => {
                          const element = document.getElementById(`area-${areaData.area}`);
                          if (element) {
                            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }
                        }, 100);
                      }}
                      variant={areaData.locations.size > 0 ? 'filled' : 'outlined'}
                      color={areaData.locations.size > 0 ? 'primary' : 'default'}
                      sx={{ cursor: 'pointer' }}
                    />
                  ))}
              </Box>
            )}
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                <CircularProgress />
              </Box>
            )}
            {areas.size === 0 && !loading && (
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
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        sendCommand(`GET STATS ${areaData.area}`);
                      }}
                      disabled={!connected}
                      sx={{ minWidth: 'auto' }}
                    >
                      Get Stats
                    </Button>
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
                          No probes assigned
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
                                {threshold ? (
                                  <ThresholdForm
                                    area={areaData.area}
                                    metric={metric}
                                    initialValues={threshold.values}
                                    onSave={(values) => handleSetThreshold(areaData.area, metric, values)}
                                    disabled={!connected}
                                  />
                                ) : (
                                  <Typography variant="body2" color="text.secondary">
                                    Not loaded. Click Fetch to load thresholds.
                                  </Typography>
                                )}
                              </Paper>
                            </Grid>
                            <Grid item xs={12} md={6}>
                              <Paper variant="outlined" sx={{ p: 2 }}>
                                <Box
                                  sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}
                                >
                                  <Typography variant="caption" color="text.secondary">
                                    Statistics
                                  </Typography>
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={() => sendCommand(`GET STATS ${areaData.area}`)}
                                    disabled={!connected}
                                    sx={{ minWidth: 'auto', px: 1, py: 0.5 }}
                                  >
                                    Fetch
                                  </Button>
                                </Box>
                                {stat ? (
                                  <StatDisplay stat={stat} />
                                ) : (
                                  <Typography variant="body2" color="text.secondary">
                                    Not loaded. Click Fetch to load stats.
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

      <SerialLog log={serialLog} maxHeight={300} />
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
