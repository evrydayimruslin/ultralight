// SellerLibraryBanner — G1 (3E1b ASellerLibrary).
//
// Pinned-once "sold · keeps running for you" banner shown at the top
// of LibraryView the first time the seller opens it after accepting a
// bid (or having the buyer take the ask). Past-tense vibe — the seller
// chose this, the deal is settled. Dismiss is single-shot and persists
// to the BE so it doesn't reappear on the next launch / on another
// device.
//
// Ports `SoldBanner` from handoff/mockups/acquisition-handoff.jsx with
// the visual language adapted to our tokens (no inline styles, no raw
// hex).

import { useState } from 'react';
import { X } from 'lucide-react';
import { dismissHandoffBanner, type HandoffBannerItem } from '../../lib/api';
import { formatLightPrecise as formatLight } from '../../lib/format';

interface SellerLibraryBannerProps {
  item: HandoffBannerItem;
  /** Fires after a successful dismiss so the parent feed can drop the row. */
  onDismissed: (saleId: string) => void;
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(1, Math.round((Date.now() - then) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function SellerLibraryBanner({ item, onDismissed }: SellerLibraryBannerProps) {
  const [dismissing, setDismissing] = useState(false);
  const path = item.path;
  const buyer = item.buyer_handle ?? '@buyer';
  const when = timeAgo(item.sold_at ?? item.acquired_at);

  const headline = path === 'instant'
    ? 'Bought at ask · keeps running for you'
    : 'Sold · keeps running for you';
  const verb = path === 'instant' ? 'Bought at ask by' : 'Sold to';

  const handleDismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    const result = await dismissHandoffBanner({ saleId: item.sale_id, side: 'seller' });
    if (result.ok) {
      onDismissed(item.sale_id);
    } else {
      // Soft fail — leaving the banner up is acceptable.
      setDismissing(false);
    }
  };

  return (
    <div className="relative mb-4">
      <div className="text-nano font-mono uppercase tracking-[0.1em] text-ul-text-muted mb-2.5">
        {headline}
      </div>
      <div
        className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] gap-5 items-center px-5 py-4 border border-ul-border rounded-card bg-ul-bg-raised"
      >
        {/* Glyph block: ✦ tile with an outbound-arrow chip — the inverse
            of the buyer banner's key chip. */}
        <div className="relative w-14 h-14 rounded-lg bg-ul-bg border border-ul-border flex items-center justify-center text-h2 text-ul-text leading-none">
          ✦
          <div className="absolute -right-1 -bottom-1 w-[18px] h-[18px] rounded-full bg-ul-text text-white text-nano leading-none flex items-center justify-center">
            →
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2.5 mb-1 flex-wrap">
            <span className="text-h3 font-bold tracking-tight font-mono text-ul-text truncate">
              {item.app_name}
            </span>
            <span className="text-nano font-mono uppercase tracking-wider text-ul-text-secondary bg-ul-bg border border-ul-border px-2 py-0.5 rounded-full">
              No longer yours
            </span>
          </div>
          <div className="text-caption text-ul-text-secondary leading-relaxed">
            {verb} <strong className="text-ul-text">{buyer}</strong>
            {when && <> {when}</>} for{' '}
            <strong className="text-ul-text font-mono">✦{formatLight(item.sale_price_light)}</strong>
            {' '}· still installed in your library, calls now route to the new owner.
          </div>
        </div>

        <div className="text-right flex flex-col items-end gap-1 pl-4 border-l border-ul-border">
          <div className="text-nano font-mono uppercase tracking-[0.1em] text-ul-text-muted">
            From sale
          </div>
          <div className="text-h3 font-bold font-mono tabular-nums">
            +✦{formatLight(item.sale_price_light)}
          </div>
          <div className="text-nano font-mono text-ul-success-strong">
            settled · view in wallet
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleDismiss()}
          disabled={dismissing}
          aria-label="Dismiss"
          className="absolute top-2.5 right-2.5 w-[22px] h-[22px] rounded-full text-ul-text-muted hover:bg-ul-bg-hover flex items-center justify-center cursor-pointer disabled:opacity-50 border-none bg-transparent"
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-2 pl-0.5 text-nano font-mono text-ul-text-muted">
        shown once · the row stays in your library, this banner won't reappear
      </div>
    </div>
  );
}
