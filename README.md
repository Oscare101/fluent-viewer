# fluent-viewer

Сайт для перегляду розрахунків Fluent з приватного репозиторію `fluent-data`. Публікується на GitHub Pages
автоматично при кожному push у `main` (`.github/workflows/deploy.yml`).

**Тут немає жодних даних і секретів.** Сайт читає `fluent-data` через GitHub REST API з fine-grained токеном
(Contents: Read-only лише до `fluent-data`), який кожен пристрій вводить один раз; токен зберігається тільки в браузері.
Content-Security-Policy дозволяє сторінці звертатися лише до `api.github.com`.

## Як працює
- Одне звернення до Git Trees API дає всі шляхи й sha файлів репо; список розрахунків — з `index.json`
  (генерує `py hub.py` у `fluent-data`). Нові розрахунки з'являються після push без перезбирання сайту
  (кнопка «Оновити» або повернення на вкладку).
- Файли качаються за sha (Git Blobs API) і кешуються в IndexedDB: незмінений файл повторно не завантажується.

## Розробка
```
npm install
npm run dev      # http://localhost:5173/fluent-viewer/
npm run build    # перевірка типів + збірка в dist/
```
Звідки читати дані — `src/config.ts`. Формати `index.json` і `preview/` — `src/types.ts` і `fluent-data/README.md`.
