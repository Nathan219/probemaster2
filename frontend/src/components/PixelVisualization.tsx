import React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import EmojiPeopleIcon from '@mui/icons-material/EmojiPeople';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk';
import SelfImprovementIcon from '@mui/icons-material/SelfImprovement';
import PoolIcon from '@mui/icons-material/Pool';
import { useTheme } from '@mui/material/styles';
import { getAuthHeaders } from '../utils/auth';

interface PixelVisualizationProps {
  pixelData: Record<string, number>;
  sendCommand?: (cmd: string) => Promise<void>;
  connected?: boolean;
  onGetPixels?: () => Promise<void>;
  lastPixelUpdate?: number | null;
  areaColors?: Record<string, string>;
  areaLabels?: Record<string, string>;
}

// Icon component wrapper to handle lit/unlit styling
const IconWrapper: React.FC<{ lit: boolean; theme: any; colorOverride?: string; children: React.ReactNode }> = ({
  lit,
  theme,
  colorOverride,
  children,
}) => {
  const color = lit
    ? colorOverride ||
      (theme.palette.mode === 'dark'
        ? '#ffffff'
        : '#000000')
    : theme.palette.mode === 'dark'
      ? '#333333'
      : '#cccccc';
  return <Box sx={{ color, display: 'flex', alignItems: 'center' }}>{children}</Box>;
};

// Area configuration with icon types
const AREA_CONFIG: Record<string, { label: string; iconTypes: Array<'person' | 'raised' | 'lotus' | 'swimming'> }> = {
  FLOOR17: { label: 'FLOOR 17', iconTypes: ['person', 'raised', 'person', 'raised', 'person', 'raised'] },
  FLOOR16: { label: 'FLOOR 16', iconTypes: ['raised', 'person', 'raised', 'person', 'raised', 'person'] },
  FLOOR15: { label: 'FLOOR 15', iconTypes: ['person', 'raised', 'person', 'raised', 'person', 'raised'] },
  FLOOR12: { label: 'FLOOR 12', iconTypes: ['raised', 'person', 'raised', 'person', 'raised', 'person'] },
  FLOOR11: { label: 'FLOOR 11', iconTypes: ['lotus', 'person', 'lotus', 'person', 'lotus', 'person'] },
  TEAROOM: { label: 'TEAHOUSE', iconTypes: ['lotus', 'lotus', 'lotus', 'lotus', 'lotus', 'lotus'] },
  POOL: { label: 'POOL', iconTypes: ['swimming', 'swimming', 'person', 'swimming', 'swimming', 'swimming'] },
};

// Normalize area name (handle variations like FLOOR11 vs FLOOR 11)
function normalizeAreaName(area: string): string {
  const upper = area.toUpperCase().trim();
  // Handle "FLOOR 11" -> "FLOOR11", "FLOOR 12" -> "FLOOR12", etc.
  const floorMatch = upper.match(/FLOOR\s*(\d+)/);
  if (floorMatch) {
    return `FLOOR${floorMatch[1]}`;
  }
  return upper;
}

export default function PixelVisualization({
  pixelData,
  sendCommand,
  connected,
  onGetPixels,
  lastPixelUpdate,
  areaColors,
  areaLabels,
}: PixelVisualizationProps) {
  const theme = useTheme();
  const now = Date.now();
  const isFresh = lastPixelUpdate ? now - lastPixelUpdate < 20 * 60 * 1000 : false;
  const headingColor = lastPixelUpdate ? (isFresh ? '#4caf50' : '#f44336') : '#ffffff';
  const timestampLabel = lastPixelUpdate
    ? new Date(lastPixelUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'No data';

  const handleRefresh = async () => {
    if (connected && sendCommand) {
      await sendCommand('GET PIXELS');
    } else if (onGetPixels) {
      await onGetPixels();
    }
  };

  // Get all areas in order
  const areas = Object.keys(AREA_CONFIG).filter((area) => {
    const normalized = normalizeAreaName(area);
    return pixelData.hasOwnProperty(normalized) || pixelData.hasOwnProperty(area);
  });

  // If no data, show all configured areas
  const displayAreas = areas.length > 0 ? areas : Object.keys(AREA_CONFIG);

  return (
    <Paper
      sx={{
        p: 2,
        mb: 2,
        background: theme.palette.mode === 'dark' ? '#0a0a0e' : '#1a1a1a',
        color: '#ffffff',
        border: `2px solid ${theme.palette.mode === 'dark' ? '#333' : '#444'}`,
      }}
      variant="outlined"
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="h6"
            sx={{
              textAlign: 'center',
              fontWeight: 700,
              letterSpacing: 1,
              color: headingColor,
              fontSize: '1.5rem',
            }}
          >
            WHERE IS EVERY
          </Typography>
          <Typography
            variant="h6"
            sx={{
              textAlign: 'center',
              fontWeight: 700,
              letterSpacing: 1,
              color: headingColor,
              fontSize: '1.5rem',
            }}
          >
            BODY AT?!
          </Typography>
          <Typography variant="caption" color="rgba(255,255,255,0.7)">
            Last update: {timestampLabel}
          </Typography>
        </Box>
        {(sendCommand || onGetPixels) && (
          <IconButton
            onClick={handleRefresh}
            sx={{
              color: '#ffffff',
              opacity: connected ? 1 : 0.5,
              '&:hover': {
                bgcolor: 'rgba(255, 255, 255, 0.1)',
              },
            }}
            size="small"
          >
            <RefreshIcon />
          </IconButton>
        )}
      </Box>

      <Stack spacing={1.5}>
        {displayAreas.map((area) => {
          const config = AREA_CONFIG[area];
          if (!config) return null;

          // Get pixel value for this area (try normalized and original)
          const normalizedArea = normalizeAreaName(area);
          const pixelValue = pixelData[normalizedArea] ?? pixelData[area] ?? 0;
          const clampedValue = Math.max(0, Math.min(6, Math.round(pixelValue)));

          const isPool = area === 'POOL';
          const colorOverride = areaColors?.[area];

          return (
            <Box key={area} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography
                sx={{
                  color: colorOverride || '#ffffff',
                  fontWeight: 600,
                  minWidth: 100,
                  fontSize: '0.9rem',
                }}
              >
                {isPool
                  ? `★ ${areaLabels?.[area] ?? config.label}`
                  : areaLabels?.[area] ?? config.label}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                {config.iconTypes.map((iconType, idx) => {
                  const lit = idx < clampedValue;
                  const IconComponent =
                    iconType === 'raised'
                      ? EmojiPeopleIcon
                      : iconType === 'lotus'
                        ? SelfImprovementIcon
                        : iconType === 'swimming'
                          ? PoolIcon
                          : DirectionsWalkIcon;
                  return (
                    <IconWrapper key={idx} lit={lit} theme={theme} colorOverride={colorOverride}>
                      <IconComponent sx={{ fontSize: 24 }} />
                    </IconWrapper>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Stack>

      {Object.keys(pixelData).length === 0 && (
        <Typography variant="body2" sx={{ color: '#888', textAlign: 'center', mt: 2 }}>
          Waiting for pixel data...
        </Typography>
      )}
    </Paper>
  );
}
