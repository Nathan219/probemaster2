import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeProvider, CssBaseline, Container, Grid, Paper, Typography, Tabs, Tab, Box } from '@mui/material';
import Header from './components/Header';
import Filters from './components/Filters';
import IndividualCharts from './components/IndividualCharts';
import SummaryCharts from './components/SummaryCharts';
import { LatestReadings } from './components/Lists';
import CommandCenter, { AreaData } from './components/CommandCenter';
import SerialLog from './components/SerialLog';
import PixelVisualization from './components/PixelVisualization';
import { makeTheme } from './theme';
import {
  Sample,
  Probe,
  Location,
  SerializedAreaData,
  PersistedAreasData,
  PersistedPixelData,
  PersistedTimestamps,
} from './utils/types';
import { parseLine, toCSV } from './utils/parsing';
import { parseCommandResponse, AreaInfo, StatInfo, ThresholdInfo } from './utils/commandParsing';
import { idbGetAll, idbBulkAddSamples, idbPut, idbClear, idbGet } from './db/idb';
import JSZip from 'jszip';
import {
  generateSampleData,
  generateGetAreasResponse,
  generateGetStatsResponse,
  generateGetThresholdsResponse,
  getTestProbeIds,
} from './utils/testMode';

// Serialize Map<string, AreaData> to array for IndexedDB storage
function serializeAreasData(areas: Map<string, AreaData>): SerializedAreaData[] {
  return Array.from(areas.entries()).map(([area, areaData]) => ({
    area: areaData.area,
    locations: Array.from(areaData.locations.entries()),
    thresholds: Array.from(areaData.thresholds.entries()),
    stats: Array.from(areaData.stats.entries()),
  }));
}

// Deserialize array back to Map<string, AreaData>
function deserializeAreasData(serialized: SerializedAreaData[]): Map<string, AreaData> {
  const map = new Map<string, AreaData>();
  for (const item of serialized) {
    map.set(item.area, {
      area: item.area,
      locations: new Map(item.locations),
      thresholds: new Map(item.thresholds),
      stats: new Map(item.stats),
    });
  }
  return map;
}

// Format timestamp as relative time (X min ago) or absolute timestamp
export function formatLastFetched(timestamp: number | null): string {
  if (!timestamp) return 'Never fetched';
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

  // For older data, show absolute timestamp
  return new Date(timestamp).toLocaleString();
}

function App() {
  const [dark, setDark] = useState<boolean>(() => {
    const s = localStorage.getItem('pm_dark');
    return s ? s === '1' : true;
  });

  useEffect(() => {
    localStorage.setItem('pm_dark', dark ? '1' : '0');
  }, [dark]);

  const theme = makeTheme(dark);

  // Tabs
  const [activeTab, setActiveTab] = useState<number>(() => {
    const s = localStorage.getItem('pm_activeTab');
    return s ? parseInt(s, 10) : 0;
  });

  useEffect(() => {
    localStorage.setItem('pm_activeTab', activeTab.toString());
  }, [activeTab]);

  // Serial
  const [port, setPort] = useState<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const [baud, setBaud] = useState(115200);
  const [status, setStatus] = useState('Idle');
  const [serialLog, setSerialLog] = useState('');
  const [testMode, setTestMode] = useState<boolean>(() => {
    const s = localStorage.getItem('pm_testMode');
    return s ? s === '1' : false;
  });

  useEffect(() => {
    localStorage.setItem('pm_testMode', testMode ? '1' : '0');
  }, [testMode]);
  const testModeIntervalRef = useRef<number | null>(null);

  // Data
  const [samples, setSamples] = useState<Sample[]>([]);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [locations, setLocations] = useState<Record<string, Location>>({});
  const [areas, setAreas] = useState<Set<string>>(new Set());

  // Command Center areas data (shared between tabs)
  const [commandCenterAreas, setCommandCenterAreas] = useState<Map<string, AreaData>>(new Map());

  // GET AREAS loading state
  const [getAreasTimestamp, setGetAreasTimestamp] = useState<number | null>(null);

  // Timestamps for last fetched data
  const [areasLastFetched, setAreasLastFetched] = useState<number | null>(null);
  const [pixelDataLastFetched, setPixelDataLastFetched] = useState<number | null>(null);
  // Per-area/metric timestamps for thresholds and stats
  const [thresholdsLastFetched, setThresholdsLastFetched] = useState<Map<string, number>>(new Map());
  const [statsLastFetched, setStatsLastFetched] = useState<Map<string, number>>(new Map());

  // Pixel data (area -> pixel count 0-6)
  const [pixelData, setPixelData] = useState<Record<string, number>>({});

  // Filters
  const [metricVisibility, setMetricVisibility] = useState({ CO2: true, Temp: true, Hum: true, Sound: true });
  const [activeAreas, setActiveAreas] = useState<Set<string>>(new Set(['All']));
  const [activeProbes, setActiveProbes] = useState<Set<string>>(new Set());
  const [aggType, setAggType] = useState<'avg' | 'min' | 'max'>('avg');
  const [showBand, setShowBand] = useState<boolean>(true);

  const pending = useRef<Sample[]>([]);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (pending.current.length) {
        setSamples((prev) => {
          const next = [...prev, ...pending.current];
          pending.current = [];
          return next;
        });
      }
    }, 400);
    return () => clearInterval(t);
  }, []);

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

  // Function to send commands via serial port
  async function sendCommand(cmd: string) {
    const cmdUpper = cmd.trim().toUpperCase();
    setSerialLog((prev) => (prev + `[ROUTE USB->UART1] ${cmd}\n`).slice(-20000));
    // Log to CommandCenter's command log if callback is set
    commandLogCallbackRef.current?.(`[TX] ${cmd}`);

    // Track GET AREAS command
    if (cmdUpper === 'GET AREAS') {
      setGetAreasTimestamp(Date.now());
      // Clear existing areas to start fresh
      setCommandCenterAreas(new Map());
      setAreas(new Set());
    }

    // Handle test mode command simulation
    if (testMode) {
      // Simulate command responses with a small delay
      setTimeout(async () => {
        if (cmdUpper === 'GET AREAS') {
          const responses = generateGetAreasResponse();
          for (const response of responses) {
            await onLine(response);
            // Small delay between responses to simulate real behavior
            await new Promise((r) => setTimeout(r, 50));
          }
        } else if (cmdUpper.startsWith('GET STATS')) {
          const matchWithMetric = cmd.match(/GET STATS\s+(\S+)\s+(\S+)/i);
          if (matchWithMetric) {
            // GET STATS with area and metric
            const area = matchWithMetric[1];
            const metric = matchWithMetric[2];
            const response = generateGetStatsResponse(area, metric);
            await onLine(response);
          } else {
            const matchWithArea = cmd.match(/GET STATS\s+(\S+)/i);
            if (matchWithArea) {
              // GET STATS with area only - generate for all metrics for that area
              const area = matchWithArea[1];
              const metrics = ['CO2', 'Temp', 'Hum', 'Sound'];
              for (const metric of metrics) {
                const response = generateGetStatsResponse(area, metric);
                await onLine(response);
                await new Promise((r) => setTimeout(r, 20));
              }
            } else if (cmdUpper === 'GET STATS') {
              // GET STATS without area/metric - generate for all areas and metrics
              const areas = ['FLOOR11', 'FLOOR12', 'FLOOR15', 'FLOOR16', 'FLOOR17', 'POOL', 'TEAROOM'];
              const metrics = ['CO2', 'TEMP', 'HUM', 'SOUND'];
              for (const area of areas) {
                for (const metric of metrics) {
                  const response = generateGetStatsResponse(area, metric);
                  await onLine(response);
                  await new Promise((r) => setTimeout(r, 20));
                }
              }
            }
          }
        } else if (cmdUpper.startsWith('GET THRESHOLD')) {
          const match = cmd.match(/GET THRESHOLD(?:S)?\s+(\S+)\s+(\S+)/i);
          if (match) {
            const area = match[1];
            const metric = match[2];
            const response = generateGetThresholdsResponse(area, metric);
            await onLine(response);
          }
        }
        // Other commands are just logged, no response generated
      }, 100);
      return;
    }

    // Real serial port handling
    if (!port || !port.writable) {
      console.error('Port not writable');
      return;
    }
    const command = cmd.trim() + '\n';

    try {
      // Get or reuse writer
      if (!writerRef.current) {
        writerRef.current = port.writable.getWriter();
      }
      const encoder = new TextEncoder();
      await writerRef.current.write(encoder.encode(command));
    } catch (e) {
      console.error('Send command error', e);
      // If writer is invalid, clear it so we get a new one next time
      if (writerRef.current) {
        try {
          writerRef.current.releaseLock();
        } catch {}
        writerRef.current = null;
      }
    }
  }

  // Load persisted data
  useEffect(() => {
    (async () => {
      const [
        savedSamples,
        savedProbes,
        savedLocations,
        savedAreasData,
        savedPixelData,
        savedThresholdTimestamps,
        savedStatTimestamps,
      ] = await Promise.all([
        idbGetAll('samples'),
        idbGetAll('probes'),
        idbGetAll('locations'),
        idbGet('areasData', 'areas').catch(() => null),
        idbGet('pixelData', 'pixels').catch(() => null),
        idbGet('timestamps', 'thresholds').catch(() => null),
        idbGet('timestamps', 'stats').catch(() => null),
      ]);
      setSamples(savedSamples as Sample[]);
      const p = Object.fromEntries((savedProbes as Probe[]).map((v) => [v.id, v]));
      setProbes(p);
      const loc = Object.fromEntries((savedLocations as Location[]).map((v) => [v.id, v]));
      setLocations(loc);

      // Restore areas data
      if (savedAreasData) {
        const persisted = savedAreasData as PersistedAreasData;
        const deserialized = deserializeAreasData(persisted.data);
        setCommandCenterAreas(deserialized);
        setAreasLastFetched(persisted.lastFetched);
        // Update areas set from restored data
        setAreas(new Set(Array.from(deserialized.keys())));
      }

      // Restore pixel data (only if it has actual values)
      if (savedPixelData) {
        const persisted = savedPixelData as PersistedPixelData;
        // Only restore if there's actual data (not empty object)
        if (persisted.data && Object.keys(persisted.data).length > 0) {
          // Filter out any entries with invalid values
          const validData: Record<string, number> = {};
          for (const [key, value] of Object.entries(persisted.data)) {
            if (typeof value === 'number' && value >= 0 && value <= 6) {
              validData[key] = value;
            }
          }
          if (Object.keys(validData).length > 0) {
            setPixelData(validData);
            setPixelDataLastFetched(persisted.lastFetched);
          }
        }
      }

      // Restore threshold timestamps
      if (savedThresholdTimestamps) {
        const persisted = savedThresholdTimestamps as PersistedTimestamps;
        setThresholdsLastFetched(new Map(Object.entries(persisted.data)));
      }

      // Restore stat timestamps
      if (savedStatTimestamps) {
        const persisted = savedStatTimestamps as PersistedTimestamps;
        setStatsLastFetched(new Map(Object.entries(persisted.data)));
      }
    })().catch(console.error);
  }, []);

  // Areas are now only populated from GET AREAS command responses, not from locations

  // Auto-persist probes and locations to IndexedDB
  useEffect(() => {
    for (const probe of Object.values(probes)) {
      idbPut('probes', probe);
    }
  }, [probes]);

  useEffect(() => {
    for (const loc of Object.values(locations)) {
      idbPut('locations', loc);
    }
  }, [locations]);

  // Derive locations and probes from GET AREAS data for Dashboard
  const dashboardLocations = useMemo(() => {
    const locs: Record<string, Location> = {};
    commandCenterAreas.forEach((areaData, area) => {
      areaData.locations.forEach((probeId, locationName) => {
        // Use location name as the location ID
        const locationId = `${area}-${locationName}`;
        locs[locationId] = {
          id: locationId,
          name: locationName,
          area: area,
        };
      });
    });
    return locs;
  }, [commandCenterAreas]);

  const dashboardProbes = useMemo(() => {
    const probs: Record<string, Probe> = {};
    commandCenterAreas.forEach((areaData) => {
      areaData.locations.forEach((probeId, locationName) => {
        // Find the location ID for this probe
        const locationId = Object.keys(dashboardLocations).find(
          (lid) => dashboardLocations[lid].name === locationName && dashboardLocations[lid].area === areaData.area
        );
        probs[probeId] = {
          id: probeId,
          locationId: locationId || null,
        };
      });
    });
    return probs;
  }, [commandCenterAreas, dashboardLocations]);

  // Helper function to normalize probe ID (strip prefixes like [UART2])
  function normalizeProbeId(probeId: string | undefined): string {
    if (!probeId) return '';
    // Remove prefixes like [UART2], [UART1], etc.
    const match = probeId.match(/\[.*?\]\s*(.+)$/);
    return match ? match[1].trim() : probeId.trim();
  }

  // Merge dashboard probes with sensor data probes
  const allProbes = useMemo(() => {
    const merged = { ...dashboardProbes };
    // Add probes from sensor data that aren't in dashboardProbes
    Object.values(probes).forEach((p) => {
      if (!p.id) return;
      const normalizedId = normalizeProbeId(p.id);
      if (!normalizedId) return;
      // Use normalized ID for the merged probe
      if (!merged[normalizedId]) {
        // Try to find this probe in commandCenterAreas to get its location
        let locationId: string | null = null;
        for (const [area, areaData] of commandCenterAreas.entries()) {
          for (const [locName, probeId] of areaData.locations.entries()) {
            if (probeId === normalizedId) {
              // Found the probe, create the location ID using the same format as dashboardLocations
              const locId = `${area}-${locName}`;
              locationId = locId;
              break;
            }
          }
          if (locationId) break;
        }
        merged[normalizedId] = {
          id: normalizedId,
          locationId: locationId || null,
        };
      }
    });
    return merged;
  }, [dashboardProbes, probes, commandCenterAreas]);

  const visibleProbeIds = useMemo(() => {
    const allowed = new Set<string>();
    for (const p of Object.values(allProbes)) {
      const area = p.locationId ? dashboardLocations[p.locationId]?.area || 'Unassigned' : 'Unassigned';
      if (activeAreas.has('All') || activeAreas.has(area)) {
        allowed.add(p.id);
      }
    }
    // If no probes match area filter but we have samples, include all probes with samples (normalized)
    if (allowed.size === 0 && samples.length > 0) {
      const probeIdsFromSamples = new Set(samples.map((s) => normalizeProbeId(s.probeId)));
      probeIdsFromSamples.forEach((id) => allowed.add(id));
    }
    // Also need to check if samples have probe IDs that match (with normalization)
    const normalizedActiveProbes = new Set(Array.from(activeProbes).map((id) => normalizeProbeId(id)));
    return new Set(
      [...allowed].filter((id) => {
        const normalizedId = normalizeProbeId(id);
        return normalizedActiveProbes.has(normalizedId) || normalizedActiveProbes.size === 0;
      })
    );
  }, [activeAreas, allProbes, dashboardLocations, activeProbes, samples]);

  const filteredSamples = useMemo(
    () =>
      samples.filter((s) => {
        const normalizedId = normalizeProbeId(s.probeId);
        return visibleProbeIds.has(normalizedId) || visibleProbeIds.has(s.probeId);
      }),
    [samples, visibleProbeIds]
  );

  useEffect(() => {
    if (activeProbes.size === 0 && Object.keys(allProbes).length) {
      setActiveProbes(new Set(Object.keys(allProbes)));
    }
  }, [allProbes, activeProbes]);

  const commandResponseCallbackRef = useRef<((line: string) => void) | null>(null);
  const commandLogCallbackRef = useRef<((line: string) => void) | null>(null);
  const probeAssignmentCallbackRef = useRef<((probeId: string, area: string, location: string) => void) | null>(null);

  // Clear loading state when 7 areas are received and update timestamp
  useEffect(() => {
    if (commandCenterAreas.size >= 7 && getAreasTimestamp !== null) {
      const timestamp = Date.now();
      setAreasLastFetched(timestamp);
      setGetAreasTimestamp(null);
    }
  }, [commandCenterAreas.size, getAreasTimestamp]);

  // Persist areas data to IndexedDB when it changes
  // Use a ref to debounce rapid updates
  const persistTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    if (commandCenterAreas.size > 0) {
      // Debounce persistence to avoid too many writes
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      persistTimeoutRef.current = window.setTimeout(() => {
        const serialized = serializeAreasData(commandCenterAreas);
        const persisted: PersistedAreasData = {
          id: 'areas',
          data: serialized,
          lastFetched: areasLastFetched || Date.now(),
        };
        idbPut('areasData', persisted).catch(console.error);
      }, 500); // Wait 500ms after last change
    }
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
    };
  }, [commandCenterAreas, areasLastFetched]);

  // Persist pixel data to IndexedDB when it changes
  useEffect(() => {
    // Only persist if there's actual valid data
    const validEntries = Object.entries(pixelData).filter(
      ([_, value]) => typeof value === 'number' && value >= 0 && value <= 6
    );
    if (validEntries.length > 0) {
      const validData = Object.fromEntries(validEntries);
      const timestamp = pixelDataLastFetched || Date.now();
      const persisted: PersistedPixelData = {
        id: 'pixels',
        data: validData,
        lastFetched: timestamp,
      };
      idbPut('pixelData', persisted).catch(console.error);
    } else if (Object.keys(pixelData).length === 0 && pixelDataLastFetched) {
      // If pixelData is empty but we have a timestamp, clear the stored data
      idbPut('pixelData', {
        id: 'pixels',
        data: {},
        lastFetched: 0,
      }).catch(console.error);
    }
  }, [pixelData, pixelDataLastFetched]);

  // Persist threshold timestamps to IndexedDB when they change
  useEffect(() => {
    if (thresholdsLastFetched.size > 0) {
      const persisted: PersistedTimestamps = {
        id: 'thresholds',
        data: Object.fromEntries(thresholdsLastFetched),
      };
      idbPut('timestamps', persisted).catch(console.error);
    }
  }, [thresholdsLastFetched]);

  // Persist stat timestamps to IndexedDB when they change
  useEffect(() => {
    if (statsLastFetched.size > 0) {
      const persisted: PersistedTimestamps = {
        id: 'stats',
        data: Object.fromEntries(statsLastFetched),
      };
      idbPut('timestamps', persisted).catch(console.error);
    }
  }, [statsLastFetched]);

  async function onLine(line: string) {
    setSerialLog((prev) => (prev + line + '\n').slice(-20000));

    // Check for PROBE ACCEPTED message: [UART1] WEBd: PROBE e6e0 FLOOR12 ROTUNDA ACCEPTED
    const probeMatch = line.match(/PROBE\s+(\S+)\s+(\S+)\s+(\S+)\s+ACCEPTED/i);
    if (probeMatch) {
      const probeId = probeMatch[1];
      const area = probeMatch[2];
      const location = probeMatch[3];
      probeAssignmentCallbackRef.current?.(probeId, area, location);
    }

    // Check for PIXELS message: [UART1] WEBd: PIXELS FLOOR11 0
    const pixelsMatch = line.match(/PIXELS\s+(\S+)\s+(\S+)/i);
    if (pixelsMatch) {
      const area = pixelsMatch[1];
      const valueStr = pixelsMatch[2];
      const value = parseFloat(valueStr);
      if (!isNaN(value)) {
        // Normalize area name (FLOOR11 -> FLOOR11, FLOOR 11 -> FLOOR11)
        let normalizedArea = area.toUpperCase();
        const floorMatch = normalizedArea.match(/FLOOR\s*(\d+)/);
        if (floorMatch) {
          normalizedArea = `FLOOR${floorMatch[1]}`;
        }
        setPixelData((prev) => ({
          ...prev,
          [normalizedArea]: Math.max(0, Math.min(6, Math.round(value))),
        }));
        setPixelDataLastFetched(Date.now());
      }
    }

    // Check if this is a command response and route to CommandCenter
    if (
      line.includes('AREA:') ||
      line.includes('STAT:') ||
      line.includes('THRESHOLD') ||
      line.includes('USE_BASELINE')
    ) {
      commandResponseCallbackRef.current?.(line);

      // Parse command responses to update shared state
      if (line.includes('AREA:') || line.includes('STAT:') || line.includes('THRESHOLD')) {
        const parsed = parseCommandResponse(line);

        if (parsed.type === 'area' && parsed.data) {
          const areaInfo = parsed.data as AreaInfo;
          // Area names come in uppercase format (e.g., "FLOOR11")
          const areaName = areaInfo.area.toUpperCase();
          // Add to Dashboard areas set
          setAreas((prev) => {
            const next = new Set(prev);
            next.add(areaName);
            return next;
          });
          // Update CommandCenter areas data
          setCommandCenterAreas((prev) => {
            const next = new Map(prev);
            const existingArea = next.get(areaName);

            const newLocations = existingArea ? new Map(existingArea.locations) : new Map<string, string>();
            const newThresholds = existingArea ? new Map(existingArea.thresholds) : new Map();
            const newStats = existingArea ? new Map(existingArea.stats) : new Map();

            if (areaInfo.probeId === '' && areaInfo.location === '') {
              newLocations.clear();
            } else if (areaInfo.probeId && areaInfo.probeId.trim() && areaInfo.location && areaInfo.location.trim()) {
              newLocations.set(areaInfo.location, areaInfo.probeId);
            }

            next.set(areaName, {
              area: areaName,
              locations: newLocations,
              thresholds: newThresholds,
              stats: newStats,
            });

            return next;
          });
        } else if (parsed.type === 'threshold' && parsed.data) {
          const thresholdInfo = parsed.data as ThresholdInfo;
          const areaName = thresholdInfo.area.toUpperCase();
          // Normalize metric name
          const upper = thresholdInfo.metric.toUpperCase();
          const normalizedMetric =
            upper === 'TEMP' ? 'Temp' : upper === 'HUM' ? 'Hum' : upper === 'DB' ? 'Sound' : thresholdInfo.metric;

          setCommandCenterAreas((prev) => {
            const next = new Map(prev);
            const existingArea = next.get(areaName);
            const newThresholds = existingArea ? new Map(existingArea.thresholds) : new Map();
            const newLocations = existingArea ? new Map(existingArea.locations) : new Map();
            const newStats = existingArea ? new Map(existingArea.stats) : new Map();

            newThresholds.set(normalizedMetric, { ...thresholdInfo, metric: normalizedMetric, area: areaName });

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
          // Update threshold timestamp
          const thresholdKey = `${areaName}-${normalizedMetric}`;
          setThresholdsLastFetched((prev) => {
            const next = new Map(prev);
            next.set(thresholdKey, Date.now());
            return next;
          });
        } else if (parsed.type === 'stat' && parsed.data) {
          const statInfo = parsed.data as StatInfo;
          const areaName = statInfo.area.toUpperCase();
          // Normalize metric name
          const upper = statInfo.metric.toUpperCase();
          const normalizedMetric =
            upper === 'TEMP' ? 'Temp' : upper === 'HUM' ? 'Hum' : upper === 'DB' ? 'Sound' : statInfo.metric;

          setCommandCenterAreas((prev) => {
            const next = new Map(prev);
            const existingArea = next.get(areaName);
            const newThresholds = existingArea ? new Map(existingArea.thresholds) : new Map();
            const newLocations = existingArea ? new Map(existingArea.locations) : new Map();
            const newStats = existingArea ? new Map(existingArea.stats) : new Map();

            newStats.set(normalizedMetric, { ...statInfo, metric: normalizedMetric, area: areaName });

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
                stats: newStats,
              });
            }

            return next;
          });
          // Update stat timestamp
          const statKey = `${areaName}-${normalizedMetric}`;
          setStatsLastFetched((prev) => {
            const next = new Map(prev);
            next.set(statKey, Date.now());
            return next;
          });
        }
      }
    }

    // Parse pixel data from LED diagnostic messages
    // Format: [LEDS] Pixels: FLOOR11:0, FLOOR12:0, FLOOR15:0, FLOOR16:0, FLOOR17:0, POOL:0, TEAROOM:0
    if (line.includes('[LEDS]') && line.includes('Pixels:')) {
      const pixelsMatch = line.match(/\[LEDS\]\s*Pixels:\s*(.+)/i);
      if (pixelsMatch) {
        const pixelsStr = pixelsMatch[1].trim();
        const newPixelData: Record<string, number> = {};

        // Parse area:value pairs
        const pairs = pixelsStr.split(',').map((p) => p.trim());
        for (const pair of pairs) {
          const [area, valueStr] = pair.split(':').map((s) => s.trim());
          if (area && valueStr !== undefined) {
            const value = parseFloat(valueStr);
            if (!isNaN(value)) {
              // Normalize area name (FLOOR11 -> FLOOR11, FLOOR 11 -> FLOOR11)
              let normalizedArea = area.toUpperCase();
              const floorMatch = normalizedArea.match(/FLOOR\s*(\d+)/);
              if (floorMatch) {
                normalizedArea = `FLOOR${floorMatch[1]}`;
              }
              newPixelData[normalizedArea] = Math.max(0, Math.min(6, Math.round(value)));
            }
          }
        }

        if (Object.keys(newPixelData).length > 0) {
          setPixelData((prev) => ({ ...prev, ...newPixelData }));
          setPixelDataLastFetched(Date.now());
        }
      }
    }

    const parsed = parseLine(line);
    if (!parsed) return;
    // Normalize probe ID to strip prefixes like [UART2]
    const normalizedProbeId = normalizeProbeId(parsed.probeId);
    const normalizedSample = { ...parsed, probeId: normalizedProbeId };
    pending.current.push(normalizedSample);
    if (!probes[normalizedProbeId]) {
      const newProbe: Probe = { id: normalizedProbeId, locationId: null };
      setProbes((prev) => ({ ...prev, [newProbe.id]: newProbe }));
      await idbPut('probes', newProbe);
      setActiveProbes((prev) => new Set(prev).add(newProbe.id));
    }
    await idbBulkAddSamples([normalizedSample]);
  }

  async function handleConnect() {
    if (testMode) {
      alert('Please exit test mode before connecting to a serial port.');
      return;
    }
    if (!('serial' in navigator)) {
      alert('Web Serial not supported. Use Chrome/Edge over HTTPS.');
      return;
    }
    // If already connected, disconnect first
    if (port) {
      await handleDisconnect();
      // Wait a bit for cleanup to complete
      await new Promise((r) => setTimeout(r, 200));
    }
    try {
      const p = await (navigator as any).serial.requestPort();
      // Try to open the port, but handle the case where it's already open
      try {
        await p.open({ baudRate: baud });
      } catch (openError: any) {
        // If port is already open, that's okay - we can still use it
        if (openError.name === 'InvalidStateError' && openError.message.includes('already open')) {
          console.log('Port already open, reusing existing connection');
          // If readable is locked, we need to cancel the reader first, then close and reopen
          if (p.readable && p.readable.locked) {
            console.log('Port is open but locked, closing and reopening...');
            try {
              // Cancel any existing reader first
              if (readerRef.current) {
                try {
                  await readerRef.current.cancel();
                } catch {}
                readerRef.current = null;
              }
              // Wait a bit for the stream to unlock
              await new Promise((r) => setTimeout(r, 200));
              // Now try to close the port
              try {
                await p.close();
              } catch (closeError: any) {
                // If close fails because stream is still locked, wait more and try again
                if (closeError.message && closeError.message.includes('locked')) {
                  await new Promise((r) => setTimeout(r, 300));
                  await p.close();
                } else {
                  throw closeError;
                }
              }
              await new Promise((r) => setTimeout(r, 100));
              await p.open({ baudRate: baud });
            } catch (e) {
              throw new Error('Failed to reopen port: ' + e);
            }
          }
        } else {
          // Some other error occurred
          throw openError;
        }
      }
      setPort(p);
      setStatus('Connected. Reading...');
      // Start reading after a small delay to ensure port is ready
      setTimeout(() => {
        startReading(p);
      }, 100);
      // Call GET AREAS after connection is established
      setTimeout(() => {
        sendCommand('GET AREAS');
      }, 300);
    } catch (e) {
      console.error(e);
      setStatus('Failed to connect');
      const errorMessage = e instanceof Error ? e.message : String(e);
      alert(`Failed to connect to serial port: ${errorMessage}`);
    }
  }

  async function handleDisconnect() {
    setStatus('Disconnecting...');
    try {
      readerRef.current?.cancel();
    } catch {}
    try {
      await port?.close();
    } catch {}
    readerRef.current = null;
    setPort(null);
    setStatus('Disconnected');
  }

  // Test mode toggle handler
  function handleToggleTestMode() {
    const newTestMode = !testMode;

    // If trying to enable test mode while connected, disconnect first
    if (newTestMode && port) {
      handleDisconnect().then(() => {
        // Wait a bit for cleanup, then enable test mode
        setTimeout(() => {
          setTestMode(true);
          setStatus('Test Mode');
          // Start generating periodic sample data
          const probeIds = getTestProbeIds();
          testModeIntervalRef.current = window.setInterval(() => {
            // Generate a random probe's data
            const randomProbeId = probeIds[Math.floor(Math.random() * probeIds.length)];
            const sampleLine = generateSampleData(randomProbeId);
            onLine(sampleLine);
          }, 3000); // Generate data every 3 seconds

          // Automatically send GET AREAS after a short delay
          setTimeout(() => {
            sendCommand('GET AREAS');
          }, 500);
        }, 200);
      });
      return;
    }

    setTestMode(newTestMode);

    if (newTestMode) {
      setStatus('Test Mode');
      // Start generating periodic sample data
      const probeIds = getTestProbeIds();
      testModeIntervalRef.current = window.setInterval(() => {
        // Generate a random probe's data
        const randomProbeId = probeIds[Math.floor(Math.random() * probeIds.length)];
        const sampleLine = generateSampleData(randomProbeId);
        onLine(sampleLine);
      }, 3000); // Generate data every 3 seconds

      // Automatically send GET AREAS after a short delay
      setTimeout(() => {
        sendCommand('GET AREAS');
      }, 500);
    } else {
      setStatus('Idle');
      // Stop generating data
      if (testModeIntervalRef.current !== null) {
        clearInterval(testModeIntervalRef.current);
        testModeIntervalRef.current = null;
      }
    }
  }

  // Start test mode interval if test mode is enabled on mount
  // Note: We don't auto-send GET AREAS here to preserve restored data
  useEffect(() => {
    if (testMode) {
      setStatus('Test Mode');
      const probeIds = getTestProbeIds();
      testModeIntervalRef.current = window.setInterval(() => {
        const randomProbeId = probeIds[Math.floor(Math.random() * probeIds.length)];
        const sampleLine = generateSampleData(randomProbeId);
        onLine(sampleLine);
      }, 3000);
    }
    return () => {
      if (testModeIntervalRef.current !== null) {
        clearInterval(testModeIntervalRef.current);
        testModeIntervalRef.current = null;
      }
    };
  }, []); // Only run on mount

  async function startReading(p: SerialPort) {
    // Cancel any existing reader first
    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch {}
      readerRef.current = null;
    }

    if (!p.readable) {
      console.error('Port readable stream not available');
      setStatus('Port readable stream not available');
      return;
    }

    // Check if readable stream is already locked (has an active reader)
    if (p.readable.locked) {
      console.log('Readable stream is locked, waiting a bit...');
      // Wait a bit and try again
      await new Promise((r) => setTimeout(r, 200));
      if (p.readable.locked) {
        console.log('Readable stream still locked, cannot start reading');
        setStatus('Port already in use');
        return;
      }
    }

    try {
      const textDecoder = new TextDecoderStream();
      const readableClosed = p.readable.pipeTo(textDecoder.writable as WritableStream<Uint8Array>);
      const reader = (textDecoder.readable as ReadableStream<string>).getReader();
      readerRef.current = reader as any;

      let buffer = '';
      setStatus('Reading...');
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
        console.error('Read loop error', e);
      } finally {
        readerRef.current = null;
        try {
          await readableClosed;
        } catch {}
      }
    } catch (e) {
      console.error('Failed to start reading:', e);
      alert('Failed to start reading: ' + e);
      setStatus('Failed to start reading');
    }
  }

  function csvSafe(s: string) {
    return /,|"|\n/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  async function handleBackupClear() {
    if (!confirm('Backup & clear all local data? A ZIP with CSVs will download.')) return;
    const samplesCSV = toCSV(samples);
    const probesCSV = ['id,locationId', ...Object.values(probes).map((p) => [p.id, p.locationId ?? ''].join(','))].join(
      '\n'
    );
    const locationsCSV = [
      'id,name,area',
      ...Object.values(locations).map((l) => [l.id, csvSafe(l.name), csvSafe(l.area)].join(',')),
    ].join('\n');

    const zip = new JSZip();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    zip.file(`samples-${ts}.csv`, samplesCSV);
    zip.file(`probes-${ts}.csv`, probesCSV);
    zip.file(`locations-${ts}.csv`, locationsCSV);
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `probemaster-backup-${ts}.zip`;
    a.click();
    URL.revokeObjectURL(url);

    await Promise.all([idbClear('samples'), idbClear('probes'), idbClear('locations')]);
    setSamples([]);
    setProbes({});
    setLocations({});
    setActiveAreas(new Set(['All']));
    setActiveProbes(new Set());
  }

  const probeListForFilter = useMemo(() => {
    return Object.values(allProbes).map((p) => {
      const area = p.locationId ? dashboardLocations[p.locationId]?.area || 'Unassigned' : 'Unassigned';
      return { id: p.id, label: p.id, area };
    });
  }, [allProbes, dashboardLocations]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Header
        status={status}
        connected={!!port || testMode}
        baud={baud}
        setBaud={setBaud}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onBackupClear={handleBackupClear}
        dark={dark}
        setDark={setDark}
        onGetAreas={() => sendCommand('GET AREAS')}
        testMode={testMode}
        onToggleTestMode={handleToggleTestMode}
      />

      <Container maxWidth="xl" sx={{ py: 2 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
            <Tab label="Dashboard" />
            <Tab label="Command Center" />
            <Tab label="Spy Mode" />
          </Tabs>
        </Box>

        {activeTab === 0 && (
          <>
            <Filters
              areas={Array.from(areas).sort()}
              activeAreas={activeAreas}
              setActiveAreas={setActiveAreas}
              metricVisibility={metricVisibility}
              setMetricVisibility={setMetricVisibility}
              probes={probeListForFilter}
              activeProbes={activeProbes}
              setActiveProbes={setActiveProbes}
              aggType={aggType}
              setAggType={setAggType}
              showBand={showBand}
              setShowBand={setShowBand}
            />

            <Grid container spacing={2}>
              <Grid item xs={12} md={8}>
                <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
                  <Typography variant="subtitle1" sx={{ mb: 1 }}>
                    Individual (Per-Probe)
                  </Typography>
                  <IndividualCharts
                    samples={filteredSamples}
                    probes={allProbes}
                    locations={dashboardLocations}
                    activeProbes={activeProbes}
                    metricVisibility={metricVisibility}
                  />
                </Paper>

                <Paper sx={{ p: 2 }} variant="outlined">
                  <Typography variant="subtitle1" sx={{ mb: 1 }}>
                    Summary (Per-Area)
                  </Typography>
                  <SummaryCharts
                    samples={filteredSamples}
                    probes={allProbes}
                    locations={dashboardLocations}
                    activeAreas={activeAreas}
                    metricVisibility={metricVisibility}
                    aggType={aggType}
                    showBand={showBand}
                  />
                </Paper>
              </Grid>

              <Grid item xs={12} md={4}>
                <PixelVisualization pixelData={pixelData} sendCommand={sendCommand} connected={!!port || testMode} />
                <LatestReadings samples={filteredSamples} probes={allProbes} locations={dashboardLocations} />
              </Grid>
            </Grid>

            <SerialLog log={serialLog} />
          </>
        )}

        {activeTab === 1 && (
          <CommandCenter
            port={port}
            baud={baud}
            connected={!!port || testMode}
            serialLog={serialLog}
            onCommandResponseRef={commandResponseCallbackRef}
            onCommandLogRef={commandLogCallbackRef}
            areas={commandCenterAreas}
            setAreas={setCommandCenterAreas}
            sendCommand={sendCommand}
            probes={allProbes}
            locations={dashboardLocations}
            setProbes={setProbes}
            setLocations={setLocations}
            areasList={areas}
            getAreasTimestamp={getAreasTimestamp}
            areasLastFetched={areasLastFetched}
            thresholdsLastFetched={thresholdsLastFetched}
            statsLastFetched={statsLastFetched}
            clearSerialLog={() => setSerialLog('')}
            onProbeAssignmentRef={probeAssignmentCallbackRef}
          />
        )}

        {activeTab === 2 && (
          <Grid container spacing={2}>
            <IndividualCharts
              samples={filteredSamples}
              probes={allProbes}
              locations={dashboardLocations}
              activeProbes={activeProbes}
              metricVisibility={metricVisibility}
              gridLayout={true}
            />
            <SummaryCharts
              samples={filteredSamples}
              probes={allProbes}
              locations={dashboardLocations}
              activeAreas={activeAreas}
              metricVisibility={metricVisibility}
              aggType={aggType}
              showBand={showBand}
              gridLayout={true}
            />
          </Grid>
        )}
      </Container>
    </ThemeProvider>
  );
}

export default App;
