import { useState } from 'react'
import './App.css'

function App() {
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [isManufacturerOpen, setIsManufacturerOpen] = useState(false)
  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null)

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

  const manufacturers = [
    { 
      id: 'DKC', 
      logo: '🏢', 
      url: 'https://www.dkc.ru/ru/' 
    },
    { 
      id: 'EKF', 
      logo: '⚡', 
      url: 'https://ekfgroup.com/ru' 
    },
    { 
      id: 'IEK', 
      logo: '🔌', 
      url: 'https://www.iek.ru/' 
    },
    { 
      id: 'CHINT', 
      logo: '💡', 
      url: 'https://ensmas.ru/' 
    },
    { 
      id: 'Systeme Electric', 
      logo: '🔋', 
      url: 'https://systeme.ru/' 
    }
  ]

  const handleTokenClick = (token: string) => {
    if (token === 'Производители') {
      setIsManufacturerOpen(true)
      setSelectedToken(null)
      return
    }
    
    setSelectedToken(token)
    setTimeout(() => setSelectedToken(null), 2000)
  }

  const handleManufacturerClick = (manufacturer: string) => {
    setSelectedManufacturer(manufacturer)
  }

  const closeManufacturerModal = () => {
    setIsManufacturerOpen(false)
    setSelectedManufacturer(null)
  }

  const closeManufacturerDetailModal = () => {
    setSelectedManufacturer(null)
  }

  return (
    <div className="app-container">
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
                  Выбрана папка: {token.id}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

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

      {/* Модальное окно для папки "Производители" */}
      {isManufacturerOpen && (
        <div className="modal-overlay" onClick={closeManufacturerModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Производители</h2>
              <button className="modal-close" onClick={closeManufacturerModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="manufacturers-grid">
                {manufacturers.map((manufacturer) => (
                  <div
                    key={manufacturer.id}
                    className="manufacturer-item"
                    onClick={() => handleManufacturerClick(manufacturer.id)}
                  >
                    <div className="manufacturer-logo">{manufacturer.logo}</div>
                    <div className="manufacturer-name">{manufacturer.id}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Модальное окно для конкретного производителя */}
      {selectedManufacturer && (
        <div className="modal-overlay" onClick={closeManufacturerDetailModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{selectedManufacturer}</h2>
              <button className="modal-close" onClick={closeManufacturerDetailModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="manufacturer-detail">
                <div className="manufacturer-detail-logo">
                  {manufacturers.find(m => m.id === selectedManufacturer)?.logo}
                </div>
                <h3 className="manufacturer-detail-name">{selectedManufacturer}</h3>
                <a 
                  href={manufacturers.find(m => m.id === selectedManufacturer)?.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="manufacturer-link"
                >
                  Официальный сайт
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App