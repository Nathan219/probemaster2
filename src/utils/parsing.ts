import { Sample, AreaInfo, Stats, Pixel, Threshold, LocationName, Measurement } from './types';

export function parseLine(l: string) {
  const m = l.match(/^([^:]+):\s*(.*)$/);
  if (!m) return null;
  const probeId = m[1].trim(),
    rest = m[2].trim();
  let co2 = NaN,
    temp = NaN,
    hum = NaN,
    sound = NaN;
  for (const part of rest.split(/[\s,]+/)) {
    const [k, v] = part.split(/[:=]/);
    if (!k || !v) continue;
    const key = k.toLowerCase();
    const val = parseFloat(v);
    if (Number.isNaN(val)) continue;
    if (key.startsWith('co2')) co2 = val;
    else if (key.startsWith('temp')) temp = val;
    else if (key.startsWith('hum')) hum = val;
    else if (key.startsWith('sound')) sound = val;
  }
  if ([co2, temp, hum, sound].some((v) => Number.isFinite(v)))
    return { ts: Date.now(), probeId, co2, temp, hum, sound } as Sample;
  return null;
}

export function toCSV(rows: Sample[]) {
  const h = ['timestamp', 'isoTime', 'probeId', 'CO2', 'Temp', 'Hum', 'Sound'];
  const out = [h.join(',')];
  for (const r of rows) {
    out.push([r.ts, new Date(r.ts).toISOString(), r.probeId, r.co2, r.temp, r.hum, r.sound].join(','));
  }
  return out.join('\n');
}

// Serial port writing
let writeQueue: Array<{ port: SerialPort; command: string; resolve: () => void; reject: (e: Error) => void }> = [];
let isWriting = false;

async function processWriteQueue() {
  if (isWriting || writeQueue.length === 0) return;

  isWriting = true;
  while (writeQueue.length > 0) {
    const { port, command, resolve, reject } = writeQueue.shift()!;

    try {
      if (!port.writable) {
        reject(new Error('Serial port is not writable'));
        continue;
      }

      const encoder = new TextEncoder();
      const writer = port.writable.getWriter();
      try {
        await writer.write(encoder.encode(command + '\r\n'));
        await writer.ready;
        resolve();
      } finally {
        writer.releaseLock();
      }
    } catch (e) {
      reject(e as Error);
    }
  }
  isWriting = false;
}

export async function sendSerialCommand(port: SerialPort, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    writeQueue.push({ port, command, resolve, reject });
    processWriteQueue();
  });
}

export function releaseSerialWriter(): void {
  // No-op since we release immediately after each write
}

// Command center parsing functions
export function parseGetAreas(line: string): AreaInfo | null {
  // Format: Area Name, Location Name, Probe ID
  // Should NOT match sample data format like: [UART2] dfe8: CO2:640,Temp:27.34,...
  // Check that it doesn't contain colons (sample data has measurement:value pairs)
  // and doesn't start with brackets
  if (line.includes(':') || line.trim().startsWith('[')) {
    return null;
  }

  const parts = line.split(',').map((p) => p.trim());
  if (parts.length === 3) {
    // Also check that it doesn't contain measurement keywords
    const lowerLine = line.toLowerCase();
    if (
      lowerLine.includes('co2') ||
      lowerLine.includes('temp') ||
      lowerLine.includes('hum') ||
      lowerLine.includes('sound')
    ) {
      return null;
    }

    return {
      areaName: parts[0],
      locationName: parts[1] as LocationName,
      probeId: parts[2],
    };
  }
  return null;
}

export function parseGetStats(line: string): Stats | null {
  // Format: STATS: AREA_NAME LOCATION MIN MAX OVERRIDE_MIN OVERRIDE_MAX
  const match = line.match(
    /^STATS:\s+(\S+)\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?|-)\s+(-?\d+(?:\.\d+)?|-)$/
  );
  if (match) {
    return {
      areaName: match[1],
      location: match[2],
      min: parseFloat(match[3]),
      max: parseFloat(match[4]),
      overrideMin: match[5] === '-' ? null : parseFloat(match[5]),
      overrideMax: match[6] === '-' ? null : parseFloat(match[6]),
    };
  }
  return null;
}

export function parseGetPixels(line: string): Pixel | null {
  // Format: PIXEL: AREA_NAME MEASUREMENT_ENUM
  // The pixel value is 0-6, but the format says "pixels can be a value of 0-6"
  // Assuming it's: PIXEL: AREA_NAME MEASUREMENT_ENUM VALUE
  const match = line.match(/^PIXEL:\s+(\S+)\s+(CO2|HUM|TEMP|DB)\s+(\d+)$/);
  if (match) {
    const pixel = parseInt(match[3], 10);
    if (pixel >= 0 && pixel <= 6) {
      return {
        areaName: match[1],
        measurement: match[2] as Measurement,
        pixel,
      };
    }
  }
  return null;
}

export function parseGetThreshold(line: string): Threshold | null {
  // Format: [THRESHOLD AREA_NAME MEASUREMENT_ENUM VALUE1, VALUE2, VALUE3, VALUE4, VALUE5, VALUE6]
  const match = line.match(/^\[THRESHOLD\s+(\S+)\s+(CO2|HUM|TEMP|DB)\s+([-\d]+(?:,\s*[-\d]+){5})\]$/);
  if (match) {
    const values = match[3].split(',').map((v) => parseInt(v.trim(), 10));
    if (values.length === 6 && values.every((v) => v >= -1 && v <= 100)) {
      return {
        areaName: match[1],
        measurement: match[2] as Measurement,
        values,
      };
    }
  }
  return null;
}

export function parseAcknowledgment(line: string): {
  type: 'OVERRIDE' | 'THRESHOLD' | 'PROBE';
  areaName?: string;
  measurement?: Measurement;
  pixel?: number;
  value?: number;
  probeId?: string;
  location?: string;
} | null {
  // Format: OVERRIDE {AREA_NAME} MAX {VALUE} ACCEPTED
  // Format: Acknowledged: OVERRIDE {AREA_NAME} MAX {VALUE} ACCEPTED
  // Format: THRESHOLD {AREA_NAME} {MEASUREMENT_ENUM} {PIXEL_NUM} {VALUE} ACCEPTED
  // Format: PROBE {PROBE_ID} {AREA_NAME} {LOCATION} ACCEPTED
  // Handle optional "Acknowledged:" prefix

  const normalizedLine = line.replace(/^Acknowledged:\s*/i, '').trim();

  let match = normalizedLine.match(/^OVERRIDE\s+(\S+)\s+(MIN|MAX)\s+(-?\d+(?:\.\d+)?)\s+ACCEPTED$/);
  if (match) {
    return {
      type: 'OVERRIDE',
      areaName: match[1],
      value: parseFloat(match[3]),
    };
  }

  match = normalizedLine.match(/^THRESHOLD\s+(\S+)\s+(CO2|HUM|TEMP|DB)\s+(\d+)\s+(-?\d+)\s+ACCEPTED$/);
  if (match) {
    return {
      type: 'THRESHOLD',
      areaName: match[1],
      measurement: match[2] as Measurement,
      pixel: parseInt(match[3], 10),
      value: parseInt(match[4], 10),
    };
  }

  match = normalizedLine.match(/^PROBE\s+(\S+)\s+(\S+)\s+(\S+)\s+ACCEPTED$/);
  if (match) {
    return {
      type: 'PROBE',
      probeId: match[1],
      areaName: match[2],
      location: match[3],
    };
  }

  return null;
}
