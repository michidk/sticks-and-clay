import { Link, type LinkProps } from "@tanstack/react-router";
import { Fragment } from "react";

export type Crumb = { label: string; link?: Pick<LinkProps, "to" | "params" | "search"> };

/** Page trail: every crumb except the last links back up the hierarchy. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden="true">/</span>}
          {item.link && index < items.length - 1 ? (
            <Link {...(item.link as LinkProps)}>{item.label}</Link>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
