import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/lib/attendance";
import {
  BODY_AREAS, CATEGORIES, CONTEXTS, INITIAL_STAGES, MECHANISMS, ONSETS, SIDES,
  injuryLabel, isLateral, openInSameArea, recurrenceCandidates, type InjuryDraft,
} from "@/lib/injuries";
import type { InjuryWithStatus } from "@/lib/types";

/**
 * The fields every injury entry point shares — the quick report dialog and the
 * match grid's inline panel — so the three can never ask different questions.
 * Controlled: the caller owns the draft and decides when it saves.
 */
export function InjuryFields({
  draft,
  onChange,
  occurredOn,
  problems,
  history,
  showContext = true,
  compact = false,
  editing = false,
}: {
  draft: InjuryDraft;
  onChange: (next: InjuryDraft) => void;
  /** The injury date — recurrence candidates must have ended by then. */
  occurredOn: string;
  /** Shown only once the caller has tried to save. */
  problems: Record<string, string>;
  /** This player's injuries, for the recurrence picker and the setback warning. */
  history: InjuryWithStatus[];
  /** Hidden where the entry point already fixes it (the match grid is always "match"). */
  showContext?: boolean;
  compact?: boolean;
  /**
   * Editing an existing injury: no "Status now" (stages are a dated history,
   * changed below it in the dialog) and expected back always shown.
   */
  editing?: boolean;
}) {
  const set = <K extends keyof InjuryDraft>(key: K, value: InjuryDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const injury = draft.category === "injury";
  const candidates = injury ? recurrenceCandidates(history, draft.body_area || null, occurredOn) : [];
  const openSame = injury ? openInSameArea(history, draft.body_area || null, occurredOn) : [];

  const selectCls = cn(
    "w-full bg-muted border rounded-lg px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary",
    compact ? "py-1.5" : "py-2",
  );

  return (
    <div className={cn(compact ? "grid gap-3 sm:grid-cols-2" : "space-y-4")}>
      <Field label="Type" problem={problems.category}>
        <Segmented
          options={CATEGORIES}
          value={draft.category}
          // Switching category clears the recurrence link: an illness has none
          onChange={(v) => onChange({ ...draft, category: v, recurrence_of: "" })}
        />
      </Field>

      {showContext && (
        <Field label="Where" problem={problems.context}>
          <Segmented options={CONTEXTS} value={draft.context} onChange={(v) => set("context", v)} />
        </Field>
      )}

      {injury && (
        <Field label="Body area" problem={problems.body_area}>
          <select
            value={draft.body_area}
            onChange={(e) => onChange({
              ...draft,
              body_area: e.target.value,
              // A side picked for a knee means nothing on the back
              side: isLateral(e.target.value) ? draft.side : "",
              recurrence_of: "",
            })}
            className={cn(selectCls, problems.body_area ? "border-status-bad" : "border-border")}
            data-testid="select-injury-body-area"
          >
            <option value="">Select…</option>
            {BODY_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
      )}

      {injury && isLateral(draft.body_area) && (
        <Field label="Side" problem={problems.side}>
          <Segmented options={SIDES} value={draft.side} onChange={(v) => set("side", v)} />
        </Field>
      )}

      {injury && (
        <Field label="Mechanism" problem={problems.mechanism}>
          <Segmented options={MECHANISMS} value={draft.mechanism} onChange={(v) => set("mechanism", v)} />
        </Field>
      )}

      {injury && (
        <Field label="Onset" problem={problems.onset}>
          <Segmented
            options={ONSETS.map((o) => ({ value: o.value, label: o.label, title: o.hint }))}
            value={draft.onset}
            onChange={(v) => set("onset", v)}
          />
        </Field>
      )}

      {!editing && (
      <Field label="Status now" problem={problems.stage}>
        <select
          value={draft.stage}
          onChange={(e) => set("stage", e.target.value as InjuryDraft["stage"])}
          className={cn(selectCls, "border-border")}
        >
          {INITIAL_STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Field>
      )}

      {(editing || draft.stage !== "match_fit") && (
        <Field label="Expected back" optional problem={problems.expected_return_on}>
          <input
            type="date"
            value={draft.expected_return_on}
            min={occurredOn}
            onChange={(e) => set("expected_return_on", e.target.value)}
            className={cn(selectCls, problems.expected_return_on ? "border-status-bad" : "border-border")}
          />
        </Field>
      )}

      {candidates.length > 0 && (
        <Field label="Recurrence of" optional>
          <select
            value={draft.recurrence_of}
            onChange={(e) => set("recurrence_of", e.target.value)}
            className={cn(selectCls, "border-border")}
          >
            <option value="">No — a new injury</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {injuryLabel(c)} · {formatDateShort(c.occurred_on)}, back {formatDateShort(c.returned_on!)}
              </option>
            ))}
          </select>
        </Field>
      )}

      {openSame.length > 0 && (
        <p className={cn("flex items-start gap-1.5 text-[11px] text-status-warn", compact && "sm:col-span-2")}>
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          <span>
            Already out with {openSame.map((i) => `${injuryLabel(i)} since ${formatDateShort(i.occurred_on)}`).join(", ")}.
            If this is the same problem getting worse, it's a setback on that injury, not a new one.
          </span>
        </p>
      )}

      <Field label="Notes" optional className={compact ? "sm:col-span-2" : undefined}>
        <input
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder={injury ? "e.g. ACL tear, 62', went down in a tackle" : "e.g. fever"}
          className={cn(selectCls, "border-border placeholder:text-muted-foreground/40")}
        />
      </Field>
    </div>
  );
}

function Field({
  label, optional, problem, className, children,
}: {
  label: string;
  optional?: boolean;
  problem?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-muted-foreground mb-1">
        {label} {optional && <span className="text-muted-foreground/50">(optional)</span>}
      </label>
      {children}
      {problem && <p className="text-[11px] text-status-bad mt-1">{problem}</p>}
    </div>
  );
}

/** A short set of mutually exclusive choices, all visible — quicker than a select for two or three. */
function Segmented<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string; title?: string }[];
  value: T | "";
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 min-w-[4.5rem] px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
            value === o.value
              ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
