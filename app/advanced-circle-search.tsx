"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  advancedCircleSearchCount,
  CREATOR_TYPE_OPTIONS,
  findWorkTopicSuggestions,
  type AdvancedCircleSearch,
  type WorkTopicSuggestion,
} from "./circle-search";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import styles from "./advanced-circle-search.module.css";

export default function AdvancedCircleSearchControls({ value, workSuggestions, onApply }: {
  value: AdvancedCircleSearch;
  workSuggestions: WorkTopicSuggestion[];
  onApply: (next: AdvancedCircleSearch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [workInputFocused, setWorkInputFocused] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const suggestionListId = useId();
  const activeCount = advancedCircleSearchCount(value);
  const matchingSuggestions = useMemo(
    () => findWorkTopicSuggestions(workSuggestions, draft.workQuery),
    [draft.workQuery, workSuggestions],
  );
  const showSuggestions = workInputFocused && Boolean(draft.workQuery.trim());

  const closePanel = () => {
    setDraft(value);
    setOpen(false);
    setWorkInputFocused(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  // Focus entry, the Tab ring and Escape all come from the shared hook, so this
  // panel and the planning one cannot drift apart again.
  useModalFocus(open, panelRef, closePanel);

  const selectSuggestion = (suggestion: WorkTopicSuggestion) => {
    setDraft((current) => ({ ...current, workQuery: suggestion.value }));
    setWorkInputFocused(false);
    setActiveSuggestion(0);
  };

  const handleWorkQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || matchingSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % matchingSuggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) => (current - 1 + matchingSuggestions.length) % matchingSuggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectSuggestion(matchingSuggestions[activeSuggestion] ?? matchingSuggestions[0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
    }
  };

  return <section className={styles.wrap} aria-label="社團內容詳細搜尋">
    <button
      type="button"
      ref={triggerRef}
      className={styles.trigger}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={(event) => {
        const nextOpen = !open;
        const trigger = event.currentTarget;
        setDraft(value);
        setOpen(nextOpen);
        if (nextOpen && window.innerWidth <= 760) {
          window.requestAnimationFrame(() => trigger.scrollIntoView({ block: "start", behavior: "auto" }));
        }
      }}
    >
      <span><UiIcon name="search" />詳細搜尋</span>
      <small>{activeCount > 0 ? `已套用 ${activeCount} 項` : "創作者、作品與分級"}</small>
    </button>
    {open && <div ref={panelRef} id={panelId} className={styles.panel} role="dialog" aria-modal="true" aria-label="詳細搜尋條件" tabIndex={-1}>
      <label>
        創作者類型
        <select value={draft.creatorType} onChange={(event) => setDraft({ ...draft, creatorType: event.target.value })}>
          <option value="ALL">全部類型</option>
          {CREATOR_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <div className={styles.field}>
        <label htmlFor={`${suggestionListId}-input`}>作品名稱／題材</label>
        <span className={styles.workInput}>
          <input
            id={`${suggestionListId}-input`}
            value={draft.workQuery}
            maxLength={120}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls={suggestionListId}
            aria-activedescendant={showSuggestions && matchingSuggestions.length > 0 ? `${suggestionListId}-${activeSuggestion}` : undefined}
            onFocus={() => setWorkInputFocused(true)}
            onBlur={() => setWorkInputFocused(false)}
            onKeyDown={handleWorkQueryKeyDown}
            onChange={(event) => {
              setDraft({ ...draft, workQuery: event.target.value });
              setActiveSuggestion(0);
              setWorkInputFocused(true);
            }}
            placeholder="輸入作品或題材，例如：賽馬娘"
          />
          {showSuggestions && <div id={suggestionListId} className={styles.suggestions} role="listbox" aria-label="作品題材建議">
            {matchingSuggestions.length > 0 ? matchingSuggestions.map((suggestion, index) => <button
              type="button"
              role="option"
              id={`${suggestionListId}-${index}`}
              aria-selected={activeSuggestion === index}
              key={suggestion.value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveSuggestion(index)}
              onClick={() => selectSuggestion(suggestion)}
            >
              <span><b>{suggestion.value}</b><small>{suggestion.aliases.length > 0 ? suggestion.aliases.join(" · ") : "現有作品題材"}</small></span>
              <em>{suggestion.count} 社團</em>
            </button>) : <p role="status">沒有相符建議，仍可直接套用目前文字。</p>}
          </div>}
        </span>
      </div>
      <fieldset>
        <legend>作品類型</legend>
        <div className={styles.segments}>
          {(["ALL", "原創", "二創"] as const).map((option) => <button type="button" key={option} aria-pressed={draft.workType === option} className={draft.workType === option ? styles.active : ""} onClick={() => setDraft({ ...draft, workType: option })}>{option === "ALL" ? "不限" : option}</button>)}
        </div>
      </fieldset>
      <fieldset>
        <legend>成人內容</legend>
        <div className={styles.segments}>
          {(["ALL", "R18", "GENERAL"] as const).map((option) => <button type="button" key={option} aria-pressed={draft.adultContent === option} className={draft.adultContent === option ? styles.active : ""} onClick={() => setDraft({ ...draft, adultContent: option })}>{option === "ALL" ? "不限" : option === "R18" ? "只看 R18" : "只看一般"}</button>)}
        </div>
      </fieldset>
      <footer>
        <button type="button" onClick={closePanel}>取消</button>
        <button type="button" className={styles.apply} onClick={() => { onApply({ ...draft, workQuery: draft.workQuery.trim() }); setOpen(false); window.requestAnimationFrame(() => triggerRef.current?.focus()); }}>套用搜尋</button>
      </footer>
    </div>}
  </section>;
}
