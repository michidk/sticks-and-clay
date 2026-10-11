import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Bot, ListTodo, Settings } from "lucide-react";

const sections = [
  {
    to: "/admin/queue",
    label: "Queue",
    description: "Generation jobs",
    icon: ListTodo,
  },
  {
    to: "/admin/agents",
    label: "Agents",
    description: "AI roles and prompts",
    icon: Bot,
  },
  {
    to: "/admin/diagnostics",
    label: "Diagnostics",
    description: "Service health",
    icon: Activity,
  },
  {
    to: "/admin/settings",
    label: "Settings",
    description: "Runtime defaults",
    icon: Settings,
  },
] as const;

export function AdminSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-heading">
        <span className="eyebrow">Administration</span>
        <p>Manage production and the tools behind it.</p>
      </div>
      <nav className="admin-subnav" aria-label="Administration navigation">
        {sections.map(({ to, label, description, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(to + "/");

          return (
            <Link
              key={to}
              to={to}
              className="admin-subnav-link"
              aria-current={active ? (pathname === to ? "page" : "location") : undefined}
              data-current={active ? "true" : undefined}
            >
              <Icon aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
