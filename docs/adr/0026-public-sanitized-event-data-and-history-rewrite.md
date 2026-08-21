# ADR-0026：活動資料 repo 公開且只收可再發布資料，程式碼 repo 重寫歷史

- 狀態：已定案（2026-08-21）
- 具體化：[ADR-0014](./0014-event-data-lives-outside-the-code-repo.md)、[ADR-0015](./0015-access-lifts-when-no-third-party-bytes-remain.md)
- 相關 issue：[#38](https://github.com/dekkmarsvin/tw_doujin_event/issues/38)

## 決策

每個活動使用一個**公開**資料 repo，只收可公開再發布的主辦活動事實、本站產物、裁決紀錄與必要 provenance。第三方工作簿、配置圖原檔及其不可再發布的衍生內容不得搬入新 repo。

程式碼 repo 以固定 commit SHA 與逐檔 SHA-256 引用資料。搬移完成後，在沒有 open PR 的維護窗口以 `git filter-repo` 類工具重寫程式碼 repo 歷史，先建立可恢復的 mirror／tag，再 force-push；所有既有 clone 都必須重新取得。

## 後果

- 公開 repo 不等於替第三方素材重新授權；不符合邊界的位元組直接排除。
- 歷史重寫是 Access 解除前的一次性破壞性 gate，不能與仍在審查的 PR 並行。
- 新 clone 即使未取得真實活動資料，也要能以最小 fixture 跑完 gate。

