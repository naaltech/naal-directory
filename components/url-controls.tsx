"use client";

// Filtre ve sayfalama durumunu adres çubuğunda tutan Carbon bileşenleri.
// Sunucu sayfası searchParams'tan okur; böylece bağlantı paylaşılabilir ve geri tuşu çalışır.

import { Dropdown, Pagination, Search } from "@carbon/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

function useSetParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete("sayfa");
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { params, set, pending };
}

export function UrlSearch({ name = "q", placeholder }: { name?: string; placeholder: string }) {
  const { params, set } = useSetParams();
  const [value, setValue] = useState(params.get(name) ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Search
      size="lg"
      labelText={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        const v = typeof e === "string" ? e : e.target.value;
        setValue(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => set({ [name]: v.trim() || undefined }), 300);
      }}
      onClear={() => set({ [name]: undefined })}
    />
  );
}

export interface Option {
  value: string;
  label: string;
}

export function UrlDropdown({ name, label, options, allLabel }: { name: string; label: string; options: Option[]; allLabel: string }) {
  const { params, set } = useSetParams();
  const items: Option[] = [{ value: "", label: allLabel }, ...options];
  const selected = items.find((o) => o.value === (params.get(name) ?? "")) ?? items[0];
  return (
    <Dropdown
      id={`filter-${name}`}
      type="inline"
      size="lg"
      titleText={label}
      hideLabel
      label={allLabel}
      items={items}
      itemToString={(o) => o?.label ?? ""}
      selectedItem={selected}
      onChange={({ selectedItem }) => set({ [name]: selectedItem?.value || undefined })}
    />
  );
}

export function UrlPagination({ total, page, pageSize, unit }: { total: number; page: number; pageSize: number; unit: string }) {
  const { set } = useSetParams();
  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      pageSizes={[25, 50, 100, 250]}
      totalItems={total}
      itemsPerPageText="Sayfa başına"
      itemRangeText={(min, max, n) => `${min}–${max} / ${n.toLocaleString("tr-TR")} ${unit}`}
      pageRangeText={(_, n) => `/ ${n} sayfa`}
      onChange={({ page: p, pageSize: size }) =>
        set({ sayfa: p > 1 ? String(p) : undefined, boyut: size !== 50 ? String(size) : undefined }, false)
      }
    />
  );
}
