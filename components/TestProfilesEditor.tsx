"use client";

import { useState } from "react";
import { CEFR_LADDER, type CefrRung } from "@/lib/cefr-rung";
import { adminColors } from "@/lib/admin-theme";
import { MAX_MIN_QUESTIONS, PROFILE_LANGUAGES, type ProfileQuestion, type TestProfile } from "@/lib/test-profile-types";

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 4,
  border: `1px solid ${adminColors.border}`,
  background: adminColors.bg,
  color: adminColors.ink,
  fontSize: 13,
};

const buttonStyle = (primary: boolean, disabled = false): React.CSSProperties => ({
  padding: "6px 10px",
  borderRadius: 4,
  border: primary ? "none" : `1px solid ${adminColors.border}`,
  background: primary ? adminColors.ink : "transparent",
  color: primary ? "#fff" : adminColors.ink,
  fontWeight: 600,
  fontSize: 12,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

const labelStyle: React.CSSProperties = { fontSize: 12, color: adminColors.muted, display: "flex", flexDirection: "column", gap: 4 };

const EMPTY_QUESTION: ProfileQuestion = { text: "", simpler: null, minLevel: "B1", maxLevel: "B2", active: true };

/**
 * /admin/profiles: client profiles (roadmap phase 3) and their questions.
 * Local edit state per profile, saved as a whole (PUT /api/test-profiles/:id).
 */
export function TestProfilesEditor({ initial }: { initial: TestProfile[] }) {
  const [profiles, setProfiles] = useState<TestProfile[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const replace = (p: TestProfile) => setProfiles((all) => all.map((x) => (x.id === p.id ? p : x)));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            style={{ ...buttonStyle(p.id === selectedId), ...(p.active ? {} : { textDecoration: "line-through" }) }}
          >
            {p.name}
          </button>
        ))}
        <NewProfileForm
          onCreated={(p) => {
            setProfiles((all) => [...all, p]);
            setSelectedId(p.id);
          }}
        />
      </div>
      {selected ? (
        <ProfileForm key={selected.id} profile={selected} onSaved={replace} />
      ) : (
        <div style={{ color: adminColors.muted, fontSize: 13 }}>No profile yet. Create one above (migration 0020 must have been run).</div>
      )}
    </div>
  );
}

function NewProfileForm({ onCreated }: { onCreated: (p: TestProfile) => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<string>("en");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return <button style={buttonStyle(false)} onClick={() => setOpen(true)}>+ New profile</button>;

  const create = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/test-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name, language }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onCreated(json.profile as TestProfile);
      setOpen(false);
      setId("");
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input style={{ ...inputStyle, width: 120 }} placeholder="id (e.g. airbus)" value={id} onChange={(e) => setId(e.target.value.toLowerCase())} />
      <input style={{ ...inputStyle, width: 140 }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <select style={inputStyle} value={language} onChange={(e) => setLanguage(e.target.value)}>
        {PROFILE_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <button style={buttonStyle(true, pending)} disabled={pending} onClick={create}>Create</button>
      <button style={buttonStyle(false)} onClick={() => setOpen(false)}>Cancel</button>
      {error && <span style={{ color: adminColors.danger, fontSize: 12 }}>{error}</span>}
    </div>
  );
}

function ProfileForm({ profile, onSaved }: { profile: TestProfile; onSaved: (p: TestProfile) => void }) {
  const [draft, setDraft] = useState<TestProfile>(profile);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);

  const set = (patch: Partial<TestProfile>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setQuestion = (i: number, patch: Partial<ProfileQuestion>) =>
    set({ questions: draft.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const move = (i: number, by: -1 | 1) => {
    const qs = [...draft.questions];
    const j = i + by;
    if (j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    set({ questions: qs });
  };

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/test-profiles/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const p = json.profile as TestProfile;
      setDraft(p);
      onSaved(p);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const testLink = typeof window !== "undefined" ? `${window.location.origin}/?profile=${draft.id}` : `/?profile=${draft.id}`;
  const activeCount = draft.questions.filter((q) => q.active).length;

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={labelStyle}>
          Name
          <input style={{ ...inputStyle, width: 180 }} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label style={labelStyle}>
          Language tested
          <select style={inputStyle} value={draft.language} onChange={(e) => set({ language: e.target.value as TestProfile["language"] })}>
            {PROFILE_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label style={labelStyle}>
          Questions asked per test (minimum)
          <input
            type="number"
            min={0}
            max={MAX_MIN_QUESTIONS}
            style={{ ...inputStyle, width: 70 }}
            value={draft.minQuestions}
            onChange={(e) => set({ minQuestions: Number(e.target.value) })}
          />
        </label>
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
          Active
        </label>
      </div>

      <div style={{ fontSize: 12, color: adminColors.muted, marginBottom: 16, maxWidth: 760, lineHeight: 1.5 }}>
        Test link: <code>{testLink}</code>
        <br />
        Each test asks at least this many of the active questions below ({activeCount} active), each when the conversation reaches a
        level inside its range, at most one every other turn, in this order of preference. The test does not end before they have been
        asked (up to the maximum length); in the last part of the test a missing one is asked even out of its range, the closest range
        first. Questions are asked word for word; the simpler version is used if the candidate says they don&apos;t understand. Changes
        apply to new turns within a minute. Only tests in the profile&apos;s language use it.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {draft.questions.map((q, i) => (
          <div
            key={q.id ?? `new-${i}`}
            style={{
              border: `1px solid ${adminColors.border}`,
              borderRadius: 6,
              padding: 10,
              background: adminColors.surface,
              opacity: q.active ? 1 : 0.55,
              display: "grid",
              gridTemplateColumns: "28px 1fr auto",
              gap: 10,
              alignItems: "start",
            }}
          >
            <div style={{ color: adminColors.faint, fontSize: 12, paddingTop: 6 }}>{i + 1}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <textarea
                rows={2}
                style={{ ...inputStyle, width: "100%", resize: "vertical" }}
                placeholder="Question, as Léa will ask it"
                value={q.text}
                onChange={(e) => setQuestion(i, { text: e.target.value })}
              />
              <input
                style={{ ...inputStyle, width: "100%" }}
                placeholder="Simpler version (optional) — asked if the candidate doesn't understand"
                value={q.simpler ?? ""}
                onChange={(e) => setQuestion(i, { simpler: e.target.value || null })}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
              <div style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, color: adminColors.muted }}>
                <LevelSelect value={q.minLevel} onChange={(v) => setQuestion(i, { minLevel: v })} />
                to
                <LevelSelect value={q.maxLevel} onChange={(v) => setQuestion(i, { maxLevel: v })} />
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button style={buttonStyle(false, i === 0)} disabled={i === 0} onClick={() => move(i, -1)} title="Move up">↑</button>
                <button style={buttonStyle(false, i === draft.questions.length - 1)} disabled={i === draft.questions.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
                <button style={buttonStyle(false)} onClick={() => setQuestion(i, { active: !q.active })}>{q.active ? "Disable" : "Enable"}</button>
                <button
                  style={buttonStyle(false)}
                  onClick={() => {
                    if (q.id && !window.confirm("Delete this question? Disabling keeps it.")) return;
                    set({ questions: draft.questions.filter((_, j) => j !== i) });
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <button style={buttonStyle(false)} onClick={() => set({ questions: [...draft.questions, { ...EMPTY_QUESTION }] })}>+ Add a question</button>
        <button style={buttonStyle(true, pending || !dirty)} disabled={pending || !dirty} onClick={save}>{pending ? "Saving…" : "Save"}</button>
        {dirty && !pending && <button style={buttonStyle(false)} onClick={() => setDraft(profile)}>Discard changes</button>}
        {saved && !dirty && <span style={{ fontSize: 12, color: adminColors.muted }}>Saved.</span>}
        {error && <span style={{ fontSize: 12, color: adminColors.danger }}>{error}</span>}
      </div>
    </div>
  );
}

function LevelSelect({ value, onChange }: { value: CefrRung; onChange: (v: CefrRung) => void }) {
  return (
    <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value as CefrRung)}>
      {CEFR_LADDER.map((r) => <option key={r} value={r}>{r}</option>)}
    </select>
  );
}
