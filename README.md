# Local AI Extension

This project builds a Chrome extension into `dist/`.

## Load in Chrome

1. Run `npm install` if dependencies are not installed.
2. Run `npm run build`.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click **Load unpacked**.
6. Select this folder:

```text
/home/lau/Code/Personal/summarizer-extension/dist
```

Do not select the repository root. The source manifest lives in `src/manifest.json`, and Chrome needs the bundled extension output in `dist/`.

## Usage

- Click the extension icon to open Local AI inside the active webpage.
- Right-click a page or selection for assistant shortcuts.
- Open the extension options page for API status and settings.
