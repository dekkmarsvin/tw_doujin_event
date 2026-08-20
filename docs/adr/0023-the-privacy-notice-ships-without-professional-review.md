# ADR-0023：隱私告知自行撰寫、隨 repo 版控，不送專業審閱

- 狀態：已定案（2026-08-20）
- 文件：[隱私權與資料使用告知](../policy/privacy-notice.md)
- 相關 ADR：[ADR-0015](./0015-access-lifts-when-no-third-party-bytes-remain.md)、[ADR-0019](./0019-personal-data-requests-go-to-the-mailbox-not-the-issue-tracker.md)、[ADR-0021](./0021-credentials-expire-and-are-purged-records-are-kept.md)
- 相關 issue：[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30)

## 脈絡

[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 的產出清單裡有一條「由適當法律／營運專業人士完成確認」。

本站是非營利、單人維運的開源專案，沒有法務也沒有預算。而依 [ADR-0015](./0015-access-lifts-when-no-third-party-bytes-remain.md)，Access 閘控解除的那一刻 `/circle` 與 `/api/auth/*` 同時對外可達，本站從那一刻起收集真實個人資料。

把上線條件設成「等到專業審閱完成」，實際效果是**告知永遠不會上線**。而在沒有告知的情況下開始收資料，比在有一份誠實但未經審閱的告知下開始，糟得多。

## 決策

**自行撰寫、直接公開，並在文件裡明說未經專業審閱。範圍限於兩件事：基礎的隱私與資料使用告知，以及侵權／內容爭議的申訴信箱。**

告知文件放在 repo（[`docs/policy/privacy-notice.md`](../policy/privacy-notice.md)），**git 的版本歷史就是它的變更史**——研究裡 Codeberg 的 `PrivacyPolicy.md` 正是這個作法，不必另建一套版本管理。

### 四個約束

**一、文件描述的必須是實際行為。** 行為改了就在同一個 commit 改文件。一份比程式碼舊的告知不是文件落後，是**對外做了做不到的承諾**。

**二、不主張任何例外。** 延續[社團自助控制面契約](../contracts/circle-portal.md)已有的那條線：曾經寫過的「學術或研究用途」例外已移除，日後要主張任何例外，先有條款，再改介面與文件。

**三、文件自己要說清楚它是什麼。** 非法律意見、單人志工維運、無法保證絕對的資安水準。使用者有權在決定要不要交出 email 之前知道這些。

**四、重大變更要主動告知。** 新增資料類別、延長期限、改變使用目的屬於重大變更，要在 `/circle` 上讓社團看見，而不是靜靜換掉頁面內容。其餘修訂更新文件內的最後更新日期即可。

## 這個決策沒有解決什麼

- **它不是「本站的作法沒有法律風險」的結論。** 風險由維運者自己承擔，這是明知的取捨。
- **它不涵蓋使用條款。** 本次只做告知與申訴窗口；服務條款、責任限制那一類文件仍然沒有，也不在本決策的範圍。

## 後果

- **[#30](https://github.com/dekkmarsvin/tw_doujin_event/issues/30) 的「專業審閱」那條驗收條件被明確放棄，而不是留著不做。** 記在這裡，是為了日後有人翻到那條清單時知道它是被決定不做，不是被忘記。
- **規模改變時這個決策要重審。** 開始有金流、跨足其他活動、或收到第一件正式爭議，都是重審的觸發點。
- **文件與程式碼同一個 repo、同一次 review。** 好處是改行為的人一定會看到它；代價是它會出現在每一次 `git log`，包括那些只想改樣式的 commit。
