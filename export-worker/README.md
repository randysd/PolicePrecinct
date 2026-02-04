# PP App – Newsprint Export Worker

This Worker provides **server-side exports** for the Shift Report newspaper (`#newsprint`).

## Endpoints

- `POST /api/newsprint.png` → returns a PNG screenshot cropped to the `#newsprint` element
- `POST /api/newsprint.pdf` → returns a PDF print of the rendered HTML

## Request body

Send JSON like:

```json
{
  "html": "<!doctype html>..."
}
```

Your client code in `app.js` already builds this HTML by cloning `#newsprint`, inlining computed styles, and converting `<img>` tags to `data:` URLs.

## Deploy

1. `cd export-worker`
2. `npm install`
3. `wrangler deploy`
4. Add a route so your Pages site forwards `/api/*` to this Worker.

Optional: set `EXPORT_KEY` in `wrangler.toml` and send it as an `x-export-key` header from the client.
