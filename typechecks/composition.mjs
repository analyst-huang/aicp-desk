// @ts-check
// Compile-only assertions: these functions are never called and need no cloud access.
import { methodPort } from '../lib/ports.mjs';
import { BrowserSession } from '../lib/browser.mjs';
import { AicpService } from '../lib/service.mjs';
import { GraphqlTransport } from '../lib/browser/graphql.mjs';
/** @param {ConstructorParameters<typeof GraphqlTransport>[0]['runtime']} runtime */
const acceptRuntime = runtime => runtime;
/** @param {BrowserSession} browser @param {AicpService} service */
export function checkComposition(browser, service) {
  const port = methodPort(browser, ['graphql', 'targets']);
  port.graphql('List', 'query List { ok }', {});
  // @ts-expect-error Misspelled ports must fail at build time.
  methodPort(browser, ['graphQl']);
  // @ts-expect-error Ports expose only their selected methods.
  port.clearSession();
  // @ts-expect-error Resource kinds are checked at the business entry point.
  service.prepareCreate('unknown', {});
  // @ts-expect-error Browser dependencies must keep their signatures.
  new BrowserSession({ region: 'test' }, { now: () => 'wrong' });
  acceptRuntime(methodPort(browser.runtimeAdapter, ['evaluate', 'withBrowser']));
  // @ts-expect-error Transport requires the browser lease as well as evaluate.
  acceptRuntime(methodPort(browser.runtimeAdapter, ['evaluate']));
}
