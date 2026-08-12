/**
 * Konfiguracja pm2 dla serwisu Eksporter 3000.
 *
 * Uruchomienie z katalogu `server/`:
 *   pm2 start ecosystem.config.cjs
 *
 * Uwaga na `cwd`: Prisma wczytuje `server/.env` względem katalogu roboczego,
 * a z tego pliku biorą się także poświadczenia Hotres. Przy złym `cwd` serwis
 * wstanie, ale każdy eksport padnie na autoryzacji.
 */

module.exports = {
  apps: [
    {
      name: 'eksporter-3000',
      cwd: __dirname,
      script: 'src/server.ts',
      // tsx odpala TypeScript bez kroku budowania - to narzędzie tymczasowe.
      interpreter: 'node',
      interpreter_args: '--import tsx',
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
