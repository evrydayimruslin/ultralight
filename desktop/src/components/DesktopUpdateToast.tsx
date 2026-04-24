import type { DesktopUpdateController } from '../hooks/useDesktopUpdater';

interface DesktopUpdateToastProps {
  readonly updater: DesktopUpdateController;
}

function formatProgress(downloadedBytes: number, totalBytes: number | null): string {
  if (!totalBytes || totalBytes <= 0) return 'Downloading update...';

  const progress = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
  return `Downloading update... ${progress}%`;
}

export default function DesktopUpdateToast({ updater }: DesktopUpdateToastProps) {
  if (!updater.enabled || !updater.visible || !updater.version) return null;

  const isInstalling = updater.phase === 'installing';
  const isDownloading = updater.phase === 'downloading';

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[360px] rounded-2xl border border-black/10 bg-white/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.14)] backdrop-blur">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-black text-[11px] font-semibold tracking-[0.14em] text-white">
          UL
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-black">
            Ultralight {updater.version} is ready
          </p>
          <p className="mt-1 text-[12px] text-black/60">
            {updater.currentVersion ? `Current ${updater.currentVersion}` : 'A new desktop release is available'}
            {updater.publishedAt ? ` • Released ${updater.publishedAt}` : ''}
          </p>

          {updater.notes && (
            <p className="mt-2 text-[12px] leading-5 text-black/75">
              {updater.notes}
            </p>
          )}

          {updater.error && (
            <p className="mt-2 text-[12px] leading-5 text-red-600">
              {updater.error}
            </p>
          )}

          {isDownloading && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-black/8">
                <div
                  className="h-full rounded-full bg-black transition-[width] duration-300"
                  style={{
                    width: updater.totalBytes
                      ? `${Math.min(100, (updater.downloadedBytes / updater.totalBytes) * 100)}%`
                      : '35%',
                  }}
                />
              </div>
              <p className="mt-2 text-[12px] text-black/60">
                {formatProgress(updater.downloadedBytes, updater.totalBytes)}
              </p>
            </div>
          )}

          {isInstalling && (
            <p className="mt-3 text-[12px] text-black/60">
              Installing update and relaunching...
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {!isDownloading && !isInstalling && (
          <button
            type="button"
            onClick={updater.dismiss}
            className="btn btn-ghost btn-sm"
          >
            Later
          </button>
        )}

        <button
          type="button"
          onClick={() => void updater.install()}
          disabled={isDownloading || isInstalling}
          className={isDownloading || isInstalling ? 'btn btn-secondary btn-sm cursor-default' : 'btn btn-primary btn-sm'}
        >
          {isInstalling ? 'Restarting...' : isDownloading ? 'Downloading...' : 'Update & relaunch'}
        </button>
      </div>
    </div>
  );
}
