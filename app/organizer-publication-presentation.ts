const GROUPS = [
  { label: "準備活動資料", steps: ["assemble", "preparing_data"] },
  { label: "更新公開資料", steps: ["waiting_data_checks", "merging_data", "preparing_main", "waiting_main_checks", "merging_main"] },
  { label: "部署網站", steps: ["waiting_deployment"] },
  { label: "確認公開結果", steps: ["verifying_production", "smoke", "verify"] },
];

export function publicationProgress(job: { step: string; status: string }) {
  const current = GROUPS.findIndex((group) => group.steps.includes(job.step));
  return GROUPS.map((group, index) => ({ label: group.label,
    state: job.status === "published" || (current >= 0 && index < current) ? "complete"
      : index === current ? job.status === "failed" ? "failed" : "current" : "pending",
  }));
}

export function publicationFailureMessage(code: string | null | undefined, retryable: boolean) {
  if (code === "event_id_collision") return "這個活動代碼已存在，首次發布不能覆寫。請聯絡網站管理者，透過已發布活動修正流程處理。";
  if (code === "snapshot_mismatch") return "已核准內容與發布記錄不一致，系統已停止發布。請聯絡網站管理者檢查這一版的送審記錄。";
  return retryable ? "發布暫時失敗，內容沒有被退件。可以重試發布，系統會從失敗步驟繼續，保留已完成的進度。"
    : "發布已停止，內容沒有被退件。請聯絡網站管理者排除問題後再繼續。";
}
