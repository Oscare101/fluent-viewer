import { useEffect, useState } from 'react'
import { AuthError } from './github'

export type Route = { page: 'list' } | { page: 'run'; id: string }

function parse(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''))
  return h.startsWith('run/') ? { page: 'run', id: h.slice(4) } : { page: 'list' }
}

export function useRoute(): Route {
  const [r, setR] = useState(parse)
  useEffect(() => {
    const f = () => {
      setR(parse())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return r
}

/** Асинхронне завантаження; AuthError віддаємо нагору (вихід на екран токена). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], onAuth: (e: AuthError) => void) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (e: unknown) => {
        if (!alive) return
        if (e instanceof AuthError) onAuth(e)
        setState({ error: e instanceof Error ? e.message : String(e), loading: false })
      },
    )
    return () => {
      alive = false
    }
  }, deps) // fn навмисно не в залежностях: перезавантаження керується deps
  return state
}
