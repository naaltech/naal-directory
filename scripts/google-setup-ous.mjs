// Yeni OU yapısını oluşturur. Var olanı atlar, hiçbir şeyi silmez veya taşımaz.
// Şube OU'ları (/Ogrenciler/9/9-A) Excel yüklenince sistem tarafından açılır.
// Kullanım: node scripts/google-setup-ous.mjs
import { getApi } from "./google-auth.mjs";

const api = await getApi();

const OUS = [
  ["/", "Ogrenciler", "Aktif öğrenciler (sınıf seviyesi / şube)"],
  ["/Ogrenciler", "9", "9. sınıflar"],
  ["/Ogrenciler", "10", "10. sınıflar"],
  ["/Ogrenciler", "11", "11. sınıflar"],
  ["/Ogrenciler", "12", "12. sınıflar"],
  ["/", "Ogretmenler", "Öğretmenler"],
  ["/", "Kulupler", "Kulüp yönetim kadrosu hesapları (naal.org.tr)"],
  ["/", "Mezunlar", "Mezunlar: 90 gün sonra askı, 365 gün sonra silme"],
  ["/", "Nakil", "Nakil giden öğrenciler: 90 gün sonra askı, 365 gün sonra silme"],
];

const existing = new Set(
  ((await api("customer/my_customer/orgunits?type=all")).organizationUnits ?? []).map((o) => o.orgUnitPath),
);

for (const [parent, name, description] of OUS) {
  const path = parent === "/" ? `/${name}` : `${parent}/${name}`;
  if (existing.has(path)) {
    console.log(`= ${path} zaten var`);
    continue;
  }
  await api("customer/my_customer/orgunits", {
    method: "POST",
    body: JSON.stringify({ name, parentOrgUnitPath: parent, description }),
  });
  console.log(`+ ${path} oluşturuldu`);
}
