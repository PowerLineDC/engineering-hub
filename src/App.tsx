import { useEffect, useState } from 'react'
import './App.css'

type EstimateItem = { id: string; name: string; image: string; url: string }
type SavedEstimate = { quantity: string | number; updatedAt?: string }

const ros301: EstimateItem = {
  id: '278',
  name: '278',
  image: 'https://www.techsteklo.ru/assets/images/products/1685/ros-301.jpg',
  url: 'https://rizur.ru/catalog/prochie-pribory/signalizator-ros-301/',
}

const API_URL = '/api/estimate'

function App() {
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const [isManufacturerOpen, setIsManufacturerOpen] = useState(false)
  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null)
  const [selectedChintFolder, setSelectedChintFolder] = useState<string | null>(null)
  const [isEstimateOpen, setIsEstimateOpen] = useState(false)
  const [isRasskazkaOpen, setIsRasskazkaOpen] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [saveStatus, setSaveStatus] = useState('')

  useEffect(() => {
    fetch(API_URL)
      .then((response) => response.json())
      .then((data: Record<string, SavedEstimate>) => {
        if (data[ros301.id]) setQuantity(String(data[ros301.id].quantity ?? ''))
      })
      .catch(() => setSaveStatus('Сервер недоступен'))
  }, [])

  const tokens = [{ id: 'Производители', icon: '🏭' }, { id: 'Автоматизация', icon: '🤖' }, { id: 'СМИ', icon: '📺' }, { id: 'Проектирование', icon: '📐' }, { id: 'Строительство', icon: '🏗️' }, { id: 'ПО', icon: '💻' }, { id: 'Где купить', icon: '🛒' }, { id: 'Документация', icon: '📄' }, { id: 'Нормативы', icon: '📋' }, { id: 'Новости', icon: '📰' }, { id: 'Сотрудничество', icon: '🤝' }, { id: 'Выставки', icon: '🎪' }, { id: 'Ассоциации', icon: '🏛️' }, { id: 'Сборка щитов', icon: '⚡' }, { id: 'Смета', icon: '🧾' }]
  const manufacturers = [
    { id: 'DKC', logo: '/manufacturers/dkc/brand/dkc_logo_2020_new.svg', url: 'https://www.dkc.ru/ru/' },
    { id: 'EKF', logo: '/manufacturers/ekf/brand/logo-ekf-white.svg', url: 'https://ekfgroup.com/ru' },
    { id: 'IEK', logo: '/manufacturers/iek/brand/logo.svg', url: 'https://www.iek.ru/' },
    { id: 'CHINT', logo: '/manufacturers/chint/brand/logo.svg', url: 'https://ensmas.ru/' },
    { id: 'Systeme Electric', logo: '/manufacturers/systeme electric/brand/logo-main.d552ca3.svg', url: 'https://systeme.ru/' }
  ]
  const chintCatalogFolders = [
    { name: 'модульные аппараты распределения электроэнергии', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_raspredeleniya_elektroenergii/' },
    { name: 'модульные аппараты дифференциальной защиты', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_differentsialnoy_zashchity/' },
    { name: 'модульные аппараты сигнализации и управления', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/modulnye_apparaty_signalizatsii_i_upravleniya/' },
    { name: 'силовые аппараты распределения электроэнергии', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/silovye_apparaty_raspredeleniya_elektroenergii/' },
    { name: 'оборудование для автоматического ввода резерва', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/oborudovanie_dlya_avtomaticheskogo_vvoda_rezerva/' },
    { name: 'оборудование для защиты и управления двигателем', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/oborudovanie_dlya_zashchity_i_upravleniya_dvigatelem/' },
    { name: 'оборудование сигнализации и управления', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/oborudovanie_signalizatsii_i_upravleniya_/' },
    { name: 'измерительные приборы', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/izmeritelnye_pribory/' },
    { name: 'оборудование для компенсации реактивной мощности', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/oborudovanie_dlya_kompensatsii_reaktivnoy_moshchnosti/' },
    { name: 'шкафы и аксессуары', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/shkafy_i_aksessuary/' },
    { name: 'ретрофит решения низкого напряжения', url: 'https://ensmas.ru/catalog/oborudovanie_nizkogo_napryazheniya/retrofit_resheniya_nizkogo_napryazheniya/' }
  ]
  const handleTokenClick = (token: string) => {
    if (token === 'Производители') { setIsManufacturerOpen(true); setSelectedToken(null); return }
    if (token === 'Смета') { setIsEstimateOpen(true); setSelectedToken(null); return }
    setSelectedToken(token); setTimeout(() => setSelectedToken(null), 2000)
  }
  const handleManufacturerClick = (manufacturer: string) => { setSelectedManufacturer(manufacturer); setSelectedChintFolder(null) }
  const closeManufacturerModal = () => { setIsManufacturerOpen(false); setSelectedManufacturer(null); setSelectedChintFolder(null) }
  const closeManufacturerDetailModal = () => { setSelectedManufacturer(null); setSelectedChintFolder(null) }
  const closeEstimateModal = () => setIsEstimateOpen(false)
  const closeRasskazkaModal = () => setIsRasskazkaOpen(false)
  const saveQuantity = async () => {
    setSaveStatus('Сохранение...')
    try {
      const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ros301.id, quantity }) })
      if (!response.ok) throw new Error()
      setSaveStatus('Сохранено')
    } catch {
      setSaveStatus('Ошибка сохранения')
    }
  }

  return (
    <div className="app-container">
      <header className="header"><div className="header-top"><h1 className="logo">Engineering Hub</h1><button className="auth-btn">Войти</button></div><div className="search-container"><input type="text" className="search-input" placeholder="Поиск..." /><span className="search-icon">🔍</span></div></header>
      <main className="tokens-container"><div className="tokens-grid">{tokens.map((token) => <div key={token.id} className={`token ${selectedToken === token.id ? 'token-active' : ''}`} onClick={() => handleTokenClick(token.id)}><div className="token-icon">{token.icon}</div><div className="token-label">{token.id}</div>{selectedToken === token.id && <div className="token-popup">Выбрана папка: {token.id}</div>}</div>)}</div></main>
      <nav className="bottom-nav"><div className="nav-item nav-active"><span className="nav-icon">🏠</span><span className="nav-label">Главная</span></div><div className="nav-item"><span className="nav-icon">⭐</span><span className="nav-label">Избранное</span></div><div className="nav-item"><span className="nav-icon">👤</span><span className="nav-label">Профиль</span></div></nav>
      {isEstimateOpen && <div className="modal-overlay" onClick={closeEstimateModal}><div className="modal-content" onClick={(e) => e.stopPropagation()}><div className="modal-header"><h2 className="modal-title">Смета</h2><button className="modal-close" onClick={closeEstimateModal}>✕</button></div><div className="modal-body"><div className="manufacturer-folders"><button className="manufacturer-folder-button" onClick={() => { setIsEstimateOpen(false); setIsRasskazkaOpen(true) }}>Рассказовка</button></div></div></div></div>}
      {isRasskazkaOpen && <div className="modal-overlay" onClick={closeRasskazkaModal}><div className="modal-content estimate-console" onClick={(e) => e.stopPropagation()}><div className="modal-header"><h2 className="modal-title">Рассказовка</h2><button className="modal-close" onClick={closeRasskazkaModal}>✕</button></div><div className="modal-body"><div className="estimate-item"><div className="estimate-image-column"><img src={ros301.image} alt="Сигнализатор уровня РОС-301" className="estimate-product-image" /><a href={ros301.url} target="_blank" rel="noopener noreferrer" className="estimate-shop-link">Сайт магазина</a></div><div className="estimate-product-info"><div className="estimate-product-name">{ros301.name}</div><input type="number" min="0" value={quantity} onChange={(e) => { setQuantity(e.target.value); setSaveStatus('') }} className="estimate-quantity" /><button className="estimate-save-button" onClick={saveQuantity}>Сохранить</button>{saveStatus && <div className="estimate-save-status">{saveStatus}</div>}</div></div></div></div></div>}
      {isManufacturerOpen && <div className="modal-overlay" onClick={closeManufacturerModal}><div className="modal-content" onClick={(e) => e.stopPropagation()}><div className="modal-header"><h2 className="modal-title">Производители</h2><button className="modal-close" onClick={closeManufacturerModal}>✕</button></div><div className="modal-body"><div className="manufacturers-grid">{manufacturers.map((manufacturer) => <div key={manufacturer.id} className="manufacturer-item" onClick={() => handleManufacturerClick(manufacturer.id)}><img src={manufacturer.logo} alt={manufacturer.id} className="manufacturer-logo" /><div className="manufacturer-name">{manufacturer.id}</div></div>)}</div></div></div></div>}
      {selectedManufacturer && <div className="modal-overlay" onClick={closeManufacturerDetailModal}><div className="modal-content" onClick={(e) => e.stopPropagation()}><div className="modal-header"><h2 className="modal-title">{selectedManufacturer}</h2><button className="modal-close" onClick={closeManufacturerDetailModal}>✕</button></div><div className="modal-body">
        {selectedManufacturer === 'CHINT' && selectedChintFolder ? <div className="manufacturer-detail"><h3 className="manufacturer-detail-name">{selectedChintFolder}</h3>{selectedChintFolder === 'Каталог' && <div className="chint-catalog-grid">{chintCatalogFolders.map((folder) => <div key={folder.name} className="manufacturer-catalog-item"><button className="manufacturer-folder-button">{folder.name}</button><a href={folder.url} target="_blank" rel="noopener noreferrer" className="manufacturer-folder-link">{folder.url}</a></div>)}</div>}</div> : <div className="manufacturer-detail"><img src={manufacturers.find(m => m.id === selectedManufacturer)?.logo} alt={selectedManufacturer} className="manufacturer-detail-logo" /><h3 className="manufacturer-detail-name">{selectedManufacturer}</h3><a href={manufacturers.find(m => m.id === selectedManufacturer)?.url} target="_blank" rel="noopener noreferrer" className="manufacturer-link" onClick={(e) => e.stopPropagation()}>{manufacturers.find(m => m.id === selectedManufacturer)?.url}</a>{selectedManufacturer === 'CHINT' && <div className="manufacturer-folders"><button className="manufacturer-folder-button" onClick={() => setSelectedChintFolder('Серия')}>Серия</button><button className="manufacturer-folder-button" onClick={() => setSelectedChintFolder('Каталог')}>Каталог</button><a href="https://ensmas.ru/catalog/" target="_blank" rel="noopener noreferrer" className="manufacturer-folder-link" onClick={(e) => e.stopPropagation()}>https://ensmas.ru/catalog/</a></div>}</div>}
      </div></div></div>}
    </div>
  )
}
export default App
