import { Link, useRouterState } from "@tanstack/react-router";
import { Boxes, FolderOpen, ListTodo, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const sections = [
  { to: "/", label: "Projects", icon: FolderOpen },
  { to: "/admin/queue", label: "Queue", icon: ListTodo },
  { to: "/admin/agents", label: "Agents", icon: Bot },
] as const;

export function StudioNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label="Asset Studio home">
          <span className="brand-icon"><Boxes size={22} aria-hidden="true" /></span>
          <span>Asset Studio</span>
        </Link>
        <Badge variant="outline" className="workshop-badge">Workshop</Badge>
        <nav className="studio-nav" aria-label="Main navigation">
          {sections.map(({ to, label, icon: Icon }) => {
            const active = to === "/"
              ? pathname === "/" || pathname.startsWith("/projects/")
              : pathname === to || pathname.startsWith(to + "/");
            return (
              <Link
                key={to}
                to={to}
                className="studio-nav-link"
                activeOptions={{ exact: true }}
                activeProps={{ "aria-current": "page" }}
                aria-current={active ? (pathname === to ? "page" : "location") : undefined}
                data-current={active ? "true" : undefined}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
