import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

import {
  accountRoutes,
  primaryRoutes,
  resolveLaunchRoute,
  type LaunchRouteKey,
  type ResolvedLaunchRoute,
} from "./lib/routes";
import {
  AdminFoundationPage,
  HomeFoundationPage,
  InstallFoundationPage,
  LibraryFoundationPage,
  SettingsFoundationPage,
  StoreFoundationPage,
  ToolFoundationPage,
  WalletFoundationPage,
} from "./pages/foundation-pages";
import { LaunchShell } from "./components/launch-chrome";

interface LocationState {
  pathname: string;
  search: string;
}

export interface LaunchPageProps {
  route: ResolvedLaunchRoute;
  navigate: (to: string) => void;
}

const routeTitles: Record<LaunchRouteKey, string> = {
  home: "Home",
  install: "Install",
  library: "Library",
  store: "Store",
  tool: "Tool",
  wallet: "Wallet",
  settings: "Settings",
  adminTool: "Tool admin",
};

export function App(): ReactElement {
  const [location, setLocation] = useState<LocationState>(() =>
    currentLocation()
  );

  useEffect(() => {
    const onPopState = () => setLocation(currentLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((to: string) => {
    const next = new URL(to, window.location.origin);
    if (next.origin !== window.location.origin) {
      window.location.href = next.href;
      return;
    }
    window.history.pushState(null, "", `${next.pathname}${next.search}`);
    setLocation(currentLocation());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const route = useMemo(
    () => resolveLaunchRoute(location.pathname),
    [location.pathname],
  );

  return (
    <LaunchShell
      accountRoutes={accountRoutes()}
      activeRoute={route.definition.key}
      navigate={navigate}
      primaryRoutes={primaryRoutes()}
      title={routeTitles[route.definition.key]}
    >
      <RouteSwitch route={route} navigate={navigate} />
    </LaunchShell>
  );
}

function RouteSwitch({ route, navigate }: LaunchPageProps): ReactElement {
  switch (route.definition.key) {
    case "home":
      return <HomeFoundationPage route={route} navigate={navigate} />;
    case "install":
      return <InstallFoundationPage route={route} navigate={navigate} />;
    case "library":
      return <LibraryFoundationPage route={route} navigate={navigate} />;
    case "store":
      return <StoreFoundationPage route={route} navigate={navigate} />;
    case "tool":
      return <ToolFoundationPage route={route} navigate={navigate} />;
    case "wallet":
      return <WalletFoundationPage route={route} navigate={navigate} />;
    case "settings":
      return <SettingsFoundationPage route={route} navigate={navigate} />;
    case "adminTool":
      return <AdminFoundationPage route={route} navigate={navigate} />;
  }
}

function currentLocation(): LocationState {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  };
}
