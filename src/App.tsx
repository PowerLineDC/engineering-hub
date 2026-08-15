import { useState } from 'react'
import './App.css'

function App() {
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [isManufacturerOpen, setIsManufacturerOpen] = useState(false)
  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null)
  const [selectedChintFolder, setSelectedChintFolder] = useState<string | null>(null)

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
    { id: 'DKC', logo: '/manufacturers/dkc/brand/dkc_logo_2020_new.svg', url: 'https://www.dkc.ru/ru/' },
    { id: 'EKF', logo: '/manufacturers/ekf/brand/logo-ekf-white.svg', url: 'https://ekfgroup.com/ru' },
    { id: 'IEK', logo: '/manufacturers/iek/brand/logo.svg', url: 'https://www.iek.ru/' },
    { id: 'CHINT', logo: '/manufacturers/chint/brand/logo.svg', url: 'https://ensmas.ru/' },
    { id: 'Systeme Electric', logo: '/manufacturers/systeme electric/brand/logo-main.d552ca3.svg', url: 'https://systeme.ru/' }
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
    setSelectedChintFolder(null)
  }

  const closeManufacturerModal = () => {
    setIsManufacturerOpen(false)
    setSelectedManufacturer(null)
    setSelectedChintFolder(null)
  }

  const closeManufacturerDetailModal = () => {
    setSelectedManufacturer(null)
    setSelectedChintFolder(null)
  }

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
          {tokens.map((token) => (
            <div key={token.id} className={`token ${selectedToken === token.id ? 'token-active' : ''}`} onClick={() => handleTokenClick(token.id)}>
              <div className="token-icon">{token.icon}</div>
              <div className="token-label">{token.id}</div>
              {selectedToken === token.id && <div className="token-popup">Выбрана папка: {token.id}</div>}
            </div>
          ))}
        </div>
      </main>

      <nav className="bottom-nav">
        <div className="nav-item nav-active"><span className="nav-icon">🏠</span><span className="nav-label">Главная</span></div>
        <div className="nav-item"><span className="nav-icon">⭐</span><span className="nav-label">Избранное</span></div>
        <div className="nav-item"><span className="nav-icon">👤</span><span className="nav-label">Профиль</span></div>
      </nav>

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
                  <div key={manufacturer.id} className="manufacturer-item" onClick={() => handleManufacturerClick(manufacturer.id)}>
                    <img src={manufacturer.logo} alt={manufacturer.id} className="manufacturer-logo" />
                    <div className="manufacturer-name">{manufacturer.id}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedManufacturer && (
        <div className="modal-overlay" onClick={closeManufacturerDetailModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{selectedManufacturer}</h2>
              <button className="modal-close" onClick={closeManufacturerDetailModal}>✕</button>
            </div>
            <div className="modal-body">
              {selectedManufacturer === 'CHINT' && selectedChintFolder ? (
                <div className="manufacturer-detail">
                  <h3 className="manufacturer-detail-name">{selectedChintFolder}</h3>
                </div>
              ) : (
                <div className="manufacturer-detail">
                  <img src={manufacturers.find(m => m.id === selectedManufacturer)?.logo} alt={selectedManufacturer} className="manufacturer-detail-logo" />
                  <h3 className="manufacturer-detail-name">{selectedManufacturer}</h3>
                  <a href={manufacturers.find(m => m.id === selectedManufacturer)?.url} target="_blank" rel="noopener noreferrer" className="manufacturer-link" onClick={(e) => e.stopPropagation()}>
                    {manufacturers.find(m => m.id === selectedManufacturer)?.url}
                  </a>

                  {selectedManufacturer === 'CHINT' && (
                    <div className="manufacturer-folders">
                      <button className="manufacturer-folder-button" onClick={() => setSelectedChintFolder('Серия')}>
                        Серия
                      </button>
                      <button className="manufacturer-folder-button" onClick={() => setSelectedChintFolder('Каталог')}>
                        Каталог
                      </button>
                      <a href="https://ensmas.ru/" target="_blank" rel="noopener noreferrer" className="manufacturer-folder-link" onClick={(e) => e.stopPropagation()}>
                        Официальный сайт производителя
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App