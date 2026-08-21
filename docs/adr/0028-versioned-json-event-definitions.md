# ADR-0028：活動定義使用版本化 JSON，共用程式只保留 schema 與 adapter

- 狀態：已定案（2026-08-21）
- 相關 issue：[#35](https://github.com/dekkmarsvin/tw_doujin_event/issues/35)

## 決策

每個活動以一份帶 `schema` 版本的 JSON 定義 id、名稱、場館、日期、天數、展區、地圖模板、來源 URL 與發布時間。共用 TypeScript 只保留 parser、validator、通用 `EventDefinition` 型別與 registry，不保留 `FF47_*` 常數。

主辦網站解析屬 organizer adapter；活動定義選擇 adapter 與其設定，但解析規則不放進 JSON。天與展區在共用程式中使用一般 `string | number`／`string`，活動專屬字面量只存在資料與驗證結果中。

## 後果

- 新活動以新增資料檔和必要 adapter 完成，不修改既有活動檔。
- JSON schema 版本變更必須有 migration 或明確拒絕舊版，不能靜默猜測。
- 既有 `FF47_EVENT` 可在遷移期作相容別名，但不得再成為共用模組的資料權威。

