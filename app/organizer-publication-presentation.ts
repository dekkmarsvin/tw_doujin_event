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

export function publicationFailureMessage(job: { failureCode?: string | null; retryable?: boolean; started?: boolean }) {
  // A job that never started reads as a mid-publication failure unless it says
  // otherwise, and the owner then looks for progress that was never made. The
  // timeout also catches jobs that stalled again after a retry: those really
  // did stop part-way, and the stage list beside this message already shows
  // their completed stages, so only the ones that finished no stage at all may
  // claim that nothing ran. `started` carries that, because the step does not:
  // approval creates a job on `preparing_data` and retry keeps the failed step,
  // so the same name covers both cases.
  if (job.failureCode === "queued_timeout" && !job.started) return "發布沒有開始，內容沒有被退件。可以重試發布。";
  if (job.failureCode === "event_id_collision") return "這個活動代碼已存在，首次發布不能覆寫。請聯絡網站管理者，透過已發布活動修正流程處理。";
  if (job.failureCode === "amendment_baseline_changed" || job.failureCode === "amendment_base_conflict") return "修正所依據的公開版本或發布資料已變更，系統已停止合併。請聯絡網站管理者核對版本，不能直接重試覆寫。";
  if (job.failureCode === "snapshot_mismatch") return "已核准內容與發布記錄不一致，系統已停止發布。請聯絡網站管理者檢查這一版的送審記錄。";
  return job.retryable ? "發布暫時失敗，內容沒有被退件。可以重試發布，系統會從失敗步驟繼續，保留已完成的進度。"
    : "發布已停止，內容沒有被退件。請聯絡網站管理者排除問題後再繼續。";
}
