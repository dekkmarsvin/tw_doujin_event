"use client";
import { createPortal } from "react-dom";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  advancedCircleSearchCount,
  AGE_RATING_OPTIONS,
  ageRatingFilterLabel,
  CREATOR_TYPE_OPTIONS,
  findWorkTopicSuggestions,
  normalizeWorkTopics,
  WORK_TYPE_OPTIONS,
  type AdvancedCircleSearch,
  type WorkTopicSuggestion,
} from "./circle-search";
import { allCircleCategoriesLabel } from "./circle-categories";
import { circleOptionLabel } from "./circle-overrides";
import { formatCount } from "./i18n/format";
import { useLocale, useMessages } from "./i18n/locale-context";
import { defineMessages } from "./i18n/messages";
import { useModalFocus } from "./use-modal-focus";
import { UiIcon } from "./ui-icons";
import styles from "./advanced-circle-search.module.css";

type TopicList = "workTopics" | "excludedWorkTopics";

const MESSAGES = defineMessages({
  "zh-Hant": {
    dialog: "詳細搜尋條件",
    category: "社團分類",
    creatorType: "創作內容",
    all: "全部",
    topic: "作品名稱／題材",
    topicPlaceholder: "輸入作品或題材，例如：賽馬娘",
    suggestions: "作品題材建議",
    existingTopic: "現有作品題材",
    suggestionCount: "{count} 社團",
    noSuggestion: "沒有相符建議，仍可直接加入目前文字。",
    include: "加入",
    exclude: "排除",
    included: "已加入的作品題材",
    removeIncluded: "移除作品題材：{topic}",
    excluded: "已排除的作品題材",
    removeExcluded: "取消排除：{topic}",
    topicHint: "多筆題材可用「符合任一」或「全部符合」組合；「排除」的題材一律不出現在結果中。",
    combine: "多筆題材如何組合",
    any: "符合任一",
    allMatch: "全部符合",
    workType: "作品取向",
    anyWorkType: "不限",
    ageRating: "年齡分級",
    cancel: "取消",
    apply: "套用搜尋",
    section: "社團內容詳細搜尋",
    trigger: "詳細搜尋",
    applied: "已套用 {count} 項",
    summary: "創作者、作品與分級",
  },
  en: {
    dialog: "Advanced search filters",
    category: "Circle category",
    creatorType: "Creator type",
    all: "All",
    topic: "Work title / topic",
    topicPlaceholder: "Enter a work or topic, e.g. Uma Musume",
    suggestions: "Topic suggestions",
    existingTopic: "Existing topic",
    suggestionCount: ({ count }, locale) => Number(count) === 1 ? "1 circle" : `${formatCount(Number(count), locale)} circles`,
    noSuggestion: "No matching suggestions. You can still add what you typed.",
    include: "Add",
    exclude: "Exclude",
    included: "Included topics",
    removeIncluded: "Remove topic: {topic}",
    excluded: "Excluded topics",
    removeExcluded: "Stop excluding: {topic}",
    topicHint: "Combine several topics with “Match any” or “Match all”. Excluded topics never appear in results.",
    combine: "How to combine topics",
    any: "Match any",
    allMatch: "Match all",
    workType: "Audience",
    anyWorkType: "Any",
    ageRating: "Age rating",
    cancel: "Cancel",
    apply: "Apply search",
    section: "Advanced circle search",
    trigger: "Advanced search",
    applied: ({ count }, locale) => `${formatCount(Number(count), locale)} applied`,
    summary: "Creators, works and ratings",
  },
  ja: {
    dialog: "詳細検索の条件",
    category: "サークルカテゴリ",
    creatorType: "創作ジャンル",
    all: "すべて",
    topic: "作品名・題材",
    topicPlaceholder: "作品名や題材を入力（例：ウマ娘）",
    suggestions: "作品・題材の候補",
    existingTopic: "登録済みの題材",
    suggestionCount: ({ count }, locale) => `${formatCount(Number(count), locale)}サークル`,
    noSuggestion: "一致する候補はありません。入力した文字をそのまま追加できます。",
    include: "追加",
    exclude: "除外",
    included: "追加した題材",
    removeIncluded: "題材を削除：{topic}",
    excluded: "除外した題材",
    removeExcluded: "除外を解除：{topic}",
    topicHint: "複数の題材は「いずれかに一致」または「すべてに一致」で組み合わせられます。「除外」した題材は結果に表示されません。",
    combine: "複数題材の組み合わせ方",
    any: "いずれかに一致",
    allMatch: "すべてに一致",
    workType: "作品の傾向",
    anyWorkType: "指定なし",
    ageRating: "年齢区分",
    cancel: "キャンセル",
    apply: "この条件で検索",
    section: "サークルの詳細検索",
    trigger: "詳細検索",
    applied: ({ count }, locale) => `${formatCount(Number(count), locale)}件適用中`,
    summary: "作者・作品・年齢区分",
  },
});

/** The value that means every category; only its label follows the language. */
const ALL_CATEGORIES = allCircleCategoriesLabel();

export default function AdvancedCircleSearchControls({ value, workSuggestions, onApply, categories, category }: {
  value: AdvancedCircleSearch;
  workSuggestions: WorkTopicSuggestion[];
  onApply: (next: AdvancedCircleSearch, category?: string) => void;
  categories?: readonly string[];
  category?: string;
}) {
  const [draftCategory, setDraftCategory] = useState(category);
  const { locale } = useLocale();
  const t = useMessages(MESSAGES);
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
    }, draftCategory);
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

  const panel = <div ref={panelRef} id={panelId} className={`${styles.panel} ${categories ? styles.browsePanel : ""}`} role="dialog" aria-modal="true" aria-label={t("dialog")} tabIndex={-1}>
      {categories && <label>{t("category")}<select value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)}>{categories.map((value) => <option key={value} value={value}>{value === ALL_CATEGORIES ? allCircleCategoriesLabel(locale) : value}</option>)}</select></label>}
      <label>
        {t("creatorType")}
        <select value={draft.creatorType} onChange={(event) => setDraft({ ...draft, creatorType: event.target.value })}>
          <option value="ALL">{t("all")}</option>
          {CREATOR_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{circleOptionLabel(option, locale)}</option>)}
        </select>
      </label>
      <div className={styles.field}>
        <label htmlFor={`${suggestionListId}-input`}>{t("topic")}</label>
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
              placeholder={t("topicPlaceholder")}
            />
            {showSuggestions && <div id={suggestionListId} className={styles.suggestions} role="listbox" aria-label={t("suggestions")}>
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
                <span><b>{suggestion.value}</b><small>{suggestion.aliases.length > 0 ? suggestion.aliases.join(" · ") : t("existingTopic")}</small></span>
                <em>{t("suggestionCount", { count: suggestion.count })}</em>
              </button>) : <p role="status">{t("noSuggestion")}</p>}
            </div>}
          </span>
          <button type="button" disabled={!topicInput.trim()} onClick={() => addTopic("workTopics", topicInput)}>{t("include")}</button>
          <button type="button" disabled={!topicInput.trim()} onClick={() => addTopic("excludedWorkTopics", topicInput)}>{t("exclude")}</button>
        </div>
        {chipList("workTopics", draft.workTopics, t("included"), (topic) => t("removeIncluded", { topic }))}
        {chipList("excludedWorkTopics", draft.excludedWorkTopics, t("excluded"), (topic) => t("removeExcluded", { topic }))}
        <small>{t("topicHint")}</small>
      </div>
      {draft.workTopics.length > 1 && <fieldset>
        <legend>{t("combine")}</legend>
        <div className={`${styles.segments} ${styles.modeSegments}`}>
          {([["any", t("any")], ["all", t("allMatch")]] as const).map(([option, label]) => <button
            type="button"
            key={option}
            aria-pressed={draft.workTopicMode === option}
            className={draft.workTopicMode === option ? styles.active : ""}
            onClick={() => setDraft({ ...draft, workTopicMode: option })}
          >{label}</button>)}
        </div>
      </fieldset>}
      <fieldset>
        <legend>{t("workType")}</legend>
        <div className={styles.segments}>
          {(["ALL", ...WORK_TYPE_OPTIONS] as const).map((option) => <button type="button" key={option} aria-pressed={draft.workType === option} className={draft.workType === option ? styles.active : ""} onClick={() => setDraft({ ...draft, workType: option })}>{option === "ALL" ? t("anyWorkType") : circleOptionLabel(option, locale)}</button>)}
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("ageRating")}</legend>
        <div className={`${styles.segments} ${styles.ratingSegments}`}>
          {(["ALL", ...AGE_RATING_OPTIONS] as const).map((rating) => {
            const option = rating === "全年齡" ? "GENERAL" : rating;
            return <button type="button" key={option} aria-pressed={draft.adultContent === option} className={draft.adultContent === option ? styles.active : ""} onClick={() => setDraft({ ...draft, adultContent: option })}>{ageRatingFilterLabel(option, locale)}</button>;
          })}
        </div>
      </fieldset>
      <footer>
        <button type="button" onClick={closePanel}>{t("cancel")}</button>
        <button type="button" className={styles.apply} onClick={applyDraft}>{t("apply")}</button>
      </footer>
    </div>;
  return <section className={styles.wrap} aria-label={t("section")}>
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
        setDraftCategory(category);
        setTopicInput("");
        setOpen(nextOpen);
        if (nextOpen && !categories && window.innerWidth <= 760) {
          window.requestAnimationFrame(() => trigger.scrollIntoView({ block: "start", behavior: "auto" }));
        }
      }}
    >
      <span><UiIcon name="search" />{t("trigger")}</span>
      <small>{activeCount > 0 ? t("applied", { count: activeCount }) : t("summary")}</small>
    </button>
    {open && (categories ? createPortal(<div className={styles.browseBackdrop}>{panel}</div>, document.body) : panel)}
  </section>;
}
