# ADR-0025：重新公開前先切成主辦資料的薄場刊

- 狀態：已定案（2026-08-21）
- 具體化：[ADR-0012](./0012-first-party-sources-only.md)
- 相關 issue：[#33](https://github.com/dekkmarsvin/tw_doujin_event/issues/33)、[#49](https://github.com/dekkmarsvin/tw_doujin_event/issues/49)

## 脈絡

工作簿仍供應販售資訊、連結與搜尋 facet。等待社團自填達到某個比例才移除，會讓沒有授權依據的過渡來源反過來決定網站何時能公開；逐筆修正工作簿名稱也只延長它的權威角色。

## 決策

**Access 解除前，base catalog 只保留主辦可確認的活動事實：社團名稱、日期與攤位配置。** 工作簿供應的介紹、筆名、販售資訊、外部連結、縮圖與 facet 一次退出，不設自填覆蓋率門檻。尚未自填的社團顯示文字卡與主辦資料；社團內容之後由 overlay 逐步補回。

`SourceContentType.catalog` 可為歷史 payload 保留讀取相容，但不得再有新的 production 生產者。#49 的工作簿逐筆修正因此被 #33 的整體退場取代。

## 後果

- 公開初期的搜尋與內容密度會下降，這是已接受的產品取捨。
- 官網 adapter 必須 fail closed；主辦資料不完整時不發布猜測結果。
- generator 要有可驗收的 official-only 輸出，且 build 不得把過渡工作簿欄位帶回 production snapshot。

