"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
}

/** Focuses a fallback container, temporarily making it programmatically focusable if needed. */
function focusFallback(element: HTMLElement) {
  if (!element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
    element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
  }
  element.focus();
}

/** Makes every body child except the dialog overlay inert and returns a function restoring each element's previous inert state. */
function makeBackgroundInert(overlay: HTMLElement) {
  const previous = Array.from(document.body.children)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
    .map((element) => ({ element, inert: element.inert }));
  previous.forEach(({ element }) => { element.inert = true; });
  return () => previous.forEach(({ element, inert }) => { element.inert = inert; });
}

/** Locks page scrolling (compensating for the removed scrollbar) and returns a function restoring the previous scroll state. */
function lockBackgroundScroll() {
  const { documentElement: html, body } = document;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const scrollbarWidth = window.innerWidth - html.clientWidth;
  const previous = { htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow, bodyPaddingRight: body.style.paddingRight };
  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
  return () => {
    html.style.overflow = previous.htmlOverflow;
    body.style.overflow = previous.bodyOverflow;
    body.style.paddingRight = previous.bodyPaddingRight;
    if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo(scrollX, scrollY);
  };
}

export function DocumentDeleteAction({ id, number, subject }: { id: string; number: string | null; subject: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const fallbackFocusRef = useRef<HTMLElement | null>(null);
  const deletedRef = useRef(false);

  // While open: background inert, background scroll locked, initial focus on Cancel.
  // Cleanup (close or unmount) restores inert and scroll state first, then moves focus, so the focus target is never inert.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!open || !overlay) return;
    const trigger = triggerRef.current;
    const restoreInert = makeBackgroundInert(overlay);
    const restoreScroll = lockBackgroundScroll();
    cancelRef.current?.focus();
    return () => {
      restoreInert();
      restoreScroll();
      const fallback = fallbackFocusRef.current;
      // After a successful deletion the row (and trigger) is about to be removed, so focus the stable results section instead.
      if (!deletedRef.current && trigger?.isConnected) trigger.focus();
      else if (fallback?.isConnected) focusFallback(fallback);
    };
  }, [open]);

  // While both actions are disabled, keep focus on the dialog itself; return it to Cancel once they re-enable.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (pending) { dialog.focus(); return; }
    const active = document.activeElement;
    if (active === dialog || active === null || active === document.body) cancelRef.current?.focus();
  }, [open, pending]);

  function openDialog() {
    if (deletedRef.current) return;
    fallbackFocusRef.current = triggerRef.current?.closest<HTMLElement>("section, main") ?? null;
    setOpen(true);
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (!pending) { event.preventDefault(); setOpen(false); }
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const outside = active === dialog || !dialog.contains(active);
    if (event.shiftKey && (active === first || outside)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || outside)) { event.preventDefault(); first.focus(); }
  }

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) { setError(body.error?.message ?? "The document could not be deleted. Please retry."); return; }
      deletedRef.current = true;
      setDeleted(true);
      setOpen(false);
      router.refresh();
    } catch {
      setError("The deletion request could not be completed. Please retry.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <button ref={triggerRef} className="table-action table-action-danger" type="button" disabled={deleted} onClick={openDialog}>Delete<span className="sr-only"> {subject}</span></button>
    {open && createPortal(
      <div ref={overlayRef} className="document-delete-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) event.preventDefault(); }}>
        <section ref={dialogRef} className="confirmation-panel" role="alertdialog" aria-modal="true" aria-labelledby={`delete-title-${id}`} aria-describedby={`delete-description-${id}`} aria-busy={pending} tabIndex={-1} onKeyDown={handleDialogKeyDown}>
          <div><h2 id={`delete-title-${id}`}>Delete document?</h2><div id={`delete-description-${id}`}><p>Document number: <strong>{number ?? "—"}</strong></p><p>Subject: <strong>{subject}</strong></p><p>The record will be moved to the Document Center Trash and hidden from the registry. An administrator can restore it or purge it later.</p></div>{error && <p className="form-error" role="alert">{error}</p>}</div>
          <div className="confirmation-actions"><button ref={cancelRef} className="button button-secondary" type="button" disabled={pending} onClick={() => setOpen(false)}>Cancel</button><button className="button button-danger" type="button" disabled={pending} onClick={() => void confirm()}>{pending ? "Deleting…" : "Delete document"}</button></div>
        </section>
      </div>,
      document.body,
    )}
  </>;
}
