/**
 * Runs the written test's evaluation (lib/writing) on sample copies, outside
 * the page — to check the two passes and calibrate the grid.
 *
 *   tsx scripts/writing-eval.ts            # every sample
 *   tsx scripts/writing-eval.ts fr-weak    # one sample
 *
 * Prints the level, the bands, the caps and what the code dropped from the
 * survey; writes the full results to sim-runs/writing-eval-<date>.json.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
for (const f of [".env", ".env.local"]) if (existsSync(f)) process.loadEnvFile(f);

import { evaluateWriting } from "@/lib/writing/evaluate";
import { countWords } from "@/lib/writing/tasks";
import { CRITERIA, type WritingLang, type WritingResult } from "@/lib/writing/types";

const SAMPLES: Record<string, { language: WritingLang; texts: [string, string, string] }> = {
  "fr-weak": {
    language: "fr",
    texts: [
      "Salut Marc, je suis desole je peux pas venir samedi. Ma mere est malade et je doit aller chez elle a Lyon. Elle habite loin et je reste la tout le week-end. On peut se voir le samedi prochain ? Ou dimanche apres ? Je t'apelle demain pour parler. Encore pardon pour sa. A bientot, ton ami Paul.",
      "L'année dernier je suis allé a la mer avec mes amis. Nous avons pris le train mais le train il est arrivé en retard de trois heure. Il y avait beaucoup de monde et pas de place pour assis. Moi j'etais très en colère et fatigué, je parle avec le controleur mais il dit rien. Apres on arrive a la plage et il pleut tout le jour. Aujourd'hui je pense que c'est pas grave, je rigole quand je pense ça.",
      "Je suis d'accord avec le teletravail parce que c'est plus facile pour les gens. On reste a la maison et on gagne du temps, pas de transport. Par exemple ma soeur elle travaille a la maison et elle est content, elle a plus de temps pour ses enfants. Mais des gens pensent que c'est pas bon parce que on voit pas les collègues et on est seul. C'est vrai aussi. Pour moi le teletravail c'est bien mais pas tout les jours.",
    ],
  },
  "fr-strong": {
    language: "fr",
    texts: [
      "Cher Marc, je suis vraiment navré, mais je ne pourrai pas venir samedi comme prévu. Mon chef m'a demandé de remplacer au pied levé une collègue lors d'un salon professionnel à Lille, et je n'ai pas pu refuser. Je sais que tu avais réservé une table au restaurant, et j'en suis d'autant plus confus. Serais-tu libre le samedi suivant ? Je m'occuperai de la réservation, c'est la moindre des choses. Encore toutes mes excuses. Amitiés, Paul",
      "Il y a deux ans, j'avais organisé une randonnée en montagne avec des amis, persuadé que la météo resterait clémente. Or, à mi-parcours, un orage a éclaté et nous avons dû nous réfugier dans une cabane où nous avons passé la nuit, trempés. Sur le moment, j'ai culpabilisé, car c'était moi qui avais insisté pour partir malgré les avertissements. Pourtant, cette soirée improvisée reste l'un de mes meilleurs souvenirs. J'en retiens qu'il vaut mieux préparer sérieusement une sortie, mais aussi savoir accueillir l'imprévu.",
      "Bien que le télétravail présente des avantages indéniables, je ne pense pas qu'il doive devenir la norme. Certes, il évite des trajets épuisants : une amie qui habitait à une heure de son bureau a ainsi retrouvé du temps pour sa famille. Cependant, le travail à distance isole et appauvrit les échanges informels, qui sont souvent à l'origine des meilleures idées. Ses défenseurs objecteront que les outils numériques suffisent à maintenir le lien. Je crois plutôt qu'un équilibre entre jours sur site et jours à domicile répond mieux aux besoins de chacun.",
    ],
  },
};

function summary(name: string, r: WritingResult): string {
  const lines = [`\n=== ${name}: ${r.level} (average ${r.weightedAverage}, before caps ${r.uncappedLevel}) — ${Math.round(r.meta.durationMs / 1000)} s`];
  for (const c of CRITERIA) {
    const b = r.criteria[c];
    const flags = [b.hesitation ? `hesitated ${b.hesitation.between.join("/")}` : "", b.noEvidence ? "NO EVIDENCE" : "", b.modelBand !== b.band ? `model said ${b.modelBand}` : ""].filter(Boolean).join(", ");
    lines.push(`  ${c.padEnd(16)} ${b.band}  evidence ${b.evidence.length}${flags ? `  (${flags})` : ""}`);
  }
  for (const cap of r.caps) lines.push(`  cap ${cap.rule} → ${cap.cap}: ${cap.detail}`);
  r.surveys.forEach((s, i) => {
    const dropped = s.dropped.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.reason]: (acc[d.reason] ?? 0) + 1 }), {});
    lines.push(`  T${i + 1} ${s.wordCount} words: ${s.coverage.length} points covered, ${s.facts.length} facts, ${s.interpretations.length} interpreted, dropped ${JSON.stringify(dropped)}`);
  });
  return lines.join("\n");
}

async function main() {
  const only = process.argv[2];
  const names = only ? [only] : Object.keys(SAMPLES);
  const results: Record<string, WritingResult> = {};
  for (const name of names) {
    const s = SAMPLES[name];
    if (!s) throw new Error(`unknown sample ${name}`);
    console.log(`${name}: ${s.texts.map(countWords).join(" / ")} words`);
    results[name] = await evaluateWriting({ language: s.language, texts: s.texts, notesLang: "fr" });
    console.log(summary(name, results[name]));
  }
  mkdirSync("sim-runs", { recursive: true });
  const out = `sim-runs/writing-eval-${new Date().toISOString().slice(0, 16).replace(":", "-")}.json`;
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nFull results: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
