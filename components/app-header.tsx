import Link from "next/link";

import { logoutAction } from "@/app/login/actions";

type NavLink = {
  href: string;
  label: string;
};

const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Kontrolpanel" },
  { href: "/reports", label: "Rapporter" },
  { href: "/settings", label: "Indstillinger" },
];

export function AppHeader({ activeHref }: { activeHref: string }) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span>B-Bikes Mekaniker Dashboard</span>
      </div>
      <nav className="app-header__nav">
        {NAV_LINKS.map((link) => {
          const isActive = link.href === "/" ? activeHref === "/" : activeHref.startsWith(link.href);
          return (
            <Link className={isActive ? "is-active" : undefined} href={link.href} key={link.href}>
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="app-header__actions">
        <Link className="app-header__link" href="/dashboard" rel="noreferrer" target="_blank">
          Åbn TV-visning
        </Link>
        <form action={logoutAction}>
          <button className="logout-button" type="submit">
            Log ud
          </button>
        </form>
      </div>
    </header>
  );
}
