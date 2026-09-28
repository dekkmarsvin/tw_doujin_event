import { useEffect, useRef, useState } from 'react';
import { readSharedReferences, saveSharedReference } from '../organizer-client';
import type { SharedReferenceCatalog } from '../shared-reference-catalog';
import styles from '../circle-portal/portal.module.css';
import ui from './admin-reference-panel.module.css';

type Form = { kind: string; title: string; values: Record<string, string>; initial: string };
type Section = 'venues' | 'organizers' | 'categories';
const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作失敗，請稍後再試。';

export function AdminReferencePanel() {
  const formElement = useRef<HTMLFormElement>(null);
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
  async function refresh() {
    if (!mayLeave()) return;
    setBusy(true); setError('');
    try { setCatalog(await readSharedReferences()); setRefreshRequired(false); setForm(null); }
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
  return <section className={`${styles.card} ${ui.panel}`} aria-labelledby="shared-title">
    <h2 id="shared-title">共用資料</h2>
    <p>場館與場地、主辦單位及分類目錄。</p>
    <div className={ui.tabs} role="group" aria-label="資料類別">
      {([['venues', '場館與場地'], ['organizers', '主辦單位'], ['categories', '分類目錄']] as const).map(([key, label]) =>
        <button key={key} type="button" aria-pressed={section === key} disabled={busy} onClick={() => {
          if (mayLeave()) { setSection(key); setForm(null); setSelected(''); setSearch(''); setNotice(''); if (!refreshRequired) setError(''); }
        }}>{label}</button>)}
    </div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && <div role="alert" className={styles.error}>{error} <button type="button" disabled={busy} onClick={() => void refresh()}>重新讀取</button></div>}
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
          <h4>場地</h4><ul className={ui.list}>{venue.spaces.map(space => <li key={space.id}>
            <strong>{space.name}</strong>{space.publicName && space.publicName !== space.name && <p>公開名稱：{space.publicName}</p>}
            <p>展區預設：{space.defaultAreaMode === 'none' ? '不分區' : '依攤位名單'}</p>
            {(space.officialUrl ?? space.sourceUrl) && <a href={space.officialUrl ?? space.sourceUrl!} target="_blank" rel="noreferrer">場地官方來源</a>}
            {!space.version && <button type="button" disabled={locked} onClick={() => open('venue-space', '補齊場地來源', { venueId: venue.id, spaceId: space.id, name: space.name, sourceUrl: space.sourceUrl ?? venue.officialUrl ?? venue.sourceUrl ?? '' })}>補齊「{space.name}」來源</button>}
          </li>)}</ul>
          <button type="button" disabled={locked} onClick={() => open('venue-space-create', `新增場地：${venue.name}`, { venueId: venue.id })}>新增場地</button>
        </div>}</div>
      </>}
      {section === 'organizers' && <><button type="button" disabled={locked} onClick={() => open('organizer', '新增主辦單位')}>新增主辦單位</button>
        <ul className={ui.list}>{catalog.organizers.map(item => <li key={item.id}><strong>{item.name}</strong> · <a href={item.officialUrl} target="_blank" rel="noreferrer">官方來源</a></li>)}</ul>
        {!catalog.organizers.length && <p>尚無主辦單位。</p>}</>}
      {section === 'categories' && <><button type="button" disabled={locked || !catalog.organizers.length} onClick={() => open('category-catalog', '新增分類目錄')}>新增分類目錄</button>
        {!catalog.organizers.length && <p>請先新增主辦單位。</p>}
        <ul className={ui.list}>{catalog.categories.map(item => <li key={`${item.id}:${item.revision}`}><strong>{item.name}</strong>
          <p>{catalog.organizers.find(org => org.id === item.organizerId)?.name} · 第 {item.revision} 版 · <a href={item.sourceUrl} target="_blank" rel="noreferrer">官方來源</a></p>
          <ul>{item.categories.map(category => <li key={category.id}>{category.label}{category.description ? `：${category.description}` : ''}</li>)}</ul></li>)}</ul>
        {!catalog.categories.length && <p>尚無分類目錄。</p>}</>}
    </>}
    {form && <form ref={formElement} className={ui.form} onSubmit={event => void save(event)}><h3>{form.title}</h3><fieldset disabled={locked}>
      {form.kind !== 'venue-address' && field('name', form.kind === 'venue-create' ? '場館名稱' : form.kind.includes('space') ? '場地名稱' : form.kind === 'organizer' ? '主辦名稱' : form.kind === 'category-catalog' ? '目錄名稱' : '公開名稱')}
      {form.kind !== 'venue-address' && field('sourceUrl', '官方來源網址', form.kind !== 'venue-space-create', 'url')}
      {form.kind === 'venue-space-create' && <p>網址留空時沿用場館來源。</p>}
      {['venue', 'venue-create', 'venue-address'].includes(form.kind) && <>{field('address', '場館地址')}<p>貼上場館官方網站上的完整地址。</p></>}
      {form.kind === 'venue-create' && <>{field('spaceName', '第一個場地名稱')}{field('spaceSourceUrl', '場地來源網址', false, 'url')}<p>場地網址留空時沿用場館來源。</p></>}
      {['venue-create', 'venue-space-create'].includes(form.kind) && <label>展區預設<select value={form.values.defaultAreaMode} onChange={event => setForm({ ...form, values: { ...form.values, defaultAreaMode: event.target.value } })}>
        <option value="imported">依攤位名單</option><option value="none">不分區</option></select></label>}
      {form.kind === 'category-catalog' && <><label>所屬主辦<select required value={form.values.organizerId} onChange={event => setForm({ ...form, values: { ...form.values, organizerId: event.target.value } })}>
        <option value="">請選擇主辦單位</option>{catalog?.organizers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>分類名稱（每行一個）<textarea required rows={5} value={form.values.categories} onChange={event => setForm({ ...form, values: { ...form.values, categories: event.target.value } })} /></label></>}
      <p>已發布活動須完成發布後修正，才會顯示此資料。</p>
      <div className={ui.actions}><button type="submit">{busy ? '儲存中…' : form.kind === 'venue-address' ? '儲存地址' : '儲存'}</button>
        <button type="button" onClick={() => { if (mayLeave()) setForm(null); }}>取消</button></div>
    </fieldset></form>}
  </section>;
}
