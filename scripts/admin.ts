// Panel yönetici hesapları. Panelde kayıt ekranı yoktur; hesaplar buradan yönetilir.
//
//   npm run admin -- create <e-posta> "<Ad Soyad>" [--role SUPER_ADMIN|ADMIN|VIEWER] [--generate]
//   npm run admin -- list
//   npm run admin -- passwd <e-posta> [--generate]
//   npm run admin -- role <e-posta> <SUPER_ADMIN|ADMIN|VIEWER>
//   npm run admin -- disable <e-posta>
//   npm run admin -- enable <e-posta>
//   npm run admin -- remove <e-posta>
//
// Şifre terminalde gizli olarak sorulur. --generate verilirse rastgele şifre üretilip bir kez gösterilir.
// Şifre betiğe borudan da verilebilir: echo "sifre" | npm run admin -- create ...

import { createInterface } from "node:readline";
import { loadEnv } from "./env.ts";
import { openDb, migrate } from "../lib/db.ts";
import {
  createAdmin, isRole, listAdmins, removeAdmin, ROLE_LABELS, ROLES,
  setAdminActive, setAdminPassword, setAdminRole, type Role,
} from "../lib/auth/admins.ts";
import { generatePassword, passwordProblem } from "../lib/auth/password.ts";

loadEnv();

const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const next = argv[i + 1];
    if (next && !next.startsWith("--") && a === "--role") {
      flags.set(a, next);
      i++;
    } else flags.set(a, true);
  } else positional.push(a);
}
const [command, ...args] = positional;

const USAGE = `Kullanım:
  npm run admin -- create <e-posta> "<Ad Soyad>" [--role ${ROLES.join("|")}] [--generate]
  npm run admin -- list
  npm run admin -- passwd <e-posta> [--generate]
  npm run admin -- role <e-posta> <${ROLES.join("|")}>
  npm run admin -- disable <e-posta>
  npm run admin -- enable <e-posta>
  npm run admin -- remove <e-posta>`;

/** Gizli girişle şifre sorar; TTY değilse stdin'in ilk satırını okur. */
async function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      rl.close();
      return line.trim();
    }
    throw new Error("Şifre okunamadı (stdin boş). --generate kullanabilirsiniz.");
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void });
    let muted = false;
    write._writeToOutput = (s: string) => {
      if (!muted) process.stdout.write(s);
      else if (s.includes("\n") || s.includes("\r")) process.stdout.write("\n");
      else process.stdout.write("*".repeat(s.length));
    };
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

async function obtainPassword(): Promise<{ password: string; generated: boolean }> {
  if (flags.has("--generate")) return { password: generatePassword(), generated: true };
  const pw = await readPassword("Şifre: ");
  const problem = passwordProblem(pw);
  if (problem) throw new Error(problem);
  if (process.stdin.isTTY) {
    const again = await readPassword("Şifre (tekrar): ");
    if (again !== pw) throw new Error("Şifreler eşleşmedi");
  }
  return { password: pw, generated: false };
}

function need(n: number) {
  if (args.length < n) {
    console.error(USAGE);
    process.exit(1);
  }
}

const db = openDb();
migrate(db);

try {
  switch (command) {
    case "create": {
      need(2);
      const [email, name] = args;
      const role = (flags.get("--role") ?? "ADMIN") as string;
      if (!isRole(role)) throw new Error(`Geçersiz rol: ${role}. Seçenekler: ${ROLES.join(", ")}`);
      const { password, generated } = await obtainPassword();
      const user = await createAdmin(db, { email, name, role, password });
      console.log(`✓ ${user.email} oluşturuldu (${ROLE_LABELS[user.role]})`);
      if (generated) console.log(`  Şifre: ${password}\n  Bu şifre bir daha gösterilmeyecek; ilk girişten sonra değiştirin.`);
      break;
    }
    case "list": {
      const admins = listAdmins(db);
      if (!admins.length) {
        console.log('Henüz yönetici yok. Oluşturmak için: npm run admin -- create <e-posta> "<Ad Soyad>" --role SUPER_ADMIN');
        break;
      }
      for (const a of admins) {
        const state = !a.is_active ? "pasif" : a.locked_until && a.locked_until > new Date().toISOString().replace("T", " ") ? "kilitli" : "aktif";
        console.log(`${a.email.padEnd(36)} ${a.name.padEnd(24)} ${ROLE_LABELS[a.role].padEnd(16)} ${state.padEnd(8)} son giriş: ${a.last_login_at ?? "-"}`);
      }
      break;
    }
    case "passwd": {
      need(1);
      const { password, generated } = await obtainPassword();
      await setAdminPassword(db, args[0], password);
      console.log(`✓ ${args[0]} şifresi değişti, açık oturumları kapatıldı`);
      if (generated) console.log(`  Şifre: ${password}`);
      break;
    }
    case "role": {
      need(2);
      const role = args[1].toUpperCase();
      if (!isRole(role)) throw new Error(`Geçersiz rol: ${args[1]}. Seçenekler: ${ROLES.join(", ")}`);
      setAdminRole(db, args[0], role as Role);
      console.log(`✓ ${args[0]} rolü: ${ROLE_LABELS[role as Role]}`);
      break;
    }
    case "disable":
    case "enable": {
      need(1);
      setAdminActive(db, args[0], command === "enable");
      console.log(`✓ ${args[0]} ${command === "enable" ? "aktifleştirildi" : "pasifleştirildi, oturumları kapatıldı"}`);
      break;
    }
    case "remove": {
      need(1);
      removeAdmin(db, args[0]);
      console.log(`✓ ${args[0]} silindi`);
      break;
    }
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
