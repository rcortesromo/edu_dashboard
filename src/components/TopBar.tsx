import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

const navItems = [{ label: "Home", to: "/" }];

const scorecardItem = { label: "Scorecard", to: "/scorecard" };

const metricsItems = [
  { label: "EDU", to: "/metrics" },
  { label: "Teams", to: "/team-metrics" },
];

const businessMetricsItems = [
  { label: "RevTrak Forms", to: "/business-metrics/feathery" },
];

function TopBar() {
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  const isMetricsActive =
    location.pathname.startsWith("/metrics") || location.pathname.startsWith("/team-metrics");
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
            className={`nav-link nav-dropdown-trigger${isMetricsActive ? " active" : ""}`}
            aria-haspopup="true"
            aria-expanded={openMenu === "metrics"}
            onClick={() => setOpenMenu((current) => (current === "metrics" ? null : "metrics"))}
          >
            Metrics
            <span className="nav-dropdown-caret" aria-hidden="true">
              ▾
            </span>
          </button>

          {openMenu === "metrics" ? (
            <div className="nav-dropdown-menu" role="menu">
              {metricsItems.map((item) => (
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

        <NavLink
          to={scorecardItem.to}
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
        >
          {scorecardItem.label}
        </NavLink>

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
