import { useState } from 'react'
import './App.css'

function App() {
  const [selectedToken, setSelectedToken] = useState<string | null>(null)

  const tokens = [
    { id: 'Производители', icon: '🏭' },
    { id: 'Автоматизация', icon: '🤖' },
    { id: 'СМИ', icon: '📺' },
    { id: 'Проектирование', icon: '📐' },
    { id: 'Строительство', icon: '🏗️' },
    { id: 'ПО', icon: '💻' },
    { id: 'Где купить', icon: '🛒' },
    { id: 'Документация', icon: '📄' },
    { id: 'Нормативы', icon: '📋' },
    { id: 'Новости', icon: '📰' },
    { id: 'Сотрудничество', icon: '🤝' },
    { id: 'Выставки', icon: '🎪' },
    { id: 'Ассоциации', icon: '🏛️' },
    { id: 'Сборка щитов', icon: '⚡' }
  ]

  const handleTokenClick = (token: string) => {
    setSelectedToken(token)
    setTimeout(() => setSelectedToken(null), 2000)
  }

  return (
    <div className="app-container">
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
              key={token.id}
              className={`token ${selectedToken === token.id ? 'token-active' : ''}`}
              onClick={() => handleTokenClick(token.id)}
            >
              <div className="token-icon">{token.icon}</div>
              <div className="token-label">{token.id}</div>
              {selectedToken === token.id && (
                <div className="token-popup">
                  Выбран раздел: {token.id}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      {/* Нижняя навигация - удалена иконка "Разделы" */}
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
          <span className="nav-icon">👤</span>
          <span className="nav-label">Профиль</span>
        </div>
      </nav>
    </div>
  )
}

export default App