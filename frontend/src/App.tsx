import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeProvider, CssBaseline, Container, Grid, Paper, Typography, Tabs, Tab, Box, Dialog, DialogTitle, DialogContent, TextField, DialogActions, Button } from '@mui/material';
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
import { exportAllData } from './utils/exportData';
import JSZip from 'jszip';
import {
  generateSampleData,
  generateGetAreasResponse,
  generateGetStatsResponse,
  generateGetThresholdsResponse,
  getTestProbeIds,
} from './utils/testMode';
import { getAccessKey, setAccessKey, getAuthHeaders } from './utils/auth';

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
  // Password protection
  const [passwordModalOpen, setPasswordModalOpen] = useState<boolean>(() => {
    const savedPassword = localStorage.getItem('pm_access_key');
    // If password is saved and matches, don't show modal
    return savedPassword !== 'sasquatch';
  });
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');

  const handlePasswordSubmit = () => {
    if (passwordInput.trim() === 'sasquatch') {
      setAccessKey('sasquatch');
      setPasswordModalOpen(false);
      setPasswordError('');
    } else {
      setPasswordError('Incorrect password');
      setPasswordInput('');
    }
  };

  const handlePasswordKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handlePasswordSubmit();
    }
  };

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

  const isWherePage = typeof window !== 'undefined' && window.location.pathname === '/whereiseverybodyat';
  const [showWhereRawData, setShowWhereRawData] = useState<boolean>(false);

  // Colors and labels for pixel visualization areas
  const pixelAreaColors: Record<string, string> = {
    FLOOR17: '#4169E1', // royal blue
    FLOOR16: '#4CAF50', // green
    FLOOR15: '#FFEB3B', // yellow
    FLOOR12: '#03A9F4', // sky blue
    FLOOR11: '#9C27B0', // purple
    TEAROOM: '#C0CA33', // between green and yellow
    POOL: '#B39DDB', // lavender
  };

  const pixelAreaLabels: Record<string, string> = {
    TEAROOM: 'TEAHOUSE',
  };

  // Update browser tab title based on current page
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isWherePage) {
      document.title = 'Where Is Every Body At?';
    } else {
      document.title = 'N.E.R.V.E.S Center';
    }
  }, [isWherePage]);

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
  
  // Polling state
  const [lastMessageId, setLastMessageId] = useState<string>('');
  const lastMessageIdRef = useRef<string>(''); // Ref to always get current value
  const [pollingEnabled, setPollingEnabled] = useState<boolean>(true);
  const seenMessageIdsRef = useRef<Set<string>>(new Set()); // Track seen message IDs to avoid duplicates
  const oldestMessageIdRef = useRef<string>(''); // Track oldest message ID for pagination
  const paginationIntervalRef = useRef<number | null>(null); // Interval for pagination
  const [probeRefreshInterval, setProbeRefreshInterval] = useState<number>(10); // Default 10 seconds - how often probes send data
  const [pollingFrequency, setPollingFrequency] = useState<number>(10); // Default 10 seconds - how often frontend polls backend
  const pollingIntervalRef = useRef<number | null>(null);
  
  // Keep ref in sync with state
  useEffect(() => {
    lastMessageIdRef.current = lastMessageId;
  }, [lastMessageId]);

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
  const [pixelUpdateTimestamp, setPixelUpdateTimestamp] = useState<number | null>(null);

  // Filters
  const [metricVisibility, setMetricVisibility] = useState({ CO2: true, Temp: true, Hum: true, Sound: true });
  const [activeAreas, setActiveAreas] = useState<Set<string>>(new Set(['All']));
  const [activeProbes, setActiveProbes] = useState<Set<string>>(new Set());
  const [aggType, setAggType] = useState<'avg' | 'min' | 'max'>('avg');
  const [showBand, setShowBand] = useState<boolean>(true);
  const [bucketInterval, setBucketInterval] = useState<number>(30000); // 30 seconds default

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

  // Function to fetch areas from the API
  async function handleGetAreas() {
    setGetAreasTimestamp(Date.now());
    // Clear existing areas to start fresh
    setCommandCenterAreas(new Map());
    setAreas(new Set());
    
    try {
      const response = await fetch('/api/areas', {
        method: 'GET',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Failed to fetch areas:', response.status, response.statusText);
      return;
    }

      const data = await response.json();
      // Data is now an array of objects: [{area, location, probeID}, ...]
      const areaItems = Array.isArray(data) ? data : [];

      // Convert each item to AREA: format for processing
      for (const item of areaItems) {
        const area = item.area || '';
        const location = item.location || '';
        const probeID = item.probeID || '';
        
        if (!area) continue;
        
        // Format: "AREA: {AREA} {LOCATION} {PROBE_ID}" or "AREA: {AREA} (no probes)"
        let areaLine: string;
        if (!location && !probeID) {
          areaLine = `AREA: ${area} (no probes)`;
        } else {
          areaLine = `AREA: ${area} ${location} ${probeID}`;
        }
        
        await onLine(areaLine);
      }
    } catch (error) {
      console.error('Error fetching areas:', error);
    }
  }

  // Function to fetch stats from the API
  async function handleGetStats(area?: string) {
    try {
      const url = area ? `/api/stats?area=${encodeURIComponent(area)}` : '/api/stats';
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Failed to fetch stats:', response.status, response.statusText);
        return;
      }

      const data = await response.json();
      const stats = data.stats || [];

      // Process each stat as if it came from serial
      // Format: "STAT: {area} {metric} min:{min} max:{max} min_o:{min_o} max_o:{max_o}"
      for (const areaStat of stats) {
        for (const metric of areaStat.metrics) {
          const statLine = `STAT: ${areaStat.name} ${metric.name} min:${metric.min} max:${metric.max} min_o:${metric.min_o} max_o:${metric.max_o}`;
          await onLine(statLine);
        }
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }

  async function fetchPixelTimestamp() {
    try {
      const response = await fetch('/api/pixeltimestamp', {
        method: 'GET',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (data.lastUpdated) {
        const ts = Date.parse(data.lastUpdated);
        if (!Number.isNaN(ts)) {
          setPixelUpdateTimestamp(ts);
          return;
        }
      }
      setPixelUpdateTimestamp(null);
    } catch (error) {
      console.error('Failed to fetch pixel timestamp:', error);
    }
  }

  // Function to fetch pixels from the API
  async function handleGetPixels() {
    try {
      const response = await fetch('/api/pixels', {
        method: 'GET',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Failed to fetch pixels:', response.status, response.statusText);
        return;
      }

      const data = await response.json();
      const pixelCounts = data.pixelCount || [];

      // Process each pixel count as if it came from serial
      // Format: "PIXELS {area} {value}"
      // The pixels value may contain * (e.g., "6*"), so we need to extract the number
      for (const pixelCount of pixelCounts) {
        // Extract numeric value from pixels string (handle "6*" -> 6, "5" -> 5)
        const pixelsStr = pixelCount.pixels || '0';
        const pixelsClean = pixelsStr.replace('*', '');
        const pixelValue = parseInt(pixelsClean, 10);
        
        if (!isNaN(pixelValue)) {
          // Normalize area name
          let normalizedArea = pixelCount.area.toUpperCase();
          const floorMatch = normalizedArea.match(/FLOOR\s*(\d+)/);
          if (floorMatch) {
            normalizedArea = `FLOOR${floorMatch[1]}`;
          }
          
          // Update pixel data
          setPixelData((prev) => ({
            ...prev,
            [normalizedArea]: Math.max(0, Math.min(6, pixelValue)),
          }));
          setPixelDataLastFetched(Date.now());
        }
      }

      fetchPixelTimestamp();
    } catch (error) {
      console.error('Error fetching pixels:', error);
    }
  }

  // On initial load, fetch areas and start pixel polling every 60 seconds
  useEffect(() => {
    // Fire once on mount
    handleGetAreas().catch((err) => console.error('Initial GET AREAS failed:', err));
    handleGetPixels().catch((err) => console.error('Initial GET PIXELS failed:', err));

    const pixelInterval = window.setInterval(() => {
      handleGetPixels().catch((err) => console.error('Polling GET PIXELS failed:', err));
    }, 60000);

    return () => {
      window.clearInterval(pixelInterval);
    };
  }, []);

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

  // Parse probe ID to extract area and location
  // Format examples:
  // - F17R -> Floor17, Rotunda
  // - F17H -> Floor17, Hallway
  // - F16R -> Floor16, Rotunda
  // - POOL -> pool, Line
  // - TEA1 -> Tea_room, Location1
  // - TEA2 -> Tea_room, Location2
  function parseProbeId(probeId: string): { area: string; location: string } | null {
    const upperId = probeId.toUpperCase();
    
    // Floor probes: F17R, F17H, F16R, etc.
    const floorMatch = upperId.match(/^F(\d+)([RH])$/);
    if (floorMatch) {
      const floorNum = floorMatch[1];
      const locationCode = floorMatch[2];
      const area = `Floor${floorNum}`;
      const location = locationCode === 'R' ? 'Rotunda' : 'Hallway';
      return { area, location };
    }
    
    // Pool: POOL
    if (upperId === 'POOL') {
      return { area: 'pool', location: 'Line' };
    }
    
    // Tea room: TEA1, TEA2
    const teaMatch = upperId.match(/^TEA([12])$/);
    if (teaMatch) {
      const locationNum = teaMatch[1];
      return { area: 'Tea_room', location: `Location${locationNum}` };
    }
    
    return null;
  }

  // Convert probe data format from server to parser format
  // Current format: "F16R co2=454,temp=25.5,hum=36.2,db=67,rssi=-57"
  // Old format: "abcd: [CO2] 500 [HUM] 50 [TEMP] 25 [dB] 60"
  // Parser expects: "abcd: co2:500 temp:25 hum:50 sound:60"
  function convertProbeDataFormat(data: string, messageId?: string): string {
    // Try current format: "F16R co2=454,temp=25.5,hum=36.2,db=67,rssi=-57"
    // 4 char probe ID followed by space, then data
    const spaceFormatMatch = data.match(/^([A-Z0-9]{4})\s+(.+)$/i);
    let probeId: string;
    let dataPart: string;
    
    if (spaceFormatMatch) {
      // Has probe ID prefix with space
      probeId = spaceFormatMatch[1].toUpperCase();
      dataPart = spaceFormatMatch[2];
    } else {
      // Try old format with colon: "F17R: co2=462,..."
      const colonFormatMatch = data.match(/^([A-Z0-9]{4}):\s*(.+)$/i);
      if (colonFormatMatch) {
        probeId = colonFormatMatch[1].toUpperCase();
        dataPart = colonFormatMatch[2];
      } else {
        // No probe ID prefix - try to extract from messageId or use default
        probeId = messageId ? messageId.substring(0, 4).toUpperCase() : 'PROB';
        dataPart = data;
      }
    }
    
    // Try new format: co2=454,temp=25.5,hum=36.2,db=67,rssi=-57
    const newFormatMatch = dataPart.match(/co2=([^,]+),temp=([^,]+),hum=([^,]+),db=([^,]+)/i);
    if (newFormatMatch) {
      const [, co2, temp, hum, db] = newFormatMatch;
      return `${probeId}: co2:${co2} temp:${temp} hum:${hum} sound:${db}`;
    }
    
    // Try old format: "abcd: [CO2] 500 [HUM] 50 [TEMP] 25 [dB] 60"
    const oldFormatMatch = data.match(/^([^:]+):\s*(.+)$/);
    if (oldFormatMatch) {
      const probeId = oldFormatMatch[1].trim();
      const rest = oldFormatMatch[2];
      
      // Extract values using regex
      const co2Match = rest.match(/\[CO2\]\s*(\S+)/i);
      const humMatch = rest.match(/\[HUM\]\s*(\S+)/i);
      const tempMatch = rest.match(/\[TEMP\]\s*(\S+)/i);
      const dbMatch = rest.match(/\[dB\]\s*(\S+)/i);
      
      const parts: string[] = [];
      if (co2Match) parts.push(`co2:${co2Match[1]}`);
      if (tempMatch) parts.push(`temp:${tempMatch[1]}`);
      if (humMatch) parts.push(`hum:${humMatch[1]}`);
      if (dbMatch) parts.push(`sound:${dbMatch[1]}`);
      
      return parts.length > 0 ? `${probeId}: ${parts.join(' ')}` : data;
    }
    
    // Return as-is if no format matches
    return data;
  }

  // Fetch probe config on mount
  useEffect(() => {
    const fetchProbeConfig = async () => {
      try {
        const response = await fetch('/api/probeconfig', {
          method: 'GET',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          const data = await response.json();
          console.log('Fetched probe config:', data);
          if (data.refresh !== undefined && data.refresh !== null) {
            setProbeRefreshInterval(data.refresh);
            console.log('Set probe refresh interval to:', data.refresh);
          } else {
            console.warn('Probe config response missing refresh field:', data);
          }
        } else {
          console.error('Failed to fetch probe config:', response.status, response.statusText);
        }
      } catch (error) {
        console.error('Failed to fetch probe config:', error);
      }
    };
    fetchProbeConfig();
  }, []);

  // Start polling when component mounts
  useEffect(() => {
    fetchPixelTimestamp();
    const interval = window.setInterval(fetchPixelTimestamp, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!pollingEnabled || testMode) {
      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (paginationIntervalRef.current !== null) {
        clearInterval(paginationIntervalRef.current);
        paginationIntervalRef.current = null;
      }
      return;
    }

    const pollProbeData = async () => {
      try {
        const apiBase = '/api';
        // Use ref to always get current lastMessageId value
        const currentLastId = lastMessageIdRef.current;
        // Always request length=100 to get all available messages
        const url = currentLastId 
          ? `${apiBase}/poll?lastId=${encodeURIComponent(currentLastId)}&length=100`
          : `${apiBase}/poll?length=100`;
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            // Unauthorized - password might be wrong
            console.error('Unauthorized - check password');
            return;
          }
          console.error('Poll failed:', response.status, response.statusText);
          return;
        }

        // Get raw response text
        const rawResponse = await response.text();
        
        // Try to parse JSON
        let data;
        try {
          data = JSON.parse(rawResponse);
        } catch (parseError) {
          console.error('Failed to parse response:', parseError);
          return;
        }

        const messages = data.messages || [];
        const newMessages: typeof messages = [];

        // Filter out duplicate messages using seen IDs
        for (const msg of messages) {
          const msgId = msg.id || '';
          if (msgId && !seenMessageIdsRef.current.has(msgId)) {
            seenMessageIdsRef.current.add(msgId);
            newMessages.push(msg);
          }
        }

        if (newMessages.length > 0) {
          // Log the raw response only when there are new messages
          const timestamp = new Date().toISOString();
          const logEntry = `[${timestamp}] ${rawResponse}`;
          setSerialLog((prev) => {
            // Remove trailing newlines from prev, then add new entry
            const trimmedPrev = prev.trimEnd();
            const newLog = trimmedPrev ? `${trimmedPrev}\n${logEntry}` : logEntry;
            return newLog.slice(-20000);
          });

          // Process each new message
          for (const msg of newMessages) {
            const msgId = msg.id || '';
            
            // Update lastMessageId to the newest message
            if (msgId && (!lastMessageIdRef.current || msgId > lastMessageIdRef.current)) {
              lastMessageIdRef.current = msgId;
              setLastMessageId(msgId);
            }

            // Update oldestMessageId for pagination
            if (msgId && (!oldestMessageIdRef.current || msgId < oldestMessageIdRef.current)) {
              oldestMessageIdRef.current = msgId;
            }

            // Convert format and parse the probe data line
            const convertedData = convertProbeDataFormat(msg.data, msg.id);
            
            // Extract probe ID from converted data
            const probeIdMatch = convertedData.match(/^([^:]+):/);
            if (probeIdMatch) {
              const probeId = probeIdMatch[1].trim();
              
              // Parse probe ID to get area and location
              const parsed = parseProbeId(probeId);
              if (parsed) {
                const { area, location } = parsed;
                const locationId = `${area}-${location}`;
                
                // Update or create location
                setLocations((prev) => {
                  if (!prev[locationId]) {
                    const newLocation: Location = {
                      id: locationId,
                      name: location,
                      area: area,
                    };
                    idbPut('locations', newLocation).catch(console.error);
                    return { ...prev, [locationId]: newLocation };
                  }
                  return prev;
                });
                
                // Update probe's locationId
                setProbes((prev) => {
                  if (prev[probeId]) {
                    if (prev[probeId].locationId !== locationId) {
                      const updatedProbe: Probe = {
                        ...prev[probeId],
                        locationId: locationId,
                      };
                      idbPut('probes', updatedProbe).catch(console.error);
                      return { ...prev, [probeId]: updatedProbe };
                    }
                  } else {
                    // Create new probe if it doesn't exist
                    const newProbe: Probe = {
                      id: probeId,
                      locationId: locationId,
                    };
                    idbPut('probes', newProbe).catch(console.error);
                    setActiveProbes((prev) => new Set(prev).add(probeId));
                    return { ...prev, [probeId]: newProbe };
                  }
                  return prev;
                });
              }
            }
            
            await onLine(convertedData);
          }
        }
      } catch (error) {
        // Only log to console, not to serial log
        console.error('Poll error:', error);
      }
    };

    // Function to fetch older messages via pagination
    const fetchOlderMessages = async () => {
      const oldestId = oldestMessageIdRef.current;
      if (!oldestId) {
        return; // No oldest message yet, skip pagination
      }

      try {
        const apiBase = '/api';
        const url = `${apiBase}/poll?beforeId=${encodeURIComponent(oldestId)}&length=100`;
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          console.error('Pagination poll failed:', response.status, response.statusText);
          return;
        }

        const data = await response.json();
        const messages = data.messages || [];
        const newMessages: typeof messages = [];

        // Filter out duplicate messages
        for (const msg of messages) {
          const msgId = msg.id || '';
          if (msgId && !seenMessageIdsRef.current.has(msgId)) {
            seenMessageIdsRef.current.add(msgId);
            newMessages.push(msg);
          }
        }

        if (newMessages.length > 0) {
          // Update oldestMessageId to the oldest message in this batch
          for (const msg of newMessages) {
            const msgId = msg.id || '';
            if (msgId && (!oldestMessageIdRef.current || msgId < oldestMessageIdRef.current)) {
              oldestMessageIdRef.current = msgId;
            }
          }

          // Process messages (same logic as pollProbeData)
          for (const msg of newMessages) {
            const convertedData = convertProbeDataFormat(msg.data, msg.id);
            
            const probeIdMatch = convertedData.match(/^([^:]+):/);
            if (probeIdMatch) {
              const probeId = probeIdMatch[1].trim();
              
              const parsed = parseProbeId(probeId);
              if (parsed) {
                const { area, location } = parsed;
                const locationId = `${area}-${location}`;
                
                setLocations((prev) => {
                  if (!prev[locationId]) {
                    const newLocation: Location = {
                      id: locationId,
                      name: location,
                      area: area,
                    };
                    idbPut('locations', newLocation).catch(console.error);
                    return { ...prev, [locationId]: newLocation };
                  }
                  return prev;
                });
                
                setProbes((prev) => {
                  if (prev[probeId]) {
                    if (prev[probeId].locationId !== locationId) {
                      const updatedProbe: Probe = {
                        ...prev[probeId],
                        locationId: locationId,
                      };
                      idbPut('probes', updatedProbe).catch(console.error);
                      return { ...prev, [probeId]: updatedProbe };
                    }
                  } else {
                    const newProbe: Probe = {
                      id: probeId,
                      locationId: locationId,
                    };
                    idbPut('probes', newProbe).catch(console.error);
                    setActiveProbes((prev) => new Set(prev).add(probeId));
                    return { ...prev, [probeId]: newProbe };
                  }
                  return prev;
                });
              }
            }
            
            await onLine(convertedData);
          }
        }
      } catch (error) {
        console.error('Pagination error:', error);
      }
    };

    // Initial fetch of last 100 messages
    pollProbeData();
    
    // Set up regular polling for new messages
    pollingIntervalRef.current = window.setInterval(pollProbeData, pollingFrequency * 1000);
    
    // Set up pagination to fetch older messages every minute
    paginationIntervalRef.current = window.setInterval(fetchOlderMessages, 60000); // 60 seconds

    return () => {
      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (paginationIntervalRef.current !== null) {
        clearInterval(paginationIntervalRef.current);
        paginationIntervalRef.current = null;
      }
    };
  }, [pollingEnabled, testMode, pollingFrequency]);

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
      // Filter out probes that don't have a 4 character ID
      const validProbes = (savedProbes as Probe[]).filter((v) => isValidProbeId(v.id));
      const p = Object.fromEntries(validProbes.map((v) => [v.id, v]));
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

  // Helper function to normalize probe ID (strip prefixes like [UART2])
  function normalizeProbeId(probeId: string | undefined): string {
    if (!probeId) return '';
    // Remove prefixes like [UART2], [UART1], etc.
    const match = probeId.match(/\[.*?\]\s*(.+)$/);
    return match ? match[1].trim() : probeId.trim();
  }

  // Helper function to validate probe ID (must be exactly 4 characters)
  function isValidProbeId(probeId: string | undefined): boolean {
    if (!probeId) return false;
    const normalized = normalizeProbeId(probeId);
    return normalized.length === 4;
  }

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
        // Ignore probes that don't have a 4 character ID
        if (!isValidProbeId(probeId)) {
          return;
        }
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

  // Merge dashboard probes with sensor data probes
  const allProbes = useMemo(() => {
    const merged = { ...dashboardProbes };
    // Add probes from sensor data that aren't in dashboardProbes
    Object.values(probes).forEach((p) => {
      if (!p.id) return;
      const normalizedId = normalizeProbeId(p.id);
      if (!normalizedId) return;
      // Ignore probes that don't have a 4 character ID
      if (!isValidProbeId(normalizedId)) {
        return;
      }
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
    // Note: Poll responses are logged separately in the polling function

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
              // Only add probe if it has a valid 4 character ID
              if (isValidProbeId(areaInfo.probeId)) {
              newLocations.set(areaInfo.location, areaInfo.probeId);
              }
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
            upper === 'TEMP' ? 'Temp' : 
            upper === 'HUM' ? 'Hum' : 
            upper === 'DB' ? 'Sound' : 
            upper === 'CO2' ? 'CO2' : 
            statInfo.metric;

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
    // Ignore probes that don't have a 4 character ID
    if (!isValidProbeId(normalizedProbeId)) {
      return;
    }
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

  async function handleExportData() {
    try {
      await exportAllData();
    } catch (error) {
      console.error('Error exporting data:', error);
      alert('Failed to export data. Please check the console for details.');
    }
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

    await Promise.all([
      idbClear('samples'),
      idbClear('probes'),
      idbClear('locations'),
      idbClear('areasData'),
      idbClear('pixelData'),
      idbClear('timestamps'),
    ]);
    setSamples([]);
    setProbes({});
    setLocations({});
    setCommandCenterAreas(new Map());
    setAreas(new Set());
    setPixelData({});
    setAreasLastFetched(null);
    setPixelDataLastFetched(null);
    setThresholdsLastFetched(new Map());
    setStatsLastFetched(new Map());
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
      <Dialog
        open={passwordModalOpen}
        disableEscapeKeyDown
        onClose={() => {}} // Prevent closing without password
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Access Required</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <TextField
              autoFocus
              fullWidth
              type="password"
              label="Password"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setPasswordError('');
              }}
              onKeyPress={handlePasswordKeyPress}
              error={!!passwordError}
              helperText={passwordError}
              sx={{ mt: 1 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handlePasswordSubmit} variant="contained">
            Submit
          </Button>
        </DialogActions>
      </Dialog>
      {!passwordModalOpen && (
        <>
      {!isWherePage && (
        <Header
          status={pollingEnabled && !testMode ? 'Polling' : status}
          connected={!!port || testMode || pollingEnabled}
          baud={baud}
          setBaud={setBaud}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onBackupClear={handleBackupClear}
          dark={dark}
          setDark={setDark}
          onGetAreas={handleGetAreas}
          testMode={testMode}
          onToggleTestMode={handleToggleTestMode}
          onExportData={handleExportData}
        />
      )}

      {isWherePage ? (
        <Container maxWidth="md" sx={{ py: 2 }}>
          <PixelVisualization
            pixelData={pixelData}
            sendCommand={sendCommand}
            connected={!!port || testMode}
            onGetPixels={handleGetPixels}
            lastPixelUpdate={pixelUpdateTimestamp}
            areaColors={pixelAreaColors}
            areaLabels={pixelAreaLabels}
          />

          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Contributors
            </Typography>
            <Typography variant="body2">
              Jerica Rattana, Nathan Meyers, Zach Radding, Liina Laufer, Matt Merner, John Owens, Wesley Evans
            </Typography>
          </Box>

          <Box sx={{ mt: 4 }}>
            <Typography variant="h5" sx={{ mb: 1 }}>
              How does it work?
            </Typography>
            <Typography variant="subtitle1">
              Where Is Every Body At uses cutting edge CO2, Temperature, Humidity, and Decibel sensors placed throughout the
              event to estimate where every body is at.
            </Typography>
          </Box>

          <Box sx={{ mt: 4, mb: 2 }}>
            <Button
              variant="contained"
              fullWidth
              onClick={() => setShowWhereRawData((prev) => !prev)}
            >
              Nerd out over the raw data
            </Button>
            <Typography variant="subtitle1">
              Data will start flowing in as soon as it's enabled.
            </Typography>
          </Box>

          {showWhereRawData && (
            <Box sx={{ mt: 2, mb: 2 }}>
              {['FLOOR11', 'FLOOR12', 'FLOOR15', 'FLOOR16', 'FLOOR17', 'POOL', 'TEAROOM']
                .filter((areaName) => areas.has(areaName))
                .map((areaName) => (
                  <Box key={areaName} sx={{ mb: 3 }}>
                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                      {areaName}
                    </Typography>
                    <SummaryCharts
                      samples={filteredSamples}
                      probes={allProbes}
                      locations={dashboardLocations}
                      activeAreas={new Set<string>([areaName])}
                      metricVisibility={metricVisibility}
                      aggType={aggType}
                      showBand={showBand}
                      bucketInterval={bucketInterval}
                    />
                  </Box>
                ))}
            </Box>
          )}
        </Container>
      ) : (
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
              bucketInterval={bucketInterval}
              setBucketInterval={setBucketInterval}
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
                    bucketInterval={bucketInterval}
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
                    bucketInterval={bucketInterval}
                  />
                </Paper>
              </Grid>

              <Grid item xs={12} md={4}>
                <PixelVisualization
                  pixelData={pixelData}
                  sendCommand={sendCommand}
                  connected={!!port || testMode}
                  onGetPixels={handleGetPixels}
                  lastPixelUpdate={pixelUpdateTimestamp}
                  areaColors={pixelAreaColors}
                  areaLabels={pixelAreaLabels}
                />
                <LatestReadings samples={filteredSamples} probes={allProbes} locations={dashboardLocations} />
              </Grid>
            </Grid>

            <SerialLog log={serialLog} onClear={() => setSerialLog('')} />
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
            onGetStats={handleGetStats}
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
            probeRefreshInterval={probeRefreshInterval}
            setProbeRefreshInterval={setProbeRefreshInterval}
            pollingFrequency={pollingFrequency}
            setPollingFrequency={setPollingFrequency}
            passwordUnlocked={!passwordModalOpen}
          />
        )}

        {activeTab === 2 && (
          <Grid container spacing={2}>
            <SummaryCharts
              samples={filteredSamples}
              probes={allProbes}
              locations={dashboardLocations}
              activeAreas={activeAreas}
              metricVisibility={metricVisibility}
              aggType={aggType}
              showBand={showBand}
              bucketInterval={bucketInterval}
              gridLayout={true}
            />
          </Grid>
        )}
      </Container>
      )}
        </>
      )}
    </ThemeProvider>
  );
}

export default App;
