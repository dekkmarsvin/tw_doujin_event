# ADR-0028：活動定義使用版本化 JSON，共用程式只保留 schema 與 adapter

- 狀態：已定案（2026-08-21）
- 相關 issue：[#35](https://github.com/dekkmarsvin/tw_doujin_event/issues/35)

## 決策

每個活動以一份帶 `schema` 版本的 JSON 定義 id、名稱、日期、天數、展區、地圖模板、官方資料 adapter、主辦角色、分類目錄 selection、場館／場館空間 assignment 與發布時間。共用 TypeScript 只保留 parser、validator、通用 `EventDefinition` 型別與 registry，不保留 `FF47_*` 常數。

`event-definition/3` 不內嵌主辦、分類目錄、場館或場館空間內容，而是以 stable ID 指向同一 event-data commit 所固定的 `reference-data-pin/2`。parser 必須驗證 exactly one lead organizer、分類目錄的 organizer／revision，以及每個 venue space 與 venue 的關聯；venue assignments 必須不重疊地覆蓋所有 `area`。`event-definition/2` 不會靜默套用這些新語意，讀取時明確拒絕。

主辦分類記錄投影為 `circleCategories`，再由 parser 為既有 filter／URL codec 產生 `genres`；資料檔不得自行提供第二份字彙。`venue` 顯示名稱同樣由 pinned reference record 投影，不是 event JSON 的第二份副本。

主辦網站解析屬 organizer adapter；活動定義選擇 adapter 與其設定，但解析規則不放進 JSON。天與展區在共用程式中使用一般 `string | number`／`string`，活動專屬字面量只存在資料與驗證結果中。

## 後果

- 新活動以新增資料檔、pinned reference assignment 和必要 adapter 完成，不修改既有活動檔。
- JSON schema 版本變更必須有 migration 或明確拒絕舊版，不能靜默猜測。
- 既有 `FF47_EVENT` 可在遷移期作相容別名，但不得再成為共用模組的資料權威。
