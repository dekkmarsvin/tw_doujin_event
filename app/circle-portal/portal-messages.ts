import { defineMessages, type MessageCatalog } from "../i18n/messages";
import { PORTAL_FORM_MESSAGES } from "./portal-form-messages";

// Source-language keys let stored notices change language when they render.
// Only system copy is looked up here; authored values stay outside this catalog.
export const PORTAL_MESSAGES: MessageCatalog<string> = defineMessages({
  "zh-Hant": {
    ...PORTAL_FORM_MESSAGES["zh-Hant"],
    "社團資料": "社團資料", "主辦工作區": "主辦工作區", "工作區": "工作區", "帳號": "帳號",
    "認領社團、更新介紹與品書": "認領社團、更新介紹與品書", "建置活動、管理攤位與地圖": "建置活動、管理攤位與地圖",
    "第一次使用？看看社團和主辦能做什麼": "第一次使用？看看社團和主辦能做什麼", "聯絡管理者": "聯絡管理者",
    "返回活動列表": "返回活動列表", "登入": "登入", "登出": "登出", "寄送中…": "寄送中…", "寄出登入連結": "寄出登入連結",
    "寄到 {email}": "寄到 {email}", "送出即表示你已閱讀": "送出即表示你已閱讀", "隱私權與資料使用告知": "隱私權與資料使用告知",
    "若這個 email 可以使用，登入連結已寄出。請一併檢查垃圾郵件匣。": "若這個 email 可以使用，登入連結已寄出。請一併檢查垃圾郵件匣。",
    "真人驗證元件載入失敗，請檢查網路或內容封鎖設定後重新整理。": "真人驗證元件載入失敗，請檢查網路或內容封鎖設定後重新整理。",
    "操作失敗，請稍後再試。": "操作失敗，請稍後再試。", "登入已到期，請重新登入。": "登入已到期，請重新登入。", "登入成功。": "登入成功。",
    "關閉": "關閉", "載入中…": "載入中…", "儲存中…": "儲存中…", "已儲存": "已儲存",
    "這個操作被存取控制擋下了。請先在同一個瀏覽器開啟本站首頁完成驗證，再回來重試。": "這個操作被存取控制擋下了。請先在同一個瀏覽器開啟本站首頁完成驗證，再回來重試。",
    "收到無法處理的回應，請稍後再試。": "收到無法處理的回應，請稍後再試。",
  },
  en: {
    ...PORTAL_FORM_MESSAGES.en,
    "社團資料": "Circle details", "主辦工作區": "Organizer workspace", "工作區": "Workspaces", "帳號": "Account",
    "認領社團、更新介紹與品書": "Claim your circle and update its details and item list", "建置活動、管理攤位與地圖": "Set up events and manage booths and maps",
    "第一次使用？看看社團和主辦能做什麼": "New here? See what circles and organizers can do", "聯絡管理者": "Contact the site team",
    "返回活動列表": "Back to events", "登入": "Sign in", "登出": "Sign out", "寄送中…": "Sending…", "寄出登入連結": "Send sign-in link",
    "寄到 {email}": "Send to {email}", "送出即表示你已閱讀": "By submitting, you confirm that you have read the ", "隱私權與資料使用告知": "Privacy and data use notice",
    "若這個 email 可以使用，登入連結已寄出。請一併檢查垃圾郵件匣。": "If this email can be used, a sign-in link has been sent. Please also check your spam folder.",
    "真人驗證元件載入失敗，請檢查網路或內容封鎖設定後重新整理。": "The verification widget could not load. Check your connection or content blocker, then reload.",
    "操作失敗，請稍後再試。": "The action failed. Please try again later.", "登入已到期，請重新登入。": "Your session has expired. Please sign in again.", "登入成功。": "Signed in.",
    "關閉": "Close", "載入中…": "Loading…", "儲存中…": "Saving…", "已儲存": "Saved",
    "這個操作被存取控制擋下了。請先在同一個瀏覽器開啟本站首頁完成驗證，再回來重試。": "Access was blocked. Open this site’s home page in the same browser to complete verification, then try again.",
    "收到無法處理的回應，請稍後再試。": "The response could not be read. Please try again later.",
  },
  ja: {
    ...PORTAL_FORM_MESSAGES.ja,
    "社團資料": "サークル情報", "主辦工作區": "主催ワークスペース", "工作區": "ワークスペース", "帳號": "アカウント",
    "認領社團、更新介紹與品書": "サークルの管理申請・紹介・お品書きの更新", "建置活動、管理攤位與地圖": "イベントの作成・スペースと配置マップの管理",
    "第一次使用？看看社團和主辦能做什麼": "初めての方へ：サークル・主催者ができること", "聯絡管理者": "管理者に連絡する",
    "返回活動列表": "イベント一覧に戻る", "登入": "ログイン", "登出": "ログアウト", "寄送中…": "送信中…", "寄出登入連結": "ログインリンクを送信",
    "寄到 {email}": "送信先：{email}", "送出即表示你已閱讀": "送信することで、次のお知らせを読んだことを確認します：", "隱私權與資料使用告知": "プライバシーとデータ利用について",
    "若這個 email 可以使用，登入連結已寄出。請一併檢查垃圾郵件匣。": "このメールアドレスが利用可能な場合、ログインリンクを送信しました。迷惑メールフォルダもご確認ください。",
    "真人驗證元件載入失敗，請檢查網路或內容封鎖設定後重新整理。": "認証ウィジェットを読み込めませんでした。通信環境やコンテンツブロッカーの設定を確認して、再読み込みしてください。",
    "操作失敗，請稍後再試。": "操作に失敗しました。しばらくしてから再試行してください。", "登入已到期，請重新登入。": "ログインの有効期限が切れました。再度ログインしてください。", "登入成功。": "ログインしました。",
    "關閉": "閉じる", "載入中…": "読み込み中…", "儲存中…": "保存中…", "已儲存": "保存しました",
    "這個操作被存取控制擋下了。請先在同一個瀏覽器開啟本站首頁完成驗證，再回來重試。": "アクセスがブロックされました。同じブラウザーでこのサイトのトップページを開いて認証を済ませてから、再試行してください。",
    "收到無法處理的回應，請稍後再試。": "応答を読み取れませんでした。しばらくしてから再試行してください。",
  },
});
