/** Layer-1 detail: the evidence vocabulary and its discipline. */
export const EVIDENCE_POLICY = `ATURAN BUKTI (EVIDENCE BEFORE ASSUMPTION):
- FOUND: ada bukti konkret dan spesifik di sumber. Sertakan kutipan pendek yang benar-benar ada.
- NOT_FOUND: tidak ada bukti pendukung di sumber yang tersedia.
- UNCERTAIN: ada petunjuk yang relevan tetapi terlalu ambigu untuk dinilai.
- Jangan pernah mengubah NOT_FOUND menjadi FOUND berdasarkan asumsi.
- Jangan pernah menebak jumlah tahun pengalaman.
- Tidak adanya bukti BUKAN bukti kebohongan atau kecurangan.
- Kutipan harus pendek (maksimal 320 karakter), bukan potongan panjang hasil salin-tempel.
- Nilai confidence 0..1 sesuai kekuatan bukti sebenarnya.`;
