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
  const match = line.match(/^AREA:\s+(\S+)\s+(\S+)\s+(\S+)$/i);
  if (!match) return null;
  return {
    area: match[1],
    location: match[2],
    probeId: match[3],
  };
}

export function parseStatResponse(line: string): StatInfo | null {
  // Format: STAT: {AREA} {METRIC} min:{value} max:{value} min_o:{value} max_o:{value}
  const match = line.match(/^STAT:\s+(\S+)\s+(\S+)\s+min:([-\d.]+)\s+max:([-\d.]+)\s+min_o:([-\d.]+)\s+max_o:([-\d.]+)$/i);
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
  // Format: THRESHOLDS {AREA} {METRIC} [{values}]
  // Example: THRESHOLDS FLOOR11 CO2 [10%, 40%, 70%, 80%, 90%, 95%]
  // or: THRESHOLDS FLOOR11 CO2 [10.0, 40.0, 70.0, 80.0, 90.0, 95.0]
  const match = line.match(/^THRESHOLDS\s+(\S+)\s+(\S+)\s+\[(.*?)\]$/i);
  if (!match) return null;
  const valuesStr = match[3];
  const values = valuesStr
    .split(',')
    .map((v) => {
      const cleaned = v.trim().replace(/%$/, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? -1 : num;
    })
    .filter((v) => v !== -1 || valuesStr.includes('-1'));
  return {
    area: match[1],
    metric: match[2],
    values: values.length === 6 ? values : Array(6).fill(-1),
  };
}

export function parseUseBaselineResponse(line: string): UseBaselineInfo | null {
  // Format: USE_BASELINE {AREA} {True/False}
  const match = line.match(/^USE_BASELINE\s+(\S+)\s+(True|False)$/i);
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
  const trimmed = line.trim();
  if (trimmed.startsWith('AREA:')) {
    return { type: 'area', data: parseAreaResponse(trimmed) };
  }
  if (trimmed.startsWith('STAT:')) {
    return { type: 'stat', data: parseStatResponse(trimmed) };
  }
  if (trimmed.startsWith('THRESHOLDS')) {
    return { type: 'threshold', data: parseThresholdResponse(trimmed) };
  }
  if (trimmed.startsWith('USE_BASELINE')) {
    return { type: 'use_baseline', data: parseUseBaselineResponse(trimmed) };
  }
  return { type: 'unknown', data: null };
}

