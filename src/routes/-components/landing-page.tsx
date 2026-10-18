import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { Bot, Boxes, Code, Film, Grid3x3, Image as ImageIcon, Layers, PenTool, Server } from "lucide-react";

const repository = "https://github.com/michidk/sticks-and-clay";

const steps = [
  ["Design", "Your brief becomes design v1 as written. Approve it, request a change, or let AI improve it. Every revision is kept."],
  ["Mockups", "Generate concept images, revise them in chat, and keep the ones you like as references for every batch."],
  ["Visual target", "Before a 3D build, review a concept sheet of the asset and approve, revise or skip it."],
  ["Build and judge", "Agents write Blender Python in isolated processes. A vision judge inspects the renders and sends fixes back."],
  ["Review", "Accept a finished asset, iterate with a written request, or fork a variant. Nothing ships without you."],
  ["Export", "Download GLBs, the .blend, and a source bundle that rebuilds without an agent or a database."],
] as const;

const kinds = [
  [Layers, "3D models", "Editable Blender sources with GLB exports, product shots and mesh analysis."],
  [ImageIcon, "Graphics", "Images from an OpenAI-compatible Image API, sized per batch."],
  [PenTool, "SVG artwork", "Vector files with previews and variants, sanitized of scripts and external content."],
  [Grid3x3, "Pixel art", "Drawn cell by cell on a grid with a palette, then reviewed against the cells."],
  [Boxes, "PBR materials", "Procedural material recipes, previewed live and assigned to models."],
  [Film, "Sprites from 3D", "Pixel or smooth sprite sheets with 1, 4 or 8 directions and animation frames."],
] as const;

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-header">
        <Link to="/" aria-label="Sticks & Clay home">
          <img
            className="block h-auto w-[220px] max-[600px]:w-[200px]"
            src="/brand/sticks-and-clay-lockup-v2.png"
            alt="Sticks & Clay"
            width={1100}
            height={252}
          />
        </Link>
        <nav aria-label="Landing">
          <Button asChild variant="outline" className="max-[600px]:hidden">
            <a href={repository}>
              <Code size={16} aria-hidden="true" />
              GitHub
            </a>
          </Button>
          <Button asChild>
            <Link to="/projects">Open the demo</Link>
          </Button>
        </nav>
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div>
            <h1 id="landing-title">
              AI builds the assets. <em>You decide what ships.</em>
            </h1>
            <p className="landing-lede">
              Sticks &amp; Clay is a self-hosted workshop for cohesive collections of 3D models, graphics, SVG, pixel
              art, materials and sprites. Agents draft the design, write editable Blender code, photograph their
              work and judge it. You approve the design, the target and every finished asset.
            </p>
            <div className="landing-actions">
              <Button asChild size="lg">
                <Link to="/projects">Explore the live demo</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={repository}>
                  <Code size={18} aria-hidden="true" />
                  Self-host it from GitHub
                </a>
              </Button>
            </div>
            <p className="landing-note">The demo is read-only, needs no account, and shows sample projects made with the app.</p>
          </div>
          <figure className="landing-shot">
            <img
              src="/landing/model-review.png"
              alt="A generated low-poly sedan in the 3D viewer, next to the judge's review with a score and a requested change"
              width={1280}
              height={800}
            />
          </figure>
        </section>

        <section className="landing-section" aria-labelledby="landing-flow">
          <h2 id="landing-flow">How it works</h2>
          <p className="lede">A pipeline with explicit human checkpoints. AI drafts, builds and reviews first; you decide.</p>
          <ol className="landing-steps">
            {steps.map(([title, text], index) => (
              <li key={title}>
                <span className="landing-step-number" aria-hidden="true">{index + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
          <figure className="landing-shot">
            <img
              src="/landing/design-chat.png"
              alt="Design chat with revisions, revert buttons, and the approved design reference"
              width={1280}
              height={800}
              loading="lazy"
            />
          </figure>
        </section>

        <section className="landing-section" aria-labelledby="landing-kinds">
          <h2 id="landing-kinds">One workshop, six kinds of asset</h2>
          <p className="lede">Describe a collection once and every asset follows the same approved design.</p>
          <ul className="landing-kinds">
            {kinds.map(([Icon, title, text]) => (
              <li key={title}>
                <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
          <div className="landing-pair">
            <figure className="landing-shot">
              <img
                src="/landing/board.png"
                alt="Project board with Ideas, Ready, In progress, Review and Done columns"
                width={1280}
                height={800}
                loading="lazy"
              />
              <figcaption>The board follows every asset from idea to done.</figcaption>
            </figure>
            <figure className="landing-shot">
              <img
                src="/landing/collection.png"
                alt="A collection render of generated models side by side"
                width={1280}
                height={800}
                loading="lazy"
              />
              <figcaption>Collection renders show the set together.</figcaption>
            </figure>
          </div>
        </section>

        <section className="landing-section landing-split" aria-labelledby="landing-mcp">
          <div>
            <Bot size={26} strokeWidth={1.6} aria-hidden="true" />
            <h2 id="landing-mcp">Bring your own agent</h2>
            <p>
              The whole workshop is available over a built-in, OAuth-protected MCP server. Claude Code, Codex,
              ChatGPT or any MCP client can create collections, queue builds, view renders and download GLBs, and
              its instructions tell agents to show you designs before approving them.
            </p>
            <a href={`${repository}/blob/main/docs/mcp.md`}>Read the MCP guide</a>
          </div>
          <figure className="landing-shot">
            <img
              src="/landing/mcp-activity.png"
              alt="Connected Claude Code and Codex clients and a log of their tool calls"
              width={1280}
              height={800}
              loading="lazy"
            />
          </figure>
        </section>

        <section className="landing-section landing-split" aria-labelledby="landing-host">
          <div>
            <Server size={26} strokeWidth={1.6} aria-hidden="true" />
            <h2 id="landing-host">Yours to run</h2>
            <p>
              A single-owner workshop on Bun, PostgreSQL and Blender 4.5, with durable jobs that survive restarts and
              honest cost estimates for every request, failed attempts included. It is MIT licensed and works on
              desktop and phone.
            </p>
            <div className="landing-actions">
              <Button asChild>
                <a href={`${repository}#-quick-start`}>Quick start</a>
              </Button>
              <Button asChild variant="outline">
                <Link to="/projects">Explore the demo</Link>
              </Button>
            </div>
          </div>
          <figure className="landing-shot landing-phone">
            <img
              src="/landing/model-mobile.png"
              alt="The 3D model viewer on a phone"
              width={390}
              height={844}
              loading="lazy"
            />
          </figure>
        </section>
      </main>

      <footer className="landing-footer">
        <span>Sticks &amp; Clay · MIT licensed</span>
        <a href={repository}>Source on GitHub</a>
      </footer>
    </div>
  );
}
