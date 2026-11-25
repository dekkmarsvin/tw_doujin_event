import type { IdentityRepository } from "../db/identity-repository";
import type { MailEnvironment } from "./portal-mail";
import type { ServiceCheck } from "./site-settings";

type Environment = MailEnvironment & Pick<PortalEnv, "ORGANIZER_PUBLICATION_MODE">;
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

export async function checkPublicationService(env: Environment): Promise<ServiceCheck> {
  if (env.ORGANIZER_PUBLICATION_MODE === "r2") return check("available", "活動資料發布", "核准時直接寫入活動資料儲存。");
  return check("unavailable", "發布設定", "此環境尚未啟用發布。");
}

/** On-demand only, run by the existing scheduled Worker using its actual credentials. */
export async function runRequestedServiceCheck(repository: IdentityRepository, env: Environment) {
  const pending = await repository.getServiceChecks();
  if (!pending || pending.checkedAt !== null) return;
  const [mail, publication] = await Promise.all([checkMailService(env), checkPublicationService(env)]);
  await repository.completeServiceCheck(pending.requestedAt, Date.now(), { mail, publication });
}
