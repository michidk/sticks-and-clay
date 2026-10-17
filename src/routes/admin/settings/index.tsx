import { createFileRoute } from "@tanstack/react-router";
import { AiAccess } from "./-components/ai-access";
import { SettingsForm } from "./-components/settings-form";

export const Route = createFileRoute("/admin/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="admin-page">
      <section className="page-heading">
        <div>
          <h1>Runtime settings</h1>
          <p className="lede">
            Timeouts and defaults for new generation work.
          </p>
        </div>
      </section>
      <SettingsForm />
      <AiAccess />
    </div>
  );
}
