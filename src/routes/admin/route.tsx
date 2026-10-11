import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminSidebar } from "./-components/admin-sidebar";
import "./-components/admin.css";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <main className="admin-layout">
      <AdminSidebar />
      <div className="admin-content">
        <Outlet />
      </div>
    </main>
  );
}
