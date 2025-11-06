import { createTheme } from '@mui/material/styles';
export const makeTheme = (d: boolean) =>
  createTheme({
    palette: {
      mode: d ? 'dark' : 'light',
      primary: { main: '#7E57C2' },
      secondary: { main: '#9575CD' },
      background: { default: d ? '#101014' : '#fafafa', paper: d ? '#14141a' : '#ffffff' },
    },
    shape: { borderRadius: 10 },
  });
