type AppHeaderProps = {
  checkingHealth: boolean;
  health: string;
  healthError: string;
  onCheckHealth: () => void;
};

function AppHeader({ checkingHealth, health, healthError, onCheckHealth }: AppHeaderProps) {
  return (
    <header className="app-header">
      <h1>MTG Deck Manager</h1>
      <div className="health-row">
        <button className="btn" onClick={onCheckHealth} disabled={checkingHealth}>
          {checkingHealth ? "Checking..." : "Check Backend Health"}
        </button>
        {health && <span className="status-badge status-ok">API: {health}</span>}
        {healthError && <span className="status-badge status-error">{healthError}</span>}
      </div>
    </header>
  );
}

export default AppHeader;
