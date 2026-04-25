import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nox Messenger',
    short_name: 'Nox',
    description: 'Закрытый приватный мессенджер',
    start_url: '/chats',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
    scope: '/',
  };
}
