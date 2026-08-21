import { useState } from 'react'
import { OpenGeometryCadScene } from './OpenGeometryCadScene'
import './OpenGeometryConfigurator.css'

const WIDTH_OPTIONS = [300, 400, 500, 600, 800, 1000, 1200, 1400, 1600]
const DEPTH_OPTIONS = [300, 400, 500, 600, 800, 1000, 1200]

const DEFAULTS = {
  width: 800,
  height: 600,
  depth: 300,
  railCount: 4,
  plinthHeight: 100,
}

export function OpenGeometryConfigurator({ onClose }: { onClose: () => void }) {
  const [width, setWidth] = useState(DEFAULTS.width)
  const [height, setHeight] = useState(DEFAULTS.height)
  const [depth, setDepth] = useState(DEFAULTS.depth)
  const [railCount, setRailCount] = useState(DEFAULTS.railCount)
  const [plinthHeight, setPlinthHeight] = useState(DEFAULTS.plinthHeight)
  const [createdConfig, setCreatedConfig] = useState(DEFAULTS)

  const handleCreate = () => {
    setCreatedConfig({ width, height, depth, railCount, plinthHeight })
  }

  return (
    <div className="og-configurator-overlay">
      <div className="og-configurator">
        <header className="og-configurator-header">
          <div>
            <div className="og-configurator-kicker">Engineering Hub / Сборка щитов</div>
            <h2>Конфигуратор НКУ — OpenGeometry</h2>
            <p>Выберите параметры корпуса и нажмите «Создать»</p>
          </div>
          <button className="og-configurator-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </header>

        <div className="og-configurator-body">
          <aside className="og-configurator-panel">
            <section>
              <h3>Корпус</h3>
              <label>
                Ширина, мм
                <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
                  {WIDTH_OPTIONS.map((value) => <option key={value} value={value}>{value} мм</option>)}
                </select>
              </label>
              <label>
                Высота, мм
                <input type="number" min="200" max="2500" step="10" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
              </label>
              <label>
                Глубина, мм
                <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                  {DEPTH_OPTIONS.map((value) => <option key={value} value={value}>{value} мм</option>)}
                </select>
              </label>
            </section>

            <section>
              <h3>Монтаж</h3>
              <label>
                DIN-рейки
                <input type="number" min="1" max="10" step="1" value={railCount} onChange={(e) => setRailCount(Number(e.target.value))} />
              </label>
            </section>

            <section>
              <h3>Цоколь</h3>
              <label>
                Высота цоколя
                <select value={plinthHeight} onChange={(e) => setPlinthHeight(Number(e.target.value))}>
                  <option value={100}>100 мм</option>
                  <option value={200}>200 мм</option>
                </select>
              </label>
            </section>

            <button className="og-configurator-create" type="button" onClick={handleCreate}>
              Создать
            </button>

            <section className="og-configurator-status">
              <div><span>CAD</span><strong>OpenGeometry</strong></div>
              <div><span>Runtime</span><strong>Rust + WebAssembly</strong></div>
              <div><span>Режим</span><strong>Формирование модели</strong></div>
            </section>
          </aside>

          <main className="og-configurator-view">
            <OpenGeometryCadScene
              width={createdConfig.width}
              height={createdConfig.height}
              depth={createdConfig.depth}
              railCount={createdConfig.railCount}
              plinthHeight={createdConfig.plinthHeight}
            />
            <div className="og-cad-hint">Выберите параметры и нажмите «Создать» · ЛКМ — вращение · колёсико — масштаб · ПКМ — панорамирование</div>
          </main>
        </div>
      </div>
    </div>
  )
}
