export type AreaInfo = {
  area: string;
  location: string;
  probeId: string;
};

export type StatInfo = {
  area: string;
  metric: string;
  min: number;
  max: number;
  min_o: number;
  max_o: number;
};

export type ThresholdInfo = {
  area: string;
  metric: string;
  values: number[];
};

export type UseBaselineInfo = {
  area: string;
  enabled: boolean;
};

export function parseAreaResponse(line: string): AreaInfo | null {
  // Format: AREA: {AREA} {LOCATION} {PROBE_ID}
  // or: AREA: {AREA} (no probes)
  // Strip prefixes like [UART1] WEBd: or WEBd: or [UART1]WEBd:
  // Find AREA: in the line and extract from there
  const areaIdx = line.indexOf('AREA:');
  if (areaIdx === -1) return null;
  const cleaned = line.slice(areaIdx).trim();

  // Handle case with probe
  const matchWithProbe = cleaned.match(/^AREA:\s+(\S+)\s+(\S+)\s+(\S+)$/i);
  if (matchWithProbe) {
    return {
      area: matchWithProbe[1],
      location: matchWithProbe[2],
      probeId: matchWithProbe[3],
    };
  }

  // Handle case without probe: AREA: {AREA} (no probes)
  const matchNoProbe = cleaned.match(/^AREA:\s+(\S+)\s+\(no\s+probes\)$/i);
  if (matchNoProbe) {
    return {
      area: matchNoProbe[1],
      location: '',
      probeId: '',
    };
  }

  return null;
}

export function parseStatResponse(line: string): StatInfo | null {
  // Format: STAT: {AREA} {METRIC} min:{value} max:{value} min_o:{value} max_o:{value}
  // Strip prefixes like [UART1] WEBd: or WEBd:
  const statIdx = line.indexOf('STAT:');
  if (statIdx === -1) return null;
  const cleaned = line.slice(statIdx).trim();
  const match = cleaned.match(
    /^STAT:\s+(\S+)\s+(\S+)\s+min:([-\d.]+)\s+max:([-\d.]+)\s+min_o:([-\d.]+)\s+max_o:([-\d.]+)$/i
  );
  if (!match) return null;
  return {
    area: match[1],
    metric: match[2],
    min: parseFloat(match[3]),
    max: parseFloat(match[4]),
    min_o: parseFloat(match[5]),
    max_o: parseFloat(match[6]),
  };
}

export function parseThresholdResponse(line: string): ThresholdInfo | null {
  // Format 1: THRESHOLD {AREA} {METRIC} {value1} {value2} ... {value6}
  // Example: THRESHOLD FLOOR11 CO2 100.00 200.00 300.00 400.00 500.00 600.00
  // Format 2: THRESHOLDS {AREA} {METRIC} [{values}]
  // Example: THRESHOLDS FLOOR11 CO2 [10%, 40%, 70%, 80%, 90%, 95%]
  // or: THRESHOLDS FLOOR11 CO2 [10.0, 40.0, 70.0, 80.0, 90.0, 95.0]
  // Strip prefixes like [UART1] WEBd: or WEBd:
  const thresholdIdx = line.indexOf('THRESHOLD');
  if (thresholdIdx === -1) return null;
  const cleaned = line.slice(thresholdIdx).trim();
  
  // Try format 1: THRESHOLD {AREA} {METRIC} {value1} {value2} ... {value6}
  const match1 = cleaned.match(/^THRESHOLD\s+(\S+)\s+(\S+)\s+(.+)$/i);
  if (match1) {
    const valuesStr = match1[3].trim();
    const values = valuesStr
      .split(/\s+/)
      .map((v) => {
        const num = parseFloat(v);
        return isNaN(num) ? -1 : num;
      });
    // Always return 6 values, padding with -1 if needed
    while (values.length < 6) {
      values.push(-1);
    }
    return {
      area: match1[1],
      metric: match1[2],
      values: values.slice(0, 6),
    };
  }
  
  // Try format 2: THRESHOLDS {AREA} {METRIC} [{values}]
  const match2 = cleaned.match(/^THRESHOLDS\s+(\S+)\s+(\S+)\s+\[(.*?)\]$/i);
  if (match2) {
    const valuesStr = match2[3];
    const values = valuesStr
      .split(',')
      .map((v) => {
        const cleaned = v.trim().replace(/%$/, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? -1 : num;
      })
      .filter((v) => v !== -1 || valuesStr.includes('-1'));
    return {
      area: match2[1],
      metric: match2[2],
      values: values.length === 6 ? values : Array(6).fill(-1),
    };
  }
  
  return null;
}

export function parseUseBaselineResponse(line: string): UseBaselineInfo | null {
  // Format: USE_BASELINE {AREA} {True/False}
  // Strip prefixes like [UART1] WEBd: or WEBd:
  const baselineIdx = line.indexOf('USE_BASELINE');
  if (baselineIdx === -1) return null;
  const cleaned = line.slice(baselineIdx).trim();
  const match = cleaned.match(/^USE_BASELINE\s+(\S+)\s+(True|False)$/i);
  if (!match) return null;
  return {
    area: match[1],
    enabled: match[2].toLowerCase() === 'true',
  };
}

export function parseCommandResponse(line: string): {
  type: 'area' | 'stat' | 'threshold' | 'use_baseline' | 'unknown';
  data: AreaInfo | StatInfo | ThresholdInfo | UseBaselineInfo | null;
} {
  // Check for command keywords in the line (handles prefixes automatically)
  if (line.includes('AREA:')) {
    return { type: 'area', data: parseAreaResponse(line) };
  }
  if (line.includes('STAT:')) {
    return { type: 'stat', data: parseStatResponse(line) };
  }
  if (line.includes('THRESHOLD')) {
    return { type: 'threshold', data: parseThresholdResponse(line) };
  }
  if (line.includes('USE_BASELINE')) {
    return { type: 'use_baseline', data: parseUseBaselineResponse(line) };
  }
  return { type: 'unknown', data: null };
}
