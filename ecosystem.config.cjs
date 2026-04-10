/**
 * PM2 ecosystem config for IPTV Playlist Manager.
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 start ecosystem.config.cjs --env production
 */
module.exports = {
  apps: [
    {
      name: "Playlists Manager",
      script: "dist/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      env: {
        NODE_ENV: "development",
        PORT: 3022,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3022,
      },
    },
  ],
};
