import { useCallback, useEffect, useMemo, useState } from 'react'
import { AuthError, Repo } from './github'
import { clearToken, loadToken, saveToken } from './storage'
import { useRoute } from './hooks'
import Login from './pages/Login'
import RunList from './pages/RunList'
import RunPage from './pages/RunPage'

export default function App() {
  const [token, setToken] = useState(loadToken)
  const [authMsg, setAuthMsg] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const repo = useMemo(() => (token ? new Repo(token) : null), [token])
  const route = useRoute()

  const onAuth = useCallback((e: AuthError) => {
    clearToken()
    setToken(null)
    setAuthMsg(e.message)
  }, [])

  const refresh = useCallback(() => {
    if (!repo) return
    setRefreshing(true)
    repo
      .files(true)
      .then(() => setVersion((v) => v + 1))
      .catch((e) => e instanceof AuthError && onAuth(e))
      .finally(() => setRefreshing(false))
  }, [repo, onAuth])

  // Повернулись на вкладку через хвилину+ — перечитати дерево репо (нові розрахунки з'являться самі).
  useEffect(() => {
    if (!repo) return
    const f = () => document.visibilityState === 'visible' && repo.ageMs() > 60_000 && refresh()
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [repo, refresh])

  if (!repo) {
    return (
      <Login
        message={authMsg}
        onLogin={(t) => {
          const stored = saveToken(t)
          setAuthMsg(stored ? null : 'Браузер не дозволяє зберегти токен — доведеться вводити знову після закриття вкладки.')
          setToken(t)
        }}
      />
    )
  }

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#/">
          Fluent Data Hub
        </a>
        <div className="top-actions">
          <button className="ghost" onClick={refresh} disabled={refreshing} title="Перечитати репозиторій">
            {refreshing ? 'Оновлюю…' : 'Оновити'}
          </button>
          <button
            className="ghost"
            onClick={() => {
              if (confirm('Вийти? Токен буде видалено з цього браузера.')) {
                clearToken()
                setToken(null)
              }
            }}
          >
            Вийти
          </button>
        </div>
      </header>
      {authMsg && <p className="note">{authMsg}</p>}
      <main>
        {route.page === 'run' ? (
          <RunPage key={route.id} repo={repo} id={route.id} version={version} onAuth={onAuth} />
        ) : (
          <RunList repo={repo} version={version} onAuth={onAuth} />
        )}
      </main>
    </div>
  )
}
