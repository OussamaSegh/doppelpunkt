# Native-speaker review queue

Content in `content/` was drafted without a native review. Before v1.0 every unit needs sign-off
from a German native teacher and, for every Swiss lane, a Zurich German native (Bernese forms from
a Bernese speaker).

## AI pre-review (2026-10-25)

The forms flagged by the drafting author were checked by an AI reviewer against Zurich German
grammar conventions and the SRF *Merkblatt zürichdeutsche Schreibung* (Dieth-based spelling).
**This is not a native review.** It catches clear errors and records the reasoning, so the human
reviewer can work faster. Every line below still needs a native tick.

Legend: ✅ confirmed, no change · ✏️ corrected in content

A second pass (same day) resolved the remaining open items with online sources: the SRF
Merkblatt, the conjugation tables at tal-mi-or.ch and the Wikipedia articles on Zurich and Bernese German.

### Zurich German (gsw-zh)

| Form | Verdict | Notes |
| --- | --- | --- |
| `ire / iri / ires` (ihr) | ✅ | Same pattern as min / mini / mis. |
| `öise / öisi / öises` (unser) | ✅ | öi is typical of Zurich; Bernese üse / üsi / üses. |
| `ich gsee / gsehne` | ✏️ | Now `ich gseh / gsee, du gsehsch, er gseht, mir gsehnd`. Online tables give `ich gsee, du gseesch, er gseet, mir gseend` (the same forms in SRF's gseh spelling); `gsehne` is not listed, so it stays a note only. |
| `du möchtisch, mir möchted` | ✏️ | Now `du möchtsch / möchtisch`. Added the note that Zurich also uses `ich wett`. No source found that settles the du form, so both stay accepted. |
| `söle / sölle` | ✏️ | Both kept; `sölle` listed first. Added `er söll, mir sölled` (SRF rule: double consonants follow Standard spelling). |
| `dörfe … mir dörfed` | ✏️ | Now `ich dörf, du dörfsch, er dörf, mir dörfed` (confirmed by an online Swiss German conjugation table); `darf` noted as also heard. |
| `wele / welle` | ✅ | Both spellings in use; `ich wott, mir wänd` confirmed. |
| `Brüeder / Brueder` | ✏️ | **Error fixed.** The singular is `Brueder`, the plural is `Brüeder` (umlaut kept, like Standard Brüder). Unit 3 used `min Brüeder` for one brother; every instance is now `Brueder`. |
| `Chind` vs `Chinde` | ✏️ | Zurich plural is `Chind` (unchanged); `Chinde` is noted as other regions. |
| Gender of `Zmorge` | ✏️ | `de Zmorge` (m), like `de Zmittag`; `s Znacht` is neuter. Znüni / Zvieri are heard with both de and s. Notes added. |
| `es Kafi` (café) vs `en Kafi` (drink) | ✅ | Correct; note reworded to show both genders. |
| `Suscht / Süscht no öppis?` | ✅ | Both heard in Zurich; `Suscht` kept as primary. |
| `zwei` as default (`zwee / zwo`) | ✅ | Gendered `zwee / zwo / zwei` is now mostly older or rural speech. |
| `zää / zäh / zä` | ✅ | `zää` primary; the others are accepted spellings. |
| `nüün` | ✅ | |
| `Ich hett gern` vs `Ich hett gärn` | ✏️ | `gärn` is now primary everywhere, matching `Gärn gscheh` and Dieth's ä for the open vowel. `gern` stays accepted. |
| `wohäre / wo ane` | ✏️ | `wo ane` listed first (most common in speech: *Wo gaasch ane?*). |
| `niemert / niemer` | ✅ | |
| `moll / momoll` | ✅ | |
| `Täfeli / Zältli` | ✏️ | Kept both; note says Täfeli is Zurich, Zältli more Bernese and central Swiss. |
| `Chacheli` | ✏️ | Kept as an alternative; note says Tasse is the everyday Zurich word. |
| `tifig` | ✅ | quick, nimble. |
| `Güselchübel` | ✅ | |
| `gää` participle (not flagged) | ✏️ | Participle given as `ggää`, following the Dieth spelling (gg for the merged ge + g). |

### Bernese (gsw-be)

| Form | Verdict | Notes |
| --- | --- | --- |
| `Wie geits Ech?` | ✅ | Ech = Euch, as in Grüessech. |
| `Dir / Ihr` as polite form | ✏️ | `Ihr` is the Standard form, not Bernese. Now `Dir` (subject) / `Ech` (object). |
| `vilech` | ✏️ | Now `villech / vilech`; both accepted since there is no fixed spelling. |
| `mir göh`, `i nime`, `Grossätti`, `Ghüderchübu` | ✅ | |

### Swiss Standard German (ch-std)

| Form | Verdict | Notes |
| --- | --- | --- |
| `Kellner / Servicemitarbeiter` | ✅ | |
| `Merci vielmal` (spoken ch-std) | ✏️ | In Swiss Standard it is `Merci vielmals`; `Merci vilmal` stays as the dialect form. |
| `Knabe (official) / Bub` | ✅ | |
| `Hahnenwasser` | ✅ | |

### Curriculum notes (docs/CURRICULUM.md)

| Form | Verdict | Notes |
| --- | --- | --- |
| `Er hät gseit, er heg kei Ziit` | ✏️ | Now `er heig kei Ziit`; `heg` noted as a variant. |
| Baseldytsch (`Kind / Kuchi` with k, `mir sinn`) | ✅ | Matches the standard description of Basel German (no k → ch shift). |

### Still for the native reviewer
- Every ✏️ and ✅ line above, as a quick tick list.
- Natural flow of the unit 2 and unit 3 Swiss-lane dialogues (word order, particles, what a Zurich
  speaker would really say), which an AI review cannot judge reliably.
- Audio scripts once studio recording starts (v0.2).

## Open format questions
- A1 units 1 and 3 use `transform` from `de` to `de` (du → Sie). The UI labels it "Rewrite in Hochdeutsch".
- Listening MCQs refer to the dialogues until studio audio exists (v0.2).
