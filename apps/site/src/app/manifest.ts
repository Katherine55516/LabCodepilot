import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AI Native Lab',
    short_name: 'AI Native Lab',
    description: 'Desktop workspace for Claude Code',
    start_url: '/',
    display: 'browser',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
