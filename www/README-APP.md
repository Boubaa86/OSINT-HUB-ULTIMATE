# Android WebView bundle

This directory is a static bundle intended for an Android WebView wrapper such as AppMint.

- Start page: `index.html`
- Assets: `styles.css`, `app.js`
- The bundle uses same-origin relative API paths. For a packaged offline WebView, configure the application wrapper to load the hosted Render URL or configure an explicit HTTPS API base URL before using server-backed features.
- Do not place provider API keys in this directory.
