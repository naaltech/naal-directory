// pm2 ayarı: pm2 start ecosystem.config.cjs
// Tek süreç (fork): SQLite tek yazıcıyla çalışır, cluster modu kullanmayın.
// Sadece 127.0.0.1'i dinler; dışarıya Caddy (deploy/Caddyfile) açar.
module.exports = {
  apps: [
    {
      name: "naal-panel",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        TZ: "Europe/Istanbul",
      },
      time: true,
    },
    {
      // Kuyruk ve sağlık kontrolü (scripts/worker.ts). Çalışan iş bitsin diye durdurma süresi uzun.
      name: "naal-worker",
      cwd: __dirname,
      script: "scripts/worker.ts",
      node_args: "--no-warnings",
      exec_mode: "fork",
      instances: 1,
      kill_timeout: 30000,
      env: {
        NODE_ENV: "production",
        TZ: "Europe/Istanbul",
      },
      time: true,
    },
  ],
};
