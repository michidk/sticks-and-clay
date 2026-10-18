import { createFileRoute, redirect } from "@tanstack/react-router";
import { DEMO_MODE } from "@/lib/build-mode";
import { LandingPage } from "./-components/landing-page";

// The public landing page exists only in the demo edition; a workshop opens on its projects.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (!DEMO_MODE) throw redirect({ to: "/projects" });
  },
  head: () => ({
    meta: [
      { title: "Sticks & Clay · AI asset generation with a human in the loop" },
      {
        name: "description",
        content:
          "A self-hosted workshop for 3D models, graphics, SVG, pixel art, PBR materials and sprites. Agents write Blender code and judge the renders; you approve what ships.",
      },
    ],
  }),
  component: LandingPage,
});
