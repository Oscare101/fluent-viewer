// Читання приватного репозиторію fluent-data через GitHub REST API.
// Дерево репо (усі шляхи + sha) — один запит; файли — за sha через Git Blobs API, з кешем у IndexedDB.
import { BRANCH, OWNER, REPO } from './config'
import { cacheGet, cachePut } from './cache'

export class AuthError extends Error {}

export interface TreeEntry {
  path: string
  sha: string
  size: number
}

const API = `https://api.github.com/repos/${OWNER}/${REPO}`

async function call(token: string, url: string, accept: string, fresh = false): Promise<Response> {
  let r: Response
  try {
    r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
      cache: fresh ? 'no-cache' : 'default',
    })
  } catch {
    throw new Error('Немає зв’язку з GitHub. Перевір інтернет.')
  }
  if (r.status === 401) throw new AuthError('Токен недійсний або прострочений.')
  if (r.status === 404 || r.status === 403) {
    const left = r.headers.get('x-ratelimit-remaining')
    if (r.status === 403 && left === '0') throw new Error('Вичерпано ліміт запитів GitHub, спробуй за годину.')
    throw new AuthError(`Токен не має доступу до ${OWNER}/${REPO} (потрібно Contents: Read-only).`)
  }
  if (!r.ok) throw new Error(`GitHub відповів ${r.status}`)
  return r
}

export async function checkToken(token: string): Promise<void> {
  await call(token, API, 'application/vnd.github+json', true)
}

export class Repo {
  private tree: Promise<Map<string, TreeEntry>> | null = null
  private loadedAt = 0
  constructor(readonly token: string) {}

  /** Дерево репо; force — перечитати (нові push). */
  files(force = false): Promise<Map<string, TreeEntry>> {
    if (!this.tree || force) {
      this.loadedAt = Date.now()
      this.tree = call(this.token, `${API}/git/trees/${BRANCH}?recursive=1`, 'application/vnd.github+json', true)
        .then((r) => r.json())
        .then((j: { tree: { path: string; sha: string; size?: number; type: string }[] }) => {
          const m = new Map<string, TreeEntry>()
          for (const e of j.tree) if (e.type === 'blob') m.set(e.path, { path: e.path, sha: e.sha, size: e.size ?? 0 })
          return m
        })
      this.tree.catch(() => (this.tree = null))
    }
    return this.tree
  }

  ageMs(): number {
    return Date.now() - this.loadedAt
  }

  async buffer(path: string): Promise<ArrayBuffer> {
    const e = (await this.files()).get(path)
    if (!e) throw new Error(`Немає файлу ${path}`)
    const hit = await cacheGet(e.sha)
    if (hit) return hit
    const r = await call(this.token, `${API}/git/blobs/${e.sha}`, 'application/vnd.github.raw+json')
    const buf = await r.arrayBuffer()
    void cachePut(e.sha, buf)
    return buf
  }

  async json<T>(path: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.buffer(path))) as T
  }
}

/** Лише для розробки (`npm run dev`, адреса з ?local): файли з локальної ../fluent-data через dev-сервер. */
export class LocalRepo extends Repo {
  private local: Promise<Map<string, TreeEntry>> | null = null
  constructor() {
    super('local')
  }
  files(force = false): Promise<Map<string, TreeEntry>> {
    if (!this.local || force)
      this.local = fetch('/__data/tree')
        .then((r) => r.json())
        .then((l: TreeEntry[]) => new Map(l.map((e) => [e.path, e])))
    return this.local
  }
  ageMs(): number {
    return 0
  }
  async buffer(path: string): Promise<ArrayBuffer> {
    const r = await fetch(`/__data/${path}`)
    if (!r.ok) throw new Error(`Немає файлу ${path}`)
    return r.arrayBuffer()
  }
}
