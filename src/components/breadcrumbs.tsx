import { Link, type LinkProps } from "@tanstack/react-router";
import { Fragment } from "react";

export type Crumb = { label: string; link?: Pick<LinkProps, "to" | "params" | "search"> };

/** Page trail: linked crumbs lead back up the hierarchy; an unlinked last crumb is the current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <span aria-hidden="true">/</span>}
          {item.link ? (
            <Link {...(item.link as LinkProps)}>{item.label}</Link>
          ) : (
            <span aria-current={index === items.length - 1 ? "page" : undefined}>{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
