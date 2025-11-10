import React from 'react';
import { Paper, Typography } from '@mui/material';

interface SerialLogProps {
  log: string;
  maxHeight?: number;
}

export default function SerialLog({ log, maxHeight = 240 }: SerialLogProps) {
  return (
    <Paper sx={{ p: 2, my: 2 }} variant="outlined">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Serial Log
      </Typography>
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight, overflow: 'auto' }}>
        {log || 'No data yet...'}
      </pre>
    </Paper>
  );
}

