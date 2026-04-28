import { NavLink } from "react-router-dom";

const navItems = [
  { label: "Home", to: "/" },
  { label: "Metrics", to: "/metrics" },
  { label: "Trends", to: "/trends" },
];

function TopBar() {
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
      </nav>
    </header>
  );
}

export default TopBar;
