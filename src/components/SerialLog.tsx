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
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight, overflow: 'auto' }}>
        {log || 'No data yet...'}
      </pre>
    </Paper>
  );
}

