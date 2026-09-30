import Link from "next/link";
import { BANK_RUNGS, bankFor, type BankRung } from "@/lib/question-bank";
import { isConvLang, type ConvLang } from "@/lib/conversation-prompts";
import { DOMAIN_LABEL, TOPIC_DOMAINS } from "@/lib/topic-domain";
import { adminColors } from "@/lib/admin-theme";
import styles from "@/components/admin.module.css";

const LANG_TABS: { key: ConvLang; label: string }[] = [
  { key: "fr", label: "Français" },
  { key: "en", label: "English" },
  { key: "nl-BE", label: "Nederlands" },
  { key: "es", label: "Español" },
  { key: "it", label: "Italiano" },
  { key: "de", label: "Deutsch" },
];

const RUNG_NOTE: Record<BankRung, string> = {
  warmup: "Opening question of every session, whatever the starting level.",
  A1: "Léa picks from a random slice of these, and may add one simple follow-up.",
  A2: "Léa picks from a random slice of these, and may add one simple follow-up.",
  B1: "Léa picks from a random slice of these, mixed with her own questions.",
  B2: "Léa picks from a random slice of these, mixed with her own questions.",
  C1: "Chosen by the system: Léa asks the question, then one of its follow-ups, then moves to the next question (new topic). The simpler version is used if the speaker says they don't understand.",
  C2: "Chosen by the system: Léa asks the question, then one of its follow-ups, then moves to the next question (new topic). The simpler version is used if the speaker says they don't understand.",
};

export default async function QuestionBankPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang: langParam } = await searchParams;
  const lang: ConvLang = isConvLang(langParam) ? langParam : "fr";

  return (
    <div>
      <h1 className={styles.pageTitle}>Question bank</h1>
      <div style={{ color: adminColors.muted, fontSize: 13, marginBottom: 20, maxWidth: 680 }}>
        Every question Léa can take from the bank, per level and topic. Read-only — the bank is
        maintained in code (<code>lib/question-bank/</code>).
      </div>

      <div className={styles.tabs}>
        {LANG_TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/question-bank?lang=${t.key}`}
            className={`${styles.tab} ${t.key === lang ? styles.tabActive : ""}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {BANK_RUNGS.map((rung) => {
        const questions = bankFor(rung);
        return (
          <section key={rung} style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 16, color: adminColors.ink, margin: "0 0 4px" }}>
              {rung === "warmup" ? "Warm-up" : rung}{" "}
              <span style={{ color: adminColors.faint, fontWeight: 400 }}>· {questions.length} questions</span>
            </h2>
            <div style={{ color: adminColors.muted, fontSize: 13, marginBottom: 10 }}>{RUNG_NOTE[rung]}</div>
            <div className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Topic</th>
                    <th>Question</th>
                  </tr>
                </thead>
                <tbody>
                  {TOPIC_DOMAINS.flatMap((domain) =>
                    questions
                      .filter((q) => q.domain === domain)
                      .map((q) => (
                        <tr key={q.id}>
                          <td style={{ color: adminColors.muted, fontSize: 12, verticalAlign: "top" }}>
                            {DOMAIN_LABEL[domain]}
                          </td>
                          <td style={{ verticalAlign: "top" }}>
                            <div style={{ color: adminColors.ink }}>{q.text[lang]}</div>
                            {q.simpler && (
                              <div style={{ fontSize: 12, color: adminColors.text, marginTop: 6 }}>
                                <strong>Simpler:</strong> {q.simpler[lang]}
                              </div>
                            )}
                            {q.followUps && q.followUps.length > 0 && (
                              <div style={{ fontSize: 12, color: adminColors.text, marginTop: 4 }}>
                                <strong>Follow-ups:</strong> {q.followUps.map((f) => f[lang]).join(" · ")}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: adminColors.faint, marginTop: 4 }}>{q.id}</div>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
