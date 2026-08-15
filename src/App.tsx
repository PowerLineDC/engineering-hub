import { useState } from 'react'
import './App.css'

function App() {
  const [selectedToken, setSelectedToken] = useState<string | null>(null)

  const tokens = [
    'Производители',
    'Автоматизация',
    'СМИ',
    'Проектирование',
    'Строительство',
    'ПО',
    'Где купить',
    'Документация',
    'Нормативы',
    'Новости',
    'Сотрудничество',
    'Выставки',
    'Ассоциации',
    'Сборка щитов'
  ]

  const handleTokenClick = (token: string) => {
    setSelectedToken(token)
    setTimeout(() => setSelectedToken(null), 2000)
  }

  return (
    <div className="phone-frame">
      <div className="phone-screen">
        {/* Шапка */}
        <header className="header">
          <div className="header-top">
            <h1 className="logo">Engineering Hub</h1>
            <button className="auth-btn">Войти</button>
          </div>
          <div className="search-container">
            <input 
              type="text" 
              className="search-input" 
              placeholder="Поиск..."
            />
            <span className="search-icon">🔍</span>
          </div>
        </header>

        {/* Основная область с жетонами */}
        <main className="tokens-container">
          <div className="tokens-grid">
            {tokens.map((token) => (
              <div
                key={token}
                className={`token ${selectedToken === token ? 'token-active' : ''}`}
                onClick={() => handleTokenClick(token)}
              >
                <span className="token-text">{token}</span>
                {selectedToken === token && (
                  <div className="token-popup">
                    Выбран раздел: {token}
                  </div>
                )}
              </div>
            ))}
          </div>
        </main>

        {/* Нижняя навигация */}
        <nav className="bottom-nav">
          <div className="nav-item nav-active">
            <span className="nav-icon">🏠</span>
            <span className="nav-label">Главная</span>
          </div>
          <div className="nav-item">
            <span className="nav-icon">⭐</span>
            <span className="nav-label">Избранное</span>
          </div>
          <div className="nav-item">
            <span className="nav-icon">📋</span>
            <span className="nav-label">Разделы</span>
          </div>
          <div className="nav-item">
            <span className="nav-icon">👤</span>
            <span className="nav-label">Профиль</span>
          </div>
        </nav>
      </div>
    </div>
  )
}

export default App