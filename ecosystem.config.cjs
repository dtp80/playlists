/** @see https://pm2.keymetrics.io/docs/usage/application-declaration/ */
module.exports = {
  apps: [
    {
      name: "Playlists Manager",
      script: "./dist/server.js",
      cwd: __dirname,
      // Same as EPG Handler: node:sqlite needs this on Synology Node 22.x builds.
      // Harmless on Node 24+ where sqlite is stable.
      node_args: process.env.PLAYLISTS_NODE_ARGS || "--experimental-sqlite",
      env: {
        NODE_ENV: "production",
        PORT: 8084,
        DATABASE_URL: "file:./data/playlists.db",
        // Prefer setting API_KEY in .env; dotenv loads it at runtime.
        // Keep this empty unless you intentionally embed a key in PM2 env.
      },
    },
  ],
};
