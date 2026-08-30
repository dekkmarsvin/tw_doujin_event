# ADR-0042：公開入口支援多活動選擇，既有 deep link 保持有效

- 狀態：已定案（2026-08-30）
- **取代**：[URL 檢視狀態契約](../contracts/url-state.md)「加入第二個活動前不先顯示活動選擇器」一句
- 相關 issue：[#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119)、[#104](https://github.com/dekkmarsvin/tw_doujin_event/issues/104)
- 延續：[ADR-0002](./0002-planning-data-stays-on-device.md)、[ADR-0028](./0028-versioned-json-event-definitions.md)、[ADR-0041](./0041-scope-is-bounded-by-shippable-features.md)

## 問題

[#119](https://github.com/dekkmarsvin/tw_doujin_event/issues/119) 要移除 production 對 FF47 的單一活動硬編。若 build 能包含第二場活動，但 Reader 仍只有單一 active event，會出現兩種不可接受的結果：

1. 新活動取代 FF47，既有 `?event=ff47&...` 分享連結失效或落到錯的活動。
2. 多場活動同時存在，但公開入口沒有可理解的方式讓 Reader 選擇。

依新的 Map-first PRD，Reader P0 必須可以直接定址任一已發布活動；活動生命週期分組則屬 P1，不應綁在第二場活動的必要交付上。

## 決策

### 1. Reader 面向的是「已發布活動集合」，不是單一 active event

production 可以同時存在多個 published events。Reader 可以選擇其中一場進入，進入後才進行 Search → Circle → Map → Favorite 的既有流程。

`ACTIVE_EVENT` 可以暫時保留為未指定 event 時的預設實作，但不再是產品層級「世界上只有一場活動」的概念。

### 2. `event` deep link 是穩定入口

已發布活動的完整 URL 必須解析回同一場活動。

例如 FF47 的：

```text
?event=ff47&day=...&selectedCircle=...
```

在第二場、第三場活動上線後仍必須回到 FF47 對應狀態。

只有不存在或未發布的 event 才能 fail closed；已發布但不是預設活動，不得被靜默改回預設活動。

### 3. P0 只需要可理解的活動選擇，不要求生命週期分組

第二場活動上線時，扁平的 published-event selector 已足以完成 P0。

「即將舉辦／正在舉行／已結束」分組、首次進入引導與為此需要的可計算開始時間，全部由 [#134](https://github.com/dekkmarsvin/tw_doujin_event/issues/134) 作為 P1 處理。

因此本 ADR **不要求**：

- `event-definition` schema 升級
- `eventStartsAt` 或逐日開閉場時間
- lifecycle flag
- 三層活動分組

若 #134 啟動，再依當時 Organizer event model 選擇最小的時間資料形狀。

### 4. 未發布活動不進 Reader 公開集合

公開 selector 只消費 production 已發布活動集合。Draft / preview 活動如何定址屬 Organizer / control-plane 流程，不因 Reader 多活動而放寬。

## 功能面的變化

| 現在 | 決策落地後 |
|---|---|
| 打開網站只存在一個 active event | 可以從已發布活動中選擇 |
| `?event=` 指向非 active event 時回預設 | 指向已發布 event 時直接進該活動 |
| 新活動可能取代舊活動入口 | 舊活動 deep link 保持有效 |

進入單一活動後，搜尋、地圖、Circle detail、Favorite 等行為不因本 ADR 改變。

## 後果

- #119 的 P0 必須同時處理 published event collection 與 Reader event addressing，不能只讓 build 知道多活動。
- `docs/contracts/url-state.md` 在 #119 實作落地時同步更新，描述實際多活動 URL 行為。
- #134 明確維持 P1，不阻塞第二場活動。
- Circle portal 的多活動 self-service 是另一個 P0 問題，由 [#136](https://github.com/dekkmarsvin/tw_doujin_event/issues/136) 處理；本 ADR 不規定其登入、claim 或授權模型。

## 不在本 ADR 範圍

- 不決定活動 selector 的版面或路由。
- 不做跨活動搜尋、收藏彙整或推薦。
- 不定義 Organizer 如何建立／發布活動；由 #104 負責。
- 不定義 Circle 多活動 ownership；由 #136 負責。
- 不為 lifecycle grouping 預先升級 schema。
