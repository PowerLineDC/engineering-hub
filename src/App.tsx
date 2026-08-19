import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div style={{ padding: '24px', color: '#fff', background: '#101010', minHeight: '100vh' }}>
      <button onClick={() => setCount(count + 1)}>
        useState работает: {count}
      </button>
    </div>
  )
}

export default App
