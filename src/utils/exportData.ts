import { idbGetAll } from '../db/idb';
import { Sample, Probe, Location } from './types';
import JSZip from 'jszip';

// Metric names for file naming
const METRIC_NAMES: Record<string, string> = {
  co2: 'CO2',
  temp: 'Temperature',
  hum: 'Humidity',
  sound: 'Decibel',
};

// Area display names for file naming
const AREA_NAMES: Record<string, string> = {
  FLOOR17: 'Floor17',
  FLOOR16: 'Floor16',
  FLOOR15: 'Floor15',
  FLOOR12: 'Floor12',
  FLOOR11: 'Floor11',
  TEAROOM: 'Teahouse',
  POOL: 'Pool',
};

// Escape CSV values
function csvEscape(value: string): string {
  if (/,|"|\n/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// Download a ZIP file
async function downloadZIP(zip: JSZip, filename: string) {
  const blob = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Main export function
export async function exportAllData(): Promise<void> {
  try {
    // Fetch all data from IndexedDB
    const [samples, probes, locations] = await Promise.all([
      idbGetAll('samples') as Promise<Sample[]>,
      idbGetAll('probes') as Promise<Probe[]>,
      idbGetAll('locations') as Promise<Location[]>,
    ]);

    // Create lookup maps
    const probeMap = new Map<string, Probe>();
    probes.forEach((probe) => probeMap.set(probe.id, probe));

    const locationMap = new Map<string, Location>();
    locations.forEach((loc) => locationMap.set(loc.id, loc));

    console.log(`Exporting data: ${samples.length} samples, ${probes.length} probes, ${locations.length} locations`);

    // Group samples by area and metric
    const dataByAreaAndMetric: Record<string, Record<string, Sample[]>> = {};

    // Helper function to get area from probe ID or location
    const getAreaForSample = (sample: Sample): string => {
      const probe = probeMap.get(sample.probeId);
      if (probe?.locationId) {
        const location = locationMap.get(probe.locationId);
        if (location?.area) {
          return location.area;
        }
      }
      // Try to infer area from probe ID (e.g., F17R -> FLOOR17)
      const upperId = sample.probeId.toUpperCase();
      if (upperId.startsWith('F17')) return 'FLOOR17';
      if (upperId.startsWith('F16')) return 'FLOOR16';
      if (upperId.startsWith('F15')) return 'FLOOR15';
      if (upperId.startsWith('F12')) return 'FLOOR12';
      if (upperId.startsWith('F11')) return 'FLOOR11';
      if (upperId.startsWith('TEA')) return 'TEAROOM';
      if (upperId.startsWith('POOL')) return 'POOL';
      return 'Unassigned';
    };

    samples.forEach((sample) => {
      const area = getAreaForSample(sample);
      if (!dataByAreaAndMetric[area]) {
        dataByAreaAndMetric[area] = { co2: [], temp: [], hum: [], sound: [] };
      }

      // Add sample to each metric array
      dataByAreaAndMetric[area].co2.push(sample);
      dataByAreaAndMetric[area].temp.push(sample);
      dataByAreaAndMetric[area].hum.push(sample);
      dataByAreaAndMetric[area].sound.push(sample);
    });

    console.log(`Grouped into ${Object.keys(dataByAreaAndMetric).length} areas:`, Object.keys(dataByAreaAndMetric));

    // Create CSV files for each area/metric combination
    const files: Array<{ name: string; content: string }> = [];

    Object.entries(dataByAreaAndMetric).forEach(([area, metrics]) => {
      const areaName = AREA_NAMES[area] || area;

      Object.entries(metrics).forEach(([metricKey, samples]) => {
        if (samples.length === 0) return;

        const metricName = METRIC_NAMES[metricKey] || metricKey;

        // Sort samples by timestamp
        const sortedSamples = [...samples].sort((a, b) => a.ts - b.ts);

        // Create CSV with location information
        const headers = ['Timestamp', 'DateTime', 'ProbeID', 'Location', 'Value'];
        const rows = sortedSamples.map((sample) => {
          const probe = probeMap.get(sample.probeId);
          const location = probe?.locationId ? locationMap.get(probe.locationId) : null;
          const locationName = location?.name || 'Unknown';

          const date = new Date(sample.ts);
          const dateTime = date.toISOString().replace('T', ' ').substring(0, 19);

          // Get the value for the specific metric
          let value: number;
          if (metricKey === 'co2') {
            value = sample.co2;
          } else if (metricKey === 'temp') {
            value = sample.temp;
          } else if (metricKey === 'hum') {
            value = sample.hum;
          } else if (metricKey === 'sound') {
            value = sample.sound;
          } else {
            value = 0;
          }

          return [
            sample.ts.toString(),
            dateTime,
            csvEscape(sample.probeId),
            csvEscape(locationName),
            value.toFixed(1),
          ];
        });

        const csvContent = [headers, ...rows].map((row) => row.join(',')).join('\n');
        const filename = `${areaName}_${metricName}.csv`;

        files.push({ name: filename, content: csvContent });
        console.log(`Created file: ${filename} with ${rows.length} rows`);
      });
    });

    console.log(`Total files to export: ${files.length}`);

    if (files.length === 0) {
      console.warn('No files to export! Check if there are samples in IndexedDB.');
      alert('No data found to export. Make sure you have collected some probe data first.');
      return;
    }

    // Create a ZIP file with all CSV files
    const zip = new JSZip();
    files.forEach((file) => {
      zip.file(file.name, file.content);
    });

    // Generate timestamp for filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const zipFilename = `probemaster-data-${timestamp}.zip`;

    // Download the ZIP file
    await downloadZIP(zip, zipFilename);
  } catch (error) {
    console.error('Error exporting data:', error);
    throw error;
  }
}

