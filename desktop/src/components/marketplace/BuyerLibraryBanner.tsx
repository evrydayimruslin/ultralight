// BuyerLibraryBanner — G2 (3E2 ABuyerLibrary).
//
// "Newly acquired · waiting on you" tile pinned at the top of LibraryView
// the first time the buyer opens it after acquisition. This is the
// async-accepted-path handoff — the buyer placed a bid, walked away,
// and the seller accepted while they weren't watching. The
// TransferCeremony never played for them.
//
// Tapping "Open admin →" fires the ceremony (so the buyer gets the
// staged handoff moment they missed), then dismisses the banner.
//
// Ports `NewlyOwnedRow` from handoff/mockups/acquisition-handoff.jsx.

import { useState } from 'react';
import { Key, X } from 'lucide-react';
import { dismissHandoffBanner, type HandoffBannerItem } from '../../lib/api';
import { formatLightPrecise as formatLight } from '../../lib/format';
import TransferCeremony from './TransferCeremony';
import Modal from '../ui/Modal';

interface BuyerLibraryBannerProps {
  item: HandoffBannerItem;
  /** Fires after a successful dismiss so the parent feed drops the row. */
  onDismissed: (saleId: string) => void;
  /** Optional — caller can route the post-ceremony "done" tap to the
   *  tool's admin page. When unset, the ceremony just closes. */
  onOpenAdmin?: (appId: string) => void;
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

export default function BuyerLibraryBanner({ item, onDismissed, onOpenAdmin }: BuyerLibraryBannerProps) {
  const [ceremonyOpen, setCeremonyOpen] = useState(false);
  const priorOwner = item.prior_owner_handle ?? '@owner';
  const when = timeAgo(item.acquired_at ?? item.sold_at);

  const persistDismiss = async () => {
    const result = await dismissHandoffBanner({ saleId: item.sale_id, side: 'buyer' });
    if (result.ok) {
      onDismissed(item.sale_id);
    } else {
      // Soft fail — banner stays but won't block.
    }
  };

  const handleOpenAdmin = () => {
    setCeremonyOpen(true);
  };

  const handleCeremonyDone = () => {
    setCeremonyOpen(false);
    void persistDismiss();
    onOpenAdmin?.(item.app_id);
  };

  return (
    <div className="relative mb-4">
      <div className="text-nano font-mono uppercase tracking-[0.1em] text-ul-text-muted mb-2.5">
        Newly acquired · waiting on you
      </div>
      <div
        className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] gap-[18px] items-center px-5 py-4 border border-ul-text rounded-card bg-ul-bg shadow-lg"
      >
        {/* Glyph block: ✦ on a dark tile with a corner key chip — the
            inverse of the seller banner's outbound arrow. */}
        <div className="relative w-14 h-14 rounded-lg bg-ul-text text-white flex items-center justify-center text-h2 leading-none">
          ✦
          <div className="absolute -right-1 -bottom-1 w-[18px] h-[18px] rounded-full bg-white border border-ul-border flex items-center justify-center text-ul-text">
            <Key className="w-2.5 h-2.5" strokeWidth={2} />
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2.5 mb-1 flex-wrap">
            <span className="text-h3 font-bold tracking-tight font-mono text-ul-text truncate">
              {item.app_name}
            </span>
            <span className="text-nano font-mono uppercase tracking-wider text-ul-text bg-ul-accent-soft px-2 py-0.5 rounded-full">
              You own this
            </span>
          </div>
          <div className="text-caption text-ul-text-secondary leading-relaxed">
            Acquired {when && <>{when} </>}from{' '}
            <strong className="text-ul-text">{priorOwner}</strong> for{' '}
            <strong className="text-ul-text font-mono">✦{formatLight(item.sale_price_light)}</strong>
            {' '}· open the admin panel to claim it.
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <div className="relative">
            <button
              type="button"
              onClick={handleOpenAdmin}
              className="relative px-4 py-2.5 bg-ul-text text-white border-none rounded-md text-caption font-medium cursor-pointer hover:bg-ul-accent-hover inline-flex items-center gap-2"
            >
              Open admin <span aria-hidden>→</span>
            </button>
            {/* Pulse ring — keeps drawing attention until the user
                clicks through and the banner dismisses. */}
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-[3px] rounded-[10px] border-[1.5px] border-ul-text animate-pulse-slow"
            />
          </div>
          <span className="text-nano font-mono text-ul-text-muted">first time only</span>
        </div>
      </div>

      {/* Ceremony — async accepted-path handoff moment the buyer missed
          when the seller accepted. Replays per the addendum's locked
          two-path rule. */}
      {ceremonyOpen && (
        <Modal
          onClose={handleCeremonyDone}
          surface="plain"
          radius="xl"
          maxWidth="3xl"
          maxHeight="tall"
        >
          <TransferCeremony
            toolName={item.app_name}
            fromHandle={priorOwner}
            toHandle="you"
            amount={item.sale_price_light}
            path={item.path}
            onDone={handleCeremonyDone}
          />
        </Modal>
      )}

      {/* Dismiss without playing the ceremony. */}
      <button
        type="button"
        onClick={() => void persistDismiss()}
        aria-label="Dismiss"
        className="absolute top-[34px] right-2.5 w-[22px] h-[22px] rounded-full text-ul-text-muted hover:bg-ul-bg-hover flex items-center justify-center cursor-pointer border-none bg-transparent z-10"
      >
        <X className="w-3.5 h-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
