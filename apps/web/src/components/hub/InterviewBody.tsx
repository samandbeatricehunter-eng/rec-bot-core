type QaBlock = { question: string; answer: string };

export function parseInterviewBody(body: string | null | undefined): QaBlock[] | null {
  const text = String(body ?? "").trim();
  if (!text) return null;
  const blocks = text.split(/\n\s*\n/).map((chunk) => chunk.trim()).filter(Boolean);
  const parsed: QaBlock[] = [];
  for (const block of blocks) {
    const qMatch = block.match(/^Q:\s*([\s\S]*?)(?:\nA:\s*([\s\S]*))?$/i);
    if (!qMatch) return null;
    parsed.push({
      question: (qMatch[1] ?? "").trim(),
      answer: (qMatch[2] ?? "").trim(),
    });
  }
  return parsed.length ? parsed : null;
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
          <p className="interview-qa-question"><strong>{row.question}</strong></p>
          {row.answer ? <p className="interview-qa-answer">{row.answer}</p> : null}
        </div>
      ))}
    </div>
  );
}
