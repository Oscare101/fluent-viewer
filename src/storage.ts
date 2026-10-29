// Токен зберігається лише в браузері цього пристрою. Якщо localStorage недоступний (приватне вікно,
// заблоковані дані сайту) — токен живе до закриття вкладки.
const KEY = 'fdh.token'
let memory: string | null = null

export function loadToken(): string | null {
  try {
    return localStorage.getItem(KEY) ?? memory
  } catch {
    return memory
  }
}

export function saveToken(token: string): boolean {
  memory = token
  try {
    localStorage.setItem(KEY, token)
    return true
  } catch {
    return false
  }
}

export function clearToken(): void {
  memory = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* немає доступу — нічого не зберігалось */
  }
}
