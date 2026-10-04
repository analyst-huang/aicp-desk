import { listenGui } from '../lib/gui-server.mjs';

// Static assets are real; tests intercept every API request in the browser.
// Unexpected requests fail locally, without constructing a real cloud session.
const server = await listenGui({ config: { guiPort: 18765 } });
process.on('SIGTERM', () => server.close().then(() => process.exit()));
process.on('SIGINT', () => server.close().then(() => process.exit()));
