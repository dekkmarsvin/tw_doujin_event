# 政府行政機關辦公日曆

首頁月曆使用行政院人事行政總處的完整年度 CSV，隨前台一起提供，不在讀者開啟首頁時連線取得。欄位「是否放假」以 `0` 表示上班、`2` 表示放假；週末亦依官方旗標，不能自行以星期推算補班／補假。未收錄年度不標示官方假日。

來源：[中華民國政府行政機關辦公日曆表](https://data.gov.tw/dataset/14718)。授權：[政府資料開放授權條款第 1 版](https://data.gov.tw/license)。此資料適用政府行政機關。

- [2026 CSV 原檔](https://www.dgpa.gov.tw/FileConversion?filename=dgpa%2Ffiles%2F202506%2Fa52331bd-a189-466b-b0f0-cae3062bbf74.csv&name=115%E5%B9%B4%E4%B8%AD%E8%8F%AF%E6%B0%91%E5%9C%8B%E6%94%BF%E5%BA%9C%E8%A1%8C%E6%94%BF%E6%A9%9F%E9%97%9C%E8%BE%A6%E5%85%AC%E6%97%A5%E6%9B%86%E8%A1%A8.csv&nfix=)
- [2027 CSV 原檔](https://www.dgpa.gov.tw/FileConversion?filename=dgpa%2Ffiles%2F202607%2Ff538b1ff-ba60-4c63-9477-10db8e6612d1.csv&name=116%E5%B9%B4%E4%B8%AD%E8%8F%AF%E6%B0%91%E5%9C%8B%E6%94%BF%E5%BA%9C%E8%A1%8C%E6%94%BF%E6%A9%9F%E9%97%9C%E8%BE%A6%E5%85%AC%E6%97%A5%E6%9B%86%E8%A1%A8_utf8bom.csv&nfix=)

年度公告或修正時，從官方資料集下載並替換對應 CSV；新增年度亦須在 `app/office-calendar.ts` 匯入。現有檔案為每行四欄、沒有引號或欄內逗號的 UTF-8 CSV；格式改變時同步調整讀取方式。`tests/event-chooser-component.test.mjs` 核對全年日期、旗標及欄位格式，`reader-event-calendar` journey 驗證首頁呈現。
