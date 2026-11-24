// Check container signatures before publishing worker output under an allowed media type.
// A signature identifies the container; decoding media remains the client's job.
export function matchesMediaType(prefix: Uint8Array, type: string): boolean {
  const bytes = Buffer.from(prefix);
  const text = (start: number, length: number) => bytes.toString("latin1", start, start + length);
  switch (type) {
    case "image/jpeg": return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case "image/png": return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    case "image/gif": return ["GIF87a", "GIF89a"].includes(text(0, 6));
    case "image/webp": return text(0, 4) === "RIFF" && text(8, 4) === "WEBP";
    case "video/webm": return bytes.length >= 4 && bytes.readUIntBE(0, 4) === 0x1a45dfa3 && bytes.includes(Buffer.from("4282847765626d", "hex"));
    case "video/quicktime":
      if (["moov", "wide", "mdat"].includes(text(4, 4))) return true;
      return text(4, 4) === "ftyp" && text(8, 4) === "qt  ";
    case "image/avif":
    case "video/mp4": {
      if (bytes.length < 16 || text(4, 4) !== "ftyp") return false;
      const boxLength = bytes.readUInt32BE(0);
      if (boxLength < 16) return false;
      const brands = [text(8, 4)];
      for (let i = 16; i + 4 <= Math.min(boxLength, bytes.length); i += 4) brands.push(text(i, 4));
      if (brands.some((b) => b === "avif" || b === "avis")) return type === "image/avif";
      return type === "video/mp4" && brands.some((b) => /^(?:iso[m2-9]|mp4[12]|avc1|M4V |dash|MSNV)$/.test(b));
    }
    default: return false;
  }
}
