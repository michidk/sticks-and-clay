import { StudioNav } from "@/components/studio-nav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
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
  component: () => (
    <>
      <StudioNav />
      <Outlet />
    </>
  ),
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
      <a href="/">Return to projects</a>
    </main>
  ),
});
