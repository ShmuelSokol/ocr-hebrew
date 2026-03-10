import { NextResponse } from "next/server";
import {
  ABBREVIATIONS,
  SAGE_NAMES,
  TALMUDIC_VOCAB,
  getTalmudicWordFreqs,
  getBigramMap,
} from "@/lib/talmudic-dictionary";

export async function GET() {
  const freqs = getTalmudicWordFreqs();
  const bigrams = getBigramMap();

  // Top words by frequency
  const topWords: { word: string; freq: number }[] = [];
  freqs.forEach((freq, word) => topWords.push({ word, freq }));
  topWords.sort((a, b) => b.freq - a.freq);
  topWords.splice(500);

  // Bigram stats
  const bigramList: { trigger: string; followers: string[] }[] = [];
  bigrams.forEach((followers, trigger) => {
    const arr: string[] = [];
    followers.forEach((f) => arr.push(f));
    bigramList.push({ trigger, followers: arr.slice(0, 20) });
  });
  bigramList.sort((a, b) => b.followers.length - a.followers.length);

  return NextResponse.json({
    stats: {
      totalWords: freqs.size,
      abbreviations: Object.keys(ABBREVIATIONS).length,
      sageNames: SAGE_NAMES.length,
      vocabTerms: TALMUDIC_VOCAB.length,
      bigramTriggers: bigrams.size,
    },
    abbreviations: ABBREVIATIONS,
    sageNames: SAGE_NAMES,
    topWords,
    bigrams: bigramList.slice(0, 200),
  });
}
