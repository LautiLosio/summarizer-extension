# Local AI Extension

Local AI adds an in-page assistant for asking questions and summarizing webpages with Chrome built-in AI. It runs 100% locally: no API keys, no third-party AI providers, and no page content sent to an external service. Once Chrome's local AI model is available on your device, it can keep working offline.

Install it if you want fast page comprehension without leaving the current tab, pasting text into another app, or sending browsing context away from your computer.

This project builds the extension into `dist/`.

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
- Use **Ask** to ask questions about the current page.
- Use **Summarize** to generate a page summary.
- Open the extension options page for API status and settings.
