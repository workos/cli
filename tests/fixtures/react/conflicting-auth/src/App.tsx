import { Routes, Route, Link } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { Home } from './pages/Home';
import { About } from './pages/About';
import { Dashboard } from './pages/Dashboard';

function App() {
  const { isAuthenticated, user, logout } = useAuth();

  return (
    <div>
      <nav>
        <Link to="/">Home</Link> | <Link to="/about">About</Link> | <Link to="/dashboard">Dashboard</Link>
        {isAuthenticated && (
          <>
            {' '}
            | <span>Welcome, {user?.name}</span> |{' '}
            <button onClick={() => logout()}>Logout</button>
          </>
        )}
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </div>
  );
}

export default App;
