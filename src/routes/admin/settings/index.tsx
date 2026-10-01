import { createFileRoute, Link } from "@tanstack/react-router";
import { SettingsForm } from "./-components/settings-form";

export const Route = createFileRoute("/admin/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <main>
      <div className="eyebrow">ADMINISTRATION</div>
      <section className="page-heading">
        <div>
          <h1>Pipeline settings</h1>
          <p className="lede">
            Runtime limits for AI turns and isolated Blender builds.
          </p>
        </div>
        <Link to="/admin/agents">View agent roles</Link>
      </section>
      <SettingsForm />
    </main>
  );
}
