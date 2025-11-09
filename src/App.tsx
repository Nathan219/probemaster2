import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeProvider, CssBaseline, Container, Grid, Paper, Typography, Tabs, Tab, Box } from '@mui/material';
import Header from './components/Header';
import Filters from './components/Filters';
import IndividualCharts from './components/IndividualCharts';
import SummaryCharts from './components/SummaryCharts';
import { ProbesPanel, LocationsPanel, LatestReadings } from './components/Lists';
import CommandCenter, { AreaData } from './components/CommandCenter';
import SerialLog from './components/SerialLog';
import { makeTheme } from './theme';
import { Sample, Probe, Location } from './utils/types';
import { parseLine, toCSV } from './utils/parsing';
import { parseAreaResponse, parseCommandResponse, AreaInfo, StatInfo, ThresholdInfo } from './utils/commandParsing';
import { idbGetAll, idbBulkAddSamples, idbPut, idbClear } from './db/idb';
import JSZip from 'jszip';
import { createSimSetup, makeSimTickers } from './sim';

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
  const [activeTab, setActiveTab] = useState(0);

  // Serial
  const [port, setPort] = useState<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const [baud, setBaud] = useState(115200);
  const [status, setStatus] = useState('Idle');
  const [serialLog, setSerialLog] = useState('');
  const [simTimer, setSimTimer] = useState<number | null>(null);

  // Data
  const [samples, setSamples] = useState<Sample[]>([]);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [locations, setLocations] = useState<Record<string, Location>>({});
  const [areas, setAreas] = useState<Set<string>>(new Set());

  // Command Center areas data (shared between tabs)
  const [commandCenterAreas, setCommandCenterAreas] = useState<Map<string, AreaData>>(new Map());

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
    if (!port || !port.writable) {
      console.error('Port not writable');
      return;
    }
    const command = cmd.trim() + '\n';
    setSerialLog((prev) => (prev + `[ROUTE USB->UART1] ${cmd}\n`).slice(-20000));
    // Log to CommandCenter's command log if callback is set
    commandLogCallbackRef.current?.(`[TX] ${cmd}`);
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
      const [savedSamples, savedProbes, savedLocations] = await Promise.all([
        idbGetAll('samples'),
        idbGetAll('probes'),
        idbGetAll('locations'),
      ]);
      setSamples(savedSamples as Sample[]);
      const p = Object.fromEntries((savedProbes as Probe[]).map((v) => [v.id, v]));
      setProbes(p);
      const loc = Object.fromEntries((savedLocations as Location[]).map((v) => [v.id, v]));
      setLocations(loc);
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
  function normalizeProbeId(probeId: string): string {
    // Remove prefixes like [UART2], [UART1], etc.
    const match = probeId.match(/\[.*?\]\s*(.+)$/);
    return match ? match[1].trim() : probeId.trim();
  }

  // Merge dashboard probes with sensor data probes
  const allProbes = useMemo(() => {
    const merged = { ...dashboardProbes };
    // Add probes from sensor data that aren't in dashboardProbes
    Object.values(probes).forEach((p) => {
      const normalizedId = normalizeProbeId(p.id);
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
    const normalizedAllowed = new Set(Array.from(allowed).map((id) => normalizeProbeId(id)));
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

  async function onLine(line: string) {
    setSerialLog((prev) => (prev + line + '\n').slice(-20000));

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
          // Add to Dashboard areas set
          setAreas((prev) => {
            const next = new Set(prev);
            next.add(areaInfo.area);
            return next;
          });
          // Update CommandCenter areas data
          setCommandCenterAreas((prev) => {
            const next = new Map(prev);
            const existingArea = next.get(areaInfo.area);

            const newLocations = existingArea ? new Map(existingArea.locations) : new Map<string, string>();
            const newThresholds = existingArea ? new Map(existingArea.thresholds) : new Map();
            const newStats = existingArea ? new Map(existingArea.stats) : new Map();

            if (areaInfo.probeId === '' && areaInfo.location === '') {
              newLocations.clear();
            } else if (areaInfo.probeId && areaInfo.probeId.trim() && areaInfo.location && areaInfo.location.trim()) {
              newLocations.set(areaInfo.location, areaInfo.probeId);
            }

            next.set(areaInfo.area, {
              area: areaInfo.area,
              locations: newLocations,
              thresholds: newThresholds,
              stats: newStats,
            });

            return next;
          });
        } else if (parsed.type === 'threshold' && parsed.data) {
          const thresholdInfo = parsed.data as ThresholdInfo;
          setCommandCenterAreas((prev) => {
            const next = new Map(prev);
            const existingArea = next.get(thresholdInfo.area);
            const newThresholds = existingArea ? new Map(existingArea.thresholds) : new Map();
            const newLocations = existingArea ? new Map(existingArea.locations) : new Map();
            const newStats = existingArea ? new Map(existingArea.stats) : new Map();

            // Normalize metric name
            const upper = thresholdInfo.metric.toUpperCase();
            const normalizedMetric =
              upper === 'TEMP' ? 'Temp' : upper === 'HUM' ? 'Hum' : upper === 'DB' ? 'Sound' : thresholdInfo.metric;

            newThresholds.set(normalizedMetric, { ...thresholdInfo, metric: normalizedMetric });

            if (!existingArea) {
              next.set(thresholdInfo.area, {
                area: thresholdInfo.area,
                locations: newLocations,
                thresholds: newThresholds,
                stats: newStats,
              });
            } else {
              next.set(thresholdInfo.area, {
                ...existingArea,
                thresholds: newThresholds,
              });
            }

            return next;
          });
        } else if (parsed.type === 'stat' && parsed.data) {
          const statInfo = parsed.data as StatInfo;
          setCommandCenterAreas((prev) => {
            const next = new Map(prev);
            const existingArea = next.get(statInfo.area);
            const newThresholds = existingArea ? new Map(existingArea.thresholds) : new Map();
            const newLocations = existingArea ? new Map(existingArea.locations) : new Map();
            const newStats = existingArea ? new Map(existingArea.stats) : new Map();

            // Normalize metric name
            const upper = statInfo.metric.toUpperCase();
            const normalizedMetric =
              upper === 'TEMP' ? 'Temp' : upper === 'HUM' ? 'Hum' : upper === 'DB' ? 'Sound' : statInfo.metric;

            newStats.set(normalizedMetric, { ...statInfo, metric: normalizedMetric });

            if (!existingArea) {
              next.set(statInfo.area, {
                area: statInfo.area,
                locations: newLocations,
                thresholds: newThresholds,
                stats: newStats,
              });
            } else {
              next.set(statInfo.area, {
                ...existingArea,
                stats: newStats,
              });
            }

            return next;
          });
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
      if (simTimer) {
        window.clearInterval(simTimer);
        setSimTimer(null);
      }
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
      setStatus('Failed to start reading');
    }
  }

  // SIM
  function startSim() {
    const { locations: locs, probes: simProbes } = createSimSetup();
    if (Object.keys(locations).length === 0) {
      setLocations((prev) => ({ ...prev, ...locs }));
      Object.values(locs).forEach((l) => idbPut('locations', l));
    }
    const toAdd: Record<string, Probe> = {};
    for (const id of Object.keys(simProbes)) {
      if (!probes[id]) {
        toAdd[id] = { id, locationId: simProbes[id].locationId };
        idbPut('probes', toAdd[id]);
      }
    }
    if (Object.keys(toAdd).length) setProbes((prev) => ({ ...prev, ...toAdd }));

    const ticker = makeSimTickers(Object.keys({ ...probes, ...toAdd }));
    const timer = window.setInterval(
      async () => {
        const batch = ticker();
        pending.current.push(...batch);
        await idbBulkAddSamples(batch);
      },
      2000 + Math.random() * 1000
    );
    setSimTimer(timer as unknown as number);
    setStatus('Simulating data...');
  }
  function stopSim() {
    if (simTimer) {
      window.clearInterval(simTimer);
      setSimTimer(null);
      setStatus('Idle');
    }
  }

  function handleExport() {
    const csv = toCSV(samples);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `samples-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  async function importZip(file: File) {
    const zip = await JSZip.loadAsync(file);
    const getText = async (namePrefix: string) => {
      const entry = Object.values(zip.files).find((f) => f.name.includes(namePrefix) && !f.dir);
      return entry ? await entry.async('text') : '';
    };
    const s = await getText('samples');
    const p = await getText('probes');
    const l = await getText('locations');

    if (p) {
      const rows = p.trim().split(/\r?\n/);
      rows.shift();
      const map: Record<string, Probe> = {};
      for (const line of rows) {
        const [id, locationId] = line.split(',');
        map[id] = { id, locationId: locationId || null };
        await idbPut('probes', map[id]);
      }
      setProbes(map);
    }
    if (l) {
      const rows = l.trim().split(/\r?\n/);
      rows.shift();
      const map: Record<string, Location> = {};
      for (const line of rows) {
        const parts = parseCSVLine(line);
        const [id, name, area] = parts;
        map[id] = { id, name, area };
        await idbPut('locations', map[id]);
      }
      setLocations(map);
    }
    if (s) {
      const rows = s.trim().split(/\r?\n/);
      rows.shift();
      const imported: Sample[] = [];
      for (const line of rows) {
        const cols = parseCSVLine(line);
        const ts = Number(cols[0]);
        const probeId = cols[2];
        const co2 = Number(cols[3]);
        const temp = Number(cols[4]);
        const hum = Number(cols[5]);
        const sound = Number(cols[6]);
        imported.push({ ts, probeId, co2, temp, hum, sound });
      }
      setSamples(imported.sort((a, b) => a.ts - b.ts));
      await idbBulkAddSamples(imported);
    }
    alert('ZIP imported.');
  }

  function parseCSVLine(line: string): string[] {
    const out: string[] = [];
    let cur = '',
      inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQ = false;
        } else cur += ch;
      } else {
        if (ch === ',') {
          out.push(cur);
          cur = '';
        } else if (ch === '"') inQ = true;
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  const probeListForFilter = useMemo(() => {
    return Object.values(allProbes).map((p) => {
      const area = p.locationId ? dashboardLocations[p.locationId]?.area || 'Unassigned' : 'Unassigned';
      return { id: p.id, label: p.id, area };
    });
  }, [allProbes, dashboardLocations]);

  function handleImport(file: File) {
    if (file.name.endsWith('.zip')) return importZip(file);
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result || '');
      const rows = text.trim().split(/\r?\n/);
      rows.shift();
      const imported: Sample[] = [];
      for (const line of rows) {
        if (!line.trim()) continue;
        const [ts, , probeId, co2, temp, hum, sound] = line.split(',');
        imported.push({
          ts: Number(ts),
          probeId,
          co2: Number(co2),
          temp: Number(temp),
          hum: Number(hum),
          sound: Number(sound),
        });
      }
      setSamples((prev) => [...prev, ...imported].sort((a, b) => a.ts - b.ts));
      await idbBulkAddSamples(imported);
      alert(`Imported ${imported.length} rows from CSV.`);
    };
    reader.readAsText(file);
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Header
        status={status}
        connected={!!port}
        baud={baud}
        setBaud={setBaud}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onExport={() => {
          const csv = toCSV(samples);
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = 'samples.csv';
          a.click();
          URL.revokeObjectURL(url);
        }}
        onImport={handleImport}
        onBackupClear={handleBackupClear}
        dark={dark}
        setDark={setDark}
        onStartSim={startSim}
        onStopSim={stopSim}
        simRunning={!!simTimer}
        onGetAreas={() => sendCommand('GET AREAS')}
      />

      <Container maxWidth="xl" sx={{ py: 2 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
            <Tab label="Dashboard" />
            <Tab label="Command Center" />
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
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <LatestReadings samples={filteredSamples} probes={allProbes} locations={dashboardLocations} />
                  </Grid>
                  <Grid item xs={12}>
                    <ProbesPanel probes={allProbes} locations={dashboardLocations} setProbes={setProbes} />
                  </Grid>
                  <Grid item xs={12}>
                    <LocationsPanel locations={dashboardLocations} setLocations={setLocations} />
                  </Grid>
                </Grid>
              </Grid>
            </Grid>

            <SerialLog log={serialLog} />
          </>
        )}

        {activeTab === 1 && (
          <CommandCenter
            port={port}
            baud={baud}
            connected={!!port}
            serialLog={serialLog}
            onCommandResponseRef={commandResponseCallbackRef}
            onCommandLogRef={commandLogCallbackRef}
            areas={commandCenterAreas}
            setAreas={setCommandCenterAreas}
            sendCommand={sendCommand}
          />
        )}
      </Container>
    </ThemeProvider>
  );
}

export default App;
