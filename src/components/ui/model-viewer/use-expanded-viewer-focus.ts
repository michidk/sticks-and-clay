"use client";

import { type RefObject, useEffect, useRef } from "react";

const inertLocks = new WeakMap<HTMLElement, { count: number; previous: boolean }>();
const scrollLocks = new WeakMap<Document, { count: number; previous: string }>();
const focusable = 'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]';

/** Contain the fallback fullscreen viewer without remounting its canvas. */
export function useExpandedViewerFocus(
  ref: RefObject<HTMLDivElement | null>,
  expanded: boolean,
  returnFocus: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const root = ref.current;
    if (!expanded || !root) return;
    const doc = root.ownerDocument;
    const previousFocus = returnFocus.current;
    let lastFocus: HTMLElement = root;
    const locks = scrollLocks.get(doc) ?? { count: 0, previous: doc.body.style.overflow };
    locks.count++;
    scrollLocks.set(doc, locks);
    doc.body.style.overflow = "hidden";
    const inertElements = new Set<HTMLElement>();
    const portals = new Map<HTMLElement, { position: string; zIndex: string }>();

    // Base UI menus and tooltips are portaled. Follow their ARIA ownership
    // instead of treating every document-level popup as part of this viewer.
    function insideElements() {
      const inside = new Set<HTMLElement>([root!]);
      for (const element of inside) {
        for (const trigger of element.querySelectorAll("[aria-controls], [aria-describedby]")) {
          const ids = `${trigger.getAttribute("aria-controls") ?? ""} ${trigger.getAttribute("aria-describedby") ?? ""}`;
          for (const id of ids.split(/\s+/).filter(Boolean)) {
            const popup = doc.getElementById(id);
            const portal = popup?.closest<HTMLElement>("[data-base-ui-portal]");
            if (portal) inside.add(portal);
          }
        }
      }
      return [...inside];
    }
    function tabbables() {
      return insideElements()
        .flatMap((element) => [...element.querySelectorAll<HTMLElement>(focusable)])
        .filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(":disabled") &&
            !element.closest("[inert]") &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden",
        );
    }
    function releaseInert() {
      for (const element of inertElements) {
        const lock = inertLocks.get(element)!;
        if (--lock.count === 0) {
          element.inert = lock.previous;
          inertLocks.delete(element);
        }
      }
      inertElements.clear();
    }
    function isolate() {
      releaseInert();
      const inside = insideElements();
      for (const portal of inside.slice(1)) {
        if (!portals.has(portal))
          portals.set(portal, { position: portal.style.position, zIndex: portal.style.zIndex });
        portal.style.position = "relative";
        portal.style.zIndex = "101";
      }
      function visit(parent: HTMLElement) {
        for (const child of parent.children) {
          if (!(child instanceof HTMLElement) || inside.includes(child)) continue;
          if (inside.some((element) => child.contains(element))) visit(child);
          else {
            const lock = inertLocks.get(child) ?? { count: 0, previous: child.inert };
            lock.count++;
            inertLocks.set(child, lock);
            inertElements.add(child);
            child.inert = true;
          }
        }
      }
      visit(doc.body);
    }
    function containFocus(event: FocusEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        insideElements().some((element) => element.contains(target))
      ) {
        lastFocus = target;
      } else {
        (lastFocus.isConnected && !lastFocus.closest("[inert]") ? lastFocus : root!).focus({
          preventScroll: true,
        });
      }
    }
    function keyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "Tab") {
        const elements = tabbables();
        const index = elements.indexOf(doc.activeElement as HTMLElement);
        if (
          !elements.length ||
          (event.shiftKey ? index <= 0 : index === -1 || index === elements.length - 1)
        ) {
          event.preventDefault();
          (event.shiftKey ? (elements.at(-1) ?? root!) : (elements[0] ?? root!)).focus();
        }
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Menus get the first Escape. Tooltips must not consume the viewer's
      // escape action merely because a toolbar button currently has focus.
      if (
        insideElements().some((element) =>
          [...element.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]')].some(
            (popup) => popup.getClientRects().length > 0 && !popup.hasAttribute("data-closed"),
          ),
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    }
    isolate();
    if (previousFocus && root.contains(previousFocus)) lastFocus = previousFocus;
    else (tabbables()[0] ?? root).focus({ preventScroll: true });
    doc.addEventListener("focusin", containFocus);
    doc.addEventListener("keydown", keyDown);
    doc.addEventListener("keydown", handleEscape, true);
    const observer = new MutationObserver(isolate);
    observer.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-controls", "aria-describedby"],
    });
    return () => {
      observer.disconnect();
      doc.removeEventListener("focusin", containFocus);
      doc.removeEventListener("keydown", keyDown);
      doc.removeEventListener("keydown", handleEscape, true);
      releaseInert();
      for (const [portal, style] of portals) Object.assign(portal.style, style);
      if (--locks.count === 0) {
        doc.body.style.overflow = locks.previous;
        scrollLocks.delete(doc);
      }
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [expanded, ref, returnFocus]);
}
