// CLI betikleri için .env yükleyici (Next.js kendi yükler).
import { existsSync } from "node:fs";

export function loadEnv(file = ".env") {
  if (existsSync(file)) process.loadEnvFile(file);
}
