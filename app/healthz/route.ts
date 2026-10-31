// Dış izleme servisi için sağlık adresi. Giriş istemez, bu yüzden ayrıntı vermez.

import { NextResponse } from "next/server";
import { healthChecks, overallLevel } from "@/lib/alerts.ts";
import { getDb } from "@/lib/db.ts";

export const dynamic = "force-dynamic";

export function GET() {
  const level = overallLevel(healthChecks(getDb()));
  return NextResponse.json({ status: level }, { status: level === "fail" ? 503 : 200 });
}
