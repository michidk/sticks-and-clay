import { StudioNav } from "@/components/studio-nav";
import { Alert } from "@/components/ui/alert";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import "../styles.css";
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Asset Studio · From reference to ready" },
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
        {error instanceof Error ? error.message : String(error)}
      </Alert>
      <a href="/">Return to projects</a>
    </main>
  ),
});
