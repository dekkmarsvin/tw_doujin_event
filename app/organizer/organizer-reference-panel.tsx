import { useState, type FormEvent } from "react";
import type { OrganizerEventDraft } from "../organizer-event";
import type { OrganizerReferenceCatalog } from "../organizer-reference-catalog";
import { createOrganizerReferenceEntry } from "../organizer-client";
import styles from "./organizer.module.css";

type Selection = NonNullable<OrganizerEventDraft["references"]>;

/** `eventSourceUrl` is the event's official announcement: an organizer's
 * categories are usually published there, so a new catalog starts from it. */
export function OrganizerReferencePanel({ candidateId, expectedVersion, catalog: initialCatalog, selection, editable, eventSourceUrl = "", onChange }: {
  candidateId: string; expectedVersion: number; catalog?: OrganizerReferenceCatalog; selection?: Selection;
  editable: boolean; eventSourceUrl?: string; onChange: (selection: Selection) => void;
}) {
  const [catalog, setCatalog] = useState(initialCatalog ?? { organizers: [], categories: [] });
  const [action, setAction] = useState<"organizer" | "category-catalog" | null>(null);
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [organizerId, setOrganizerId] = useState("");
  const [categories, setCategories] = useState([{ label: "", description: "" }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const value = selection ?? { organizerAssignments: [], categoryCatalog: null };
  const selectedIds = value.organizerAssignments.map((item) => item.organizerId);
  const availableCatalogs = catalog.categories.filter((item) => selectedIds.includes(item.organizerId));
  const chooseAction = (next: typeof action) => {
    setAction(next); setName(""); setSourceUrl(next === "category-catalog" ? eventSourceUrl.trim() : ""); setError("");
    setOrganizerId(selectedIds.length === 1 ? selectedIds[0] : "");
    setCategories([{ label: "", description: "" }]);
  };
  const updateAssignments = (organizerAssignments: Selection["organizerAssignments"]) => onChange({ organizerAssignments,
    categoryCatalog: organizerAssignments.some((item) => item.organizerId === value.categoryCatalog?.organizerId) ? value.categoryCatalog : null });
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!action || pending) return;
    setPending(true); setError("");
    try {
      const result = await createOrganizerReferenceEntry(candidateId, { expectedVersion, kind: action, name, sourceUrl,
        ...(action === "category-catalog" ? { organizerId, categories } : {}) });
      setCatalog(result.catalog);
      onChange(action === "organizer" ? { ...value, organizerAssignments: [...value.organizerAssignments,
        { organizerId: result.created.id, role: selectedIds.length ? "co-organizer" : "lead" }] }
        : { ...value, categoryCatalog: { id: result.created.id, organizerId: result.created.organizerId!, revision: result.created.revision! } });
      setAction(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "建立失敗，請稍後再試。"); }
    finally { setPending(false); }
  };
  return <div className={`${styles.subpanel} ${styles.referencePanel}`}>
    <h4>主辦與分類</h4>
    <p>選擇主辦單位與其公布的分類目錄。新建的資料可供日後活動選用；選取後請儲存活動。</p>
    <fieldset disabled={!editable || pending}>
      {value.organizerAssignments.map((assignment, index) => <div className={`${styles.row} ${styles.fieldRow}`} key={index}>
        <label>單位 {index + 1}<select aria-label={`主辦單位 ${index + 1}`} value={assignment.organizerId} onChange={(event) => updateAssignments(value.organizerAssignments.map((item, position) => position === index ? { ...item, organizerId: event.target.value } : item))}>
          <option value="">請選擇單位</option>{catalog.organizers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select></label>
        <label>角色<select aria-label={`主辦角色 ${index + 1}`} value={assignment.role} onChange={(event) => updateAssignments(value.organizerAssignments.map((item, position) => position === index ? { ...item, role: event.target.value as typeof item.role } : item))}>
          <option value="lead">主辦</option><option value="co-organizer">協辦</option><option value="partner">合作夥伴</option>
        </select></label>
        <button type="button" className={styles.ghost} onClick={() => updateAssignments(value.organizerAssignments.filter((_, position) => index !== position))}>移除單位 {index + 1}</button>
      </div>)}
      <div className={styles.row}>
        <button type="button" className={styles.ghost} onClick={() => updateAssignments([...value.organizerAssignments, { organizerId: "", role: selectedIds.length ? "co-organizer" : "lead" }])}>選取既有主辦</button>
        <button type="button" className={styles.ghost} onClick={() => chooseAction("organizer")}>建立主辦單位</button>
      </div>
      <label>主辦分類目錄<select aria-label="主辦分類目錄" value={value.categoryCatalog ? `${value.categoryCatalog.id}/${value.categoryCatalog.revision}` : ""} onChange={(event) => {
        const selected = availableCatalogs.find((item) => `${item.id}/${item.revision}` === event.target.value);
        onChange({ ...value, categoryCatalog: selected ? { id: selected.id, organizerId: selected.organizerId, revision: selected.revision } : null });
      }}><option value="">請選擇分類目錄</option>{availableCatalogs.map((item) => <option value={`${item.id}/${item.revision}`} key={`${item.id}/${item.revision}`}>{item.name}（{item.categories.length} 個分類）</option>)}</select></label>
      {value.categoryCatalog && <p>{availableCatalogs.find((item) => item.id === value.categoryCatalog?.id && item.revision === value.categoryCatalog.revision)?.categories.map((item) => item.label).join("、")}</p>}
      <button type="button" className={styles.ghost} disabled={!selectedIds.some(Boolean)} onClick={() => chooseAction("category-catalog")}>建立分類目錄</button>
    </fieldset>
    {action && <form className={styles.subpanel} onSubmit={(event) => void create(event)}>
      <h4>{action === "organizer" ? "建立主辦單位" : "建立分類目錄"}</h4>
      <fieldset disabled={pending || !editable}>
        {action === "category-catalog" && <label>所屬主辦<select required value={organizerId} onChange={(event) => setOrganizerId(event.target.value)}><option value="">請選擇所屬主辦</option>{catalog.organizers.filter((item) => selectedIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <div className={styles.formGrid}>
          <label>{action === "organizer" ? "主辦名稱" : "分類目錄名稱"}<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>{action === "organizer" ? "主辦官方網址" : "分類官方來源網址"}<input required type="url" placeholder="https://" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label>
        </div>
        {action === "category-catalog" && <>
          {categories.map((category, index) => <div key={index} className={`${styles.row} ${styles.fieldRow}`}>
            <label>分類名稱 {index + 1}<input required maxLength={120} value={category.label} onChange={(event) => setCategories((rows) => rows.map((row, position) => position === index ? { ...row, label: event.target.value } : row))} /></label>
            <label>分類說明 {index + 1}（選填）<input maxLength={1000} value={category.description} onChange={(event) => setCategories((rows) => rows.map((row, position) => position === index ? { ...row, description: event.target.value } : row))} /></label>
            <button type="button" className={styles.ghost} disabled={categories.length === 1} onClick={() => setCategories((rows) => rows.filter((_, position) => index !== position))}>移除分類 {index + 1}</button>
          </div>)}
          <button type="button" className={styles.ghost} disabled={categories.length >= 100} onClick={() => setCategories((rows) => [...rows, { label: "", description: "" }])}>新增分類</button>
        </>}
        <div className={styles.row}><button type="submit">{pending ? "建立中…" : "建立並選取"}</button><button type="button" className={styles.ghost} onClick={() => setAction(null)}>取消</button></div>
      </fieldset>
      {error && <p role="alert" className={styles.issueError}>{error}</p>}
    </form>}
  </div>;
}
