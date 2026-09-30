import { useEffect, useRef, useState } from 'react';
import { readSharedReferences, saveSharedReference } from '../organizer-client';
import type { SharedReferenceCatalog } from '../shared-reference-catalog';
import styles from '../circle-portal/portal.module.css';
import ui from './admin-reference-panel.module.css';
import { UiIcon } from '../ui-icons';

type Form = { kind: string; title: string; values: Record<string, string>; initial: string };
type Managed = { path: string | null; version: string | null; editBlocked: boolean; deleteBlocked: boolean; deleteReason: string; revision?: string };
type Removal = { kind: string; name: string; item: Managed };
type Section = 'venues' | 'organizers' | 'categories';
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作失敗，請稍後再試。';

export function AdminReferencePanel() {
  const formElement = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<SharedReferenceCatalog | null>(null);
  const [section, setSection] = useState<Section>('venues');
  const [search, setSearch] = useState('');
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const dirty = !!form && JSON.stringify(form.values) !== form.initial;
  const locked = busy || refreshRequired;
  useEffect(() => {
    let current = true;
    void readSharedReferences().then(value => { if (current) setCatalog(value); })
      .catch(failure => { if (current) setError(messageOf(failure)); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, busy]);
  const formIdentity = form ? `${form.kind}:${form.initial}` : '';
  const modalOpen = !!form || !!removal;
  useEffect(() => {
    if (!modalOpen) return;
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; opener?.focus(); };
  }, [modalOpen]);
  useEffect(() => {
    if (formIdentity) formElement.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [formIdentity]);
  const mayLeave = () => !busy && (!dirty || window.confirm('放棄尚未儲存的內容？'));
  function open(kind: string, title: string, values: Record<string, string> = {}) {
    if (locked || !mayLeave()) return;
    const initial = { name: '', sourceUrl: '', address: '', spaceName: '', spaceSourceUrl: '', defaultAreaMode: 'imported', organizerId: '', categories: '', ...values };
    setForm({ kind, title, values: initial, initial: JSON.stringify(initial) });
    setError(''); setNotice('');
  }
  function edit(kind: string, title: string, item: Managed, values: Record<string, string>) {
    open(kind, title, { ...values, ...(item.revision ? { revision: item.revision } : {}), action: 'edit', path: item.path!, version: item.version! });
  }
  function remove(kind: string, name: string, item: Managed) {
    setRemoval({ kind, name, item }); setError(''); setNotice('');
  }
  function controls(kind: string, name: string, item: Managed, values: Record<string, string>) {
    return <div className={ui.actions}>
      <button type="button" disabled={locked || item.editBlocked} title={item.editBlocked ? '此資料已被活動使用，無法直接修改。' : undefined}
        onClick={() => edit(kind, `編輯${name}`, item, values)}>編輯</button>
      <button type="button" className={ui.danger} disabled={locked || !item.path} onClick={() => remove(kind, `${values.name}${item.revision ? `第 ${item.revision} 版` : ''}`, item)}>{kind === 'category-catalog' ? '刪除此版' : '刪除'}</button>
      {item.editBlocked && <small>已被活動使用</small>}
    </div>;
  }
  async function deleteItem() {
    if (!removal || locked || removal.item.deleteBlocked) return;
    setBusy(true); setError('');
    try { await saveSharedReference({ action: 'delete', kind: removal.kind, path: removal.item.path, version: removal.item.version }); }
    catch (failure) { setError(messageOf(failure)); setBusy(false); return; }
    setRemoval(null); setForm(null); setNotice('共用資料已刪除。'); setRefreshRequired(true);
    try { setCatalog(await readSharedReferences()); setRefreshRequired(false); }
    catch { setError('資料已刪除，清單更新失敗。請重新讀取。'); }
    finally { setBusy(false); }
  }
  async function refresh() {
    if (!mayLeave()) return;
    setBusy(true); setError('');
    try { setCatalog(await readSharedReferences()); setRefreshRequired(false); setForm(null); setRemoval(null); }
    catch (failure) { setError(messageOf(failure)); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || locked) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await saveSharedReference({ ...form.values, kind: form.kind,
        ...(form.kind === 'category-catalog' ? { categories: form.values.categories.split('\n').map(label => label.trim()).filter(Boolean).map(label => ({ label })) } : {}) });
    } catch (failure) { setError(messageOf(failure)); setBusy(false); return; }
    if (form.kind === 'category-catalog' && form.values.catalogId) setExpanded(previous => new Set([...previous, form.values.catalogId]));
    setForm(null); setNotice('共用資料已儲存。'); setRefreshRequired(true);
    try { setCatalog(await readSharedReferences()); setRefreshRequired(false); }
    catch { setError('資料已儲存，清單更新失敗。請重新讀取。'); }
    finally { setBusy(false); }
  }
  function field(key: string, label: string, required = true, type = 'text') {
    return <label>{label}<input type={type} value={form!.values[key] ?? ''} required={required} maxLength={key.includes('Url') ? 2048 : 200}
      onChange={event => setForm({ ...form!, values: { ...form!.values, [key]: event.target.value } })} /></label>;
  }
  const venue = catalog?.venues.find(item => item.id === selected);
  const groups = [...new Set(catalog?.categories.map(item => item.id))].map(id => ({ id,
    versions: catalog!.categories.filter(item => item.id === id).sort((a, b) => Number(b.revision) - Number(a.revision)) }));
  const errorNotice = error && <div role="alert" className={styles.error}>{error} <button type="button" disabled={busy} onClick={() => void refresh()}>重新讀取</button></div>;
  return <section className={`${styles.card} ${ui.panel}`} aria-labelledby="shared-title">
    <h2 id="shared-title">共用資料</h2>
    <p>場館與場地、主辦單位及分類目錄。</p>
    <div className={ui.topbar}><div className={ui.tabs} role="group" aria-label="資料類別">
      {([['venues', '場館與場地'], ['organizers', '主辦單位'], ['categories', '分類目錄']] as const).map(([key, label]) =>
        <button key={key} type="button" aria-pressed={section === key} disabled={busy} onClick={() => {
          if (mayLeave()) { setSection(key); setForm(null); setSelected(''); setSearch(''); setNotice(''); if (!refreshRequired) setError(''); }
        }}>{label}</button>)}
    </div>{catalog && section === 'categories' && <button type="button" disabled={locked || !catalog.organizers.length} onClick={() => open('category-catalog', '新增分類目錄')}>新增分類目錄</button>}</div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!modalOpen && errorNotice}
    {!catalog && !error && <p role="status">載入中…</p>}
    {catalog && <>
      {section === 'venues' && <>
        <div className={ui.filters}><label>搜尋場館<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label className={ui.check}><input type="checkbox" checked={missing} onChange={event => setMissing(event.target.checked)} />只看缺少地址</label>
          <button type="button" disabled={locked} onClick={() => open('venue-create', '新增場館')}>新增場館</button></div>
        <div className={ui.columns}><ul className={ui.list} aria-label="場館清單">
          {catalog.venues.filter(item => (!missing || !item.address) && `${item.name} ${item.publicName ?? ''}`.includes(search.trim())).map(item =>
            <li key={item.id}><button type="button" aria-pressed={selected === item.id} disabled={busy} onClick={() => {
              if (mayLeave()) { setSelected(item.id); setForm(null); setNotice(''); if (!refreshRequired) setError(''); }
            }}>{item.name}</button><p>{item.address ?? '尚未填寫地址'}</p></li>)}
          {!catalog.venues.some(item => (!missing || !item.address) && `${item.name} ${item.publicName ?? ''}`.includes(search.trim())) && <li>沒有符合的場館。</li>}
        </ul>
        {venue && <div className={ui.detail}>
          <h3>{venue.name}</h3>
          {venue.publicName && venue.publicName !== venue.name && <p>公開名稱：{venue.publicName}</p>}
          <p>地址：{venue.address ?? '尚未填寫'}</p>
          {(venue.officialUrl ?? venue.sourceUrl) && <p><a href={venue.officialUrl ?? venue.sourceUrl!} target="_blank" rel="noreferrer">場館官方來源</a></p>}
          {!venue.version ? <button type="button" disabled={locked} onClick={() => open('venue', '補齊場館來源', { venueId: venue.id, name: venue.name, sourceUrl: venue.sourceUrl ?? '' })}>補齊場館來源</button>
            : !venue.address && <button type="button" disabled={locked} onClick={() => open('venue-address', '補上地址', { venueId: venue.id, version: venue.version! })}>補上地址</button>}
          {venue.version && controls('venue', '場館', venue, { name: venue.publicName, sourceUrl: venue.officialUrl, address: venue.address ?? '' })}
          <h4>場地</h4><ul className={ui.list}>{venue.spaces.map(space => <li key={space.id}>
            <strong>{space.name}</strong>{space.publicName && space.publicName !== space.name && <p>公開名稱：{space.publicName}</p>}
            <p>展區預設：{space.defaultAreaMode === 'none' ? '不分區' : '依攤位名單'}</p>
            {(space.officialUrl ?? space.sourceUrl) && <a href={space.officialUrl ?? space.sourceUrl!} target="_blank" rel="noreferrer">場地官方來源</a>}
            {!space.version && <button type="button" disabled={locked} onClick={() => open('venue-space', '補齊場地來源', { venueId: venue.id, spaceId: space.id, name: space.name, sourceUrl: space.sourceUrl ?? venue.officialUrl ?? venue.sourceUrl ?? '' })}>補齊「{space.name}」來源</button>}
            {space.version && controls('venue-space', space.name, space, { name: space.publicName, sourceUrl: space.officialUrl, defaultAreaMode: space.defaultAreaMode })}
          </li>)}</ul>
          <button type="button" disabled={locked} onClick={() => open('venue-space-create', `新增場地：${venue.name}`, { venueId: venue.id })}>新增場地</button>
        </div>}</div>
      </>}
      {section === 'organizers' && <><button type="button" disabled={locked} onClick={() => open('organizer', '新增主辦單位')}>新增主辦單位</button>
        <ul className={ui.list}>{catalog.organizers.map(item => <li key={item.id} className={ui.organizerRow}><div><strong>{item.name}</strong> · <a href={item.officialUrl} target="_blank" rel="noreferrer">原始來源</a></div>
          {controls('organizer', '主辦單位', item, { name: item.name, sourceUrl: item.officialUrl })}</li>)}</ul>
        {!catalog.organizers.length && <p>尚無主辦單位。</p>}</>}
      {section === 'categories' && <>
        {!catalog.organizers.length && <p>請先新增主辦單位。</p>}
        <div className={ui.catalogTable}>
          <div className={ui.tableHead} aria-hidden="true"><span>目錄名稱</span><span>主辦單位</span><span>版本</span><span>分類數</span><span>操作</span></div>
          {groups.map(group => { const latest = group.versions[0]; return <div key={group.id} className={ui.catalogGroup}>
            <div className={ui.catalogRow}><button type="button" className={ui.disclosure} aria-expanded={expanded.has(group.id)} aria-controls={`catalog-${group.id}`}
              onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>
              <UiIcon name="chevron-right" className={expanded.has(group.id) ? ui.expandedIcon : undefined} />{latest.name}</button>
              <span>{catalog.organizers.find(org => org.id === latest.organizerId)?.name}</span><span>第 {latest.revision} 版</span><span>{latest.categories.length} 個分類</span>
              {controls('category-catalog', '分類目錄', latest, { name: latest.name, sourceUrl: latest.sourceUrl, organizerId: latest.organizerId, categories: latest.categories.map(category => category.label).join('\n'), catalogId: latest.id })}</div>
            <div id={`catalog-${group.id}`} hidden={!expanded.has(group.id)}>{group.versions.map(item => <section key={item.revision} className={ui.version} aria-label={`${item.name}第 ${item.revision} 版`}>
              {item !== latest && <div className={ui.versionHeader}><span>{item.name} · 第 {item.revision} 版</span>{controls('category-catalog', '分類目錄', item,
                { name: item.name, sourceUrl: item.sourceUrl, organizerId: item.organizerId, categories: item.categories.map(category => category.label).join('\n'), catalogId: item.id })}</div>
              }
              <details open={item === latest}><summary>第 {item.revision} 版（{item.categories.length} 個分類）</summary>
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">原始來源</a>
                <ul className={ui.categoryList}>{item.categories.map(category => <li key={category.id}>{category.label}{category.description ? `：${category.description}` : ''}</li>)}</ul>
              </details>
            </section>)}</div>
          </div>; })}
        </div>
        {!catalog.categories.length && <p>尚無分類目錄。</p>}</>}
    </>}
    {modalOpen && <dialog ref={dialog} className={ui.dialog} aria-labelledby="reference-dialog-title" onCancel={event => { event.preventDefault(); if (mayLeave()) { setForm(null); setRemoval(null); } }}>
    {form && <form ref={formElement} className={ui.form} onSubmit={event => void save(event)}><div className={ui.dialogHeader}>
      <div><h3 id="reference-dialog-title">{form.title}</h3>{form.values.revision && <p>{JSON.parse(form.initial).name} · 第 {form.values.revision} 版</p>}</div>
      <button type="button" aria-label="關閉" disabled={busy} onClick={() => { if (mayLeave()) setForm(null); }}><UiIcon name="close" /></button></div>{errorNotice}<fieldset disabled={locked}>
      {form.kind !== 'venue-address' && field('name', form.kind === 'venue-create' ? '場館名稱' : form.kind.includes('space') ? '場地名稱' : form.kind === 'organizer' ? '主辦名稱' : form.kind === 'category-catalog' ? '目錄名稱' : '公開名稱')}
      {form.kind !== 'venue-address' && field('sourceUrl', '官方來源網址', form.kind !== 'venue-space-create', 'url')}
      {form.kind === 'venue-space-create' && <p>網址留空時沿用場館來源。</p>}
      {['venue', 'venue-create', 'venue-address'].includes(form.kind) && <>{field('address', '場館地址')}<p>貼上場館官方網站上的完整地址。</p></>}
      {form.kind === 'venue-create' && <>{field('spaceName', '第一個場地名稱')}{field('spaceSourceUrl', '場地來源網址', false, 'url')}<p>場地網址留空時沿用場館來源。</p></>}
      {(['venue-create', 'venue-space-create'].includes(form.kind) || form.kind === 'venue-space' && form.values.action === 'edit') && <label>展區預設<select value={form.values.defaultAreaMode} onChange={event => setForm({ ...form, values: { ...form.values, defaultAreaMode: event.target.value } })}>
        <option value="imported">依攤位名單</option><option value="none">不分區</option></select></label>}
      {form.kind === 'category-catalog' && <><label>所屬主辦<select required disabled={form.values.action === 'edit'} value={form.values.organizerId} onChange={event => setForm({ ...form, values: { ...form.values, organizerId: event.target.value } })}>
        <option value="">請選擇主辦單位</option>{catalog?.organizers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>分類名稱（每行一個）<textarea required rows={7} value={form.values.categories} onChange={event => setForm({ ...form, values: { ...form.values, categories: event.target.value } })} /></label>
        <p>依每行順序顯示。{form.values.action === 'edit' && '儲存後建立新版本，保留舊版；既有活動不會自動切換版本。'}</p></>}
      <div className={ui.actions}><button type="button" onClick={() => { if (mayLeave()) setForm(null); }}>取消</button>
        <button type="submit">{busy ? '儲存中…' : form.kind === 'venue-address' ? '儲存地址' : form.kind === 'category-catalog' && form.values.action === 'edit' ? '儲存新版本' : '儲存'}</button></div>
    </fieldset></form>}
    {removal && <><h3 id="reference-dialog-title">{removal.item.deleteBlocked ? '無法刪除' : '確認刪除'}{removal.name}</h3>{errorNotice}
      <p>{removal.item.deleteBlocked ? removal.item.deleteReason : `刪除後無法復原。${removal.kind === 'category-catalog' ? '其他版本會保留。' : ''}`}</p>
      <div className={ui.actions}><button type="button" disabled={busy} onClick={() => setRemoval(null)}>取消</button>
        {!removal.item.deleteBlocked && <button type="button" className={ui.danger} disabled={locked} onClick={() => void deleteItem()}>{busy ? '刪除中…' : '確認刪除'}</button>}</div></>}
    </dialog>}
  </section>;
}
