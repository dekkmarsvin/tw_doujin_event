/** The prototype's single page: upload, optional hall selection, result
 * drawn over the plan. Served by the Worker; everything else is in-page. */
export const PAGE = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>配置圖自動辨識（原型）</title>
<style>
  :root { color-scheme: light; --ink: #23211e; --muted: #6b665d; --line: #d8d2c6; --paper: #fbfaf7; --accent: #2f5d8a; --warn: #9a4a12; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.6 system-ui, "Noto Sans TC", sans-serif; color: var(--ink); background: var(--paper); }
  main { max-width: 1200px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; grid-template-columns: minmax(260px, 340px) 1fr; }
  @media (max-width: 800px) { main { grid-template-columns: 1fr; } }
  h1 { font-size: 20px; margin: 16px 16px 0; max-width: 1200px; }
  form, .panel { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 16px; display: grid; gap: 12px; align-content: start; }
  label { display: grid; gap: 4px; font-weight: 600; }
  label small { font-weight: 400; color: var(--muted); }
  textarea { min-height: 140px; font: 13px/1.5 ui-monospace, monospace; }
  input, textarea, button { font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; min-width: 0; }
  input:not([type=checkbox]), textarea { width: 100%; }
  button { background: var(--accent); color: #fff; border: 0; cursor: pointer; padding: 8px 12px; }
  button.secondary { background: #fff; color: var(--accent); border: 1px solid var(--accent); }
  button:disabled { opacity: .5; cursor: wait; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .stage { position: relative; border: 1px solid var(--line); border-radius: 8px; background: #fff; overflow: auto; max-height: 78vh; touch-action: none; }
  .stage img, .stage svg.overlay { display: block; width: 100%; height: auto; }
  .stage svg.overlay { position: absolute; inset: 0; pointer-events: none; }
  .stage.vector-only img { opacity: 0; }
  .stage.overlaid svg.overlay { opacity: .82; }
  .selection { position: absolute; border: 2px dashed var(--accent); background: rgba(47, 93, 138, .08); pointer-events: none; }
  .empty { padding: 48px 16px; color: var(--muted); text-align: center; }
  .status { color: var(--muted); min-height: 1.6em; }
  .status.error { color: #b3261e; }
  ul.warnings { margin: 0; padding-left: 20px; color: var(--warn); }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border-bottom: 1px solid var(--line); padding: 4px 6px; text-align: left; }
  .check { color: var(--warn); font-weight: 600; }
</style>
</head>
<body>
<h1>配置圖自動辨識（原型）</h1>
<main>
  <form id="form">
    <label>配置圖 <small>PNG 或 JPEG</small><input type="file" name="image" accept="image/png,image/jpeg" required></label>
    <label>攤位清單 <small>每行一段或一個代碼，例如 A01~A22</small><textarea name="boothList" placeholder="A01~A22&#10;B01~B44"></textarea></label>
    <label>只辨識其中一館 <small>在右側預覽圖上拖曳框選</small><input name="crop" placeholder="整張圖"></label>
    <div class="row"><button type="submit" id="run">辨識</button><button type="button" class="secondary" id="clearCrop">取消框選</button></div>
    <div class="status" id="status" role="status"></div>
  </form>
  <section class="panel">
    <div class="row">
      <label class="row" style="font-weight:400"><input type="checkbox" id="overlay" checked> 疊在原圖上</label>
      <button type="button" class="secondary" id="downloadMap" hidden>下載地圖檔</button>
      <button type="button" class="secondary" id="downloadSvg" hidden>下載圖面</button>
    </div>
    <div class="stage overlaid" id="stage"><div class="empty">選擇配置圖後在這裡預覽</div></div>
    <div id="summary"></div>
    <div id="order" class="status"></div>
    <ul class="warnings" id="warnings"></ul>
    <table id="rows" hidden><thead><tr><th>排</th><th>攤位</th><th>編號方式</th><th></th></tr></thead><tbody></tbody></table>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const form = $("form"), stage = $("stage"), status = $("status");
let image = null, selection = null, drag = null, lastResult = null, sourceName = "map";

function scale() { return image ? image.naturalWidth / image.getBoundingClientRect().width : 1; }

form.image.addEventListener("change", () => {
  const file = form.image.files[0];
  if (!file) return;
  sourceName = file.name.replace(/\\.[^.]+$/, "");
  stage.innerHTML = "";
  image = new Image();
  image.src = URL.createObjectURL(file);
  image.alt = "上傳的配置圖";
  stage.append(image);
  form.crop.value = "";
  lastResult = null;
  $("summary").textContent = ""; $("order").textContent = ""; $("warnings").innerHTML = ""; $("rows").hidden = true;
  $("downloadMap").hidden = $("downloadSvg").hidden = true;
});

stage.addEventListener("pointerdown", (event) => {
  if (!image) return;
  const box = stage.getBoundingClientRect();
  drag = { x: event.clientX - box.left + stage.scrollLeft, y: event.clientY - box.top + stage.scrollTop };
  selection?.remove();
  selection = document.createElement("div");
  selection.className = "selection";
  stage.append(selection);
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const box = stage.getBoundingClientRect();
  const x = event.clientX - box.left + stage.scrollLeft, y = event.clientY - box.top + stage.scrollTop;
  Object.assign(selection.style, { left: Math.min(x, drag.x) + "px", top: Math.min(y, drag.y) + "px", width: Math.abs(x - drag.x) + "px", height: Math.abs(y - drag.y) + "px" });
  const s = scale();
  form.crop.value = [Math.min(x, drag.x), Math.min(y, drag.y), Math.abs(x - drag.x), Math.abs(y - drag.y)].map((v) => Math.round(v * s)).join(",");
});
stage.addEventListener("pointerup", () => {
  if (drag && selection && (parseFloat(selection.style.width) < 8 || parseFloat(selection.style.height) < 8)) { selection.remove(); selection = null; form.crop.value = ""; }
  drag = null;
});
$("clearCrop").addEventListener("click", () => { selection?.remove(); selection = null; form.crop.value = ""; });
$("overlay").addEventListener("change", (event) => {
  stage.classList.toggle("overlaid", event.target.checked);
  stage.classList.toggle("vector-only", !event.target.checked);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.image.files[0]) return;
  $("run").disabled = true;
  status.className = "status";
  status.textContent = "辨識中…";
  try {
    const response = await fetch("/recognize", { method: "POST", body: new FormData(form) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "辨識失敗。");
    lastResult = body;
    show(body);
    status.textContent = "完成。這是草稿，請逐排核對後再使用。";
  } catch (error) {
    status.className = "status error";
    status.textContent = error.message;
  } finally {
    $("run").disabled = false;
  }
});

function show(result) {
  stage.querySelector("svg.overlay")?.remove();
  const outer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  outer.setAttribute("class", "overlay");
  outer.setAttribute("viewBox", "0 0 " + image.naturalWidth + " " + image.naturalHeight);
  const inner = new DOMParser().parseFromString(result.svg, "image/svg+xml").documentElement;
  inner.setAttribute("x", result.image.offsetX);
  inner.setAttribute("y", result.image.offsetY);
  outer.append(document.importNode(inner, true));
  stage.append(outer);
  selection?.remove(); selection = null;
  const s = result.summary;
  $("summary").textContent = s.rows + " 排、" + s.booths + " 個攤位、" + s.pillars + " 根柱子、" + s.accessPoints + " 個出入口、" + s.landmarks + " 個大型區域";
  $("order").textContent = result.report.walk ? "排名依位置推定（" + result.report.walk + "），攤位數相同的排請核對排名。" : "";
  $("warnings").innerHTML = "";
  for (const text of result.report.warnings) { const li = document.createElement("li"); li.textContent = text; $("warnings").append(li); }
  const body = $("rows").tBodies[0];
  body.innerHTML = "";
  for (const row of result.report.rows) {
    const tr = document.createElement("tr");
    const check = row.confidence < 0.5 || row.label.startsWith("?");
    for (const text of [row.label, row.booths, row.numbering, check ? "需要確認" : ""]) { const td = document.createElement("td"); td.textContent = text; tr.append(td); }
    if (check) tr.lastChild.className = "check";
    body.append(tr);
  }
  $("rows").hidden = false;
  $("downloadMap").hidden = $("downloadSvg").hidden = false;
}

function download(name, type, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
$("downloadMap").addEventListener("click", () => lastResult && download(sourceName + "-map.json", "application/json", JSON.stringify({ sourceName: "辨識自 " + lastResult.sourceName, confidence: lastResult.report.confidence, layout: lastResult.layout }, null, 2)));
$("downloadSvg").addEventListener("click", () => lastResult && download(sourceName + "-map.svg", "image/svg+xml", lastResult.svg));
</script>
</body>
</html>`;
