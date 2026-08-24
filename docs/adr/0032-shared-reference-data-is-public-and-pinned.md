# ADR-0032：共享 reference-data 公開且由活動固定版本

- 狀態：已定案（2026-08-24）
- 相關 issue：[#67](https://github.com/dekkmarsvin/tw_doujin_event/issues/67)、[#69](https://github.com/dekkmarsvin/tw_doujin_event/issues/69)、[#70](https://github.com/dekkmarsvin/tw_doujin_event/issues/70)
- 延續：[ADR-0012](./0012-first-party-sources-only.md)、[ADR-0014](./0014-event-data-lives-outside-the-code-repo.md)、[ADR-0028](./0028-versioned-json-event-definitions.md)、[ADR-0030](./0030-organizer-category-catalog-circle-selected-value.md)

## 問題

主辦單位、主辦分類目錄與場館空間會被多個活動重用。若每個 event-data repo 各自複製，stable ID、來源與修正會逐漸分歧；若活動隱性讀取共享資料最新版，既有 build 又會失去可重現性。

共享資料仍必須遵守現有來源邊界：公開內容只有活動主辦官方說明頁面建立的 reviewed base，以及社團本人自填的 overlay。建立 reference repo 不能讓工作簿、社群試算表或其他第三方內容重新成為來源。

## 決策

1. 建立公開 repository `dekkmarsvin/tw_doujin_event-reference-data`，保存主辦單位、版本化主辦分類目錄、場館與場館空間。
2. reference repo 的 `main` 只在 repository review 與 schema gate 通過後更新。每筆事實必須保存官方來源與擷取資訊。
3. event-data repo 只保存本次活動使用的 reference stable IDs、角色、空間 assignment 與明確的 reference commit pin；不得隱性使用最新 revision。
4. pin 使用完整 commit SHA，並保存實際讀取檔案的 SHA-256。缺少 pin、hash mismatch、未知 stable ID 或 schema 不相容時 build fail closed。
5. 更新順序固定為：reference change 完成 review 並發布 → event-data 更新 pin 與活動 assignment → main repo 更新 event-data pin。每一步都可獨立回滾，舊 pin 必須可重建。
6. `CircleRecord` 與 `PlacementRecord` 不移入共享 reference repo；前者是專案社團身分，後者是特定活動配置。

## 後果

- 同一主辦或場館可以被多個活動重用，但每場活動仍能固定不同版本。
- reference 修正不會自動改變既有活動；活動必須以可審閱的 pin update 選擇採用。
- repo 是公開資料來源層，不保存投稿原始檔、帳號、草稿或其他私人控制面資料。
- repo 建立與首次發布是 [#69](https://github.com/dekkmarsvin/tw_doujin_event/issues/69) 的外部操作；event schema 與 FF47 遷移由 [#70](https://github.com/dekkmarsvin/tw_doujin_event/issues/70) 承接。
