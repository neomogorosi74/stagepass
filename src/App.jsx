import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home'
import Login from './pages/Login'
import StagePassAdmin from './pages/StagePassAdmin'

function ProtectedRoute({ children }) {
  const authed = sessionStorage.getItem('stagepass.admin') === 'granted' && sessionStorage.getItem('stagepass.admin.token')
  if (!authed) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (

    <div className="app-layout">
      <div className="app-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={
            <ProtectedRoute>
              <StagePassAdmin />
            </ProtectedRoute>
          } />
        </Routes>
      </div>
    </div>
  )
}
