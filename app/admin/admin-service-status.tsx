import type { AdminSiteSettings, PublicationActivity, ServiceCheck } from "../site-settings";
import styles from "./admin-site-settings-panel.module.css";

export const adminDate = (time: number) => new Date(time).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
const steps: Record<string, string> = {
  assemble: "準備活動內容", preparing_data: "準備活動資料", waiting_data_checks: "檢查活動資料", merging_data: "套用活動資料",
  preparing_main: "準備網站更新", waiting_main_checks: "檢查網站更新", merging_main: "套用網站更新",
  waiting_deployment: "部署網站", verifying_production: "確認公開結果",
};
export function publicationProgress(job: PublicationActivity, enabled: boolean) {
  return `${job.status === "queued" ? "已排程" : "發布中"} · ${!enabled ? "已暫停" : job.status === "queued" ? "等待開始" : steps[job.step] ?? "處理中"}`;
}
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
    {data.services && <p className={styles.updated}>{data.services.checkedAt === null ? `已要求檢查 ${adminDate(data.services.requestedAt)}` : `服務檢查 ${adminDate(data.services.checkedAt)}`}</p>}
  </>;
}
