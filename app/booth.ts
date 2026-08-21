/**
 * Booth identity shared by the reviewed catalog sources and the runtime read
 * model. The literal payloads live in the generated catalog snapshot, so this
 * module stays type-only at runtime and never pulls event data into a bundle.
 */

export type Tone = "coral" | "mint" | "blue" | "amber" | "lilac";

export type Booth = {
  id: string;
  code: string;
  name: string;
  pen: string;
  genre: string;
  tags: string[];
  day: string | number;
  hall: string;
  x: number;
  y: number;
  tone: Tone;
  work: string;
  note: string;
};
