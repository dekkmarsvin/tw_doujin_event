"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  advancedCircleSearchCount,
  CREATOR_TYPE_OPTIONS,
  findWorkTopicSuggestions,
  normalizeWorkTopics,
  type AdvancedCircleSearch,
  type WorkTopicSuggestion,
} from "./circle-search";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import styles from "./advanced-circle-search.module.css";

type TopicList = "workTopics" | "excludedWorkTopics";

export default function AdvancedCircleSearchControls({ value, workSuggestions, onApply }: {
  value: AdvancedCircleSearch;
  workSuggestions: WorkTopicSuggestion[];
  onApply: (next: AdvancedCircleSearch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  // The half-typed topic is draft state twice over: it is not applied, and it is
  // not a condition yet either. It never reaches the URL.
  const [topicInput, setTopicInput] = useState("");
  const [workInputFocused, setWorkInputFocused] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const suggestionListId = useId();
  const activeCount = advancedCircleSearchCount(value);
  const matchingSuggestions = useMemo(
    () => findWorkTopicSuggestions(workSuggestions, topicInput),
    [topicInput, workSuggestions],
  );
  const showSuggestions = workInputFocused && Boolean(topicInput.trim());

  const closePanel = () => {
    setDraft(value);
    setTopicInput("");
    setOpen(false);
    setWorkInputFocused(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  // Focus entry, the Tab ring and Escape all come from the shared hook, so this
  // panel and the planning one cannot drift apart again.
  useModalFocus(open, panelRef, closePanel);

  /** A topic belongs to exactly one list, so adding it to one drops it from the
   * other. Required and excluded at once always yields nothing, and the result
   * panel would have no way to explain why. */
  const addTopic = (list: TopicList, topic: string) => {
    const entry = topic.trim();
    if (!entry) return;
    const other: TopicList = list === "workTopics" ? "excludedWorkTopics" : "workTopics";
    setDraft((current) => ({
      ...current,
      [list]: normalizeWorkTopics([...current[list], entry]),
      [other]: normalizeWorkTopics(current[other]).filter((existing) => existing !== entry),
    }));
    setTopicInput("");
    setActiveSuggestion(0);
  };

  const removeTopic = (list: TopicList, topic: string) => setDraft((current) => ({
    ...current,
    [list]: current[list].filter((existing) => existing !== topic),
  }));

  const handleWorkQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const suggestion = showSuggestions ? matchingSuggestions[activeSuggestion] ?? matchingSuggestions[0] : undefined;
      addTopic("workTopics", suggestion?.value ?? topicInput);
      return;
    }
    if (!showSuggestions || matchingSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % matchingSuggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) => (current - 1 + matchingSuggestions.length) % matchingSuggestions.length);
    }
  };

  const applyDraft = () => {
    // Text left in the box is what the reader meant to search for; dropping it
    // on apply would silently discard the thing they just typed.
    const pending = topicInput.trim();
    const workTopics = normalizeWorkTopics(pending ? [...draft.workTopics, pending] : draft.workTopics);
    const excludedWorkTopics = normalizeWorkTopics(draft.excludedWorkTopics)
      .filter((topic) => !workTopics.includes(topic));
    onApply({
      ...draft,
      workTopics,
      excludedWorkTopics,
      workTopicMode: workTopics.length > 1 ? draft.workTopicMode : "any",
    });
    setTopicInput("");
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const chipList = (list: TopicList, topics: string[], label: string, removeLabel: (topic: string) => string) => topics.length > 0
    && <ul className={`${styles.chips} ${list === "excludedWorkTopics" ? styles.excluded : ""}`} aria-label={label}>
      {topics.map((topic) => <li key={topic}>
        <button type="button" onClick={() => removeTopic(list, topic)} aria-label={removeLabel(topic)}>
          {topic}<UiIcon name="close" />
        </button>
      </li>)}
    </ul>;

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
        setTopicInput("");
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
        <div className={styles.topicRow}>
          <span className={styles.workInput}>
            <input
              id={`${suggestionListId}-input`}
              value={topicInput}
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
                setTopicInput(event.target.value);
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
                onClick={() => addTopic("workTopics", suggestion.value)}
              >
                <span><b>{suggestion.value}</b><small>{suggestion.aliases.length > 0 ? suggestion.aliases.join(" · ") : "現有作品題材"}</small></span>
                <em>{suggestion.count} 社團</em>
              </button>) : <p role="status">沒有相符建議，仍可直接加入目前文字。</p>}
            </div>}
          </span>
          <button type="button" disabled={!topicInput.trim()} onClick={() => addTopic("workTopics", topicInput)}>加入</button>
          <button type="button" disabled={!topicInput.trim()} onClick={() => addTopic("excludedWorkTopics", topicInput)}>排除</button>
        </div>
        {chipList("workTopics", draft.workTopics, "已加入的作品題材", (topic) => `移除作品題材：${topic}`)}
        {chipList("excludedWorkTopics", draft.excludedWorkTopics, "已排除的作品題材", (topic) => `取消排除：${topic}`)}
        <small>多筆題材可用「符合任一」或「全部符合」組合；「排除」的題材一律不出現在結果中。</small>
      </div>
      {draft.workTopics.length > 1 && <fieldset>
        <legend>多筆題材如何組合</legend>
        <div className={`${styles.segments} ${styles.modeSegments}`}>
          {([["any", "符合任一"], ["all", "全部符合"]] as const).map(([option, label]) => <button
            type="button"
            key={option}
            aria-pressed={draft.workTopicMode === option}
            className={draft.workTopicMode === option ? styles.active : ""}
            onClick={() => setDraft({ ...draft, workTopicMode: option })}
          >{label}</button>)}
        </div>
      </fieldset>}
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
        <button type="button" className={styles.apply} onClick={applyDraft}>套用搜尋</button>
      </footer>
    </div>}
  </section>;
}
