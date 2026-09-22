import { useMemo, useState } from "react";
import type { EventMapLayout } from "./event-map";
import { mapBoothCoverage, type MapBoothScope } from "./map-booth-coverage";
import styles from "./map-layout-editor.module.css";

export function MapBoothList({ layout, scope, selectedCode, onLocate }: {
  layout: EventMapLayout;
  scope: MapBoothScope;
  selectedCode?: string;
  onLocate: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("missing");
  const [page, setPage] = useState(0);
  const coverage = useMemo(() => mapBoothCoverage(layout, scope), [layout, scope]);
  const names = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const group of scope.groups ?? []) for (const code of group.codes) {
      result.set(code, [...(result.get(code) ?? []), group.circleName]);
    }
    return result;
  }, [scope.groups]);
  const codes = useMemo(() => {
    const needle = query.trim().normalize("NFKC").toLocaleLowerCase("zh-Hant");
    const source = mode === "missing" ? coverage.missing : mode === "unknown" ? coverage.unknown : coverage.required;
    return source.filter(code => [code, ...(names.get(code) ?? [])].some(value => value.toLocaleLowerCase("zh-Hant").includes(needle)));
  }, [coverage, mode, names, query]);
  const pages = Math.max(1, Math.ceil(codes.length / 100)), shownPage = Math.min(page, pages - 1);
  return <section className={styles.boothList} aria-label="攤位清單對照">
    <h4>攤位清單對照</h4>
    <p role="status">清單 {coverage.required.length} 碼・已畫 {coverage.completed} 碼・待畫 {coverage.missing.length} 碼</p>
    <p>依目前地圖草稿即時計算；未儲存的修改不代表已完成保存。</p>
    {selectedCode && <p aria-live="polite">選取 {selectedCode}：{names.get(selectedCode)?.join("、") || "本活動日與使用空間沒有對應群組"}</p>}
    {coverage.unknown.length > 0 && <p className={scope.allowsUnallocatedBooths ? styles.boothWarning : styles.boothError} role="status">
      {scope.allowsUnallocatedBooths ? "提醒" : "錯誤"}：{coverage.unknown.length} 個代碼不在可用清單。{scope.allowsUnallocatedBooths ? "請核對是否為未分配攤位。" : "請修正後再送審。"}
    </p>}
    <details open><summary>查看代碼與定位</summary>
      <label>搜尋對照清單<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>對照顯示<select value={mode} onChange={event => { setMode(event.target.value); setPage(0); }}><option value="missing">待畫代碼</option><option value="all">本範圍全部清單</option><option value="unknown">清單外代碼</option></select></label>
      <ul>{codes.slice(shownPage * 100, (shownPage + 1) * 100).map(code => <li key={code}>
        {coverage.drawn.has(code) ? <button type="button" onClick={() => onLocate(code)} aria-label={`定位攤位 ${code}`}>{code}・定位</button> : <span>{code}・待畫</span>}
        {names.has(code) && <small>{names.get(code)!.join("、")}</small>}
      </li>)}</ul>
      {codes.length === 0 && <p>沒有符合條件的代碼。</p>}
      {pages > 1 && <div><button type="button" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>上一頁</button><span>{shownPage + 1} / {pages}</span><button type="button" disabled={shownPage + 1 >= pages} onClick={() => setPage(shownPage + 1)}>下一頁</button></div>}
    </details>
  </section>;
}
