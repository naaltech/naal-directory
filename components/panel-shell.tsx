"use client";

import {
  Content,
  Header,
  HeaderContainer,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuButton,
  HeaderName,
  SideNav,
  SideNavDivider,
  SideNavItems,
  SideNavLink,
  SkipToContent,
  Theme,
} from "@carbon/react";
import { Clean, Dashboard, Education, Events, Group, Logout, Renew, Upload, UserAdmin, UserAvatar, UserMultiple, UserProfile } from "@carbon/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { logoutAction } from "@/app/(panel)/actions.ts";

const NAV = [
  { href: "/", label: "Genel bakış", icon: Dashboard },
  { href: "/ice-aktar", label: "Liste içe aktar", icon: Upload },
  { href: "/ogrenciler", label: "Öğrenciler", icon: UserMultiple },
  { href: "/ogretmenler", label: "Öğretmenler", icon: UserProfile },
  { href: "/gruplar", label: "Öğretmen grupları", icon: Group },
  { href: "/siniflar", label: "Sınıflar", icon: Education },
  { href: "/kulupler", label: "Kulüpler", icon: Events },
  { href: "/senkronizasyon", label: "Senkronizasyon", icon: Renew },
  { href: "/temizlik", label: "Temizlik", icon: Clean },
] as const;

export function PanelShell({
  user,
  children,
}: {
  user: { name: string; email: string; roleLabel: string; canManageAdmins: boolean };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [, startLogout] = useTransition();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <HeaderContainer
      render={({ isSideNavExpanded, onClickSideNavExpand }) => (
        <>
          <Theme theme="g100">
            <Header aria-label="NAAL Hesap Yönetimi">
              <SkipToContent href="#main-content">İçeriğe geç</SkipToContent>
              <HeaderMenuButton
                aria-label={isSideNavExpanded ? "Menüyü kapat" : "Menüyü aç"}
                onClick={onClickSideNavExpand}
                isActive={isSideNavExpanded}
                aria-expanded={isSideNavExpanded}
              />
              <HeaderName as={Link} href="/" prefix="NAAL">
                Hesap Yönetimi
              </HeaderName>
              <HeaderGlobalBar>
                <div className="hidden flex-col justify-center px-4 text-right leading-tight sm:flex">
                  <span className="text-sm">{user.name}</span>
                  <span className="text-xs text-secondary">{user.roleLabel}</span>
                </div>
                <HeaderGlobalAction
                  aria-label="Çıkış yap"
                  tooltipAlignment="end"
                  onClick={() => startLogout(() => logoutAction())}
                >
                  <Logout size={20} />
                </HeaderGlobalAction>
              </HeaderGlobalBar>
            </Header>
          </Theme>

          <SideNav aria-label="Ana menü" expanded={isSideNavExpanded} onSideNavBlur={onClickSideNavExpand} href="#main-content">
            <SideNavItems>
              {NAV.map(({ href, label, icon }) => (
                <SideNavLink key={href} as={Link} href={href} renderIcon={icon} isActive={isActive(href)}>
                  {label}
                </SideNavLink>
              ))}
              <SideNavDivider />
              {user.canManageAdmins && (
                <SideNavLink as={Link} href="/yoneticiler" renderIcon={UserAdmin} isActive={isActive("/yoneticiler")}>
                  Yöneticiler
                </SideNavLink>
              )}
              <SideNavLink as={Link} href="/hesap" renderIcon={UserAvatar} isActive={isActive("/hesap")}>
                Hesabım
              </SideNavLink>
            </SideNavItems>
          </SideNav>

          {/* Carbon'un lg kırılımında (66rem) yan menü sabit ve 16rem genişlikte; içerik onun yanından başlar.
              Daha dar ekranda menü gizli, sol boşluk gereksiz. Carbon'un ".cds--side-nav ~ .cds--content"
              kuralını (3rem) ezmek için ! gerekiyor. Telefonda kenar boşluğu da 2rem yerine 1rem. */}
          <Content id="main-content" className="ml-0! min-h-screen px-4! py-6! sm:p-8! min-[66rem]:ml-64!">
            {children}
          </Content>
        </>
      )}
    />
  );
}
