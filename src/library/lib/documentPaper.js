// PDF defterinin kâğıtları: sayfa bu oranda (boy / en) beyaz bir kâğıt olarak çizilir; yazı
// kâğıdın boyunu aşarsa kâğıt uzar. Varsayılan A4.
export const DOCUMENT_PAPERS = {
  a4: { name: 'A4', caption: '210 × 297 mm', ratio: Math.SQRT2 },
  letter: { name: 'Letter', caption: '216 × 279 mm', ratio: 11 / 8.5 },
}

export const DEFAULT_DOCUMENT_PAPER = 'a4'

export function isDocumentPaper(paper) {
  return paper === 'a4' || paper === 'letter'
}
