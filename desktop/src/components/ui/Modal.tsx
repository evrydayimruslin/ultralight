// Modal — the shared chrome that AcquisitionFlow, AddLightModal,
// WithdrawModal, and WidgetPickerModal all reimplemented locally during the
// premium-UI port. Replaces four near-identical `ModalShell`s plus the
// inline overlay scaffolding that wrapped them.
//
// What it gives you:
//   • A backdrop that closes on click-outside (mousedown target check —
//     same semantics the old shells used so drag-selects inside the modal
//     don't accidentally dismiss).
//   • Escape-key dismissal scoped to a single keydown listener.
//   • Focus management: focus is moved into the modal on mount and
//     restored to the previously-focused element on unmount; Tab/Shift+Tab
//     wrap inside the modal so keyboard users can't escape into the page
//     behind the backdrop.
//
// What it doesn't try to be:
//   • A full Headless UI-style Dialog with portal + aria-modal + scroll
//     lock + animation orchestration. None of the current callers need
//     portal rendering (they all sit at the root of the visible viewport
//     anyway), and scroll-lock has been a non-issue so far.
//   • A way to compose modal *content* — body, header, footer styling is
//     entirely up to the caller. We only own the overlay + card chrome.

import { useEffect, useRef, type ReactNode } from 'react';

type Surface = 'paper' | 'plain';
type Radius = 'lg' | 'xl';
type MaxWidth = 'md' | 'lg' | '2xl' | '3xl';
type MaxHeight = 'standard' | 'tall' | 'auto';

interface ModalProps {
  onClose: () => void;
  /** Background tone — 'paper' = warm-paper marketplace surface, 'plain' = white. */
  surface?: Surface;
  /** Inner-card corner radius. */
  radius?: Radius;
  /** Inner-card max-width preset. */
  maxWidth?: MaxWidth;
  /** Inner-card max-height preset. 'auto' lets the content size itself. */
  maxHeight?: MaxHeight;
  /** When false, suppresses the click-outside dismissal (Escape still works). */
  dismissOnBackdropClick?: boolean;
  /** When false, suppresses the Escape dismissal (backdrop click still works). */
  dismissOnEscape?: boolean;
  children: ReactNode;
}

const SURFACE_CLASS: Record<Surface, string> = {
  paper: 'bg-ul-warm-paper',
  plain: 'bg-ul-bg',
};

const RADIUS_CLASS: Record<Radius, string> = {
  lg: 'rounded-lg',
  xl: 'rounded-xl',
};

const MAX_WIDTH_CLASS: Record<MaxWidth, string> = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
};

const MAX_HEIGHT_CLASS: Record<MaxHeight, string> = {
  standard: 'max-h-[80vh]',
  tall: 'max-h-[88vh]',
  auto: '',
};

// Selector covers everything the platform considers tab-stoppable. The
// `:not([disabled])` filter drops disabled controls; `tabindex="-1"` is also
// excluded so programmatic-only focusables (e.g. modal containers themselves)
// don't get pulled into Tab cycling.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function Modal({
  onClose,
  surface = 'plain',
  radius = 'xl',
  maxWidth = '3xl',
  maxHeight = 'tall',
  dismissOnBackdropClick = true,
  dismissOnEscape = true,
  children,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    // Move focus inside the card so the next Tab lands somewhere predictable.
    const focusables = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const first = focusables && focusables.length > 0 ? focusables[0] : cardRef.current;
    first?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (dismissOnEscape && e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const card = cardRef.current;
      if (!card) return;
      const nodes = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (nodes.length === 0) {
        e.preventDefault();
        card.focus({ preventScroll: true });
        return;
      }
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && active === firstNode) {
        e.preventDefault();
        lastNode.focus({ preventScroll: true });
      } else if (!e.shiftKey && active === lastNode) {
        e.preventDefault();
        firstNode.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus({ preventScroll: true });
    };
  }, [onClose, dismissOnEscape]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-6 py-10 animate-fade-in"
      onMouseDown={(e) => {
        if (dismissOnBackdropClick && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={cardRef}
        // tabIndex -1 lets us programmatically focus the card itself as a
        // last resort when the modal has no focusable children.
        tabIndex={-1}
        className={[
          SURFACE_CLASS[surface],
          RADIUS_CLASS[radius],
          MAX_WIDTH_CLASS[maxWidth],
          MAX_HEIGHT_CLASS[maxHeight],
          'shadow-xl border border-ul-border w-full flex flex-col overflow-hidden animate-fade-up outline-none',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  );
}
