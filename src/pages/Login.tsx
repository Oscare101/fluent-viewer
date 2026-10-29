import { useState, type FormEvent } from 'react'
import { checkToken } from '../github'
import { OWNER, REPO } from '../config'

export default function Login({ message, onLogin }: { message: string | null; onLogin: (token: string) => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const t = token.trim()
    if (!t) return
    setBusy(true)
    setError(null)
    try {
      await checkToken(t)
      onLogin(t)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <h1>Fluent Data Hub</h1>
      <p className="muted">
        Дані лежать у приватному репозиторії <code>{OWNER}/{REPO}</code>. Введи fine-grained токен GitHub з доступом
        <b> Contents: Read-only</b> до цього репозиторію. Токен зберігається лише в цьому браузері.
      </p>
      {message && <p className="warn">{message}</p>}
      <form onSubmit={submit}>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="github_pat_…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button type="submit" disabled={busy || !token.trim()}>
          {busy ? 'Перевіряю…' : 'Увійти'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
