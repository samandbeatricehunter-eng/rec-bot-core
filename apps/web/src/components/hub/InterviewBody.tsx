type QaBlock = { question: string; answer: string };

/** Prefer structured Q:/A: pairs; fall back to heuristic split for legacy mashed bodies. */
export function parseInterviewBody(body: string | null | undefined): QaBlock[] | null {
  const text = String(body ?? "").trim();
  if (!text) return null;

  const fromLabeled = parseLabeledQa(text);
  if (fromLabeled?.length) return fromLabeled;

  const fromHeuristic = parseHeuristicQa(text);
  if (fromHeuristic?.length) return fromHeuristic;

  return null;
}

function parseLabeledQa(text: string): QaBlock[] | null {
  // Global Q:/A: pairs — tolerates blank lines inside answers.
  const re = /Q:\s*([\s\S]*?)\nA:\s*([\s\S]*?)(?=\nQ:|$)/gi;
  const parsed: QaBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const question = (match[1] ?? "").trim();
    const answer = (match[2] ?? "").trim();
    if (question) parsed.push({ question, answer });
  }
  if (parsed.length) return parsed;

  // Blank-line chunks (legacy formatInterviewBody)
  const blocks = text.split(/\n\s*\n/).map((chunk) => chunk.trim()).filter(Boolean);
  const chunked: QaBlock[] = [];
  for (const block of blocks) {
    const qMatch = block.match(/^Q:\s*([\s\S]*?)(?:\nA:\s*([\s\S]*))?$/i);
    if (!qMatch) continue;
    chunked.push({
      question: (qMatch[1] ?? "").trim(),
      answer: (qMatch[2] ?? "").trim(),
    });
  }
  return chunked.length ? chunked : null;
}

/** Recover Q/A when newlines/prefixes were lost and body is one run-on paragraph. */
function parseHeuristicQa(text: string): QaBlock[] | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  // Split before common interview question openers that end with ?
  const parts = normalized.split(
    /(?=(?:What(?:'s| is| does| did| do| would| has| are)|How (?:does|do|is|are|much)|Where (?:do|did)|Which |Does |Is the |If the )\b)/i,
  )
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    // Single question? Try "Question? Answer"
    const one = normalized.match(/^(.+\?)\s+(.+)$/);
    if (!one) return null;
    return [{ question: one[1]!.trim(), answer: one[2]!.trim() }];
  }

  const parsed: QaBlock[] = [];
  for (const part of parts) {
    const qEnd = part.indexOf("?");
    if (qEnd < 0) continue;
    const question = part.slice(0, qEnd + 1).trim();
    const answer = part.slice(qEnd + 1).trim();
    if (question.length < 12) continue;
    parsed.push({ question, answer });
  }
  return parsed.length >= 2 ? parsed : parsed.length === 1 ? parsed : null;
}

export function InterviewBody({ body }: { body: string | null | undefined }) {
  const qa = parseInterviewBody(body);
  if (!qa) {
    return <p className="roundtable-lede">{body}</p>;
  }
  return (
    <div className="interview-qa">
      {qa.map((row, index) => (
        <div className="interview-qa-block" key={`${index}-${row.question.slice(0, 24)}`}>
          <p className="interview-qa-question">
            <strong>{row.question}</strong>
          </p>
          {row.answer ? <p className="interview-qa-answer">{row.answer}</p> : null}
        </div>
      ))}
    </div>
  );
}
