// Bekleyen SQL migration'larını uygular. Kullanım: npm run db:migrate
import { loadEnv } from "./env.ts";
import { migrate, openDb } from "../lib/db.ts";

loadEnv();
const db = openDb();
const applied = migrate(db);
console.log(applied.length ? `Uygulandı: ${applied.join(", ")}` : "Veritabanı güncel.");
db.close();
