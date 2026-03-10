// ─── Talmudic Dictionary for OCR Post-Processing ─────────────────
// Comprehensive vocabulary for correcting Hebrew/Aramaic OCR output
// from handwritten Talmud/Gemara study notes.

// ─── Abbreviation mappings (rashei teivot) ───────────────────────
// Maps common abbreviated forms to their expanded text.
// The OCR should keep the abbreviated form, but this helps matching.
export const ABBREVIATIONS: Record<string, string> = {
  // Rishonim & Acharonim
  "רמב\"ם": "רבינו משה בן מימון",
  "רמב״ם": "רבינו משה בן מימון",
  "רש\"י": "רבי שלמה יצחקי",
  "רש״י": "רבי שלמה יצחקי",
  "תוס׳": "תוספות",
  "תוס'": "תוספות",
  "ר\"ן": "רבינו נסים",
  "ר״ן": "רבינו נסים",
  "רשב\"א": "רבי שלמה בן אדרת",
  "רשב״א": "רבי שלמה בן אדרת",
  "רא\"ש": "רבינו אשר",
  "רא״ש": "רבינו אשר",
  "ריטב\"א": "רבי יום טוב בן אברהם",
  "ריטב״א": "רבי יום טוב בן אברהם",
  "רמב\"ן": "רבי משה בן נחמן",
  "רמב״ן": "רבי משה בן נחמן",
  "מהרש\"א": "מורנו הרב שמואל אליעזר",
  "מהרש״א": "מורנו הרב שמואל אליעזר",
  "מהר\"ם": "מורנו הרב מאיר",
  "מהר״ם": "מורנו הרב מאיר",

  // Tractate abbreviations
  "ב\"מ": "בבא מציעא",
  "ב״מ": "בבא מציעא",
  "ב\"ק": "בבא קמא",
  "ב״ק": "בבא קמא",
  "ב\"ב": "בבא בתרא",
  "ב״ב": "בבא בתרא",
  "ע\"ז": "עבודה זרה",
  "ע״ז": "עבודה זרה",
  "א\"ע": "אבן העזר",
  "א״ע": "אבן העזר",
  "חו\"מ": "חושן משפט",
  "חו״מ": "חושן משפט",
  "או\"ח": "אורח חיים",
  "או״ח": "אורח חיים",
  "יו\"ד": "יורה דעה",
  "יו״ד": "יורה דעה",

  // Common text abbreviations
  "ד\"ה": "דיבור המתחיל",
  "ד״ה": "דיבור המתחיל",
  "וכו'": "וכולי",
  "וכו׳": "וכולי",
  "וגו'": "וגומר",
  "וגו׳": "וגומר",
  "ע\"ב": "עמוד ב",
  "ע״ב": "עמוד ב",
  "ע\"א": "עמוד א",
  "ע״א": "עמוד א",
  "ע\"ש": "עיין שם",
  "ע״ש": "עיין שם",
  "ח\"א": "חלק א",
  "ח״א": "חלק א",
  "ח\"ב": "חלק ב",
  "ח״ב": "חלק ב",
  "נ\"ל": "נראה לי",
  "נ״ל": "נראה לי",
  "נ\"מ": "נפקא מינה",
  "נ״מ": "נפקא מינה",
  "צ\"ל": "צריך לומר",
  "צ״ל": "צריך לומר",
  "צ\"ע": "צריך עיון",
  "צ״ע": "צריך עיון",
  "י\"ל": "יש לומר",
  "י״ל": "יש לומר",
  "וי\"ל": "ויש לומר",
  "וי״ל": "ויש לומר",
  "ס\"ל": "סבירא ליה",
  "ס״ל": "סבירא ליה",
  "ז\"ל": "זכרונו לברכה",
  "ז״ל": "זכרונו לברכה",
  "ע\"כ": "על כרחך",
  "ע״כ": "על כרחך",
  "ר\"ל": "רוצה לומר",
  "ר״ל": "רוצה לומר",
  "א\"כ": "אם כן",
  "א״כ": "אם כן",
  "לכ\"ע": "לכולי עלמא",
  "לכ״ע": "לכולי עלמא",
  "מ\"מ": "מכל מקום",
  "מ״מ": "מכל מקום",
  "הנ\"ל": "הנזכר לעיל",
  "הנ״ל": "הנזכר לעיל",
  "דחו\"מ": "דחושן משפט",
};

// ─── Sage Names ──────────────────────────────────────────────────
// Tannaim, Amoraim, Rishonim — names that appear frequently in notes
export const SAGE_NAMES: string[] = [
  // Tannaim
  "רבי", "ר׳", "ר'",
  "רבי עקיבא", "רבי מאיר", "רבי יהודה", "רבי שמעון",
  "רבי יוסי", "רבי אליעזר", "רבי יהושע", "רבי טרפון",
  "רבן גמליאל", "רבי ישמעאל", "רבי נחמיה",
  "הלל", "שמאי", "בית הלל", "בית שמאי",
  "רבי יוחנן בן זכאי", "רבי חנינא בן דוסא",
  "רבי שמעון בן יוחאי", "רשב\"י", "רשב״י",
  "רבי יהודה הנשיא", "רבינו הקדוש",

  // Amoraim - Babylonian
  "רב", "שמואל", "רב הונא", "רב חסדא", "רב נחמן",
  "רבה", "רבא", "אביי", "רב אשי", "רבינא",
  "רב יהודה", "רב ששת", "רב יוסף", "רב פפא",
  "רב זביד", "רב כהנא", "רב דימי", "רבין",
  "מר זוטרא", "אמימר", "רב שימי",
  "רב נחמן בר יצחק", "רב הונא בריה דרב יהושע",

  // Amoraim - Eretz Yisrael
  "רבי יוחנן", "ריש לקיש", "רבי אלעזר",
  "רבי אמי", "רבי אסי", "רבי זירא", "רבי ירמיה",
  "רבי אבהו", "רבי חייא", "רבי אושעיא",
  "רבי שמעון בן לקיש",

  // Rishonim
  "רש\"י", "רש״י", "תוספות", "תוס׳", "תוס'",
  "רמב\"ם", "רמב״ם", "רמב\"ן", "רמב״ן",
  "ר\"ן", "ר״ן", "רשב\"א", "רשב״א",
  "רא\"ש", "רא״ש", "ריטב\"א", "ריטב״א",
  "מהרש\"א", "מהרש״א", "רי\"ף", "רי״ף",
  "תוספות רי\"ד", "מאירי", "נמוקי יוסף",
  "מרדכי", "סמ\"ג", "סמ״ג", "סמ\"ק", "סמ״ק",
  "טור", "שלחן ערוך", "רמ\"א", "רמ״א",
];

// ─── Common Talmudic Vocabulary ──────────────────────────────────
// High-frequency words in Talmudic discourse (Hebrew & Aramaic)
export const TALMUDIC_VOCAB: string[] = [
  // Aramaic discourse markers
  "דאמר", "דאמרי", "אמר", "אמרי",
  "תנן", "תנא", "תניא", "מתני׳", "מתני'",
  "גמ׳", "גמ'", "גמרא", "ברייתא",
  "אמאי", "מאי", "היכי", "הכי",
  "אלא", "אלמא", "אדרבה", "איכא",
  "ליכא", "היינו", "לאו", "דלמא",
  "ודאי", "מיהו", "מיהא", "נמי",
  "דהא", "דהכי", "משום", "משמע",
  "קאמר", "קאמרי", "קתני",
  "פירוש", "פירש", "כלומר",

  // Question/answer patterns
  "קשיא", "תיובתא", "פריך", "מתרץ",
  "לימא", "תיקו", "שמע מינה",
  "מנלן", "מנא הני מילי",
  "איבעיא להו", "בעי", "פשיטא",
  "מהו", "צריכא", "צריכי",

  // Legal terminology
  "מותר", "אסור", "פטור", "חייב",
  "טמא", "טהור", "כשר", "פסול",
  "דאורייתא", "דרבנן", "מדאורייתא", "מדרבנן",
  "לכתחילה", "בדיעבד", "דיעבד",
  "הלכה", "הלכתא", "דינא",
  "מצוה", "מצות", "עבירה",
  "שבת", "יום טוב", "חול המועד",
  "תורה", "נביאים", "כתובים",
  "מקרא", "משנה", "תלמוד", "מדרש",

  // Common connectors & particles
  "שכן", "שהרי", "שאני", "שמא",
  "לפיכך", "הילכך", "מכל מקום",
  "אף על פי", "אע\"פ", "אע״פ",
  "כגון", "כדי", "לפי", "מפני",
  "אלא", "אבל", "ואם", "ואילו",
  "כיון", "כיצד", "מהיכן",
  "עוד", "גם", "אף", "ועוד",
  "לכן", "לפיכך", "לכאורה",
  "להדיא", "בפירוש", "סתם",
  "לעיל", "לקמן", "שם", "כאן",
  "התם", "הכא", "הכי", "הני",

  // Reasoning words
  "טעם", "טעמא", "סברא", "סברה",
  "ראיה", "ראייה", "הוכחה", "סתירה",
  "קושיא", "תירוץ", "חילוק",
  "דיוק", "מוכח", "מוכיח",
  "ילפינן", "ילפי", "נפקא",

  // Common verbs
  "אומר", "סובר", "מביא", "מקשה",
  "מתרץ", "חולק", "מודה", "טוען",
  "פוסק", "מחדש", "מפרש", "מבאר",
  "כתב", "כתוב", "נאמר", "נכתב",
  "למד", "לומד", "דורש", "מלמד",

  // Numbers/counting (common in daf references)
  "דף", "עמוד", "פרק", "משנה", "סימן",
  "הלכה", "סעיף", "אות",

  // Common nouns
  "אדם", "איש", "אשה", "בעל", "קטן", "גדול",
  "כהן", "לוי", "ישראל", "גוי", "עבד", "שפחה",
  "מלך", "נביא", "חכם", "תלמיד",
  "בית דין", "סנהדרין", "דיין", "עד", "עדים",
  "ממון", "קרקע", "מטלטלין", "שטר", "כסף",
  "קרבן", "מנחה", "עולה", "חטאת", "אשם",
  "כלי", "בגד", "אוכל", "משקה",
  "שמים", "ארץ", "עולם",
];

// ─── Punctuation equivalences ────────────────────────────────────
// Maps between different representations of the same punctuation
export const PUNCT_EQUIVALENCES: [string, string][] = [
  ["׳", "'"],   // geresh
  ["״", "\""],  // gershayim
  ["־", "-"],   // maqaf vs hyphen
  ["\u05F3", "'"],  // Hebrew geresh
  ["\u05F4", "\""], // Hebrew gershayim
];

// ─── Common bigrams (word pairs) ─────────────────────────────────
// When word A appears, word B is likely to follow (or vice versa)
export const COMMON_BIGRAMS: [string, string[]][] = [
  ["רבי", ["עקיבא", "מאיר", "יהודה", "שמעון", "יוסי", "אליעזר", "יהושע", "יוחנן", "חנינא", "נחמיה"]],
  ["רב", ["הונא", "חסדא", "נחמן", "יהודה", "ששת", "יוסף", "פפא", "אשי", "כהנא", "דימי", "זביד"]],
  ["בית", ["הלל", "שמאי", "דין", "המקדש", "הכנסת", "המדרש"]],
  ["שלחן", ["ערוך"]],
  ["תלמוד", ["לומר", "בבלי", "ירושלמי"]],
  ["חושן", ["משפט"]],
  ["אורח", ["חיים"]],
  ["יורה", ["דעה"]],
  ["אבן", ["העזר"]],
  ["בבא", ["קמא", "מציעא", "בתרא"]],
  ["עבודה", ["זרה"]],
  ["שמע", ["מינה"]],
  ["נפקא", ["מינה"]],
  ["מנא", ["הני"]],
  ["הני", ["מילי"]],
  ["איבעיא", ["להו"]],
  ["אף", ["על"]],
  ["על", ["פי", "כרחך", "ידי"]],
  ["מכל", ["מקום"]],
  ["כל", ["שכן"]],
  ["יש", ["לומר"]],
  ["צריך", ["לומר", "עיון"]],
  ["נראה", ["לי"]],
  ["סבירא", ["ליה", "להו"]],
  ["פשיטא", ["ליה", "להו"]],
  ["דיבור", ["המתחיל"]],
];

// ─── Sefaria corpus data (extracted from 196 Talmud pages) ───────
// Real word frequencies and bigrams from the Babylonian Talmud
import sefariaWords from "./sefaria-words.json";
import sefariaBigrams from "./sefaria-bigrams.json";

// ─── Build combined word frequency map ───────────────────────────
// Returns Map<word, frequency> combining all sources
let _wordFreqCache: Map<string, number> | null = null;

export function getTalmudicWordFreqs(): Map<string, number> {
  if (_wordFreqCache) return _wordFreqCache;

  const freqs = new Map<string, number>();

  // Sefaria corpus words (real frequencies from Talmud text)
  const sw = sefariaWords as Record<string, number>;
  for (const [word, freq] of Object.entries(sw)) {
    freqs.set(word, (freqs.get(word) || 0) + freq);
  }

  // Add hand-curated abbreviations (high weight — they're definite)
  for (const abbr of Object.keys(ABBREVIATIONS)) {
    freqs.set(abbr, (freqs.get(abbr) || 0) + 50);
  }

  // Add sage names
  for (const name of SAGE_NAMES) {
    freqs.set(name, (freqs.get(name) || 0) + 20);
    for (const part of name.split(" ")) {
      if (part.length > 1) freqs.set(part, (freqs.get(part) || 0) + 10);
    }
  }

  // Add curated vocab
  for (const word of TALMUDIC_VOCAB) {
    freqs.set(word, (freqs.get(word) || 0) + 10);
    for (const [a, b] of PUNCT_EQUIVALENCES) {
      if (word.includes(a)) {
        const alt = word.replace(a, b);
        freqs.set(alt, (freqs.get(alt) || 0) + 5);
      }
      if (word.includes(b)) {
        const alt = word.replace(b, a);
        freqs.set(alt, (freqs.get(alt) || 0) + 5);
      }
    }
  }

  _wordFreqCache = freqs;
  return freqs;
}

// ─── Build combined word set (for fast lookup) ───────────────────
let _allWordsCache: Set<string> | null = null;

export function getAllTalmudicWords(): Set<string> {
  if (_allWordsCache) return _allWordsCache;
  _allWordsCache = new Set(getTalmudicWordFreqs().keys());
  return _allWordsCache;
}

// ─── Bigram lookup ───────────────────────────────────────────────
let _bigramCache: Map<string, Set<string>> | null = null;

export function getBigramMap(): Map<string, Set<string>> {
  if (_bigramCache) return _bigramCache;

  const map = new Map<string, Set<string>>();

  // Hand-curated bigrams
  for (const [trigger, followers] of COMMON_BIGRAMS) {
    if (!map.has(trigger)) map.set(trigger, new Set());
    for (const f of followers) map.get(trigger)!.add(f);
  }

  // Sefaria corpus bigrams (freq >= 5 to avoid noise)
  const sb = sefariaBigrams as Record<string, number>;
  for (const [bigram, freq] of Object.entries(sb)) {
    if (freq < 5) continue;
    const parts = bigram.split(" ");
    if (parts.length !== 2) continue;
    const [a, b] = parts;
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  }

  _bigramCache = map;
  return map;
}
