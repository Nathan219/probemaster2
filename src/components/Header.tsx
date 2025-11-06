import React from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Brightness4Icon from '@mui/icons-material/DarkMode';
import Brightness7Icon from '@mui/icons-material/LightMode';

export default function Header(p: any) {
  const {
    status,
    connected,
    baud,
    setBaud,
    onConnect,
    onDisconnect,
    onExport,
    onImport,
    onBackupClear,
    dark,
    setDark,
    onStartSim,
    onStopSim,
    simRunning,
  } = p;
  return (
    <AppBar position="sticky" color="default" elevation={1}>
      <Toolbar sx={{ gap: 2, justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="h6" fontWeight={700}>
            ProbeMaster Dashboard
          </Typography>
          <Typography variant="caption" sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: 'action.selected' }}>
            {status}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <input
            type="number"
            value={baud}
            onChange={(e) => setBaud(Number(e.target.value) || 115200)}
            style={{
              width: 100,
              padding: '6px',
              borderRadius: 6,
              border: '1px solid var(--mui-palette-divider)',
              background: 'transparent',
              color: 'inherit',
            }}
          />
          {!connected ? (
            <Button variant="contained" onClick={onConnect}>
              Connect Serial
            </Button>
          ) : (
            <Button variant="contained" color="error" onClick={onDisconnect}>
              Disconnect
            </Button>
          )}
          {!simRunning ? (
            <Button variant="outlined" onClick={onStartSim}>
              Generate Test Data
            </Button>
          ) : (
            <Button variant="outlined" color="warning" onClick={onStopSim}>
              Stop Simulation
            </Button>
          )}
          <Button variant="outlined" onClick={onExport}>
            Export CSV
          </Button>
          <Button variant="outlined" component="label">
            Import CSV/ZIP
            <input
              type="file"
              hidden
              accept=".csv,.zip"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImport(f);
                (e.target as HTMLInputElement).value = '';
              }}
            />
          </Button>
          <Button variant="outlined" onClick={onBackupClear}>
            Backup & Clear
          </Button>
          <Tooltip title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton onClick={() => setDark(!dark)}>{dark ? <Brightness7Icon /> : <Brightness4Icon />}</IconButton>
          </Tooltip>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
