
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ThemeProvider, CssBaseline, Container, Grid, Paper, Typography } from '@mui/material'
import Header from './components/Header'
import Filters from './components/Filters'
import IndividualCharts from './components/IndividualCharts'
import SummaryCharts from './components/SummaryCharts'
import { ProbesPanel, LocationsPanel, LatestReadings } from './components/Lists'
import { makeTheme } from './theme'
import { Sample, Probe, Location } from './utils/types'
import { parseLine, toCSV } from './utils/parsing'
import { idbGetAll, idbBulkAddSamples, idbPut, idbClear } from './db/idb'
import JSZip from 'jszip'
import { createSimSetup, makeSimTickers } from './sim'

function App() {
  const [dark, setDark] = useState<boolean>(() => {
    const s = localStorage.getItem('pm_dark'); return s ? s === '1' : true
  })
  useEffect(()=> { localStorage.setItem('pm_dark', dark ? '1' : '0') }, [dark])

  const theme = makeTheme(dark)

  // Serial
  const [port, setPort] = useState<SerialPort | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null)
  const [baud, setBaud] = useState(115200)
  const [status, setStatus] = useState('Idle')
  const [serialLog, setSerialLog] = useState('')
  const [simTimer, setSimTimer] = useState<number | null>(null)

  // Data
  const [samples, setSamples] = useState<Sample[]>([])
  const [probes, setProbes] = useState<Record<string, Probe>>({})
  const [locations, setLocations] = useState<Record<string, Location>>({})
  const [areas, setAreas] = useState<Set<string>>(new Set())

  // Filters
  const [metricVisibility, setMetricVisibility] = useState({ CO2: true, Temp: true, Hum: true, Sound: true })
  const [activeAreas, setActiveAreas] = useState<Set<string>>(new Set(['All']))
  const [activeProbes, setActiveProbes] = useState<Set<string>>(new Set())
  const [aggType, setAggType] = useState<'avg'|'min'|'max'>('avg')
  const [showBand, setShowBand] = useState<boolean>(true)

  const pending = useRef<Sample[]>([])
  useEffect(() => {
    const t = window.setInterval(() => {
      if (pending.current.length) {
        setSamples(prev => {
          const next = [...prev, ...pending.current]
          pending.current = []
          return next
        })
      }
    }, 400)
    return () => clearInterval(t)
  }, [])

  // Load persisted data
  useEffect(() => { (async () => {
    const [savedSamples, savedProbes, savedLocations] = await Promise.all([
      idbGetAll('samples'), idbGetAll('probes'), idbGetAll('locations')
    ])
    setSamples(savedSamples as Sample[])
    const p = Object.fromEntries((savedProbes as Probe[]).map(v => [v.id, v]))
    setProbes(p)
    const loc = Object.fromEntries((savedLocations as Location[]).map(v => [v.id, v]))
    setLocations(loc)
  })().catch(console.error) }, [])

  useEffect(() => {
    const set = new Set<string>()
    Object.values(locations).forEach(l => set.add(l.area))
    setAreas(set)
  }, [locations])

  useEffect(() => {
    if (activeProbes.size === 0 && Object.keys(probes).length) {
      setActiveProbes(new Set(Object.keys(probes)))
    }
  }, [probes])

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


  const visibleProbeIds = useMemo(() => {
    const allowed = new Set<string>()
    for (const p of Object.values(probes)) {
      const area = p.locationId ? locations[p.locationId]?.area || 'Unassigned' : 'Unassigned'
      if (activeAreas.has('All') || activeAreas.has(area)) {
        allowed.add(p.id)
      }
    }
    return new Set([...allowed].filter(id => activeProbes.has(id)))
  }, [activeAreas, probes, locations, activeProbes])

  const filteredSamples = useMemo(() => samples.filter(s => visibleProbeIds.has(s.probeId)), [samples, visibleProbeIds])

  async function onLine(line: string) {
    setSerialLog(prev => (prev + line + '\n').slice(-20000))
    const parsed = parseLine(line)
    if (!parsed) return
    pending.current.push(parsed)
    if (!probes[parsed.probeId]) {
      const newProbe: Probe = { id: parsed.probeId, locationId: null }
      setProbes(prev => ({ ...prev, [newProbe.id]: newProbe }))
      await idbPut('probes', newProbe)
      setActiveProbes(prev => new Set(prev).add(newProbe.id))
    }
    await idbBulkAddSamples([parsed])
  }

  async function handleConnect() {
    if (!('serial' in navigator)) { alert('Web Serial not supported. Use Chrome/Edge over HTTPS.'); return }
    try {
      const p = await (navigator as any).serial.requestPort()
      await p.open({ baudRate: baud })
      setPort(p); setStatus('Connected. Reading...'); startReading(p)
      if (simTimer) { window.clearInterval(simTimer); setSimTimer(null) }
    } catch(e){ console.error(e); setStatus('Failed to connect') }
  }
  async function handleDisconnect() {
    setStatus('Disconnecting...')
    try { readerRef.current?.cancel() } catch {}
    try { await port?.close() } catch {}
    readerRef.current = null; setPort(null); setStatus('Disconnected')
  }

  async function startReading(p: SerialPort) {
    const textDecoder = new TextDecoderStream()
    const readableClosed = p.readable!.pipeTo(textDecoder.writable)
    const reader = (textDecoder.readable as ReadableStream<string>).getReader()
    readerRef.current = reader as any

    let buffer = ''
    setStatus('Reading...')
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
          buffer += value
          let idx
          while ((idx = buffer.search(/\r?\n/)) >= 0) {
            const line = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 1)
            await onLine(line.trim())
          }
        }
        await new Promise(r => setTimeout(r, 0))
      }
    } catch(e){ console.error('Read loop error', e) }
    finally { try { await readableClosed } catch {} }
  }

  // SIM
  function startSim() {
    const { locations: locs, probes: simProbes } = createSimSetup()
    if (Object.keys(locations).length === 0) {
      setLocations(prev => ({ ...prev, ...locs }))
      Object.values(locs).forEach(l => idbPut('locations', l))
    }
    const toAdd: Record<string, Probe> = {}
    for (const id of Object.keys(simProbes)) {
      if (!probes[id]) {
        toAdd[id] = { id, locationId: simProbes[id].locationId }
        idbPut('probes', toAdd[id])
      }
    }
    if (Object.keys(toAdd).length) setProbes(prev => ({ ...prev, ...toAdd }))

    const ticker = makeSimTickers(Object.keys({ ...probes, ...toAdd }))
    const timer = window.setInterval(async () => {
      const batch = ticker()
      pending.current.push(...batch)
      await idbBulkAddSamples(batch)
    }, 2000 + Math.random()*1000)
    setSimTimer(timer as unknown as number)
    setStatus('Simulating data...')
  }
  function stopSim() {
    if (simTimer) { window.clearInterval(simTimer); setSimTimer(null); setStatus('Idle') }
  }

  function handleExport() {
    const csv = toCSV(samples)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `samples-${new Date().toISOString().replace(/[:.]/g,'-')}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  function csvSafe(s: string) { return (/,|"|\n/.test(s)) ? '"'+s.replace(/"/g,'""')+'"' : s }

  async function handleBackupClear() {
    if (!confirm('Backup & clear all local data? A ZIP with CSVs will download.')) return
    const samplesCSV = toCSV(samples)
    const probesCSV = ['id,locationId', ...Object.values(probes).map(p => [p.id, p.locationId ?? ''].join(','))].join('\n')
    const locationsCSV = ['id,name,area', ...Object.values(locations).map(l => [l.id, csvSafe(l.name), csvSafe(l.area)].join(','))].join('\n')

    const zip = new JSZip()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    zip.file(`samples-${ts}.csv`, samplesCSV)
    zip.file(`probes-${ts}.csv`, probesCSV)
    zip.file(`locations-${ts}.csv`, locationsCSV)
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); const url = URL.createObjectURL(blob)
    a.href = url; a.download = `probemaster-backup-${ts}.zip`; a.click(); URL.revokeObjectURL(url)

    await Promise.all([idbClear('samples'), idbClear('probes'), idbClear('locations')])
    setSamples([]); setProbes({}); setLocations({}); setActiveAreas(new Set(['All'])); setActiveProbes(new Set())
  }

  async function importZip(file: File) {
    const zip = await JSZip.loadAsync(file)
    const getText = async (namePrefix: string) => {
      const entry = Object.values(zip.files).find(f => f.name.includes(namePrefix) && !f.dir)
      return entry ? await entry.async('text') : ''
    }
    const s = await getText('samples')
    const p = await getText('probes')
    const l = await getText('locations')

    if (p) {
      const rows = p.trim().split(/\r?\n/); rows.shift()
      const map: Record<string, Probe> = {}
      for (const line of rows) {
        const [id, locationId] = line.split(',')
        map[id] = { id, locationId: locationId || null }
        await idbPut('probes', map[id])
      }
      setProbes(map)
    }
    if (l) {
      const rows = l.trim().split(/\r?\n/); rows.shift()
      const map: Record<string, Location> = {}
      for (const line of rows) {
        const parts = parseCSVLine(line)
        const [id, name, area] = parts
        map[id] = { id, name, area }
        await idbPut('locations', map[id])
      }
      setLocations(map)
    }
    if (s) {
      const rows = s.trim().split(/\r?\n/); rows.shift()
      const imported: Sample[] = []
      for (const line of rows) {
        const cols = parseCSVLine(line)
        const ts = Number(cols[0]); const probeId = cols[2]
        const co2 = Number(cols[3]); const temp = Number(cols[4]); const hum = Number(cols[5]); const sound = Number(cols[6])
        imported.push({ ts, probeId, co2, temp, hum, sound })
      }
      setSamples(imported.sort((a,b)=> a.ts-b.ts))
      await idbBulkAddSamples(imported)
    }
    alert('ZIP imported.')
  }

  function parseCSVLine(line: string): string[] {
    const out: string[] = []
    let cur = '', inQ = false
    for (let i=0;i<line.length;i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"' && line[i+1] === '"') { cur += '"'; i++ }
        else if (ch === '"') { inQ = false }
        else cur += ch
      } else {
        if (ch === ',') { out.push(cur); cur = '' }
        else if (ch === '"') inQ = true
        else cur += ch
      }
    }
    out.push(cur)
    return out
  }

  const probeListForFilter = useMemo(() => {
    return Object.values(probes).map(p => {
      const area = p.locationId ? locations[p.locationId]?.area || 'Unassigned' : 'Unassigned'
      return { id: p.id, label: p.id, area }
    })
  }, [probes, locations])

  function handleImport(file: File) {
    if (file.name.endsWith('.zip')) return importZip(file)
    const reader = new FileReader()
    reader.onload = async () => {
      const text = String(reader.result || '')
      const rows = text.trim().split(/\r?\n/)
      rows.shift()
      const imported: Sample[] = []
      for (const line of rows) {
        if (!line.trim()) continue
        const [ts, , probeId, co2, temp, hum, sound] = line.split(',')
        imported.push({ ts: Number(ts), probeId, co2: Number(co2), temp: Number(temp), hum: Number(hum), sound: Number(sound) })
      }
      setSamples(prev => [...prev, ...imported].sort((a,b)=>a.ts-b.ts))
      await idbBulkAddSamples(imported)
      alert(`Imported ${imported.length} rows from CSV.`)
    }
    reader.readAsText(file)
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
        onExport={() => { const csv = toCSV(samples); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = 'samples.csv'; a.click(); URL.revokeObjectURL(url); }}
        onImport={handleImport}
        onBackupClear={handleBackupClear}
        dark={dark}
        setDark={setDark}
        onStartSim={startSim}
        onStopSim={stopSim}
        simRunning={!!simTimer}
      />

      <Container maxWidth="xl" sx={{ py: 2 }}>
        <Filters
          areas={Array.from(areas).sort()}
          activeAreas={activeAreas} setActiveAreas={setActiveAreas}
          metricVisibility={metricVisibility} setMetricVisibility={setMetricVisibility}
          probes={probeListForFilter}
          activeProbes={activeProbes} setActiveProbes={setActiveProbes}
          aggType={aggType} setAggType={setAggType}
          showBand={showBand} setShowBand={setShowBand}
        />

        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <Paper sx={{ p:2, mb:2 }} variant="outlined">
              <Typography variant="subtitle1" sx={{ mb: 1 }}>Individual (Per-Probe)</Typography>
              <IndividualCharts
                samples={filteredSamples}
                probes={probes}
                locations={locations}
                activeProbes={activeProbes}
                metricVisibility={metricVisibility}
              />
            </Paper>

            <Paper sx={{ p:2 }} variant="outlined">
              <Typography variant="subtitle1" sx={{ mb: 1 }}>Summary (Per-Area)</Typography>
              <SummaryCharts
                samples={filteredSamples}
                probes={probes}
                locations={locations}
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
                <LatestReadings samples={filteredSamples} probes={probes} locations={locations} />
              </Grid>
              <Grid item xs={12}>
                <ProbesPanel probes={probes} locations={locations} setProbes={setProbes} />
              </Grid>
              <Grid item xs={12}>
                <LocationsPanel locations={locations} setLocations={setLocations} />
              </Grid>
            </Grid>
          </Grid>
        </Grid>

        <Paper sx={{ p:2, my:2 }} variant="outlined">
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Serial Log</Typography>
          <pre style={{ whiteSpace:'pre-wrap', margin:0, maxHeight:240, overflow:'auto' }}>{serialLog || 'No data yet...'}</pre>
        </Paper>
      </Container>
    </ThemeProvider>
  )
}

export default App
