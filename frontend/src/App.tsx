/* ============================================================
   src/App.tsx
   Application entry point.
   Owns the theme lifecycle and renders the AppLayout shell.
   All navigation state lives inside AppLayout.
   ============================================================ */

import { useTheme } from './hooks/useTheme'
import { AppLayout } from './components/layout/AppLayout'

function App() {
  const { theme, toggleTheme } = useTheme()
  return <AppLayout theme={theme} toggleTheme={toggleTheme} />
}

export default App
