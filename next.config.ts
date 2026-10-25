import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Yerel (native) modüller ve pdfjs sunucuda paketlenmeden çalışır
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist"],
  sassOptions: {
    // Carbon'un kendi SCSS'indeki kullanım dışı uyarılarını gizle
    quietDeps: true,
    silenceDeprecations: ["legacy-js-api", "import", "global-builtin", "if-function"],
  },
  poweredByHeader: false,
  experimental: {
    // Okul listesi PDF yüklemesi (varsayılan 1 MB)
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
