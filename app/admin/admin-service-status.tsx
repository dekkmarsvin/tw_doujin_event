import type { AdminSiteSettings, ServiceCheck } from "../site-settings";
import styles from "./admin-site-settings-panel.module.css";

export const adminDate = (time: number) => new Date(time).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
export function ServiceStatus({ label, result, pending, requested = false }: { label: string; result: ServiceCheck | null; pending: boolean; requested?: boolean }) {
  return <div className={styles.service}><strong>{label}</strong><div>
    <span className={result?.status === "unavailable" ? styles.unavailable : result?.status === "available" ? styles.available : ""}>
      {pending ? "檢查中" : result?.status === "available" ? "最近檢查可用" : result?.status === "unavailable" ? "最近檢查不可用" : result || requested ? "無法確認" : "尚未檢查"}
    </span>{result && <p>{result.source}：{result.reason}</p>}
  </div></div>;
}
export function ServiceResults({ data, checking }: { data: AdminSiteSettings; checking: boolean }) {
  return <><ServiceStatus label="寄信服務" result={data.services?.mail ?? null} pending={checking} requested={!!data.services} />
    <ServiceStatus label="發布服務" result={data.services?.publication ?? null} pending={checking} requested={!!data.services} />
    <ServiceStatus label="讀取服務" result={data.services?.reader ?? null} pending={false} />
    <ServiceStatus label="通知寄送" result={data.services?.notifications ?? null} pending={false} />
    {data.services && <p className={styles.updated}>{data.services.checkedAt === null ? `已要求檢查 ${adminDate(data.services.requestedAt)}` : `服務檢查 ${adminDate(data.services.checkedAt)}`}</p>}
  </>;
}
