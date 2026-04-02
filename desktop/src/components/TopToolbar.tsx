// TopToolbar — minimal title bar that serves as macOS window drag region.
// In windowed mode, left-pads for macOS traffic lights. In fullscreen, reclaims space.
// Uses data-tauri-drag-region for Tauri v2 window dragging.

import { useState, useEffect } from 'react';

function useIsFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const check = () => {
      setIsFullscreen(
        !!document.fullscreenElement ||
        window.innerHeight === screen.height
      );
    };

    check();
    window.addEventListener('resize', check);
    document.addEventListener('fullscreenchange', check);
    return () => {
      window.removeEventListener('resize', check);
      document.removeEventListener('fullscreenchange', check);
    };
  }, []);

  return isFullscreen;
}

export default function TopToolbar() {
  const isFullscreen = useIsFullscreen();

  return (
    <div
      data-tauri-drag-region
      className="flex items-center h-[28px] bg-gray-50 border-b border-ul-border flex-shrink-0"
    >
      {/* Traffic light spacer — collapses in fullscreen */}
      {!isFullscreen && <div data-tauri-drag-region className="w-[70px] h-full flex-shrink-0" />}

      {/* Remaining space is draggable */}
      <div data-tauri-drag-region className="flex-1 h-full" />
    </div>
  );
}
