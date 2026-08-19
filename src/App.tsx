import './App.css'

function App() {
  return (
    <div className="app-container">
      <header className="header">
        <div className="header-top">
          <h1 className="logo">Engineering Hub</h1>
          <button className="auth-btn">Войти</button>
        </div>
        <div className="search-container">
          <input type="text" className="search-input" placeholder="Поиск..." />
          <span className="search-icon">🔍</span>
        </div>
      </header>

      <main className="tokens-container">
        <div className="tokens-grid">
          <div className="token">
            <div className="token-icon">⚙️</div>
            <div className="token-label">DIAGNOSTIC: App без hooks</div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
