type ViewKey = "home" | "metrics";

type TopBarProps = {
  activeView: ViewKey;
  onNavigate: (view: ViewKey) => void;
};

const navItems: Array<{ label: string; view: ViewKey }> = [
  { label: "Home", view: "home" },
  { label: "Metrics", view: "metrics" },
];

function TopBar({ activeView, onNavigate }: TopBarProps) {
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
          <button
            key={item.view}
            type="button"
            className={`nav-link${activeView === item.view ? " active" : ""}`}
            onClick={() => onNavigate(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

export default TopBar;
