// In-browser GEDCOM load (TRD §2, §4.2). The file is read as bytes and parsed
// locally — it never leaves the machine. Bytes (not text) are passed to the core
// parser so its charset auto-detection can handle legacy ANSEL files (TRD §7.3).

export function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(new Uint8Array(result));
      else reject(new Error('Unexpected FileReader result'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsArrayBuffer(file);
  });
}
