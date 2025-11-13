import React from 'react';
import { Paper, Typography, Box, IconButton } from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';

interface SerialLogProps {
  log: string;
  maxHeight?: number;
  onClear?: () => void;
}

export default function SerialLog({ log, maxHeight = 240, onClear }: SerialLogProps) {
  return (
    <Paper sx={{ p: 2, my: 2 }} variant="outlined">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2">Serial Log</Typography>
        {onClear && (
          <IconButton size="small" onClick={onClear} disabled={!log}>
            <ClearIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      <Box
        component="pre"
        sx={{
          whiteSpace: 'pre-wrap',
          margin: 0,
          maxHeight,
          overflowY: 'scroll',
          overflowX: 'auto',
          pr: 1,
          '&::-webkit-scrollbar': {
            width: '8px',
            height: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#7E57C2',
            borderRadius: '4px',
          },
          scrollbarWidth: 'thin',
          scrollbarColor: '#7E57C2 transparent',
        }}
      >
        {log || 'No data yet...'}
      </Box>
    </Paper>
  );
}

