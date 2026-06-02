import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

const navItems = [
  { label: "Home", to: "/" },
  { label: "Metrics", to: "/metrics" },
];

const trendsItems = [
  { label: "EDU", to: "/trends" },
  { label: "Teams", to: "/team-trends" },
];

const businessMetricsItems = [
  { label: "Feathery", to: "/business-metrics/feathery" },
];

function TopBar() {
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  const isTrendsActive =
    location.pathname.startsWith("/trends") || location.pathname.startsWith("/team-trends");
  const isBusinessMetricsActive = location.pathname.startsWith("/business-metrics");

  useEffect(() => {
    setOpenMenu(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!openMenu) return;

    function handlePointerDown(event: MouseEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openMenu]);

  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark">EDU</div>
        <div className="brand-copy">
          <p className="brand-label">Executive Reporting</p>
          <h1>EDU Dashboard</h1>
        </div>
      </div>

      <nav className="topbar-nav" aria-label="Main navigation" ref={navRef}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
          >
            {item.label}
          </NavLink>
        ))}

        <div className="nav-dropdown">
          <button
            type="button"
            className={`nav-link nav-dropdown-trigger${isTrendsActive ? " active" : ""}`}
            aria-haspopup="true"
            aria-expanded={openMenu === "trends"}
            onClick={() => setOpenMenu((current) => (current === "trends" ? null : "trends"))}
          >
            Trends
            <span className="nav-dropdown-caret" aria-hidden="true">
              ▾
            </span>
          </button>

          {openMenu === "trends" ? (
            <div className="nav-dropdown-menu" role="menu">
              {trendsItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  role="menuitem"
                  className={({ isActive }) => `nav-dropdown-item${isActive ? " active" : ""}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>

        <div className="nav-dropdown">
          <button
            type="button"
            className={`nav-link nav-dropdown-trigger${isBusinessMetricsActive ? " active" : ""}`}
            aria-haspopup="true"
            aria-expanded={openMenu === "business-metrics"}
            onClick={() =>
              setOpenMenu((current) => (current === "business-metrics" ? null : "business-metrics"))
            }
          >
            Business Metrics
            <span className="nav-dropdown-caret" aria-hidden="true">
              ▾
            </span>
          </button>

          {openMenu === "business-metrics" ? (
            <div className="nav-dropdown-menu" role="menu">
              {businessMetricsItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  role="menuitem"
                  className={({ isActive }) => `nav-dropdown-item${isActive ? " active" : ""}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>
      </nav>
    </header>
  );
}

export default TopBar;
