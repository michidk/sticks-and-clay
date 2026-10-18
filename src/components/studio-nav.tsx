import { Link, useRouterState } from "@tanstack/react-router";
import { FolderOpen, Settings, Columns3 } from "lucide-react";

const sections = [
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/board", label: "Board", icon: Columns3 },
  { to: "/admin", label: "Admin", icon: Settings },
] as const;

export function StudioNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label="Sticks & Clay home">
          <img
            className="block h-auto w-[220px] max-[600px]:w-[200px]"
            src="/brand/sticks-and-clay-lockup-v2.png"
            alt="Sticks & Clay"
            width={1100}
            height={252}
          />
        </Link>
        <nav className="studio-nav" aria-label="Main navigation">
          {sections.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(to + "/");
            return (
              <Link
                key={to}
                to={to}
                className="studio-nav-link"
                title={label}
                activeOptions={{ exact: true }}
                activeProps={{ "aria-current": "page" }}
                aria-current={active ? (pathname === to ? "page" : "location") : undefined}
                data-current={active ? "true" : undefined}
              >
                <Icon size={17} aria-hidden="true" />
                <span className="studio-nav-label">{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
