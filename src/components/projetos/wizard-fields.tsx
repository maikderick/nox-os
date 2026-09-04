"use client";

/**
 * The wizard's form primitives.
 *
 * They live apart from the wizard for one reason: the two rules that matter
 * most on this screen are visual — a value suggested by the lead must *look*
 * unconfirmed, and the operator's internal notes must *look* like something
 * the customer will never read. Both were untestable while they sat inside a
 * 1900-line client component that cannot be rendered past its first step.
 * Here they render on their own, and `wizard-fields-render.test.tsx` proves
 * the mark and the collapsed group exist.
 */

import { isFactConfirmed, isLeadSuggestion, type DraftFact } from "@/lib/site-factory/brief-draft";
import { cn } from "@/lib/utils";

export const INPUT_CLASS = "nox-input mt-2";

export function SourceBadge({ source }: { source: string }) {
  if (source !== "LEAD") return null;
  return (
    <span className="rounded-full border border-nox-cyan/40 bg-nox-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-nox-cyan">
      do lead
    </span>
  );
}

/**
 * The mark a prefilled field carries until someone acts on it.
 *
 * A value that appeared on its own, from the lead, must never be mistaken for
 * one a person checked. It disappears the moment the field is confirmed or
 * edited — editing rewrites the source to `OPERADOR`, confirming stamps the
 * time — so it can only ever be read as "nobody has looked at this yet".
 */
export function LeadSuggestionMark() {
  return (
    <p className="mt-1.5 text-xs text-amber-300">sugerido pelo lead — confirme</p>
  );
}

export function Suggestion({ label, onUse }: { label: string; onUse: () => void }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-nox-muted">
      <span className="truncate">
        Do lead: <span className="text-white">{label}</span> — confirme para usar
      </span>
      <button
        type="button"
        onClick={onUse}
        className="rounded-full border border-nox-cyan/40 px-3 py-1 text-[11px] font-semibold text-nox-cyan hover:bg-nox-cyan/10"
      >
        Usar
      </button>
    </p>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  multiline = false,
  placeholder,
  hint,
  className = "",
  invalid = false,
  describedBy,
  source,
  pendingLeadSuggestion = false,
  suggestion,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  source?: string;
  /** Renders the "sugerido pelo lead" mark under a field with no confirm box. */
  pendingLeadSuggestion?: boolean;
  suggestion?: { label: string; onUse: () => void };
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const described = [describedBy, hintId].filter(Boolean).join(" ") || undefined;
  const border = invalid ? "border-red-400/60" : "";
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm text-nox-muted">
          {label}
        </label>
        {source ? <SourceBadge source={source} /> : null}
      </div>
      {multiline ? (
        <textarea
          id={id}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={`${INPUT_CLASS} ${border}`}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={described}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          className={`${INPUT_CLASS} ${border}`}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={described}
        />
      )}
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-nox-muted">
          {hint}
        </p>
      ) : null}
      {pendingLeadSuggestion ? <LeadSuggestionMark /> : null}
      {suggestion ? <Suggestion label={suggestion.label} onUse={suggestion.onUse} /> : null}
    </div>
  );
}

/** A field that reaches the payload only after an explicit confirmation. */
export function ConfirmableField({
  id,
  label,
  fact,
  onValue,
  onConfirm,
  placeholder,
  hint,
  invalid = false,
  suggestion,
}: {
  id: string;
  label: string;
  fact: DraftFact;
  onValue: (value: string) => void;
  onConfirm: (confirmed: boolean) => void;
  placeholder?: string;
  hint?: string;
  invalid?: boolean;
  suggestion?: { label: string; onUse: () => void };
}) {
  const confirmed = isFactConfirmed(fact);
  const filled = fact.value.trim().length > 0;
  return (
    <div>
      <TextField
        id={id}
        label={label}
        value={fact.value}
        onChange={onValue}
        placeholder={placeholder}
        hint={hint}
        invalid={invalid}
        source={fact.source}
        suggestion={suggestion}
      />
      {isLeadSuggestion(fact) ? <LeadSuggestionMark /> : null}
      <label
        htmlFor={`${id}-confirmado`}
        className={`mt-2 inline-flex items-center gap-2 text-xs ${confirmed ? "text-emerald-300" : "text-nox-muted"}`}
      >
        <input
          id={`${id}-confirmado`}
          type="checkbox"
          checked={confirmed}
          disabled={!filled}
          onChange={(event) => onConfirm(event.target.checked)}
          className="size-4 accent-emerald-400 disabled:opacity-40"
        />
        {confirmed ? "Confirmado — será publicado" : "Confirmado (sem isto, não é enviado)"}
      </label>
    </div>
  );
}

/**
 * The fields the operator answers for the operation, not for the visitor.
 *
 * Collapsed and labelled, because "Objetivo principal" and "Público" used to
 * sit next to the published copy and read as though they were part of it —
 * which is exactly how "nicho voltado a restaurante japonês" reached a client's
 * "Sobre" section. They are still required and still validated; they simply no
 * longer look like something a customer will read.
 */
export function InternalNotes({
  invalid,
  className,
  children,
}: {
  invalid: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      // Open when one of its fields is the reason the step will not advance:
      // an error pointing inside a closed group is an error nobody can find.
      //
      // `key` remounts the element when `invalid` flips. React writes `open`
      // only when the prop *changes*, so an operator who collapsed the group
      // by hand while it was already `invalid` would never see it re-open on
      // the next failed attempt.
      key={invalid ? "aberto" : "fechado"}
      open={invalid}
      className={cn(
        "rounded-2xl border bg-nox-bg/40 p-5",
        invalid ? "border-red-400/50" : "border-nox-border",
        className,
      )}
    >
      <summary className="cursor-pointer text-sm font-semibold text-white">
        Notas internas (não aparecem no site)
      </summary>
      <p className="mt-1 mb-4 text-xs text-nox-muted">
        Orientam a geração e ficam no briefing. Nenhuma delas é publicada.
      </p>
      {children}
    </details>
  );
}
