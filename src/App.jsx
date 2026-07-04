import { Routes, Route } from 'react-router-dom'
import StagePassFlow from './pages/StagePassFlow.jsx'
import StagePassAdmin from './pages/StagePassAdmin.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StagePassFlow />} />
      <Route path="/admin" element={<StagePassAdmin />} />
    </Routes>
  )
}
