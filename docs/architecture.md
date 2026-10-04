# Architecture

AICP Desk is a Node.js ESM application with two adapters: the CLI and a loopback HTTP/GUI server. Runtime distribution remains dependency-free; developer test tools are not part of the installed application.

## Business boundary

`createContext(overrides)` is the composition root. Tests inject cloud, browser, template, configuration and clock dependencies there. CLI and HTTP handlers call business services, never cloud or browser adapters directly. `AicpService` keeps the original method names as a compatibility facade over the developers, training, capacity, images, identity, templates and creation services. Session and settings use cases have their own services.

Creation has two steps: `prepareCreate` merges input, validates it and returns a deeply frozen snapshot; `executeCreate` submits a copy of that snapshot. Confirmation belongs to the entry point. Cancellation and dry-run never call execution. Live availability checks use read-only cloud lookups in the creation domain; the adapter converts platform identifiers and submits the operation. Templates are only written through an explicit save operation.

GraphQL documents live under `lib/cloud/operations`, grouped by resource. `lib/cloud/api.mjs` contains the primitive Ksyun request adapter, including platform pagination and protocol field mapping. `CatalogService` combines these reads into create options, image options and GPU snapshots. Image-save validation belongs to `ImagesService`. `lib/api.mjs` retains the original `AicpApi` interface by delegating aggregate calls to these services. The application uses the primitive adapter directly.

Services receive named method ports and callbacks, never the complete service registry. The composition facade retains support for older aggregate-only adapters; compatibility selection stays at that boundary. The original operations module re-exports every constant. Cloud response field names, public commands, HTTP routes, template format and installation locations remain unchanged.

## Tests and changes

Run `npm test`, `npm run check:types` and `npm run test:browser` before committing. Unit and HTTP tests use fake cloud adapters and temporary storage, never real cloud mutations or a user's browser profile. The HTTP server can be created unbound or started on port 0, and explicitly closed afterward. The CI matrix retains Windows, macOS and Linux installation smoke tests.

`tsconfig.check.json` incrementally checks JSDoc contracts, error serialization, the browser request client and pure form models. Known create fields have concrete types; unknown platform extensions remain `unknown`, and prepared snapshots are discriminated by resource kind. Add a module to this check as its interface is specified. TypeScript is a pinned development dependency and emits no runtime code.

To add a capability, add its platform operation and adapter method, put validation and orchestration in the owning business service, then expose a thin CLI/HTTP handler and add behavior tests. Keep new business logic out of transport and rendering code. Compatibility facades can remain while callers migrate.

Local JSON read/modify/write operations are serialized per path within one process. Cross-process login recovery additionally uses the existing recovery lock; the JSON write queue is not a replacement for that lock.

## Browser interface

`web/app.js` only mounts the application. The composition module constructs feature controllers for each page, form and dialog. A controller owns its local state and event bindings; the shared application state contains only configuration, session, token and navigation. Cross-feature calls are wired at composition time instead of relying on globals or circular imports. Shared request, notification, repeater and polling helpers live in `web/core`.

Controllers expose operations, not mutable state. Template snapshots are copied on read/write. The create dialog coordinates loading, confirmation and submission through two form ports. Each form owns its DOM, selectors, option cache and events; `web/models/dev-form.js` and `train-form.js` provide pure defaults, `fromVariables` and `toVariables` conversions. Conversion copies its inputs, preserves unknown advanced fields and additional training roles, and removes incompatible known fields when modes change. To add an editable field, update its model conversion, owning form and round-trip test, then add a browser test when interaction is involved.

HTTP errors keep the original status and `error` string. The serializer allowlists optional `code` and `requiresUserAction`; the browser's `ApiError` retains them and the HTTP status. Neither error serialization nor the request client retries a write, and private exception fields are not sent to the browser.

Event listeners share an abort signal. Disposal clears polling and invalidates pending responses. Dialog and resource request generations prevent a stale response from overwriting a newly opened view. Requests operate on the original HTTP contract, and the static server only exposes the UI asset directories.

Install developer dependencies with `npm ci`, install Chromium with `npx playwright install chromium`, and run `npm run test:browser`. Tests use real UI assets with intercepted API fixtures. On a machine with Edge, set `AICP_TEST_BROWSER=msedge` to reuse its executable with an isolated temporary test profile. The CI matrix runs Chromium. No real account, browser profile or cloud writes are involved.

## Browser and authentication infrastructure

`BrowserSession` is a stable facade over browser runtime/CDP, authentication recovery, GraphQL transport and Grafana reading. Components receive explicit method ports instead of the session object. Runtime owns process/lease state; authentication owns the recovery promise, generation and login-state path. Authentication coordinates interactive login through runtime, while GraphQL receives separate runtime and authentication ports. Facade method overrides and legacy state accessors forward to their owning components for integration compatibility. Paths, clock, sleep, CDP connection, process launcher, platform/environment and local browser requests can be supplied through its constructor; the application composition root accepts these as `browserOptions`.

The runtime owns reference-counted browser leases: concurrent work shares a launch, and only a browser created for that work is closed. Authentication owns identity checks, recovery cooldown and diagnostics. The existing cross-process recovery lock and saved-info reader retain their behavior. GraphQL transport validates identity before dispatch, retries a confirmed read at most once after recovery, and never replays a mutation whose result is uncertain. Keep these rules covered when changing either layer.

CDP closes idempotently. Disconnects, socket errors, malformed messages and failed sends settle pending requests and cancel their timers; a single request timeout does not cancel unrelated requests. Connection establishment also closes failed sockets. Tests use simulated sockets and injected launchers to exercise these paths, Linux launch settings and profile retention without starting a real login browser. UI and browser feature regressions should assert behavior rather than search implementation text; static HTML invariants and unchanged legacy distribution checks remain separate.
