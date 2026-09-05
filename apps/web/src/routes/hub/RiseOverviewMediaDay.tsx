// Rise to Immortality "Media Day" feature card for the main Overview page (moved off the
// Upgrades page per direction -- it's a season-long narrative feature, not an XP-spend
// control). Shows both of the member's prospects side by side; each answers its own weekly
// slate of 3 questions independently.
//
// The weekly matchup flow below assumes a real scheduled game (opponent, week, bonus claims) --
// that doesn't exist during preseason/training camp or any offseason stage (draft, free agency,
// transfer portal, etc.). gameplaySeasonStages/stageHasScheduledGames decides which of the two
// flows to render, same gate the API side uses (getWeeklyMatchupInterview vs getStageInterview).
import { useCallback, useEffect, useState } from "react";
import { stageHasScheduledGames, type LeagueGame } from "@rec/shared";
import { recApi } from "../../lib/rec-api-client.js";

type Side = "offense" | "defense";
type WeeklyInterview = Awaited<ReturnType<typeof recApi.getImmortalityWeeklyInterview>>;
type StageInterview = Awaited<ReturnType<typeof recApi.getImmortalityStageInterview>>;

function SideMediaDay({ guildId, side, label }: { guildId: string; side: Side; label: string }) {
  const [data, setData] = useState<WeeklyInterview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await recApi.getImmortalityWeeklyInterview({ guildId, side });
    setData(next);
  }, [guildId, side]);

  useEffect(() => {
    load().catch(() => setData(null));
  }, [load]);

  if (!data) return null;

  const currentQuestion = data.questions[data.answers.length] ?? null;

  return (
    <div className="hub-media-day-side">
      <h4>{label} — Week {data.week}</h4>
      {data.answers.map((answer) => {
        const question = data.questions[answer.slot - 1];
        if (!question) return null;
        return (
          <div key={answer.slot} className="hub-media-day-answered">
            <p className="hub-muted">{question.question}</p>
            <p><strong>{question.options[answer.option_index]?.text ?? "Answered"}</strong></p>
            {answer.bonus_stat_category_hint ? (
              <p className="hub-muted">
                Bold claim on the record (+{answer.bonus_xp_pct}% Player XP if it holds up) —{" "}
                {answer.bonus_status === "pending" ? "resolves once this game's result is in." : answer.bonus_status === "met" ? "held up. XP awarded." : "didn't age well."}
              </p>
            ) : null}
          </div>
        );
      })}
      {data.complete ? (
        <p className="hub-muted">Media Day complete for this week — 100 coins earned.</p>
      ) : data.windowClosed ? (
        <p className="hub-muted">This week's window has closed ({data.answers.length}/3 answered).</p>
      ) : currentQuestion ? (
        <div className="hub-media-day-question">
          <p>{currentQuestion.question}</p>
          <div className="hub-media-day-options">
            {currentQuestion.options.map((option, index) => (
              <button
                key={index}
                type="button"
                className="hub-my-team-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await recApi.submitImmortalityWeeklyInterview({ guildId, side, questionId: currentQuestion.id, optionIndex: index });
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not save that answer.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {option.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p className="hub-error">{error}</p> : null}
    </div>
  );
}

function StageSideMediaDay({ guildId, side, label }: { guildId: string; side: Side; label: string }) {
  const [data, setData] = useState<StageInterview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await recApi.getImmortalityStageInterview({ guildId, side });
    setData(next);
  }, [guildId, side]);

  useEffect(() => {
    load().catch(() => setData(null));
  }, [load]);

  if (!data) return null;
  const questions = data.questions ?? (data.question ? [data.question] : []);
  const answers = data.answers ?? (data.answer ? [data.answer] : []);
  const currentQuestion = questions[answers.length] ?? null;

  return (
    <div className="hub-media-day-side">
      <h4>{label}</h4>
      {answers.map((answer, index) => {
        const question = questions.find((item) => item.id === answer.question_id) ?? questions[index];
        if (!question) return null;
        return (
          <div key={`${question.id}-${index}`} className="hub-media-day-answered">
            <p className="hub-muted">{question.question}</p>
            <p><strong>{question.options[answer.option_index]?.text ?? "Answered"}</strong></p>
          </div>
        );
      })}
      {data.complete ? (
        <p className="hub-muted">Media Day complete for this stage — 100 coins earned.</p>
      ) : currentQuestion ? (
        <div className="hub-media-day-question">
          <p>{currentQuestion.question}</p>
          <div className="hub-media-day-options">
            {currentQuestion.options.map((option, index) => (
              <button
                key={index}
                type="button"
                className="hub-my-team-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await recApi.submitImmortalityStageInterview({ guildId, side, questionId: currentQuestion.id, optionIndex: index });
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not save that answer.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {option.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p className="hub-error">{error}</p> : null}
    </div>
  );
}

type OwnerInterview = Awaited<ReturnType<typeof recApi.getImmortalityOwnerInterview>>;

function OwnerMediaDay({ guildId }: { guildId: string }) {
  const [data, setData] = useState<OwnerInterview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await recApi.getImmortalityOwnerInterview({ guildId });
    setData(next);
  }, [guildId]);

  useEffect(() => {
    load().catch(() => setData(null));
  }, [load]);

  if (!data) return null;
  const currentQuestion = data.questions[data.answers.length] ?? null;

  return (
    <div className="hub-media-day-side hub-media-day-owner">
      <h4>Owner</h4>
      {data.answers.map((answer) => {
        const question = data.questions[answer.slot - 1];
        if (!question) return null;
        return (
          <div key={answer.slot} className="hub-media-day-answered">
            <p className="hub-muted">{question.question}</p>
            <p><strong>{question.options[answer.option_index]?.text ?? "Answered"}</strong></p>
          </div>
        );
      })}
      {data.complete ? (
        <p className="hub-muted">Owner interview complete for this week — 100 coins earned.</p>
      ) : currentQuestion ? (
        <div className="hub-media-day-question">
          <p>{currentQuestion.question}</p>
          <div className="hub-media-day-options">
            {currentQuestion.options.map((option, index) => (
              <button
                key={index}
                type="button"
                className="hub-my-team-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await recApi.submitImmortalityOwnerInterview({ guildId, questionId: currentQuestion.id, optionIndex: index });
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not save that answer.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {option.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p className="hub-error">{error}</p> : null}
    </div>
  );
}

export function RiseOverviewMediaDayCard({ guildId, seasonStage, game }: { guildId: string; seasonStage: string; game: LeagueGame }) {
  const inGameplayStage = stageHasScheduledGames(seasonStage, game);
  return (
    <section className="hub-gameday-card hub-media-day-card">
      <p className="hub-eyebrow">Media Day</p>
      <div className="hub-media-day-grid">
        {inGameplayStage ? (
          <SideMediaDay guildId={guildId} side="offense" label="Offense" />
        ) : (
          <StageSideMediaDay guildId={guildId} side="offense" label="Offense" />
        )}
        <OwnerMediaDay guildId={guildId} />
        {inGameplayStage ? (
          <SideMediaDay guildId={guildId} side="defense" label="Defense" />
        ) : (
          <StageSideMediaDay guildId={guildId} side="defense" label="Defense" />
        )}
      </div>
    </section>
  );
}
