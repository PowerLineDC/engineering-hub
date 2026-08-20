import { useState } from 'react'
import { CadScene } from './CadScene'
import './Configurator.css'

const DEFAULTS = {
  width: 800,
  height: 600,
  depth: 300,
  railCount: 4,
}

export function Configurator({ onClose }: { onClose: () => void }) {
  const [width, setWidth] = useState(DEFAULTS.width)
  const [height, setHeight] = useState(DEFAULTS.height)
  const [depth, setDepth] = useState(DEFAULTS.depth)
  const [railCount, setRailCount] = useState(DEFAULTS.railCount)

  return (
    <div className="configurator-overlay">
      <div className="configurator">
        <header className="configurator-header">
          <div>
            <div className="configurator-kicker">Engineering Hub / Сборка щитов</div>
            <h2>Конфигуратор НКУ</h2>
            <p>DKC CQE N — первый геометрический прототип</p>
          </div>
          <button className="configurator-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </header>

        <div className="configurator-body">
          <aside className="configurator-panel">
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

            <section className="configurator-status">
              <div><span>CAD</span><strong>Replicad + OpenCascade</strong></div>
              <div><span>Режим</span><strong>Параметрический</strong></div>
              <div><span>Данные</span><strong>Тестовая геометрия</strong></div>
            </section>
          </aside>

          <main className="configurator-view">
            <CadScene width={width} height={height} depth={depth} railCount={railCount} />
            <div className="cad-hint">ЛКМ — вращение · колёсико — масштаб · ПКМ — панорамирование</div>
          </main>
        </div>
      </div>
    </div>
  )
}
