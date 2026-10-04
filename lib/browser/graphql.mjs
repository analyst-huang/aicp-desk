import { randomUUID } from 'node:crypto';
import { LoginError, expiredSession } from '../login.mjs';

/** Cloud transport uses independent runtime and authentication ports; it owns no login state. */
export class GraphqlTransport {
  /** @param {{config: import('../contracts.mjs').AppConfig, runtime: Pick<import('./runtime.mjs').BrowserRuntime, 'withBrowser'|'evaluate'>,
   * authentication: Pick<import('./authentication.mjs').SessionAuthentication, 'withAuthentication'|'waitForAicpTarget'|'rememberIdentity'|'fetchCurrentUser'|'recoverLogin'> & {generation: () => number}}} dependencies */
  constructor({ config, runtime, authentication }) { this.config = config; this.runtime = runtime; this.authentication = authentication; }

  async graphql(operationName, query, variables) {
    return this.runtime.withBrowser(async () => {
      // Resolve expiry before sending any cloud operation, especially mutations.
      const generation = this.authentication.generation();
      const target = await this.authentication.withAuthentication(async () => {
        const page = await this.authentication.waitForAicpTarget();
        await this.authentication.rememberIdentity(await this.authentication.fetchCurrentUser(page));
        return page;
      });
      const request = {
        endpoint: this.config.apiEndpoint,
        operationName,
        query,
        variables,
        traceId: randomUUID(),
      };
      const expression = `
        (async () => {
          const request = ${JSON.stringify(request)};
          const response = await fetch(request.endpoint + "?action=" + encodeURIComponent(request.operationName), {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              "x-trace-id": request.traceId
            },
            body: JSON.stringify({
              operationName: request.operationName,
              query: request.query,
              variables: request.variables
            })
          });
          return {
            status: response.status,
            text: await response.text()
          };
        })()
      `;
      try {
        return await this.graphqlResponse(target, expression);
      } catch (error) {
        if (error.code !== "AUTH_EXPIRED") throw error;
        // The server may have partly executed a mutation. Recover the login but
        // never replay writes or a GraphQL document we cannot classify as a query.
        const readOnly = /^\s*(?:#[^\n]*\n\s*)*query\b/.test(query) && !/\b(?:mutation|subscription)\b/.test(query);
        try { await this.authentication.recoverLogin(generation, { force: true }); }
        catch (recoveryError) {
          if (readOnly) throw recoveryError;
          throw new LoginError("OPERATION_NOT_RETRIED", `原写操作未自动重试，请先查询资源状态。会话恢复失败：${recoveryError.message}`, Boolean(recoveryError.requiresUserAction));
        }
        if (!readOnly) {
          throw new LoginError("OPERATION_NOT_RETRIED", "会话已恢复；原写操作未自动重试。请先查询资源状态，确认结果后再决定是否重试");
        }
        return this.graphqlResponse(await this.authentication.waitForAicpTarget(), expression);
      }
    });
  }

  async graphqlResponse(target, expression) {
    const response = await this.runtime.evaluate(target, expression, 60000);
    if (!response) throw new Error("平台未返回响应；操作结果未知，请先查询资源状态");
    if (response.status === 401) throw expiredSession();
    if (response.status === 403) throw new Error("平台拒绝访问（HTTP 403），请检查操作权限");
    let payload;
    try { payload = JSON.parse(response.text); }
    catch { throw new Error(`平台返回了无法解析的响应（HTTP ${response.status}）`); }
    if (payload.errors?.length) {
      const message = payload.errors.map((item) => item.message).join("；");
      const authError = /UserTokenEmpty|token[ _.-]?(?:empty|expired|invalid)|unauthenticated|未认证|未登录|登录(?:状态)?(?:已)?过期/i;
      // Partial data means some fields may already have executed.
      if (!payload.data && payload.errors.every((item) => authError.test(item.message || ""))) throw expiredSession();
      throw new Error(message);
    }
    if (!payload.data) throw new Error("平台响应中没有 data 字段");
    return payload.data;
  }
}
