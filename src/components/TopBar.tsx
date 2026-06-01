import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

const navItems = [
  { label: "Home", to: "/" },
  { label: "Metrics", to: "/metrics" },
  { label: "Trends", to: "/trends" },
];

const businessMetricsItems = [
  { label: "Feathery", to: "/business-metrics/feathery" },
];

function TopBar() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const isBusinessMetricsActive = location.pathname.startsWith("/business-metrics");

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  return (
    <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark">EDU</div>
        <div className="brand-copy">
          <p className="brand-label">Executive Reporting</p>
          <h1>EDU Dashboard</h1>
        </div>
      </div>

      <nav className="topbar-nav" aria-label="Main navigation">
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

        <div className="nav-dropdown" ref={menuRef}>
          <button
            type="button"
            className={`nav-link nav-dropdown-trigger${isBusinessMetricsActive ? " active" : ""}`}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            Business Metrics
            <span className="nav-dropdown-caret" aria-hidden="true">
              ▾
            </span>
          </button>

          {menuOpen ? (
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
