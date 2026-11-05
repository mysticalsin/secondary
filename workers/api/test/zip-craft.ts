// Hand-built zip archives for the import guards: a header can lie, share bytes or name another entry.
import { crc32 } from "../src/uxv2/zip.ts";

export interface CraftEntry {
  name: string;
  data: Uint8Array;
  /** Name in the local header, when it differs from the central one. */
  localName?: string;
  /** Size the central header declares, when it lies. */
  declared?: number;
  /** Point at the local entry of the entry with this index instead of writing a new one. */
  reuse?: number;
}

const deflate = async (data: Uint8Array): Promise<Uint8Array> => {
  const cs = new CompressionStream("deflate-raw");
  const w = cs.writable.getWriter();
  void w.write(data as Uint8Array<ArrayBuffer>).then(() => w.close());
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
};

export async function craftZip(entries: CraftEntry[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const at: { offset: number; packed: Uint8Array }[] = [];
  let offset = 0;
  for (const [i, e] of entries.entries()) {
    let slot = e.reuse !== undefined ? at[e.reuse] : undefined;
    const name = enc.encode(e.name);
    if (!slot) {
      const packed = await deflate(e.data);
      const lname = enc.encode(e.localName ?? e.name);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(8, 8, true);
      local.setUint32(14, crc32(e.data), true);
      local.setUint32(18, packed.length, true);
      local.setUint32(22, e.declared ?? e.data.length, true);
      local.setUint16(26, lname.length, true);
      parts.push(new Uint8Array(local.buffer), lname, packed);
      slot = { offset, packed };
      offset += 30 + lname.length + packed.length;
    }
    at[i] = slot;
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(16, crc32(e.data), true);
    cd.setUint32(20, slot.packed.length, true);
    cd.setUint32(24, e.declared ?? e.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, slot.offset, true);
    central.push(new Uint8Array(cd.buffer), name);
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
