/** 場館／使用空間／展區三層的填寫依據。
 *
 * 這三個詞在日常語言裡幾乎同義，而詞彙表只寫給開發者看。#298 決定用**已發布
 * 的真實活動**當例子，而不是畫一張示意圖：不必維護新資產，而且讀者認得出那
 * 些活動。
 *
 * 例子分別展示有分區與沒有分區的活動，讓三層各有可核對的實例。
 *
 * 下面的值取自已發布資料（`data/event-data-pins/*.json` 指向的 commit）：
 * FF47 的展區是 `A：A–K 區`、`B：L–W 區`；CH20 只有一個 `ALL`。已發布的活動
 * 結構不會自己改變，要改必須走修正宣告，所以這裡寫成文案而不是即時讀取。
 */
import styles from "./organizer.module.css";

type LayerExample = {
  event: string;
  venue: string;
  space: string;
  areas: string;
  why: string;
};

const EXAMPLES: readonly LayerExample[] = [
  {
    event: "Fancy Frontier 47",
    venue: "花博公園爭艷館",
    space: "全館",
    areas: "A–K 區、L–W 區",
    why: "主辦自己把場地分成兩區公告，讀者也用這兩個名字找攤位。",
  },
  {
    event: "Comic Horizon 20",
    venue: "三重綜合體育館",
    space: "1F 開放式場地",
    areas: "沒有分區",
    why: "一個場地一次看完，不需要再細分。",
  },
];

export function VenueLayerGuide({ open = false }: { open?: boolean }) {
  /* Named explicitly: a <details> maps to role group, but the group takes no
   * accessible name from its own <summary>, so without this it is a region a
   * screen reader cannot announce and a test cannot address. */
  return <details className={styles.layerGuide} aria-label="場館、使用空間、展區的填寫依據" open={open}>
    <summary>場館、使用空間、展區分別是什麼？</summary>
    <p><b>場館</b>是建築。<b>使用空間</b>是館內可以各自畫一張地圖的範圍，例如不同館別或樓層。
      <b>展區</b>是空間裡再細分、而且主辦真的對外公告過的區塊。</p>
    <table>
      <thead><tr><th>已發布的活動</th><th>場館</th><th>使用空間</th><th>展區</th></tr></thead>
      <tbody>{EXAMPLES.map((example) => <tr key={example.event}>
        <td>{example.event}</td><td>{example.venue}</td><td>{example.space}</td><td>{example.areas}</td>
      </tr>)}</tbody>
    </table>
    <ul>{EXAMPLES.map((example) => <li key={example.event}>{example.event}：{example.why}</li>)}</ul>
    <p>是否分區要依這場活動的官方公告決定，不能只從場館名稱判斷。
      <b>大多數單一場地的活動不需要展區。</b></p>
    <p>攤位代碼開頭的字母（<code>A01</code> 的 <code>A</code>）是<b>排</b>，不是展區。
      把排當成展區會讓活動登錄出一堆讀者用不到的名字。</p>
  </details>;
}
