import styles from "./candidate.module.css";
import { UiLangSwitcher } from "./UiLangSwitcher";

/** ELAO wordmark (three amber bars + name) used across the candidate screens. */
export function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
        <div style={{ width: 4, height: 10, background: "#F5B921", borderRadius: 1 }} />
        <div style={{ width: 4, height: 17, background: "#F5B921", borderRadius: 1 }} />
        <div style={{ width: 4, height: 23, background: "#F5B921", borderRadius: 1 }} />
      </div>
      <span style={{ fontFamily: "'Outfit',sans-serif", fontSize: 21, fontWeight: 500, color: "#141D33", letterSpacing: "0.02em", lineHeight: 1 }}>
        ELAO
      </span>
    </div>
  );
}

/** Top bar shared by every candidate screen (doc/new_design): ELAO logo left, contextual content and the interface-language menu right. */
export function CandidateTopBar({ right, langSwitcher = true }: { right?: React.ReactNode; langSwitcher?: boolean }) {
  return (
    <div className={styles.topbar}>
      <Logo />
      {langSwitcher ? (
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <UiLangSwitcher />
          {right}
        </div>
      ) : (
        right
      )}
    </div>
  );
}
