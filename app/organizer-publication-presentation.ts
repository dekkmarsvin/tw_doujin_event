export function publicationFailureMessage(job: { failureCode: string | null; retryable: boolean; started: boolean }, available: boolean) {
  // Every field here is required. `started` began as optional, and omitting it
  // made `!job.started` true, so a job with remote artefacts pinned would have
  // claimed nothing ran -- a wrong assertion, not a cautious one. There is one
  // producer and one consumer today; a second producer is where that would have
  // gone wrong silently, so the compiler holds the shape instead.
  //
  // A job that never started reads as a mid-publication failure unless it says
  // otherwise, and the owner then looks for progress that was never made. The
  // timeout also catches jobs that stalled again after a retry: those really
  // did stop part-way, and the stage list beside this message already shows
  // their completed stages, so only the ones that finished no stage at all may
  // claim that nothing ran. `started` carries that, because the step does not:
  // approval creates a job on `preparing_data` and retry keeps the failed step,
  // so the same name covers both cases.
  // `available` is required for the same reason the job fields are: promising
  // a retry the owner cannot take is worse than saying less. With publication
  // switched off the retry button is disabled, and the activity page already
  // carries one line explaining why, so this one stops at what happened.
  if (job.failureCode === "queued_timeout" && !job.started) return available ? "發布沒有開始，內容沒有被退件。可以重試發布。" : "發布沒有開始，內容沒有被退件。";
  if (job.failureCode === "event_id_collision") return "這個活動代碼已經公開，首次發布不能覆寫。請退回修改並換一個活動代碼，或聯絡網站管理者。";
  if (job.failureCode === "amendment_baseline_changed" || job.failureCode === "amendment_base_conflict" || job.failureCode === "amendment_baseline_legacy") {
    return "這次修正所依據的公開版本已經變更，這一版無法發布。請聯絡網站管理者。";
  }
  if (job.failureCode === "snapshot_mismatch") return "已核准的內容與送審紀錄不一致，沒有發布。請聯絡網站管理者。";
  if (!available) return "發布失敗，內容沒有被退件。";
  return job.retryable ? "發布暫時失敗，內容沒有被退件。可以重試發布。" : "發布已停止，內容沒有被退件。請聯絡網站管理者。";
}
