// Cloudflare Turnstile: giriş formundaki bot doğrulaması.
// Token sunucuda siteverify ile doğrulanır; şifre kontrolünden önce yapıldığı için botlar hatalı deneme
// sayacını artırıp hesapları kilitleyemez. Anahtarlar yoksa geliştirmede atlanır, üretimde giriş reddedilir.
import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Widget'a verilen ve yanıtta geri dönmesi beklenen işlem adı */
export const TURNSTILE_ACTION = "login";

export function turnstileSiteKey(): string | undefined {
  return process.env.TURNSTILE_SITE_KEY || undefined;
}

export type TurnstileResult = { ok: true } | { ok: false; error: string };

export async function verifyTurnstile(token: string, ip?: string): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !turnstileSiteKey()) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return { ok: false, error: "Bot doğrulaması ayarlanmamış (TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY)." };
  }
  if (!token) return { ok: false, error: "Bot doğrulamasını tamamlayın." };

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  let data: { success?: boolean; action?: string; "error-codes"?: string[] };
  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(10_000) });
    data = await res.json();
  } catch {
    return { ok: false, error: "Bot doğrulaması yapılamadı. Biraz sonra tekrar deneyin." };
  }
  if (!data.success) {
    const expired = data["error-codes"]?.includes("timeout-or-duplicate");
    return { ok: false, error: expired ? "Bot doğrulamasının süresi doldu, tekrar deneyin." : "Bot doğrulaması başarısız." };
  }
  // Test anahtarları action döndürmez ("test"); gerçek anahtarda başka bir formun token'ı kabul edilmez
  if (data.action && data.action !== "test" && data.action !== TURNSTILE_ACTION) {
    return { ok: false, error: "Bot doğrulaması başarısız." };
  }
  return { ok: true };
}
