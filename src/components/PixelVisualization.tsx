import React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTheme } from '@mui/material/styles';

interface PixelVisualizationProps {
  pixelData: Record<string, number>;
  sendCommand?: (cmd: string) => Promise<void>;
  connected?: boolean;
}

// Human silhouette icon SVG
const PersonIcon: React.FC<{ lit: boolean; theme: any }> = ({ lit, theme }) => {
  const fillColor = lit
    ? theme.palette.mode === 'dark'
      ? '#ffffff'
      : '#000000'
    : theme.palette.mode === 'dark'
      ? '#333333'
      : '#cccccc';
  return (
    <svg width="24" height="32" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 8C13.6569 8 15 6.65685 15 5C15 3.34315 13.6569 2 12 2C10.3431 2 9 3.34315 9 5C9 6.65685 10.3431 8 12 8Z"
        fill={fillColor}
      />
      <path
        d="M12 10C8.68629 10 6 12.6863 6 16V18C6 19.1046 6.89543 20 8 20H16C17.1046 20 18 19.1046 18 18V16C18 12.6863 15.3137 10 12 10Z"
        fill={fillColor}
      />
    </svg>
  );
};

// Person with raised arms icon
const PersonRaisedIcon: React.FC<{ lit: boolean; theme: any }> = ({ lit, theme }) => {
  const fillColor = lit
    ? theme.palette.mode === 'dark'
      ? '#ffffff'
      : '#000000'
    : theme.palette.mode === 'dark'
      ? '#333333'
      : '#cccccc';
  return (
    <svg width="24" height="32" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 8C13.6569 8 15 6.65685 15 5C15 3.34315 13.6569 2 12 2C10.3431 2 9 3.34315 9 5C9 6.65685 10.3431 8 12 8Z"
        fill={fillColor}
      />
      <path
        d="M12 10C8.68629 10 6 12.6863 6 16V18C6 19.1046 6.89543 20 8 20H16C17.1046 20 18 19.1046 18 18V16C18 12.6863 15.3137 10 12 10Z"
        fill={fillColor}
      />
      <path d="M6 6L4 4L2 6" stroke={fillColor} strokeWidth="2" fill="none" />
      <path d="M18 6L20 4L22 6" stroke={fillColor} strokeWidth="2" fill="none" />
    </svg>
  );
};

// Person sitting in lotus position
const PersonLotusIcon: React.FC<{ lit: boolean; theme: any }> = ({ lit, theme }) => {
  const fillColor = lit
    ? theme.palette.mode === 'dark'
      ? '#ffffff'
      : '#000000'
    : theme.palette.mode === 'dark'
      ? '#333333'
      : '#cccccc';
  return (
    <svg width="24" height="32" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 8C13.6569 8 15 6.65685 15 5C15 3.34315 13.6569 2 12 2C10.3431 2 9 3.34315 9 5C9 6.65685 10.3431 8 12 8Z"
        fill={fillColor}
      />
      <ellipse cx="12" cy="20" rx="8" ry="4" fill={fillColor} />
    </svg>
  );
};

// Swimming person icon
const PersonSwimmingIcon: React.FC<{ lit: boolean; theme: any }> = ({ lit, theme }) => {
  const fillColor = lit
    ? theme.palette.mode === 'dark'
      ? '#ffffff'
      : '#000000'
    : theme.palette.mode === 'dark'
      ? '#333333'
      : '#cccccc';
  return (
    <svg width="24" height="32" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 6C13.6569 6 15 4.65685 15 3C15 1.34315 13.6569 0 12 0C10.3431 0 9 1.34315 9 3C9 4.65685 10.3431 6 12 6Z"
        fill={fillColor}
      />
      <path d="M8 10L6 12L8 14L10 12L8 10Z" fill={fillColor} />
      <path
        d="M12 10C8.68629 10 6 12.6863 6 16V18C6 19.1046 6.89543 20 8 20H16C17.1046 20 18 19.1046 18 18V16C18 12.6863 15.3137 10 12 10Z"
        fill={fillColor}
      />
    </svg>
  );
};

// Area configuration with icon types
const AREA_CONFIG: Record<string, { label: string; iconTypes: Array<'person' | 'raised' | 'lotus' | 'swimming'> }> = {
  FLOOR17: { label: 'FLOOR 17', iconTypes: ['person', 'raised', 'person', 'raised', 'person', 'raised'] },
  FLOOR16: { label: 'FLOOR 16', iconTypes: ['raised', 'person', 'raised', 'person', 'raised', 'person'] },
  FLOOR15: { label: 'FLOOR 15', iconTypes: ['person', 'raised', 'person', 'raised', 'person', 'raised'] },
  FLOOR12: { label: 'FLOOR 12', iconTypes: ['raised', 'person', 'raised', 'person', 'raised', 'person'] },
  FLOOR11: { label: 'FLOOR 11', iconTypes: ['lotus', 'person', 'lotus', 'person', 'lotus', 'person'] },
  TEAROOM: { label: 'TEAROOM', iconTypes: ['lotus', 'lotus', 'lotus', 'lotus', 'lotus', 'lotus'] },
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

export default function PixelVisualization({ pixelData, sendCommand, connected }: PixelVisualizationProps) {
  const theme = useTheme();
  const handleRefresh = () => {
    if (sendCommand && connected) {
      sendCommand('GET PIXELS');
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
        <Typography
          variant="h6"
          sx={{
            textAlign: 'center',
            fontWeight: 700,
            letterSpacing: 1,
            color: '#ffffff',
            fontSize: '1.5rem',
            flex: 1,
          }}
        >
          WHERE IS EVERY BODY AT?!
        </Typography>
        {sendCommand && (
          <IconButton
            onClick={handleRefresh}
            disabled={!connected}
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

          return (
            <Box key={area} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {isPool && (
                <Typography sx={{ color: '#ffffff', fontWeight: 600, minWidth: 20, fontSize: '0.9rem' }}>★</Typography>
              )}
              <Typography
                sx={{
                  color: '#ffffff',
                  fontWeight: 600,
                  minWidth: isPool ? 80 : 100,
                  fontSize: '0.9rem',
                }}
              >
                {config.label}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                {config.iconTypes.map((iconType, idx) => {
                  const lit = idx < clampedValue;
                  const IconComponent =
                    iconType === 'raised'
                      ? PersonRaisedIcon
                      : iconType === 'lotus'
                        ? PersonLotusIcon
                        : iconType === 'swimming'
                          ? PersonSwimmingIcon
                          : PersonIcon;
                  return (
                    <Box key={idx} sx={{ display: 'flex', alignItems: 'center' }}>
                      <IconComponent lit={lit} theme={theme} />
                    </Box>
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
