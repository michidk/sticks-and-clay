import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  Link,
} from "@tanstack/react-router";
import { Boxes, ArrowUpRight } from "lucide-react";
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
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-icon">
            <Boxes size={21} />
          </span>{" "}
          Asset Studio <span className="beta">WORKSHOP</span>
        </Link>
        <Link to="/admin/queue">Queue</Link>
        <Link to="/admin/agents">Agents</Link>
        <span className="top-note">
          An idea. A shared style. A world of assets.
          <ArrowUpRight size={15} />
        </span>
      </header>
      <Outlet />
      <footer>
        ASSET STUDIO{" "}
        <span>Built with Blender + Eve · Made for worlds worth exploring.</span>
      </footer>
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
      <p className="error">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <a href="/">Return to projects</a>
    </main>
  ),
});
