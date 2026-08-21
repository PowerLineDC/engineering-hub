import { useState } from 'react'
import { OpenGeometryCadScene } from './OpenGeometryCadScene'
import './OpenGeometryConfigurator.css'

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

  return (
    <div className="og-configurator-overlay">
      <div className="og-configurator">
        <header className="og-configurator-header">
          <div>
            <div className="og-configurator-kicker">Engineering Hub / Сборка щитов</div>
            <h2>Конфигуратор НКУ — OpenGeometry</h2>
            <p>Параллельный прототип для сравнения CAD-ядра</p>
          </div>
          <button className="og-configurator-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </header>

        <div className="og-configurator-body">
          <aside className="og-configurator-panel">
            <section>
              <h3>Корпус</h3>
              <label>
                Ширина, мм
                <input type="number" min="200" max="2000" step="10" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
              </label>
              <label>
                Высота, мм
                <input type="number" min="200" max="2500" step="10" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
              </label>
              <label>
                Глубина, мм
                <input type="number" min="100" max="1200" step="10" value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
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
              <div className="og-configurator-status">
                <div><span>Артикул</span><strong>{plinthHeight === 100 ? 'R5NBP01B' : 'R5NBP02B'}</strong></div>
              </div>
            </section>

            <section className="og-configurator-status">
              <div><span>CAD</span><strong>OpenGeometry</strong></div>
              <div><span>Runtime</span><strong>Rust + WebAssembly</strong></div>
              <div><span>Режим</span><strong>Параметрический тест</strong></div>
            </section>
          </aside>

          <main className="og-configurator-view">
            <OpenGeometryCadScene
              width={width}
              height={height}
              depth={depth}
              railCount={railCount}
              plinthHeight={plinthHeight}
            />
            <div className="og-cad-hint">Тест OpenGeometry · ЛКМ — вращение · колёсико — масштаб · ПКМ — панорамирование</div>
          </main>
        </div>
      </div>
    </div>
  )
}
