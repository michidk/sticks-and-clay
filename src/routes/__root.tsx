import { StudioNav } from "@/components/studio-nav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { DEMO_MODE } from "@/lib/build-mode";
import "../styles.css";
export const Route = createRootRoute({
  head: () => ({
    links: [{ rel: "icon", type: "image/png", href: "/brand/sticks-and-clay-favicon-v2.png" }],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Sticks & Clay · From reference to ready" },
    ],
  }),
  component: RootLayout,
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  ),
  errorComponent: ({ error }) => (
    <main>
      <h1>Something needs attention</h1>
      <Alert variant="destructive" className="error">
        <AlertDescription className="min-w-0 break-words">
          {error instanceof Error ? error.message : String(error)}
        </AlertDescription>
      </Alert>
      <Button variant="outline" onClick={() => window.location.reload()}>
        Reload page
      </Button>
      <a href="/projects">Return to projects</a>
    </main>
  ),
});

function RootLayout() {
  const landing = useRouterState({ select: (state) => state.location.pathname === "/" });
  if (landing) return <Outlet />;
  return (
    <>
      {DEMO_MODE && (
        <p className="demo-banner">
          Read-only demo with sample projects. Generation and changes are disabled.{" "}
          <a href="https://github.com/michidk/sticks-and-clay">Self-host Sticks &amp; Clay</a>
        </p>
      )}
      <StudioNav />
      <Outlet />
    </>
  );
}
