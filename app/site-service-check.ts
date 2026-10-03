import type { IdentityRepository } from "../db/identity-repository";
import type { MailEnvironment } from "./portal-mail";
import type { ServiceCheck } from "./site-settings";
import { createGitHubAppTokenProvider } from "./github-app-token";
import { GITHUB_PUBLICATION_REPOSITORIES } from "./github-remote-auditor";
import { PUBLICATION_GITHUB_PERMISSIONS } from "./publication-runtime";
import { PublicationFailure } from "./organizer-publication";

type Environment = MailEnvironment & Pick<PortalEnv, "ORGANIZER_PUBLICATION_MODE" | "GITHUB_APP_ID" | "GITHUB_APP_INSTALLATION_ID" | "GITHUB_APP_PRIVATE_KEY">;
const check = (status: ServiceCheck["status"], source: string, reason: string): ServiceCheck => ({ status, source, reason });

export async function checkMailService(env: MailEnvironment, requestFetch = globalThis.fetch): Promise<ServiceCheck> {
  if (env.PREVIEW_MAIL_SINK === "d1") return check("available", "預覽收信槽", "使用隔離的預覽收信槽。");
  if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) return check("unavailable", "寄信設定", "缺少 Mailgun 金鑰或寄信網域。");
  try {
    const response = await requestFetch(`https://api.mailgun.net/v4/domains/${encodeURIComponent(env.MAILGUN_DOMAIN)}`, {
      headers: { authorization: `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}` }, signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401) return check("unavailable", "Mailgun", "金鑰驗證失敗。");
    // A sending-only key can send messages but cannot read domain metadata.
    if (response.status === 403) return check("unknown", "Mailgun", "目前金鑰無權讀取網域狀態，無法確認寄信是否可用。");
    if (response.status === 404) return check("unavailable", "Mailgun", "找不到設定的寄信網域。");
    if (!response.ok) return check("unknown", "Mailgun", "網域檢查未完成，請稍後再試。");
    const body = await response.json() as { domain?: { name?: string; state?: string } };
    if (body.domain?.name !== env.MAILGUN_DOMAIN) return check("unknown", "Mailgun", "未取得設定網域的有效狀態。");
    if (body.domain.state === "disabled" || body.domain.state === "unverified") return check("unavailable", "Mailgun 寄信網域", body.domain.state === "disabled" ? "寄信網域已停用。" : "寄信網域尚未完成驗證。");
    return body.domain.state === "active" ? check("available", "Mailgun", "連線、金鑰與寄信網域正常。") : check("unknown", "Mailgun", "無法確認寄信網域狀態。");
  } catch { return check("unknown", "Mailgun 連線", "連線逾時或未取得回應。"); }
}

export async function checkPublicationService(env: Environment, requestFetch = globalThis.fetch): Promise<ServiceCheck> {
  if (env.ORGANIZER_PUBLICATION_MODE === "fake" && env.PREVIEW_MAIL_SINK === "d1") return check("available", "預覽發布", "使用隔離的預覽發布功能。");
  if (env.ORGANIZER_PUBLICATION_MODE !== "github") return check("unavailable", "發布設定", "此環境尚未啟用 GitHub 發布能力。");
  try {
    // Token exchange checks the same two repositories and permission scope as publication; no repository writes.
    await createGitHubAppTokenProvider({ appId: env.GITHUB_APP_ID ?? "", installationId: env.GITHUB_APP_INSTALLATION_ID ?? "",
      privateKey: env.GITHUB_APP_PRIVATE_KEY ?? "", repositories: GITHUB_PUBLICATION_REPOSITORIES,
      permissions: PUBLICATION_GITHUB_PERMISSIONS,
      fetch: (url, init) => requestFetch(url, { ...init, signal: AbortSignal.timeout(8_000) }) }).getToken();
    return check("available", "GitHub App", "連線、安裝與發布權限正常。");
  } catch (error) {
    if (error instanceof PublicationFailure) {
      if (error.code === "github_app_config") return check("unavailable", "GitHub App 設定", "缺少有效的 App ID、安裝 ID 或私鑰。");
      if (error.code === "github_app_key") return check("unavailable", "GitHub App 私鑰", "無法讀取或使用私鑰。");
      if (error.code === "github_app_request" && !error.retryable) return check("unavailable", "GitHub App", "GitHub 拒絕發布授權；請檢查安裝、儲存庫範圍與權限。");
    }
    return check("unknown", "GitHub 連線", "未取得有效授權回應，請稍後再試。");
  }
}

/** On-demand only, run by the existing scheduled Worker using its actual credentials. */
export async function runRequestedServiceCheck(repository: IdentityRepository, env: Environment) {
  const pending = await repository.getServiceChecks();
  if (!pending || pending.checkedAt !== null) return;
  const [mail, publication] = await Promise.all([checkMailService(env), checkPublicationService(env)]);
  await repository.completeServiceCheck(pending.requestedAt, Date.now(), { mail, publication });
}
