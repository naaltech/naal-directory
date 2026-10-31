"use client";

import { Button, CodeSnippet, InlineNotification, Modal, PasswordInput, Stack, Tag, TextInput, Tile } from "@carbon/react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  changeEmailAction,
  changePasswordAction,
  confirmTotpAction,
  disableTotpAction,
  regenerateCodesAction,
  startTotpAction,
} from "./actions.ts";

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Tile>
      <h2 className="mb-1 text-lg">{title}</h2>
      <p className="mb-6 text-sm text-secondary">{description}</p>
      {children}
    </Tile>
  );
}

function Notice({ kind, text }: { kind: "error" | "success"; text: string }) {
  return (
    <InlineNotification
      kind={kind}
      lowContrast
      hideCloseButton
      title={kind === "error" ? "İşlem yapılamadı" : "Tamam"}
      subtitle={text}
    />
  );
}

function SecretField({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  return (
    <PasswordInput
      id={id}
      labelText={label}
      autoComplete={autoComplete}
      showPasswordLabel="Şifreyi göster"
      hidePasswordLabel="Şifreyi gizle"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function CodeField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      id={id}
      labelText="Doğrulama kodu"
      helperText="Uygulamadaki 6 haneli kod ya da bir kurtarma kodu"
      autoComplete="one-time-code"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function EmailForm({ current, domains, twoFactor }: { current: string; domains: string[]; twoFactor: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ kind: "error" | "success"; text: string }>();
  const [pending, start] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await changeEmailAction({ email, password, code });
      if (!res.ok) return setResult({ kind: "error", text: res.error });
      setResult({ kind: "success", text: `${res.data} adresine onay bağlantısı gönderildi. Adres, bağlantı açılınca değişir.` });
      setEmail("");
      setPassword("");
      setCode("");
    });
  };

  return (
    <Section title="E-posta adresi" description={`Şu anki adresiniz: ${current}. Yeni adres ${domains.map((d) => `@${d}`).join(" ya da ")} ile bitmeli.`}>
      <form onSubmit={submit}>
        <Stack gap={6}>
          {result && <Notice {...result} />}
          <TextInput id="new-email" type="email" labelText="Yeni e-posta" value={email} onChange={(e) => setEmail(e.target.value)} />
          <SecretField id="email-password" label="Şifreniz" autoComplete="current-password" value={password} onChange={setPassword} />
          {twoFactor && <CodeField id="email-code" value={code} onChange={setCode} />}
          <div>
            <Button type="submit" disabled={pending || !email || !password || (twoFactor && !code)}>
              {pending ? "Gönderiliyor…" : "Onay bağlantısı gönder"}
            </Button>
          </div>
        </Stack>
      </form>
    </Section>
  );
}

export function PasswordForm({ twoFactor }: { twoFactor: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ kind: "error" | "success"; text: string }>();
  const [pending, start] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== repeat) return setResult({ kind: "error", text: "Yeni şifreler eşleşmedi" });
    start(async () => {
      const res = await changePasswordAction({ current, next, code });
      if (!res.ok) return setResult({ kind: "error", text: res.error });
      setResult({ kind: "success", text: "Şifre değişti. Öteki cihazlardaki oturumlarınız kapandı." });
      setCurrent("");
      setNext("");
      setRepeat("");
      setCode("");
    });
  };

  return (
    <Section title="Şifre" description="En az 10 karakter, harf ve rakam içermeli. Değişince öteki cihazlardaki oturumlarınız kapanır.">
      <form onSubmit={submit}>
        <Stack gap={6}>
          {result && <Notice {...result} />}
          <SecretField id="current-password" label="Mevcut şifre" autoComplete="current-password" value={current} onChange={setCurrent} />
          <SecretField id="next-password" label="Yeni şifre" autoComplete="new-password" value={next} onChange={setNext} />
          <SecretField id="repeat-password" label="Yeni şifre (tekrar)" autoComplete="new-password" value={repeat} onChange={setRepeat} />
          {twoFactor && <CodeField id="password-code" value={code} onChange={setCode} />}
          <div>
            <Button type="submit" disabled={pending || !current || !next || !repeat || (twoFactor && !code)}>
              {pending ? "Kaydediliyor…" : "Şifreyi değiştir"}
            </Button>
          </div>
        </Stack>
      </form>
    </Section>
  );
}

type Step =
  | { kind: "password" }
  | { kind: "scan"; secret: string; qr: string }
  | { kind: "codes"; codes: string[] }
  | { kind: "disable" | "regenerate" };

export function TwoFactorSection({ enabled, since, codesLeft }: { enabled: boolean; since: string; codesLeft: number }) {
  const router = useRouter();
  const [step, setStep] = useState<Step | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const open = (next: Step) => {
    setStep(next);
    setPassword("");
    setCode("");
    setError(undefined);
  };

  // Kodlar ekrandayken sayfa yenilenmez: yenileme bu bileşeni baştan kurar, kodlar kaybolur
  const close = () => {
    setStep(null);
    setError(undefined);
    router.refresh();
  };

  const act = <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, onOk: (data: T) => void) =>
    start(async () => {
      setError(undefined);
      const res = await fn();
      if (res.ok) onOk(res.data);
      else setError(res.error);
    });

  return (
    <Section
      title="İki adımlı doğrulama"
      description="Girişte şifreden sonra telefonunuzdaki doğrulama uygulamasının ürettiği kod da istenir. Google Authenticator, Microsoft Authenticator ya da benzeri bir uygulama kullanabilirsiniz."
    >
      {enabled ? (
        <Stack gap={5}>
          <div className="flex items-center gap-2 text-sm">
            <Tag type="green" size="sm">
              Açık
            </Tag>
            <span>
              {since} tarihinden beri. Kalan kurtarma kodu: {codesLeft}
            </span>
          </div>
          <div className="flex flex-wrap gap-4">
            <Button kind="tertiary" onClick={() => open({ kind: "regenerate" })}>
              Yeni kurtarma kodları
            </Button>
            <Button kind="danger--tertiary" onClick={() => open({ kind: "disable" })}>
              Kapat
            </Button>
          </div>
        </Stack>
      ) : (
        <Button onClick={() => open({ kind: "password" })}>Aç</Button>
      )}

      {step?.kind === "password" && (
        <Modal
          closeButtonLabel="Kapat"
          open
          modalHeading="İki adımlı doğrulamayı aç"
          primaryButtonText={pending ? "Hazırlanıyor…" : "Devam"}
          secondaryButtonText="Vazgeç"
          primaryButtonDisabled={pending || !password}
          onRequestClose={close}
          onRequestSubmit={() => act(() => startTotpAction(password), (d) => open({ kind: "scan", ...d }))}
        >
          <Stack gap={5}>
            <SecretField id="totp-password" label="Şifreniz" autoComplete="current-password" value={password} onChange={setPassword} />
            {error && <Notice kind="error" text={error} />}
          </Stack>
        </Modal>
      )}

      {step?.kind === "scan" && (
        <Modal
          closeButtonLabel="Kapat"
          open
          modalHeading="Uygulamaya ekleyin"
          primaryButtonText={pending ? "Doğrulanıyor…" : "Doğrula ve aç"}
          secondaryButtonText="Vazgeç"
          primaryButtonDisabled={pending || !code}
          onRequestClose={close}
          onRequestSubmit={() => act(() => confirmTotpAction(code), (codes) => open({ kind: "codes", codes }))}
        >
          <Stack gap={5}>
            <p>Doğrulama uygulamasıyla bu kodu okutun, sonra uygulamanın ürettiği 6 haneli kodu girin.</p>
            {/* SVG, sunucuda qrcode kütüphanesinin ürettiği metindir; kullanıcı girdisi içermez */}
            <div className="w-48 bg-white" dangerouslySetInnerHTML={{ __html: step.qr }} />
            <div>
              <p className="mb-2 text-sm text-secondary">Okutamıyorsanız bu anahtarı elle girin:</p>
              <CodeSnippet type="single" feedback="Kopyalandı">
                {step.secret}
              </CodeSnippet>
            </div>
            <TextInput id="totp-code" labelText="6 haneli kod" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            {error && <Notice kind="error" text={error} />}
          </Stack>
        </Modal>
      )}

      {step?.kind === "codes" && (
        <Modal closeButtonLabel="Kapat" open passiveModal modalHeading="Kurtarma kodları" onRequestClose={close}>
          <Stack gap={5}>
            <p>
              Telefonunuza erişemezseniz girişte bu kodları kullanırsınız. Her kod bir kez çalışır ve bu liste bir daha
              gösterilmez. Şifre yöneticinize kaydedin ya da yazdırıp saklayın.
            </p>
            <CodeSnippet type="multi" feedback="Kopyalandı">
              {step.codes.join("\n")}
            </CodeSnippet>
          </Stack>
        </Modal>
      )}

      {(step?.kind === "disable" || step?.kind === "regenerate") && (
        <Modal
          closeButtonLabel="Kapat"
          open
          danger={step.kind === "disable"}
          modalHeading={step.kind === "disable" ? "İki adımlı doğrulamayı kapat" : "Yeni kurtarma kodları"}
          primaryButtonText={pending ? "İşleniyor…" : step.kind === "disable" ? "Kapat" : "Kodları üret"}
          secondaryButtonText="Vazgeç"
          primaryButtonDisabled={pending || !password || !code}
          onRequestClose={close}
          onRequestSubmit={() =>
            step.kind === "disable"
              ? act(() => disableTotpAction(password, code), close)
              : act(() => regenerateCodesAction(password, code), (codes) => open({ kind: "codes", codes }))
          }
        >
          <Stack gap={5}>
            <p>{step.kind === "disable" ? "Girişte artık yalnızca şifre istenir." : "Eski kurtarma kodları çalışmaz olur."}</p>
            <SecretField id="manage-password" label="Şifreniz" autoComplete="current-password" value={password} onChange={setPassword} />
            <CodeField id="manage-code" value={code} onChange={setCode} />
            {error && <Notice kind="error" text={error} />}
          </Stack>
        </Modal>
      )}
    </Section>
  );
}
