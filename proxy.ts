// Oturum çerezi olmayan istekleri giriş sayfasına yönlendirir.
// Çerezin geçerliliği (süre, pasif hesap) sayfa düzeyinde requireUser() ile kontrol edilir;
// proxy her istekte çalıştığı için veritabanına erişmez.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/auth/cookie.ts";

export function proxy(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = req.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|healthz|_next/static|_next/image|favicon.ico).*)"],
};
