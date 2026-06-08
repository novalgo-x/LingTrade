import { readFile } from "fs/promises";
import { extname } from "path";

export async function extractText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".docx":
    case ".doc":
      return extractDocx(filePath);
    case ".pdf":
      return extractPdf(filePath);
    case ".txt":
    case ".md":
      return readFile(filePath, "utf-8");
    default:
      throw new Error(`Unsupported file format: ${ext}`);
  }
}

async function extractDocx(filePath: string): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.default.extractRawText({ path: filePath });
  return result.value;
}

async function extractPdf(filePath: string): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}
