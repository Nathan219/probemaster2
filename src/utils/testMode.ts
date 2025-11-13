import { AreaName } from './types';

// Generate a random number between min and max
function randomRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// Generate realistic sample data
export function generateSampleData(probeId: string): string {
  const co2 = Math.round(randomRange(400, 1000));
  const temp = randomRange(20, 25).toFixed(1);
  const hum = Math.round(randomRange(40, 60));
  const sound = Math.round(randomRange(30, 70));

  // Format: probeId: co2:value temp:value hum:value sound:value
  return `${probeId}: co2:${co2} temp:${temp} hum:${hum} sound:${sound}`;
}

// Generate GET AREAS response
export function generateGetAreasResponse(): string[] {
  const areas = [
    { area: 'FLOOR11', location: 'ROTUNDA', probeId: 'a1b2' },
    { area: 'FLOOR11', location: 'LOBBY', probeId: 'c3d4' },
    { area: 'FLOOR12', location: 'ROTUNDA', probeId: 'e5f6' },
    { area: 'FLOOR12', location: 'OFFICE', probeId: 'g7h8' },
    { area: 'FLOOR15', location: 'ROTUNDA', probeId: 'i9j0' },
    { area: 'FLOOR16', location: 'ROTUNDA', probeId: 'k1l2' },
    { area: 'FLOOR17', location: 'ROTUNDA', probeId: 'm3n4' },
    { area: 'POOL', location: 'ENTRY', probeId: 'o5p6' },
    { area: 'TEAROOM', location: 'ENTRANCE', probeId: 'q7r8' },
  ];

  return areas.map((a) => `[UART1] WEBd: AREA: ${a.area} ${a.location} ${a.probeId}`);
}

// Generate GET STATS response
export function generateGetStatsResponse(area: string, metric: string): string {
  const metricUpper = metric.toUpperCase();
  let min: number, max: number, min_o: number, max_o: number;
  let responseMetric: string; // Metric to use in the response

  switch (metricUpper) {
    case 'CO2':
      min = Math.round(randomRange(400, 600));
      max = Math.round(randomRange(700, 1000));
      min_o = Math.round(randomRange(350, 450));
      max_o = Math.round(randomRange(950, 1100));
      responseMetric = 'CO2';
      break;
    case 'TEMP':
      min = randomRange(20, 22);
      max = randomRange(23, 25);
      min_o = randomRange(19, 21);
      max_o = randomRange(25, 27);
      responseMetric = 'TEMP';
      break;
    case 'HUM':
      min = Math.round(randomRange(40, 45));
      max = Math.round(randomRange(55, 60));
      min_o = Math.round(randomRange(35, 40));
      max_o = Math.round(randomRange(60, 65));
      responseMetric = 'HUM';
      break;
    case 'SOUND':
    case 'DB':
      min = Math.round(randomRange(30, 40));
      max = Math.round(randomRange(60, 70));
      min_o = Math.round(randomRange(25, 35));
      max_o = Math.round(randomRange(70, 80));
      responseMetric = 'DB'; // Use 'DB' instead of 'SOUND' to match app normalization
      break;
    default:
      min = -1;
      max = -1;
      min_o = -1;
      max_o = -1;
      responseMetric = metricUpper;
  }

  return `[UART1] WEBd: STAT: ${area} ${responseMetric} min:${min.toFixed(2)} max:${max.toFixed(2)} min_o:${min_o.toFixed(2)} max_o:${max_o.toFixed(2)}`;
}

// Generate GET THRESHOLDS response
export function generateGetThresholdsResponse(area: string, metric: string): string {
  const metricUpper = metric.toUpperCase();
  let baseValue: number;
  let responseMetric: string; // Metric to use in the response

  switch (metricUpper) {
    case 'CO2':
      baseValue = 500;
      responseMetric = 'CO2';
      break;
    case 'TEMP':
      baseValue = 22;
      responseMetric = 'TEMP';
      break;
    case 'HUM':
      baseValue = 50;
      responseMetric = 'HUM';
      break;
    case 'SOUND':
    case 'DB':
      baseValue = 50;
      responseMetric = 'DB'; // Use 'DB' instead of 'SOUND' to match app normalization
      break;
    default:
      baseValue = 0;
      responseMetric = metricUpper;
  }

  // Generate 6 threshold values with some variation
  const values = Array.from({ length: 6 }, (_, i) => {
    const multiplier = 0.5 + i * 0.15;
    return (baseValue * multiplier).toFixed(2);
  });

  return `[UART1] WEBd: THRESHOLD ${area} ${responseMetric} ${values.join(' ')}`;
}

// Get list of probe IDs for test mode
export function getTestProbeIds(): string[] {
  return ['a1b2', 'c3d4', 'e5f6', 'g7h8', 'i9j0', 'k1l2', 'm3n4', 'o5p6', 'q7r8'];
}
