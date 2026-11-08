import { splitBold } from "../lib/view";
import { renderStepText, type ProcessSpec } from "../lib/spec";

/** Step text with its `**bold**` lead phrase. Plain text nodes only: nothing is parsed as HTML. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((part, i) =>
        part.bold ? (
          <b key={i} className="font-medium text-ds-ink">
            {part.text}
          </b>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <code className="whitespace-nowrap rounded-[4px] border border-ds-border bg-ds-sunken px-1 font-mono text-[11.5px] font-medium text-ds-muted">{children}</code>;
}

/** The SOP in the fixed template, as the mockup's two-column table. Used on the map tab and on the SOP tab. */
export function SopTable({ spec }: { spec: ProcessSpec }) {
  return (
    <dl className="rounded-ds-lg border border-ds-border bg-ds-surface px-[18px] pb-3.5 pt-1.5 text-[13px] text-ds-text">
      <Row label="Purpose">{spec.purpose}</Row>
      <Row label="Trigger">
        {spec.trigger.text} <Chip>{spec.trigger.event}</Chip>
      </Row>
      <Row label="Data needed">{spec.dataNeeded}</Row>
      <Row label="Steps">
        <ol className="flex list-decimal flex-col gap-[5px] pl-[18px]">
          {spec.steps.map((s) => (
            <li key={s.key}>
              <RichText text={renderStepText(s.text, s.targetText)} />
              {s.reads?.length ? <> <Chip>{s.reads.join(" · ")}</Chip></> : null}
            </li>
          ))}
        </ol>
      </Row>
      <Row label="Done when">{spec.doneWhen}</Row>
      <Row label="Exceptions">
        <div className="space-y-1">
          {spec.exceptions.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      </Row>
      <Row label="Example">{spec.example}</Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-ds-divider py-2.5 first:border-t-0 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3.5">
      <dt className="pt-px text-[12px] font-medium text-ds-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
