import React, { useEffect, useRef, useState } from 'react';
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
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { parseCommandResponse, AreaInfo, StatInfo, ThresholdInfo } from '../utils/commandParsing';

type AreaData = {
  area: string;
  locations: Map<string, string>; // location -> probeId
  thresholds: Map<string, ThresholdInfo>; // metric -> threshold info
  stats: Map<string, StatInfo>; // metric -> stat info
};

interface CommandCenterProps {
  port: SerialPort | null;
  baud: number;
  connected: boolean;
}

export default function CommandCenter({ port, baud, connected }: CommandCenterProps) {
  const [commandInput, setCommandInput] = useState('');
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [areas, setAreas] = useState<Map<string, AreaData>>(new Map());
  const [loading, setLoading] = useState(false);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const pendingCommandRef = useRef<string | null>(null);

  useEffect(() => {
    if (connected && port) {
      startReading(port);
      // Auto-discover areas on connection
      setTimeout(() => {
        sendCommand('GET AREAS');
      }, 500);
    } else {
      if (readerRef.current) {
        readerRef.current.cancel();
        readerRef.current = null;
      }
    }
    return () => {
      if (readerRef.current) {
        readerRef.current.cancel();
        readerRef.current = null;
      }
    };
  }, [connected, port]);

  async function startReading(p: SerialPort) {
    if (!p.readable) return;
    const textDecoder = new TextDecoderStream();
    const readableClosed = p.readable.pipeTo(textDecoder.writable as WritableStream<Uint8Array>);
    const reader = (textDecoder.readable as ReadableStream<string>).getReader();
    readerRef.current = reader;

    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += value;
          let idx;
          while ((idx = buffer.search(/\r?\n/)) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            await onLine(line.trim());
          }
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch (e) {
      console.error('Command center read error', e);
    } finally {
      try {
        await readableClosed;
      } catch {}
    }
  }

  async function onLine(line: string) {
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
        // Only add location if there's a probe
        if (areaInfo.probeId && areaInfo.location) {
          areaData.locations.set(areaInfo.location, areaInfo.probeId);
        }
        return next;
      });
      // Auto-fetch thresholds and stats for this area
      const metrics = ['CO2', 'Temp', 'Hum', 'Sound'];
      for (const metric of metrics) {
        setTimeout(() => sendCommand(`GET THRESHOLDS ${areaInfo.area} ${metric}`), 100 * (metrics.indexOf(metric) + 1));
      }
      setTimeout(() => sendCommand(`GET STATS ${areaInfo.area}`), 500);
    } else if (parsed.type === 'threshold' && parsed.data) {
      const thresholdInfo = parsed.data as ThresholdInfo;
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
        areaData.thresholds.set(thresholdInfo.metric, thresholdInfo);
        return next;
      });
    } else if (parsed.type === 'stat' && parsed.data) {
      const statInfo = parsed.data as StatInfo;
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
        areaData.stats.set(statInfo.metric, statInfo);
        return next;
      });
    }
  }

  async function sendCommand(cmd: string) {
    if (!port || !port.writable) {
      setCommandLog((prev) => [...prev, '[ERROR] Port not writable']);
      return;
    }
    const command = cmd.trim() + '\n';
    setCommandLog((prev) => [...prev, `[TX] ${cmd}`]);
    pendingCommandRef.current = cmd;
    try {
      const encoder = new TextEncoder();
      const writer = port.writable.getWriter();
      await writer.write(encoder.encode(command));
      writer.releaseLock();
    } catch (e) {
      console.error('Send command error', e);
      setCommandLog((prev) => [...prev, `[ERROR] Failed to send: ${e}`]);
    }
  }

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
            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                <CircularProgress />
              </Box>
            )}
            {areas.size === 0 && !loading && (
              <Alert severity="info">No areas discovered yet. Send GET AREAS to discover areas.</Alert>
            )}
            {Array.from(areas.values()).map((areaData) => (
              <Accordion key={areaData.area} sx={{ mb: 1 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle1">
                    {areaData.area} ({areaData.locations.size} location{areaData.locations.size !== 1 ? 's' : ''})
                  </Typography>
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
                                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                  Thresholds
                                </Typography>
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
                                    Loading...
                                  </Typography>
                                )}
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
                                    Loading...
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
        <strong>Min Outlier:</strong> {stat.min_o === -1 ? 'N/A' : stat.min_o.toFixed(2)}
      </Typography>
      <Typography variant="body2">
        <strong>Max Outlier:</strong> {stat.max_o === -1 ? 'N/A' : stat.max_o.toFixed(2)}
      </Typography>
    </Stack>
  );
}
