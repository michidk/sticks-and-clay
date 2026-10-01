import { createFileRoute } from "@tanstack/react-router";
import { SettingsForm } from "./-components/settings-form";

export const Route = createFileRoute("/admin/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="admin-page">
      <section className="page-heading">
        <div>
          <h1>Pipeline settings</h1>
          <p className="lede">
            Runtime limits for AI turns and isolated Blender builds.
          </p>
        </div>
      </section>
      <SettingsForm />
    </div>
  );
}
